import { NextRequest, NextResponse } from "next/server";
import { logLatencyTelemetry } from "@/app/lib/telemetry";
import { SESSION_COOKIE_NAME, getSessionUserId } from "@/app/lib/session";

export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (!sessionCookie || !getSessionUserId(sessionCookie.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  logLatencyTelemetry({
    provider: body.provider,
    operation: body.operation,
    durationMs: body.durationMs,
    status: body.status,
    route: body.route,
    httpStatus: body.httpStatus,
    model: body.model,
    errorType: body.errorType,
    metrics: body.metrics,
    source: "browser",
  });

  return NextResponse.json({ ok: true });
}
