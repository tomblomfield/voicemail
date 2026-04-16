import { NextRequest, NextResponse } from "next/server";
import {
  decryptTokens,
  hasRequiredGoogleScopes,
} from "@/app/lib/gmail";
import { debugLog, debugLogVerbose } from "@/app/lib/debugLog";
import {
  initDb,
  upsertUser,
  isDbAvailable,
  getGoogleAccounts,
  getUserByEmail,
  updateUserProfile,
} from "@/app/lib/db";
import {
  SESSION_COOKIE_NAME,
  getSessionUserId,
} from "@/app/lib/session";
import { logLatencyTelemetry } from "@/app/lib/telemetry";
import { GoogleGenAI } from "@google/genai";
import { getVoiceModel } from "@/app/lib/voiceModels";

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (!sessionCookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = getSessionUserId(sessionCookie.value);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await getGoogleAccounts(userId);
  let userEmail: string | null = null;
  let accountCount = 0;

  for (const a of accounts) {
    try {
      const tokens = decryptTokens(a.encrypted_tokens);
      if (hasRequiredGoogleScopes(tokens)) {
        if (!userEmail) userEmail = a.email;
        accountCount++;
      }
    } catch {
      // skip bad tokens
    }
  }

  if (accountCount === 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const voiceModel = getVoiceModel(request.nextUrl.searchParams.get("voiceModel"));
  const browserTimezone = request.nextUrl.searchParams.get("timezone");
  let providerStartMs: number | null = null;
  let userTimezone: string | null = null;
  try {
    console.log(
      `session_started: ${userEmail} accounts=${accountCount} voiceModel=${voiceModel.id}`
    );
    if (userEmail && isDbAvailable()) {
      await initDb();
      await upsertUser(userEmail);

      // Resolve timezone: prefer browser-detected, fall back to stored
      const user = await getUserByEmail(userEmail);
      if (browserTimezone) {
        userTimezone = browserTimezone;
        // Persist browser timezone if different from stored
        if (user?.timezone !== browserTimezone) {
          await updateUserProfile(userEmail, { timezone: browserTimezone });
        }
      } else {
        userTimezone = user?.timezone || null;
      }
    }

    if (voiceModel.provider === "gemini") {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        logLatencyTelemetry({
          provider: "gemini",
          operation: "live.auth_tokens.create",
          durationMs: 0,
          status: "error",
          route: "/api/session",
          httpStatus: 500,
          model: voiceModel.model,
          errorType: "MissingGeminiApiKey",
          metrics: { accountCount },
        });
        debugLog("error", "Gemini voice model missing API key", {
          provider: voiceModel.provider,
          model: voiceModel.model,
          voiceModel: voiceModel.id,
        });
        return NextResponse.json(
          { error: "GEMINI_API_KEY is required for Gemini voice models" },
          { status: 500 }
        );
      }

      debugLog("api", "Creating Gemini Live ephemeral token...", {
        provider: voiceModel.provider,
        model: voiceModel.model,
        voiceModel: voiceModel.id,
      });
      providerStartMs = Date.now();
      const client = new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });
      const token = await client.authTokens.create({
        config: {
          uses: 1,
          expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
          httpOptions: { apiVersion: "v1alpha" },
        },
      });

      logLatencyTelemetry({
        provider: "gemini",
        operation: "live.auth_tokens.create",
        durationMs: Date.now() - providerStartMs,
        status: "ok",
        route: "/api/session",
        model: voiceModel.model,
        metrics: { accountCount },
      });

      debugLog("api", "Gemini Live ephemeral token created", {
        provider: voiceModel.provider,
        model: voiceModel.model,
        voiceModel: voiceModel.id,
      });

      return NextResponse.json({
        client_secret: { value: token.name },
        provider: voiceModel.provider,
        voiceModel: voiceModel.id,
        model: voiceModel.model,
        dbAvailable: isDbAvailable(),
        accountCount,
        timezone: userTimezone,
      });
    }

    debugLog("api", "Creating OpenAI realtime session...", {
      provider: voiceModel.provider,
      model: voiceModel.model,
      voiceModel: voiceModel.id,
    });
    providerStartMs = Date.now();
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: voiceModel.model,
        }),
      }
    );
    const data = await response.json();
    logLatencyTelemetry({
      provider: "openai",
      operation: "realtime.sessions.create",
      durationMs: Date.now() - providerStartMs,
      status: response.ok ? "ok" : "error",
      route: "/api/session",
      httpStatus: response.status,
      model: voiceModel.model,
      metrics: { accountCount },
    });
    debugLog("api", "OpenAI realtime session created", {
      provider: voiceModel.provider,
      id: data.id,
      model: data.model,
      requestedModel: voiceModel.model,
      voiceModel: voiceModel.id,
      expires_at: data.expires_at,
    });
    debugLogVerbose("api", "OpenAI realtime session FULL RESPONSE", {
      provider: voiceModel.provider,
      model: voiceModel.model,
      voiceModel: voiceModel.id,
      response: data,
    });
    return NextResponse.json({
      ...data,
      provider: voiceModel.provider,
      voiceModel: voiceModel.id,
      model: voiceModel.model,
      dbAvailable: isDbAvailable(),
      accountCount,
      timezone: userTimezone,
    });
  } catch (error) {
    logLatencyTelemetry({
      provider: voiceModel.provider,
      operation:
        voiceModel.provider === "gemini"
          ? "live.auth_tokens.create"
          : "realtime.sessions.create",
      durationMs: providerStartMs === null ? 0 : Date.now() - providerStartMs,
      status: "error",
      route: "/api/session",
      model: voiceModel.model,
      errorType: error instanceof Error ? error.name : "Error",
    });
    console.error("Error in /session:", {
      error,
      provider: voiceModel.provider,
      model: voiceModel.model,
      voiceModel: voiceModel.id,
    });
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
