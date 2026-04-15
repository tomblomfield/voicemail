"use client";
import React, { useEffect, useRef, useState, useCallback } from "react";

import { SessionStatus } from "@/app/types";

import { useTranscript } from "@/app/contexts/TranscriptContext";
import { useEvent } from "@/app/contexts/EventContext";
import { useRealtimeSession } from "./hooks/useRealtimeSession";

import {
  createEmailTriageAgent,
  EmailData,
  AccountInfo,
} from "@/app/agentConfigs/emailTriage";
import type { InferredCalendarProfile } from "@/app/lib/calendar";
import { canAutoStartRealtime } from "@/app/lib/microphonePermission";
import {
  DEFAULT_VOICE_MODEL,
  VOICE_MODELS,
  getVoiceModel,
  type VoiceModelId,
} from "@/app/lib/voiceModels";
import {
  DEFAULT_VOICE_SETTINGS,
  INTERRUPT_SENSITIVITY_OPTIONS,
  NOISE_CANCELLATION_OPTIONS,
  SPEECH_SPEED_OPTIONS,
  getSelectedVoiceForModel,
  getVoiceOptionsForModel,
  getVoiceSettingPatch,
  getVoiceSettings,
  parseStoredVoiceSettings,
  type InterruptSensitivity,
  type NoiseCancellationMode,
  type VoiceSettings,
} from "@/app/lib/voiceSettings";
import { setClientLogContext } from "@/app/lib/debugLog";

type AuthState = {
  authenticated: boolean;
  filterWriteEnabled: boolean;
  accounts: AccountInfo[];
};

function voiceLogFields(voiceModelId: VoiceModelId) {
  const voiceModel = getVoiceModel(voiceModelId);
  return {
    provider: voiceModel.provider,
    model: voiceModel.model,
    voiceModel: voiceModel.id,
  };
}

function voiceSettingsLogFields(voiceSettings: VoiceSettings) {
  return {
    speechSpeed: voiceSettings.speechSpeed,
    noiseCancellation: voiceSettings.noiseCancellation,
    interruptSensitivity: voiceSettings.interruptSensitivity,
    openAIVoice: voiceSettings.openAIVoice,
    geminiVoice: voiceSettings.geminiVoice,
  };
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (error && typeof error === "object") {
    const maybeEvent = error as {
      type?: string;
      message?: string;
      error?: unknown;
      target?: { readyState?: number; url?: string };
    };
    return {
      type: maybeEvent.type,
      message: maybeEvent.message,
      error: serializeError(maybeEvent.error),
      target: maybeEvent.target
        ? {
            readyState: maybeEvent.target.readyState,
            url: maybeEvent.target.url,
          }
        : undefined,
      stringValue: String(error),
    };
  }
  return { message: String(error) };
}

