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

  // Reconnection state
  const connectOptionsRef = useRef<{
    agent: ReturnType<typeof createEmailTriageAgent>;
  } | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isReconnectingRef = useRef(false);
  const isManualDisconnectRef = useRef(false);
  const maxReconnectAttempts = 5;

  const { connect, disconnect, sendEvent } =
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

      const session = await fetchSessionData();
      if (!session) return;

      // Create agent with deps — emails will be populated by get_email_count tool
      const actionKeyMap = { reply: "replied", skip: "skipped", archive: "archived", block: "blocked", unsubscribe: "unsubscribed" } as const;
      const agent = createEmailTriageAgent({
        emails: () => emailsRef.current,
        setEmails: (emails) => { emailsRef.current = emails; },
        emailIndex: () => emailIndexRef.current,
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
      <div className="flex items-center justify-center h-screen bg-gray-950 text-white">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-white gap-6 px-8">
        <div className="text-4xl font-bold">Voicemail AI</div>
        <p className="text-gray-400 text-center text-lg max-w-md">
          Hands-free email and calendar for your commute. Connect your Google
          account to get started.
        </p>
        <a
          href="/api/auth"
          className="bg-white text-gray-950 font-semibold text-xl px-8 py-4 rounded-2xl active:scale-95 transition-transform"
        >
          Connect Google
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-between h-screen bg-gray-950 text-white px-6 py-10 select-none">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Voicemail</h1>
        <p className="text-gray-500 text-sm mt-1">Hands-free email + calendar</p>
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

      <button
        onClick={onToggleConnection}
        disabled={isConnecting}
        className={`w-32 h-32 rounded-full flex items-center justify-center text-xl font-bold transition-all active:scale-95 mb-8 ${
          isConnected
            ? "bg-red-600 hover:bg-red-700 text-white"
            : isConnecting
            ? "bg-gray-700 text-gray-400 cursor-not-allowed"
            : "bg-white text-gray-950 hover:bg-gray-200"
        }`}
      >
        {isConnected ? "Stop" : isConnecting ? "..." : "Start"}
      </button>
    </div>
  );
}

export default App;
