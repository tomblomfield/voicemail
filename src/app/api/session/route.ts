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
} from "@/app/lib/db";
import {
  SESSION_COOKIE_NAME,
  getSessionUserId,
} from "@/app/lib/session";
import { logLatencyTelemetry } from "@/app/lib/telemetry";

const REALTIME_MODEL = "gpt-realtime-1.5";

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

  let openaiStartMs: number | null = null;
  try {
    console.log(
      `session_started: ${userEmail} accounts=${accountCount}`
    );
    if (userEmail && isDbAvailable()) {
      await initDb();
      await upsertUser(userEmail);
    }

    debugLog("api", "Creating OpenAI realtime session...");
    openaiStartMs = Date.now();
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: REALTIME_MODEL,
        }),
      }
    );
    const data = await response.json();
    logLatencyTelemetry({
      provider: "openai",
      operation: "realtime.sessions.create",
      durationMs: Date.now() - openaiStartMs,
      status: response.ok ? "ok" : "error",
      route: "/api/session",
      httpStatus: response.status,
      model: REALTIME_MODEL,
      metrics: { accountCount },
    });
    debugLog("api", "OpenAI realtime session created", {
      id: data.id,
      model: data.model,
      expires_at: data.expires_at,
    });
    debugLogVerbose("api", "OpenAI realtime session FULL RESPONSE", data);
    return NextResponse.json({
      ...data,
      dbAvailable: isDbAvailable(),
      accountCount,
    });
  } catch (error) {
    logLatencyTelemetry({
      provider: "openai",
      operation: "realtime.sessions.create",
      durationMs: openaiStartMs === null ? 0 : Date.now() - openaiStartMs,
      status: "error",
      route: "/api/session",
      model: REALTIME_MODEL,
      errorType: error instanceof Error ? error.name : "Error",
    });
    console.error("Error in /session:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