function App() {
  const { addTranscriptMessage, addTranscriptBreadcrumb, transcriptItems } =
    useTranscript();
  const { logClientEvent, logServerEvent } = useEvent();

  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const sdkAudioElement = React.useMemo(() => {
    if (typeof window === "undefined") return undefined;
    const el = document.createElement("audio");
    el.autoplay = true;
    el.style.display = "none";
    document.body.appendChild(el);
    return el;
  }, []);

  useEffect(() => {
    if (sdkAudioElement && !audioElementRef.current) {
      audioElementRef.current = sdkAudioElement;
    }
  }, [sdkAudioElement]);

  // Email state (populated by agent tools)
  const emailsRef = useRef<EmailData[]>([]);
  const emailIndexRef = useRef<number>(0);
  const actionsRef = useRef({ replied: 0, skipped: 0, archived: 0, blocked: 0, unsubscribed: 0 });
  const calendarProfileRef = useRef<InferredCalendarProfile | null>(null);
  const nextPageTokensRef = useRef<Record<string, string | null>>({});
  const focusedAccountIdRef = useRef<string | null>(null);

  // Reconnection state
  const connectOptionsRef = useRef<{
    agent: ReturnType<typeof createEmailTriageAgent>;
    voiceModel: VoiceModelId;
    voiceSettings: VoiceSettings;
  } | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isReconnectingRef = useRef(false);
  const isManualDisconnectRef = useRef(false);
  const hasStartedSessionRef = useRef(false);
  const maxReconnectAttempts = 5;

  const [isMuted, setIsMuted] = useState(false);
  const [showAccountPanel, setShowAccountPanel] = useState(false);
  const [selectedVoiceModel, setSelectedVoiceModel] =
    useState<VoiceModelId>(DEFAULT_VOICE_MODEL);
  const [voiceSettings, setVoiceSettings] =
    useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);

  useEffect(() => {
    const stored = localStorage.getItem("voice-model");
    setSelectedVoiceModel(getVoiceModel(stored).id);
    setVoiceSettings(parseStoredVoiceSettings(localStorage.getItem("voice-settings")));
  }, []);

  useEffect(() => {
    setClientLogContext({
      ...voiceLogFields(selectedVoiceModel),
      ...voiceSettingsLogFields(voiceSettings),
    });
  }, [selectedVoiceModel, voiceSettings]);

  // PWA install prompt
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const deferredPromptRef = useRef<Event | null>(null);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    const dismissed = localStorage.getItem('install-banner-dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) return;

    const handler = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e;
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
    const isSafari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);
    if (isIOS && isSafari) {
      setShowInstallBanner(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismissInstallBanner = () => {
    setShowInstallBanner(false);
    localStorage.setItem('install-banner-dismissed', Date.now().toString());
  };

  const { connect, disconnect, sendEvent, mute } =
    useRealtimeSession({
      onConnectionChange: (s) => {
        if (
          s === "DISCONNECTED" &&
          !isManualDisconnectRef.current &&
          connectOptionsRef.current &&
          !isReconnectingRef.current
        ) {
          handleSessionDrop();
        }
        setSessionStatus(s);
      },
    });

  const [sessionStatus, setSessionStatus] =
    useState<SessionStatus>("DISCONNECTED");
  const [authState, setAuthState] = useState<AuthState | null>(null);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((data) =>
        setAuthState({
          authenticated: !!data.authenticated,
          filterWriteEnabled: !!data.filterWriteEnabled,
          accounts: (data.accounts || []).map((a: any) => ({
            id: a.id,
            email: a.email,
            displayName: a.displayName,
            isPrimary: a.isPrimary,
          })),
        })
      )
      .catch(() =>
        setAuthState({ authenticated: false, filterWriteEnabled: false, accounts: [] })
      );
  }, []);

  const fetchSessionData = async (
    voiceModel: VoiceModelId,
  ): Promise<{ key: string; dbAvailable: boolean; accountCount: number } | null> => {
    const modelLogFields = voiceLogFields(voiceModel);
    const url = `/api/session?voiceModel=${encodeURIComponent(voiceModel)}`;
    logClientEvent(
      {
        url,
        ...modelLogFields,
      },
      "fetch_session_token_request",
    );
    const tokenResponse = await fetch(url);
    const data = await tokenResponse.json();
    logServerEvent(data, "fetch_session_token_response");

    if (!data.client_secret?.value) {
      logClientEvent(
        {
          ...data,
          ...modelLogFields,
        },
        "error.no_ephemeral_key",
      );
      console.error("No ephemeral key provided by the server", {
        ...modelLogFields,
      });
      setSessionStatus("DISCONNECTED");
      return null;
    }

    return {
      key: data.client_secret.value,
      dbAvailable: !!data.dbAvailable,
      accountCount: data.accountCount || 1,
    };
  };

  const handleSessionDrop = useCallback(async () => {
    const activeVoiceModel = connectOptionsRef.current?.voiceModel ?? selectedVoiceModel;
    const activeVoiceSettings =
      connectOptionsRef.current?.voiceSettings ?? voiceSettings;
    const modelLogFields = voiceLogFields(activeVoiceModel);
    const settingsLogFields = voiceSettingsLogFields(activeVoiceSettings);
    if (reconnectAttemptRef.current >= maxReconnectAttempts) {
      setSessionStatus("DISCONNECTED");
      isReconnectingRef.current = false;
      console.log("session_reconnect_failed: max_attempts_reached", modelLogFields);
      try {
        await fetch("/api/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "session_reconnect_failed",
            data: {
              reason: "max_attempts",
              ...modelLogFields,
              ...settingsLogFields,
            },
          }),
        });
      } catch {}
      return;
    }

    isReconnectingRef.current = true;
    const attempt = reconnectAttemptRef.current++;
    const delay = Math.min(1000 * Math.pow(2, attempt), 16000);

    setSessionStatus("CONNECTING");

    if (typeof speechSynthesis !== "undefined") {
      const utterance = new SpeechSynthesisUtterance(
        "Connection lost. Reconnecting."
      );
      speechSynthesis.speak(utterance);
    }

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      const opts = connectOptionsRef.current;
      if (!opts) return;

      const session = await fetchSessionData(opts.voiceModel);
      if (!session) {
        handleSessionDrop();
        return;
      }

      await connect({
        getEphemeralKey: async () => session.key,
        initialAgents: [opts.agent],
        audioElement: sdkAudioElement,
        extraContext: { addTranscriptBreadcrumb },
        voiceModel: opts.voiceModel,
        voiceSettings: opts.voiceSettings,
      });

      const sendReconnectEvents = () => {
        try {
          const id = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
          addTranscriptMessage(id, "user", "I'm back, continue where we left off", true);
          sendEvent({
            type: "conversation.item.create",
            item: {
              id,
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: "I'm back, continue where we left off with the next email",
                },
              ],
            },
          });
          sendEvent({ type: "response.create" });
        } catch (e) {
          console.warn("Data channel not ready on reconnect, retrying...", {
            error: e,
            ...modelLogFields,
            ...settingsLogFields,
          });
          setTimeout(sendReconnectEvents, 500);
        }
      };
      setTimeout(sendReconnectEvents, 500);

      reconnectAttemptRef.current = 0;
      isReconnectingRef.current = false;

      console.log(`session_reconnected: attempt=${attempt + 1}`, modelLogFields);
      try {
        await fetch("/api/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "session_reconnected",
            data: {
              attempt: attempt + 1,
              ...modelLogFields,
              ...settingsLogFields,
            },
          }),
        });
      } catch {}
    } catch (err) {
      console.error("Reconnection failed:", {
        error: err,
        ...modelLogFields,
        ...settingsLogFields,
      });
      handleSessionDrop();
    }
  }, [connect, sdkAudioElement, sendEvent, addTranscriptBreadcrumb, addTranscriptMessage, selectedVoiceModel, voiceSettings]);

  const connectToRealtime = async (
    voiceModel: VoiceModelId = selectedVoiceModel,
    settings: VoiceSettings = voiceSettings,
    options: { force?: boolean } = {},
  ) => {
    if (!options.force && sessionStatus !== "DISCONNECTED") return;
    const selectedVoice = getSelectedVoiceForModel(voiceModel, settings);
    hasStartedSessionRef.current = true;
    setSessionStatus("CONNECTING");
    isManualDisconnectRef.current = false;

    try {
      // Reset state
      emailsRef.current = [];
      emailIndexRef.current = 0;
      actionsRef.current = { replied: 0, skipped: 0, archived: 0, blocked: 0, unsubscribed: 0 };
      calendarProfileRef.current = null;
      nextPageTokensRef.current = {};
      focusedAccountIdRef.current = null;

      const session = await fetchSessionData(voiceModel);
      if (!session) return;

      const actionKeyMap = { reply: "replied", skip: "skipped", archive: "archived", block: "blocked", unsubscribe: "unsubscribed" } as const;
      const agent = createEmailTriageAgent({
        emails: () => emailsRef.current,
        setEmails: (emails) => { emailsRef.current = emails; },
        emailIndex: () => emailIndexRef.current,
        setEmailIndex: (index) => { emailIndexRef.current = index; },
        advanceIndex: () => { emailIndexRef.current += 1; },
        recordAction: (action) => {
          const key = actionKeyMap[action];
          actionsRef.current = {
            ...actionsRef.current,
            [key]: actionsRef.current[key] + 1,
          };
        },
        getActionSummary: () => ({ ...actionsRef.current }),
        calendarProfile: () => calendarProfileRef.current,
        setCalendarProfile: (profile) => {
          calendarProfileRef.current = profile;
        },
        nextPageTokens: () => nextPageTokensRef.current,
        setNextPageTokens: (tokens) => { nextPageTokensRef.current = tokens; },
        focusedAccountId: () => focusedAccountIdRef.current,
        setFocusedAccountId: (id) => { focusedAccountIdRef.current = id; },
        dbAvailable: session.dbAvailable,
        voice: selectedVoice,
        onMute: () => {
          setIsMuted(true);
          mute(true);
        },
        onStop: () => {
          disconnectFromRealtime();
        },
        onLogout: () => {
          disconnectFromRealtime();
          window.location.href = "/api/auth/logout";
        },
        accounts: authState?.accounts || [],
        logContext: {
          ...voiceLogFields(voiceModel),
          ...voiceSettingsLogFields(settings),
          voice: selectedVoice,
        },
      });

      connectOptionsRef.current = { agent, voiceModel, voiceSettings: settings };

      await connect({
        getEphemeralKey: async () => session.key,
        initialAgents: [agent],
        audioElement: sdkAudioElement,
        extraContext: { addTranscriptBreadcrumb },
        voiceModel,
        voiceSettings: settings,
      });

      // Kick off the first model turn once the data channel is ready.
      const startInitialResponse = () => {
        try {
          sendEvent({ type: "response.create" });
        } catch (e) {
          console.warn("Data channel not ready, retrying...", e);
          setTimeout(startInitialResponse, 500);
        }
      };
      setTimeout(startInitialResponse, 500);
    } catch (err) {
      const errorDetails = {
        error: serializeError(err),
        ...voiceLogFields(voiceModel),
        ...voiceSettingsLogFields(settings),
        voice: selectedVoice,
      };
      try {
        await fetch("/api/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "connect_to_realtime_failed",
            category: "error",
            data: errorDetails,
          }),
        });
      } catch {}
      setSessionStatus("DISCONNECTED");
    }
  };

  const disconnectFromRealtime = () => {
    isManualDisconnectRef.current = true;
    isReconnectingRef.current = false;
    reconnectAttemptRef.current = 0;
    connectOptionsRef.current = null;
    disconnect();
    setSessionStatus("DISCONNECTED");
    setIsMuted(false);
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    mute(next);
    // When unmuting, nudge the AI so it knows the user is back
    if (!next && sessionStatus === "CONNECTED") {
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
      addTranscriptMessage(id, "user", "I'm back", true);
      sendEvent({
        type: "conversation.item.create",
        item: {
          id,
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "The user just unmuted their microphone. They're ready to continue. Pick up where you left off.",
            },
          ],
        },
      });
      sendEvent({ type: "response.create" });
    }
  };

  const onToggleConnection = () => {
    if (sessionStatus === "CONNECTED" || sessionStatus === "CONNECTING") {
      disconnectFromRealtime();
    } else {
      connectToRealtime();
    }
  };

  const changeVoiceModel = (voiceModel: VoiceModelId) => {
    setSelectedVoiceModel(voiceModel);
    localStorage.setItem("voice-model", voiceModel);

    if (sessionStatus === "CONNECTED") {
      disconnectFromRealtime();
      setTimeout(() => connectToRealtime(voiceModel, voiceSettings, { force: true }), 250);
    }
  };

  const changeVoiceSettings = (patch: Partial<VoiceSettings>) => {
    const next = getVoiceSettings({ ...voiceSettings, ...patch });
    setVoiceSettings(next);
    localStorage.setItem("voice-settings", JSON.stringify(next));

    if (sessionStatus === "CONNECTED") {
      disconnectFromRealtime();
      setTimeout(() => connectToRealtime(selectedVoiceModel, next, { force: true }), 250);
    }
  };

  const changeVoice = (voice: string) => {
    const provider = getVoiceModel(selectedVoiceModel).provider;
    changeVoiceSettings(getVoiceSettingPatch(provider, voice));
  };

  const removeAccount = async (accountId: string) => {
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", accountId }),
      });
      const data = await res.json();
      if (data.remainingCount === 0) {
        window.location.href = "/api/auth/logout";
        return;
      }
      // Refresh auth state
      const statusRes = await fetch("/api/auth/status");
      const statusData = await statusRes.json();
      setAuthState({
        authenticated: !!statusData.authenticated,
        filterWriteEnabled: !!statusData.filterWriteEnabled,
        accounts: (statusData.accounts || []).map((a: any) => ({
          id: a.id,
          email: a.email,
          displayName: a.displayName,
          isPrimary: a.isPrimary,
        })),
      });
    } catch (err) {
      console.error("Failed to remove account:", err);
    }
  };

  const messages = transcriptItems
    .filter((item) => item.type === "MESSAGE" && !item.isHidden)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
  const latestMessage = messages[messages.length - 1];

  const isConnected = sessionStatus === "CONNECTED";
  const isConnecting = sessionStatus === "CONNECTING";
  const isAuthenticated = authState?.authenticated ?? false;
  const filterWriteEnabled = authState?.filterWriteEnabled ?? false;
  const accounts = authState?.accounts || [];

  // Auto-start only when the browser has already granted persistent mic access.
  // Otherwise reloads in browsers with one-time/ephemeral mic grants immediately
  // trigger another permission prompt before the user taps Start.
  useEffect(() => {
    if (!isAuthenticated || sessionStatus !== "DISCONNECTED" || hasStartedSessionRef.current) {
      return;
    }

    let isCurrent = true;

    canAutoStartRealtime().then((canAutoStart) => {
      if (!isCurrent || !canAutoStart || hasStartedSessionRef.current) return;
      connectToRealtime();
    });

    return () => {
      isCurrent = false;
    };
  }, [isAuthenticated, sessionStatus]);

  if (authState === null) {
    return (
      <div className="flex items-center justify-center h-dvh-safe bg-gray-950 text-white">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    if (typeof window !== "undefined") {
      window.location.href = "/api/auth/logout";
    }
    return (
      <div className="flex items-center justify-center h-dvh-safe bg-gray-950 text-white">
        <div className="text-xl">Redirecting...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-between h-dvh-safe bg-gray-950 text-white px-6 py-6 select-none">
      {showInstallBanner && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
          <div className="flex-1 text-sm text-gray-200">
            <span className="font-medium">Add to Home Screen</span>
            <span className="text-gray-400 ml-1">— Tap</span>
            <svg className="inline w-4 h-4 mx-1 -mt-0.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span className="text-gray-400">then &ldquo;Add to Home Screen&rdquo;</span>
          </div>
          <button onClick={dismissInstallBanner} className="ml-3 text-gray-500 hover:text-gray-300 text-lg leading-none">&times;</button>
        </div>
      )}

      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Voicemail</h1>
        <p className="text-gray-500 text-sm mt-1">Hands-free email & calendar</p>

        {/* Account management toggle */}
        <button
          onClick={() => setShowAccountPanel(!showAccountPanel)}
          className="inline-block mt-2 text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          {accounts.length > 0
            ? `${accounts.length} account${accounts.length > 1 ? "s" : ""} connected · Add +`
            : "Log out"}
        </button>

        {!filterWriteEnabled && (
          <a
            href="/api/auth"
            className="inline-block mt-3 text-sm text-amber-300 underline underline-offset-4"
          >
            Reconnect Gmail to enable filter management
          </a>
        )}
      </div>

      {/* Account management panel */}
      {showAccountPanel && (
        <div className="w-full max-w-sm mt-4 p-4 rounded-2xl border border-gray-800/60 bg-gray-900/60">
          <div className="text-sm font-medium text-gray-400 mb-3">
            Connected accounts
          </div>
          <div className="space-y-2">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-200 truncate">
                    {account.displayName ? (
                      <>
                        {account.displayName}
                        <span className="text-gray-500 text-xs ml-1.5">
                          ({account.email})
                        </span>
                      </>
                    ) : (
                      account.email
                    )}
                  </div>
                  {account.isPrimary && (
                    <span className="text-[10px] text-indigo-400 font-medium uppercase tracking-wider">
                      Primary
                    </span>
                  )}
                </div>
                <button
                  onClick={() => removeAccount(account.id)}
                  className="ml-3 text-xs text-gray-600 hover:text-red-400 transition-colors shrink-0"
                >
                  Disconnect
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-gray-800/60">
            <div className="text-sm font-medium text-gray-400 mb-2">
              Voice model
            </div>
            <div className="space-y-1.5">
              {VOICE_MODELS.map((model) => (
                <label
                  key={model.id}
                  className="flex items-start gap-2 py-1.5 text-left"
                >
                  <input
                    type="radio"
                    name="voice-model"
                    value={model.id}
                    checked={selectedVoiceModel === model.id}
                    disabled={isConnecting}
                    onChange={() => changeVoiceModel(model.id)}
                    className="mt-1 accent-indigo-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-gray-200">
                      {model.label}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {model.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-gray-800/60 space-y-3">
            <div>
              <label
                htmlFor="voice"
                className="block text-sm font-medium text-gray-400 mb-1.5"
              >
                Voice
              </label>
              <select
                id="voice"
                value={getSelectedVoiceForModel(selectedVoiceModel, voiceSettings)}
                disabled={isConnecting}
                onChange={(event) => changeVoice(event.target.value)}
                className="w-full rounded-md bg-gray-950 border border-gray-800 px-2.5 py-2 text-sm text-gray-200"
              >
                {getVoiceOptionsForModel(selectedVoiceModel).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} - {option.description}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="speech-speed"
                className="block text-sm font-medium text-gray-400 mb-1.5"
              >
                Speech speed
              </label>
              <select
                id="speech-speed"
                value={voiceSettings.speechSpeed}
                disabled={isConnecting}
                onChange={(event) =>
                  changeVoiceSettings({
                    speechSpeed: Number(event.target.value),
                  })
                }
                className="w-full rounded-md bg-gray-950 border border-gray-800 px-2.5 py-2 text-sm text-gray-200"
              >
                {SPEECH_SPEED_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="noise-cancellation"
                className="block text-sm font-medium text-gray-400 mb-1.5"
              >
                Background noise cancellation
              </label>
              <select
                id="noise-cancellation"
                value={voiceSettings.noiseCancellation}
                disabled={isConnecting}
                onChange={(event) =>
                  changeVoiceSettings({
                    noiseCancellation: event.target
                      .value as NoiseCancellationMode,
                  })
                }
                className="w-full rounded-md bg-gray-950 border border-gray-800 px-2.5 py-2 text-sm text-gray-200"
              >
                {NOISE_CANCELLATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {
                  NOISE_CANCELLATION_OPTIONS.find(
                    (option) => option.value === voiceSettings.noiseCancellation,
                  )?.description
                }
              </p>
            </div>

            <div>
              <label
                htmlFor="interrupt-sensitivity"
                className="block text-sm font-medium text-gray-400 mb-1.5"
              >
                Interrupt sensitivity
              </label>
              <select
                id="interrupt-sensitivity"
                value={voiceSettings.interruptSensitivity}
                disabled={isConnecting}
                onChange={(event) =>
                  changeVoiceSettings({
                    interruptSensitivity: event.target
                      .value as InterruptSensitivity,
                  })
                }
                className="w-full rounded-md bg-gray-950 border border-gray-800 px-2.5 py-2 text-sm text-gray-200"
              >
                {INTERRUPT_SENSITIVITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {
                  INTERRUPT_SENSITIVITY_OPTIONS.find(
                    (option) => option.value === voiceSettings.interruptSensitivity,
                  )?.description
                }
              </p>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-gray-800/60 flex flex-col gap-2">
            {accounts.length < 5 && (
              <a
                href="/api/auth?addAccount=true"
                className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                + Add another account
              </a>
            )}
            <div className="flex items-center gap-4">
              <a
                href="/api/auth/logout"
                className="text-xs text-gray-600 hover:text-red-400 transition-colors"
              >
                {accounts.length > 1 ? "Disconnect all & log out" : "Log out"}
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-lg gap-4">
        {isConnected && latestMessage && (
          <div className="text-center px-4">
            <div
              className={`text-sm font-mono mb-2 ${
                latestMessage.role === "user"
                  ? "text-blue-400"
                  : "text-green-400"
              }`}
            >
              {latestMessage.role === "user" ? "You" : "Assistant"}
            </div>
            <div className="text-lg leading-relaxed text-gray-200">
              {latestMessage.title}
            </div>
          </div>
        )}
        {isConnecting && (
          <div className="text-gray-400 text-lg animate-pulse">
            {isReconnectingRef.current ? "Reconnecting..." : "Connecting..."}
          </div>
        )}
        {!isConnected && !isConnecting && (
          <div className="text-gray-600 text-center text-lg">
            Tap the button below to start
          </div>
        )}
      </div>

      <div className="relative mb-2 flex items-center justify-center">
        <button
          onClick={onToggleConnection}
          disabled={isConnecting}
          className={`w-32 h-32 rounded-full flex items-center justify-center text-xl font-bold transition-all active:scale-95 ${
            isConnected
              ? "bg-red-600 hover:bg-red-700 text-white"
              : isConnecting
              ? "bg-gray-700 text-gray-400 cursor-not-allowed"
              : "bg-white text-gray-950 hover:bg-gray-200"
          }`}
        >
          {isConnected ? "Stop" : isConnecting ? "..." : "Start"}
        </button>

        {isConnected && (
          <button
            onClick={toggleMute}
            className={`absolute -right-14 w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${
              isMuted
                ? "bg-amber-500 hover:bg-amber-600 text-white"
                : "bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white"
            }`}
            title={isMuted ? "Unmute microphone" : "Mute microphone"}
          >
            {isMuted ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.36 2.18" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default App;
