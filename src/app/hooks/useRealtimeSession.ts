import { useCallback, useRef, useState, useEffect } from 'react';
import {
  RealtimeSession,
  RealtimeAgent,
  OpenAIRealtimeWebRTC,
} from '@openai/agents/realtime';
import type { FunctionTool } from '@openai/agents/realtime';
import { GoogleGenAI, Modality, type Session as GeminiSession } from '@google/genai';

import { applyCodecPreferences } from '../lib/codecUtils';
import { useEvent } from '../contexts/EventContext';
import { useTranscript } from '../contexts/TranscriptContext';
import { useHandleSessionHistory } from './useHandleSessionHistory';
import { SessionStatus } from '../types';
import { debugLogClient, debugLogClientVerbose, setClientLogContext } from '../lib/debugLog';
import { logClientLatencyTelemetry } from '../lib/telemetry';
import { DEFAULT_VOICE_MODEL, getVoiceModel, type VoiceModelId } from '../lib/voiceModels';
import {
  DEFAULT_VOICE_SETTINGS,
  getGeminiRealtimeSettings,
  getOpenAIRealtimeSettings,
  type VoiceSettings,
} from '../lib/voiceSettings';

export interface RealtimeSessionCallbacks {
  onConnectionChange?: (status: SessionStatus) => void;
  onAgentHandoff?: (agentName: string) => void;
}

export interface ConnectOptions {
  getEphemeralKey: () => Promise<string>;
  initialAgents: RealtimeAgent[];
  audioElement?: HTMLAudioElement;
  extraContext?: Record<string, any>;
  outputGuardrails?: any[];
  voiceModel?: VoiceModelId;
  voiceSettings?: VoiceSettings;
}

type GeminiLiveRefs = {
  session: GeminiSession;
  mediaStream: MediaStream;
  inputContext: AudioContext;
  outputContext: AudioContext;
  processor: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
  silentGain: GainNode;
  scheduledSources: AudioBufferSourceNode[];
  nextPlaybackTime: number;
  speechSpeed: number;
  audioChunksSent: number;
  audioChunksWithSignal: number;
  firstSignalChunkLogged: boolean;
  lastAudioChunkLogAt: number;
  muted: boolean;
  closed: boolean;
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToInt16Array(data: string): Int16Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function float32ToPcm16(input: Float32Array): ArrayBuffer {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}

function resampleFloat32(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, input.length - 1);
    const weight = sourceIndex - left;
    output[i] = input[left] * (1 - weight) + input[right] * weight;
  }
  return output;
}

function getAudioRateFromMimeType(mimeType?: string, fallback = 24000): number {
  const match = mimeType?.match(/rate=(\d+)/);
  return match ? Number(match[1]) : fallback;
}

function getRms(input: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    sum += input[i] * input[i];
  }
  return Math.sqrt(sum / input.length);
}

async function resumeAudioContext(context: AudioContext, label: string) {
  const startingState = context.state;
  if (startingState === "suspended") {
    try {
      await Promise.race([
        context.resume(),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    } catch (error) {
      debugLogClientVerbose("error", "gemini_audio_context_resume_failed", {
        label,
        startingState,
        error: error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
      });
    }
  }
  debugLogClientVerbose("event", "gemini_audio_context_state", {
    label,
    startingState,
    state: context.state,
    sampleRate: context.sampleRate,
  });
}

function getSafeTrackDetails(track: MediaStreamTrack) {
  const settings = track.getSettings?.() ?? {};
  // Strip sensitive device identifiers before logging
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { deviceId, groupId, ...safeSettings } = settings;

  return {
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
    settings: safeSettings,
  };
}

function extractOpenAITextEvent(ev: any): string {
  if (ev?.type !== "conversation.item.create") return "";
  const content = ev.item?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item: any) => item?.text)
    .filter((text: any): text is string => typeof text === "string" && text.length > 0)
    .join("\n");
}

