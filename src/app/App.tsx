"use client";
import React, { useEffect, useRef, useState } from "react";

import { SessionStatus } from "@/app/types";

import { useTranscript } from "@/app/contexts/TranscriptContext";
import { useEvent } from "@/app/contexts/EventContext";
import { useRealtimeSession } from "./hooks/useRealtimeSession";

import { emailTriageScenario } from "@/app/agentConfigs/emailTriage";

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

  const { connect, disconnect, sendEvent } =
    useRealtimeSession({
      onConnectionChange: (s) => setSessionStatus(s as SessionStatus),
    });

  const [sessionStatus, setSessionStatus] =
    useState<SessionStatus>("DISCONNECTED");
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  // Check Gmail auth status on load
  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((data) => setIsAuthenticated(data.authenticated))
      .catch(() => setIsAuthenticated(false));
  }, []);

  const fetchEphemeralKey = async (): Promise<string | null> => {
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

    return data.client_secret.value;
  };

  const connectToRealtime = async () => {
    if (sessionStatus !== "DISCONNECTED") return;
    setSessionStatus("CONNECTING");

    try {
      const EPHEMERAL_KEY = await fetchEphemeralKey();
      if (!EPHEMERAL_KEY) return;

      await connect({
        getEphemeralKey: async () => EPHEMERAL_KEY,
        initialAgents: emailTriageScenario,
        audioElement: sdkAudioElement,
        extraContext: { addTranscriptBreadcrumb },
      });

      // Send initial message to trigger the greeting
      setTimeout(() => {
        sendEvent({
          type: "session.update",
          session: {
            turn_detection: {
              type: "server_vad",
              threshold: 0.9,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
              create_response: true,
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

  // Get the latest transcript messages for display
  const messages = transcriptItems
    .filter((item) => item.type === "MESSAGE" && !item.isHidden)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
  const latestMessage = messages[messages.length - 1];

  const isConnected = sessionStatus === "CONNECTED";
  const isConnecting = sessionStatus === "CONNECTING";

  // Auth gate
  if (isAuthenticated === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-white">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-white gap-6 px-8">
        <div className="text-4xl font-bold">Voice Nav</div>
        <p className="text-gray-400 text-center text-lg max-w-md">
          Hands-free email triage for your commute. Connect your Gmail to get
          started.
        </p>
        <a
          href="/api/auth"
          className="bg-white text-gray-950 font-semibold text-xl px-8 py-4 rounded-2xl active:scale-95 transition-transform"
        >
          Connect Gmail
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-between h-screen bg-gray-950 text-white px-6 py-10 select-none">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Voice Nav</h1>
        <p className="text-gray-500 text-sm mt-1">Hands-free email</p>
      </div>

      {/* Status / Transcript area */}
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
            Connecting...
          </div>
        )}
        {!isConnected && !isConnecting && (
          <div className="text-gray-600 text-center text-lg">
            Tap the button below to start
          </div>
        )}
      </div>

      {/* Big connect/disconnect button */}
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
