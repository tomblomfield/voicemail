"use client";
import React, { useEffect, useRef, useState, useCallback } from "react";

import { SessionStatus } from "@/app/types";

import { useTranscript } from "@/app/contexts/TranscriptContext";
import { useEvent } from "@/app/contexts/EventContext";
import { useRealtimeSession } from "./hooks/useRealtimeSession";

import {
  createEmailTriageAgent,
  EmailData,
} from "@/app/agentConfigs/emailTriage";
import type { InferredCalendarProfile } from "@/app/lib/calendar";

type AuthState = {
  authenticated: boolean;
  filterWriteEnabled: boolean;
};

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
  const nextPageTokenRef = useRef<string | undefined>(undefined);

  // Reconnection state
  const connectOptionsRef = useRef<{
    agent: ReturnType<typeof createEmailTriageAgent>;
  } | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isReconnectingRef = useRef(false);
  const isManualDisconnectRef = useRef(false);
  const maxReconnectAttempts = 5;

  const [isMuted, setIsMuted] = useState(false);

  // PWA install prompt
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const deferredPromptRef = useRef<Event | null>(null);

  useEffect(() => {
    // Check if already installed as PWA
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    // Check if dismissed recently
    const dismissed = localStorage.getItem('install-banner-dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) return;

    // Android / Chrome: listen for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e;
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // iOS Safari: detect and show manual instructions
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
        })
      )
      .catch(() =>
        setAuthState({ authenticated: false, filterWriteEnabled: false })
      );
  }, []);

  const fetchSessionData = async (): Promise<{ key: string; dbAvailable: boolean } | null> => {
    logClientEvent({ url: "/session" }, "fetch_session_token_request");
    const tokenResponse = await fetch("/api/session");
    const data = await tokenResponse.json();
    logServerEvent(data, "fetch_session_token_response");

    if (!data.client_secret?.value) {
      logClientEvent(data, "error.no_ephemeral_key");
      console.error("No ephemeral key provided by the server");
      setSessionStatus("DISCONNECTED");
      return null;
    }

    return { key: data.client_secret.value, dbAvailable: !!data.dbAvailable };
  };

  const handleSessionDrop = useCallback(async () => {
    if (reconnectAttemptRef.current >= maxReconnectAttempts) {
      setSessionStatus("DISCONNECTED");
      isReconnectingRef.current = false;
      console.log("session_reconnect_failed: max_attempts_reached");
      try {
        await fetch("/api/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "session_reconnect_failed",
            data: { reason: "max_attempts" },
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

      const session = await fetchSessionData();
      if (!session) {
        handleSessionDrop();
        return;
      }

      await connect({
        getEphemeralKey: async () => session.key,
        initialAgents: [opts.agent],
        audioElement: sdkAudioElement,
        extraContext: { addTranscriptBreadcrumb },
      });

      setTimeout(() => {
        sendEvent({
          type: "session.update",
          session: {
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 200,
              silence_duration_ms: 500,
              create_response: true,
              eagerness: "low",
            },
          },
        });

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
      }, 500);

      reconnectAttemptRef.current = 0;
      isReconnectingRef.current = false;

      console.log(`session_reconnected: attempt=${attempt + 1}`);
      try {
        await fetch("/api/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "session_reconnected",
            data: { attempt: attempt + 1 },
          }),
        });
      } catch {}
    } catch (err) {
      console.error("Reconnection failed:", err);
      handleSessionDrop();
    }
  }, [connect, sdkAudioElement, sendEvent, addTranscriptBreadcrumb, addTranscriptMessage]);

  const connectToRealtime = async () => {
    if (sessionStatus !== "DISCONNECTED") return;
    setSessionStatus("CONNECTING");
    isManualDisconnectRef.current = false;

    try {
      // Reset state
      emailsRef.current = [];
      emailIndexRef.current = 0;
      actionsRef.current = { replied: 0, skipped: 0, archived: 0, blocked: 0, unsubscribed: 0 };
      calendarProfileRef.current = null;
      nextPageTokenRef.current = undefined;

      const session = await fetchSessionData();
      if (!session) return;

      // Create agent with deps — emails will be populated by get_email_count tool
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
        nextPageToken: () => nextPageTokenRef.current,
        setNextPageToken: (token) => { nextPageTokenRef.current = token; },
        dbAvailable: session.dbAvailable,
      });

      connectOptionsRef.current = { agent };

      await connect({
        getEphemeralKey: async () => session.key,
        initialAgents: [agent],
        audioElement: sdkAudioElement,
        extraContext: { addTranscriptBreadcrumb },
      });

      setTimeout(() => {
        sendEvent({
          type: "session.update",
          session: {
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 200,
              silence_duration_ms: 500,
              create_response: true,
              eagerness: "low",
            },
          },
        });

        const id = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
        addTranscriptMessage(id, "user", "hi", true);
        sendEvent({
          type: "conversation.item.create",
          item: {
            id,
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hi" }],
          },
        });
        sendEvent({ type: "response.create" });
      }, 500);
    } catch (err) {
      console.error("Error connecting:", err);
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
  };

  const onToggleConnection = () => {
    if (sessionStatus === "CONNECTED" || sessionStatus === "CONNECTING") {
      disconnectFromRealtime();
    } else {
      connectToRealtime();
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
        <p className="text-gray-500 text-sm mt-1">Hands-free email + calendar</p>
        <a
          href="/api/auth/logout"
          className="inline-block mt-2 text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          Log out
        </a>
        {!filterWriteEnabled && (
          <a
            href="/api/auth"
            className="inline-block mt-3 text-sm text-amber-300 underline underline-offset-4"
          >
            Reconnect Gmail to enable filter management
          </a>
        )}
      </div>

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