export function useRealtimeSession(callbacks: RealtimeSessionCallbacks = {}) {
  const sessionRef = useRef<RealtimeSession | null>(null);
  const geminiRef = useRef<GeminiLiveRefs | null>(null);
  const activeVoiceModelRef = useRef(getVoiceModel(DEFAULT_VOICE_MODEL));
  const [status, setStatus] = useState<
    SessionStatus
  >('DISCONNECTED');
  const { logClientEvent } = useEvent();
  const {
    addTranscriptMessage,
    updateTranscriptMessage,
    updateTranscriptItem,
    addTranscriptBreadcrumb,
  } = useTranscript();

  const updateStatus = useCallback(
    (s: SessionStatus) => {
      setStatus(s);
      callbacks.onConnectionChange?.(s);
      logClientEvent({}, s);
    },
    [callbacks],
  );

  const { logServerEvent } = useEvent();

  const historyHandlers = useHandleSessionHistory().current;
  const lastUserTranscriptAtRef = useRef<number | null>(null);
  const responseStartedAtRef = useRef<Map<string, number>>(new Map());
  const firstOutputLoggedRef = useRef<Set<string>>(new Set());
  const geminiInputTranscriptIdRef = useRef<string | null>(null);
  const geminiOutputTranscriptIdRef = useRef<string | null>(null);
  const geminiResponseStartedAtRef = useRef<number | null>(null);
  const geminiFirstOutputLoggedRef = useRef(false);

  function getResponseId(event: any): string {
    return event.response?.id || event.response_id || "unknown";
  }

  function logFirstRealtimeOutput(event: any, outputType: string) {
    const responseId = getResponseId(event);
    if (firstOutputLoggedRef.current.has(responseId)) return;

    const startedAt = responseStartedAtRef.current.get(responseId);
    if (startedAt === undefined) return;

    firstOutputLoggedRef.current.add(responseId);
    const now = performance.now();
    logClientLatencyTelemetry({
      provider: "openai",
      operation: "realtime.first_output",
      durationMs: now - startedAt,
      status: "ok",
      model: activeVoiceModelRef.current.model,
      metrics: {
        outputType,
        sinceUserTranscriptMs:
          lastUserTranscriptAtRef.current === null
            ? undefined
            : now - lastUserTranscriptAtRef.current,
      },
    });
  }

  function handleTransportEvent(event: any) {
    debugLogClient("event", `transport_event: ${event.type}`, event.type === "response.audio_transcript.delta" ? { delta: event.delta?.slice?.(0, 50) } : event);
    // Handle additional server events that aren't managed by the session
    switch (event.type) {
      case "conversation.item.input_audio_transcription.completed": {
        lastUserTranscriptAtRef.current = performance.now();
        debugLogClient("event", "USER SAID:", event.transcript);
        historyHandlers.handleTranscriptionCompleted(event);
        break;
      }
      case "response.created": {
        responseStartedAtRef.current.set(getResponseId(event), performance.now());
        logServerEvent(event);
        break;
      }
      case "response.audio.delta": {
        logFirstRealtimeOutput(event, "audio");
        logServerEvent(event);
        break;
      }
      case "response.audio_transcript.done": {
        debugLogClient("event", "ASSISTANT SAID:", event.transcript);
        historyHandlers.handleTranscriptionCompleted(event);
        break;
      }
      case "response.audio_transcript.delta": {
        logFirstRealtimeOutput(event, "transcript");
        historyHandlers.handleTranscriptionDelta(event);
        break;
      }
      case "response.done": {
        const responseId = getResponseId(event);
        const startedAt = responseStartedAtRef.current.get(responseId);
        if (startedAt !== undefined) {
          logClientLatencyTelemetry({
            provider: "openai",
            operation: "realtime.response.done",
            durationMs: performance.now() - startedAt,
            status: "ok",
            model: activeVoiceModelRef.current.model,
          });
          responseStartedAtRef.current.delete(responseId);
          firstOutputLoggedRef.current.delete(responseId);
        }
        logServerEvent(event);
        break;
      }
      default: {
        logServerEvent(event);
        break;
      }
    }
  }

  const codecParamRef = useRef<string>(
    (typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('codec') ?? 'opus')
      : 'opus')
      .toLowerCase(),
  );

  // Wrapper to pass current codec param.
  // This lets you use the codec selector in the UI to force narrow-band (8 kHz) codecs to
  // simulate how the voice agent sounds over a PSTN/SIP phone call.
  const applyCodec = useCallback(
    (pc: RTCPeerConnection) => applyCodecPreferences(pc, codecParamRef.current),
    [],
  );

  const handleAgentHandoff = (item: any) => {
    const history = item.context.history;
    const lastMessage = history[history.length - 1];
    const agentName = lastMessage.name.split("transfer_to_")[1];
    debugLogClient("event", `AGENT HANDOFF → ${agentName}`, { history: history.slice(-3) });
    callbacks.onAgentHandoff?.(agentName);
  };

  function logFirstGeminiOutput(outputType: string) {
    if (geminiFirstOutputLoggedRef.current) return;
    if (geminiResponseStartedAtRef.current === null) return;
    geminiFirstOutputLoggedRef.current = true;
    logClientLatencyTelemetry({
      provider: "gemini",
      operation: "live.first_output",
      durationMs: performance.now() - geminiResponseStartedAtRef.current,
      status: "ok",
      model: activeVoiceModelRef.current.model,
      metrics: { outputType },
    });
  }

  function playGeminiAudio(data: string, mimeType?: string) {
    const gemini = geminiRef.current;
    if (!gemini || gemini.closed) return;

    const pcm = base64ToInt16Array(data);
    const sampleRate = getAudioRateFromMimeType(mimeType);
    const buffer = gemini.outputContext.createBuffer(1, pcm.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) {
      channel[i] = pcm[i] / 0x8000;
    }

    const source = gemini.outputContext.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = gemini.speechSpeed;
    source.connect(gemini.outputContext.destination);

    const startAt = Math.max(gemini.outputContext.currentTime, gemini.nextPlaybackTime);
    source.start(startAt);
    gemini.nextPlaybackTime = startAt + buffer.duration / gemini.speechSpeed;
    gemini.scheduledSources.push(source);
    source.onended = () => {
      gemini.scheduledSources = gemini.scheduledSources.filter((s) => s !== source);
    };
  }

  function stopGeminiPlayback() {
    const gemini = geminiRef.current;
    if (!gemini) return;
    for (const source of gemini.scheduledSources) {
      try {
        source.stop();
      } catch {}
    }
    gemini.scheduledSources = [];
    gemini.nextPlaybackTime = gemini.outputContext.currentTime;
  }

  async function runGeminiTool(functionCall: any, tools: FunctionTool[]) {
    const gemini = geminiRef.current;
    if (!gemini || !functionCall?.name) return;

    const tool = tools.find((candidate) => candidate.name === functionCall.name);
    if (!tool) {
      gemini.session.sendToolResponse({
        functionResponses: {
          id: functionCall.id,
          name: functionCall.name,
          response: { error: `Unknown tool: ${functionCall.name}` },
        },
      });
      return;
    }

    const args = functionCall.args ?? {};
    debugLogClient("tool", `GEMINI TOOL START: ${functionCall.name}`, { args });
    addTranscriptBreadcrumb(`function call: ${functionCall.name}`, args);

    try {
      const result = await tool.invoke(undefined as any, JSON.stringify(args));
      debugLogClient("tool", `GEMINI TOOL END: ${functionCall.name}`, { result });
      addTranscriptBreadcrumb(`function call result: ${functionCall.name}`, result as any);
      gemini.session.sendToolResponse({
        functionResponses: {
          id: functionCall.id,
          name: functionCall.name,
          response: { output: result as any },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debugLogClient("error", `GEMINI TOOL ERROR: ${functionCall.name}`, { error: message });
      addTranscriptBreadcrumb(`function call result: ${functionCall.name}`, { error: message });
      gemini.session.sendToolResponse({
        functionResponses: {
          id: functionCall.id,
          name: functionCall.name,
          response: { error: message },
        },
      });
    }
  }

  function handleGeminiTranscript(
    role: "user" | "assistant",
    text: string,
    finished?: boolean,
  ) {
    if (!text) return;
    const idRef =
      role === "user" ? geminiInputTranscriptIdRef : geminiOutputTranscriptIdRef;

    let itemId = idRef.current;
    if (!itemId) {
      itemId = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
      idRef.current = itemId;
      addTranscriptMessage(itemId, role, text);
    } else {
      updateTranscriptMessage(itemId, text, true);
    }

    if (finished) {
      updateTranscriptItem(itemId, { status: "DONE" });
      idRef.current = null;
      if (role === "assistant") {
        geminiResponseStartedAtRef.current = null;
        geminiFirstOutputLoggedRef.current = false;
      }
    }
  }

  function closeGeminiSession() {
    const gemini = geminiRef.current;
    if (!gemini) return;
    gemini.closed = true;
    stopGeminiPlayback();
    try {
      gemini.processor.disconnect();
      gemini.source.disconnect();
      gemini.silentGain.disconnect();
    } catch {}
    for (const track of gemini.mediaStream.getTracks()) {
      track.stop();
    }
    void gemini.inputContext.close().catch(() => {});
    void gemini.outputContext.close().catch(() => {});
    try {
      gemini.session.close();
    } catch {}
    geminiRef.current = null;
  }

  function sendGeminiText(text: string) {
    const gemini = geminiRef.current;
    if (!gemini || !text.trim()) return;
    geminiResponseStartedAtRef.current = performance.now();
    geminiFirstOutputLoggedRef.current = false;
    gemini.session.sendRealtimeInput({ text });
  }

  useEffect(() => {
    if (sessionRef.current) {
      // Log server errors
      sessionRef.current.on("error", (...args: any[]) => {
        debugLogClient("error", "SESSION ERROR", args[0]);
        logServerEvent({
          type: "error",
          message: args[0],
        });
      });

      // history events
      sessionRef.current.on("agent_handoff", handleAgentHandoff);
      sessionRef.current.on("agent_tool_start", (details: any, agent: any, functionCall: any) => {
        debugLogClient("tool", `TOOL START: ${functionCall?.name}`, { args: functionCall?.arguments });
        historyHandlers.handleAgentToolStart(details, agent, functionCall);
      });
      sessionRef.current.on("agent_tool_end", (details: any, agent: any, functionCall: any, result: any) => {
        debugLogClient("tool", `TOOL END: ${functionCall?.name}`, { result });
        historyHandlers.handleAgentToolEnd(details, agent, functionCall, result);
      });
      sessionRef.current.on("history_updated", historyHandlers.handleHistoryUpdated);
      sessionRef.current.on("history_added", (item: any) => {
        debugLogClient("event", "HISTORY ADDED", item);
        historyHandlers.handleHistoryAdded(item);
      });
      sessionRef.current.on("guardrail_tripped", (details: any, agent: any, guardrail: any) => {
        debugLogClient("error", "GUARDRAIL TRIPPED", guardrail);
        historyHandlers.handleGuardrailTripped(details, agent, guardrail);
      });

      // additional transport events
      sessionRef.current.on("transport_event", handleTransportEvent);
    }
  }, [sessionRef.current]);

  const connect = useCallback(
    async ({
      getEphemeralKey,
      initialAgents,
      audioElement,
      extraContext,
      outputGuardrails,
      voiceModel = DEFAULT_VOICE_MODEL,
      voiceSettings = DEFAULT_VOICE_SETTINGS,
    }: ConnectOptions) => {
      if (sessionRef.current || geminiRef.current) return; // already connected

      updateStatus('CONNECTING');

      const ek = await getEphemeralKey();
      const rootAgent = initialAgents[0];
      const selectedVoiceModel = getVoiceModel(voiceModel);
      const selectedVoiceSettings = voiceSettings;
      const selectedVoice =
        selectedVoiceModel.provider === "gemini"
          ? selectedVoiceSettings.geminiVoice
          : selectedVoiceSettings.openAIVoice;
      activeVoiceModelRef.current = selectedVoiceModel;
      setClientLogContext({
        provider: selectedVoiceModel.provider,
        model: selectedVoiceModel.model,
        voiceModel: selectedVoiceModel.id,
        voice: selectedVoice,
        speechSpeed: selectedVoiceSettings.speechSpeed,
        noiseCancellation: selectedVoiceSettings.noiseCancellation,
        interruptSensitivity: selectedVoiceSettings.interruptSensitivity,
        openAIVoice: selectedVoiceSettings.openAIVoice,
        geminiVoice: selectedVoiceSettings.geminiVoice,
      });

      if (selectedVoiceModel.provider === "gemini") {
        const tools = ((await rootAgent.getAllTools()) as any[]).filter(
          (toolCandidate): toolCandidate is FunctionTool =>
            toolCandidate?.type === "function",
        );
        const functionDeclarations = tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.parameters,
        }));
        const systemInstruction = await rootAgent.getSystemPrompt(undefined as any);

        debugLogClient("event", "Connecting to Gemini Live...", {
          model: selectedVoiceModel.model,
          toolCount: functionDeclarations.length,
          voiceSettings: selectedVoiceSettings,
        });
        const connectStartMs = performance.now();
        const geminiSettings = getGeminiRealtimeSettings(selectedVoiceSettings);

        try {
          const outputContext = new AudioContext({ sampleRate: 24000 });
          const inputContext = new AudioContext({ sampleRate: 16000 });
          inputContext.onstatechange = () => {
            debugLogClientVerbose("event", "gemini_audio_context_state", {
              label: "input",
              state: inputContext.state,
              sampleRate: inputContext.sampleRate,
            });
          };
          outputContext.onstatechange = () => {
            debugLogClientVerbose("event", "gemini_audio_context_state", {
              label: "output",
              state: outputContext.state,
              sampleRate: outputContext.sampleRate,
            });
          };
          await Promise.all([
            resumeAudioContext(inputContext, "input"),
            resumeAudioContext(outputContext, "output"),
          ]);

          let mediaStream: MediaStream;
          try {
            mediaStream = await navigator.mediaDevices.getUserMedia({
              audio: geminiSettings.mediaTrackConstraints,
            });
          } catch (error) {
            if (selectedVoiceSettings.noiseCancellation === "off") {
              throw error;
            }
            debugLogClientVerbose("error", "gemini_mic_constraints_fallback", {
              error: error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
              requestedConstraints: geminiSettings.mediaTrackConstraints,
            });
            mediaStream = await navigator.mediaDevices.getUserMedia({
              audio: { channelCount: 1 },
            });
          }
          const audioTracks = mediaStream.getAudioTracks();
          debugLogClientVerbose("event", "gemini_mic_stream_ready", {
            active: mediaStream.active,
            audioTracks: audioTracks.map(getSafeTrackDetails),
          });
          for (const track of audioTracks) {
            track.onmute = () => {
              debugLogClientVerbose("event", "gemini_mic_track_muted", getSafeTrackDetails(track));
            };
            track.onunmute = () => {
              debugLogClientVerbose("event", "gemini_mic_track_unmuted", getSafeTrackDetails(track));
            };
            track.onended = () => {
              debugLogClientVerbose("event", "gemini_mic_track_ended", getSafeTrackDetails(track));
            };
          }

          const source = inputContext.createMediaStreamSource(mediaStream);
          const processor = inputContext.createScriptProcessor(4096, 1, 1);
          const silentGain = inputContext.createGain();
          silentGain.gain.value = 0;

          const ai = new GoogleGenAI({ apiKey: ek, apiVersion: "v1alpha" });
          const geminiSession = await ai.live.connect({
            model: selectedVoiceModel.model,
            callbacks: {
              onmessage: (message) => {
                debugLogClient("event", "gemini_live_message", message);
                logServerEvent({
                  type: "gemini.live.message",
                  payload: message,
                });

                if (message.serverContent?.interrupted) {
                  stopGeminiPlayback();
                }

                const inputText = message.serverContent?.inputTranscription?.text;
                const inputFinished =
                  message.serverContent?.inputTranscription?.finished;
                if (inputText) {
                  handleGeminiTranscript("user", inputText, inputFinished);
                }

                const outputText =
                  message.serverContent?.outputTranscription?.text;
                const outputFinished =
                  message.serverContent?.outputTranscription?.finished ||
                  message.serverContent?.turnComplete;
                if (outputText) {
                  logFirstGeminiOutput("transcript");
                  handleGeminiTranscript("assistant", outputText, outputFinished);
                }

                const parts = message.serverContent?.modelTurn?.parts ?? [];
                for (const part of parts) {
                  const inlineData = part.inlineData;
                  if (inlineData?.data && inlineData.mimeType?.startsWith("audio/")) {
                    logFirstGeminiOutput("audio");
                    playGeminiAudio(inlineData.data, inlineData.mimeType);
                  }
                }

                if (message.toolCall?.functionCalls?.length) {
                  void Promise.all(
                    message.toolCall.functionCalls.map((call) =>
                      runGeminiTool(call, tools),
                    ),
                  );
                }
              },
              onerror: (event) => {
                debugLogClient("error", "GEMINI LIVE ERROR", event.message);
                logServerEvent({
                  type: "error",
                  message: event.message,
                });
              },
              onclose: () => {
                debugLogClient("event", "Gemini Live closed");
                if (!geminiRef.current?.closed) {
                  geminiRef.current = null;
                  updateStatus("DISCONNECTED");
                }
              },
            },
            config: {
              responseModalities: [Modality.AUDIO],
              systemInstruction,
              tools: [{ functionDeclarations }],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              speechConfig: geminiSettings.speechConfig,
              realtimeInputConfig: {
                ...geminiSettings.realtimeInputConfig,
              },
              temperature: 0.7,
            },
          });

          const geminiRefs: GeminiLiveRefs = {
            session: geminiSession,
            mediaStream,
            inputContext,
            outputContext,
            processor,
            source,
            silentGain,
            scheduledSources: [],
            nextPlaybackTime: outputContext.currentTime,
            speechSpeed: geminiSettings.speechSpeed,
            audioChunksSent: 0,
            audioChunksWithSignal: 0,
            firstSignalChunkLogged: false,
            lastAudioChunkLogAt: 0,
            muted: false,
            closed: false,
          };
          geminiRef.current = geminiRefs;

          processor.onaudioprocess = (event) => {
            const gemini = geminiRef.current;
            if (!gemini || gemini.closed || gemini.muted) return;
            const input = event.inputBuffer.getChannelData(0);
            const rms = getRms(input);
            const resampled = resampleFloat32(
              input,
              inputContext.sampleRate,
              16000,
            );
            const pcm16 = float32ToPcm16(resampled);
            gemini.audioChunksSent += 1;
            if (rms > 0.003) {
              gemini.audioChunksWithSignal += 1;
            }

            const now = performance.now();
            const shouldLogAudioChunk =
              gemini.audioChunksSent <= 3 ||
              (rms > 0.003 && !gemini.firstSignalChunkLogged) ||
              now - gemini.lastAudioChunkLogAt > 5000;
            if (shouldLogAudioChunk) {
              gemini.lastAudioChunkLogAt = now;
              if (rms > 0.003) {
                gemini.firstSignalChunkLogged = true;
              }
              debugLogClientVerbose("event", "gemini_mic_audio_chunk", {
                audioChunksSent: gemini.audioChunksSent,
                audioChunksWithSignal: gemini.audioChunksWithSignal,
                rms: Number(rms.toFixed(5)),
                inputFrames: input.length,
                inputSampleRate: inputContext.sampleRate,
                outputFrames: resampled.length,
                inputContextState: inputContext.state,
                track: audioTracks[0] ? getSafeTrackDetails(audioTracks[0]) : null,
              });
            }

            gemini.session.sendRealtimeInput({
              audio: {
                data: arrayBufferToBase64(pcm16),
                mimeType: "audio/pcm;rate=16000",
              },
            });
          };

          source.connect(processor);
          processor.connect(silentGain);
          silentGain.connect(inputContext.destination);
          await resumeAudioContext(inputContext, "input");

          logClientLatencyTelemetry({
            provider: "gemini",
            operation: "live.connect",
            durationMs: performance.now() - connectStartMs,
            status: "ok",
            model: selectedVoiceModel.model,
          });
        } catch (error) {
          logClientLatencyTelemetry({
            provider: "gemini",
            operation: "live.connect",
            durationMs: performance.now() - connectStartMs,
            status: "error",
            model: selectedVoiceModel.model,
            errorType: error instanceof Error ? error.name : "Error",
          });
          closeGeminiSession();
          throw error;
        }

        debugLogClient("event", "Connected to Gemini Live");
        updateStatus('CONNECTED');
        return;
      }

      const openAISettings = getOpenAIRealtimeSettings(selectedVoiceSettings);
      sessionRef.current = new RealtimeSession(rootAgent, {
        transport: new OpenAIRealtimeWebRTC({
          audioElement,
          // Set preferred codec before offer creation
          changePeerConnection: async (pc: RTCPeerConnection) => {
            applyCodec(pc);
            return pc;
          },
        }),
        model: selectedVoiceModel.model,
        config: {
          turnDetection: openAISettings.turnDetection,
          providerData: {
            input_audio_noise_reduction:
              openAISettings.inputAudioNoiseReduction,
            speed: openAISettings.speed,
          },
        } as any,
        outputGuardrails: outputGuardrails ?? [],
        context: extraContext ?? {},
      });

      debugLogClient("event", "Connecting to OpenAI realtime...", {
        model: selectedVoiceModel.model,
        voiceSettings: selectedVoiceSettings,
        realtimeSettings: openAISettings,
      });
      const connectStartMs = performance.now();
      try {
        await sessionRef.current.connect({ apiKey: ek });
        logClientLatencyTelemetry({
          provider: "openai",
          operation: "realtime.connect",
          durationMs: performance.now() - connectStartMs,
          status: "ok",
          model: selectedVoiceModel.model,
        });
      } catch (error) {
        logClientLatencyTelemetry({
          provider: "openai",
          operation: "realtime.connect",
          durationMs: performance.now() - connectStartMs,
          status: "error",
          model: selectedVoiceModel.model,
          errorType: error instanceof Error ? error.name : "Error",
        });
        throw error;
      }
      debugLogClient("event", "Connected to OpenAI realtime ✓");
      updateStatus('CONNECTED');
    },
    [callbacks, updateStatus],
  );

  const disconnect = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    closeGeminiSession();
    updateStatus('DISCONNECTED');
  }, [updateStatus]);

  const assertconnected = () => {
    if (!sessionRef.current && !geminiRef.current) {
      throw new Error('RealtimeSession not connected');
    }
  };

  /* ----------------------- message helpers ------------------------- */

  const interrupt = useCallback(() => {
    if (geminiRef.current) {
      stopGeminiPlayback();
      return;
    }
    sessionRef.current?.interrupt();
  }, []);
  
  const sendUserText = useCallback((text: string) => {
    assertconnected();
    if (geminiRef.current) {
      sendGeminiText(text);
      return;
    }
    sessionRef.current!.sendMessage(text);
  }, []);

  const sendEvent = useCallback((ev: any) => {
    if (geminiRef.current) {
      const text = extractOpenAITextEvent(ev);
      if (text) {
        sendGeminiText(text);
        return;
      }
      if (ev?.type === "response.create") {
        sendGeminiText("Start the session now. Follow your startup instructions.");
      }
      return;
    }
    sessionRef.current?.transport.sendEvent(ev);
  }, []);

  const mute = useCallback((m: boolean) => {
    if (geminiRef.current) {
      geminiRef.current.muted = m;
      if (m) {
        geminiRef.current.session.sendRealtimeInput({ audioStreamEnd: true });
      }
      return;
    }
    sessionRef.current?.mute(m);
  }, []);

  const pushToTalkStart = useCallback(() => {
    if (geminiRef.current) return;
    if (!sessionRef.current) return;
    sessionRef.current.transport.sendEvent({ type: 'input_audio_buffer.clear' } as any);
  }, []);

  const pushToTalkStop = useCallback(() => {
    if (geminiRef.current) return;
    if (!sessionRef.current) return;
    sessionRef.current.transport.sendEvent({ type: 'input_audio_buffer.commit' } as any);
    sessionRef.current.transport.sendEvent({ type: 'response.create' } as any);
  }, []);

  return {
    status,
    connect,
    disconnect,
    sendUserText,
    sendEvent,
    mute,
    pushToTalkStart,
    pushToTalkStop,
    interrupt,
  } as const;
}
