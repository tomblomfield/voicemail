import { useCallback, useRef, useState, useEffect } from 'react';
import {
  RealtimeSession,
  RealtimeAgent,
  OpenAIRealtimeWebRTC,
} from '@openai/agents/realtime';

import { applyCodecPreferences } from '../lib/codecUtils';
import { useEvent } from '../contexts/EventContext';
import { useHandleSessionHistory } from './useHandleSessionHistory';
import { SessionStatus } from '../types';
import { debugLogClient } from '../lib/debugLog';
import { logClientLatencyTelemetry } from '../lib/telemetry';

const REALTIME_MODEL = 'gpt-realtime-1.5';

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
}

export function useRealtimeSession(callbacks: RealtimeSessionCallbacks = {}) {
  const sessionRef = useRef<RealtimeSession | null>(null);
  const [status, setStatus] = useState<
    SessionStatus
  >('DISCONNECTED');
  const { logClientEvent } = useEvent();

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
      model: REALTIME_MODEL,
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
            model: REALTIME_MODEL,
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
    }: ConnectOptions) => {
      if (sessionRef.current) return; // already connected

      updateStatus('CONNECTING');

      const ek = await getEphemeralKey();
      const rootAgent = initialAgents[0];

      sessionRef.current = new RealtimeSession(rootAgent, {
        transport: new OpenAIRealtimeWebRTC({
          audioElement,
          // Set preferred codec before offer creation
          changePeerConnection: async (pc: RTCPeerConnection) => {
            applyCodec(pc);
            return pc;
          },
        }),
        model: REALTIME_MODEL,
        config: {
          turn_detection: {
            type: 'server_vad',
            threshold: 0.65,
            prefix_padding_ms: 200,
            silence_duration_ms: 500,
            create_response: true,
            eagerness: 'low',
          },
          speed: 1.2,
        } as any,
        outputGuardrails: outputGuardrails ?? [],
        context: extraContext ?? {},
      });

      debugLogClient("event", "Connecting to OpenAI realtime...", { model: REALTIME_MODEL });
      const connectStartMs = performance.now();
      try {
        await sessionRef.current.connect({ apiKey: ek });
        logClientLatencyTelemetry({
          provider: "openai",
          operation: "realtime.connect",
          durationMs: performance.now() - connectStartMs,
          status: "ok",
          model: REALTIME_MODEL,
        });
      } catch (error) {
        logClientLatencyTelemetry({
          provider: "openai",
          operation: "realtime.connect",
          durationMs: performance.now() - connectStartMs,
          status: "error",
          model: REALTIME_MODEL,
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
    updateStatus('DISCONNECTED');
  }, [updateStatus]);

  const assertconnected = () => {
    if (!sessionRef.current) throw new Error('RealtimeSession not connected');
  };

  /* ----------------------- message helpers ------------------------- */

  const interrupt = useCallback(() => {
    sessionRef.current?.interrupt();
  }, []);
  
  const sendUserText = useCallback((text: string) => {
    assertconnected();
    sessionRef.current!.sendMessage(text);
  }, []);

  const sendEvent = useCallback((ev: any) => {
    sessionRef.current?.transport.sendEvent(ev);
  }, []);

  const mute = useCallback((m: boolean) => {
    sessionRef.current?.mute(m);
  }, []);

  const pushToTalkStart = useCallback(() => {
    if (!sessionRef.current) return;
    sessionRef.current.transport.sendEvent({ type: 'input_audio_buffer.clear' } as any);
  }, []);

  const pushToTalkStop = useCallback(() => {
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
