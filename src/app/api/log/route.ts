import { NextRequest, NextResponse } from "next/server";
import { debugLog, debugLogVerbose } from "@/app/lib/debugLog";

export async function POST(req: NextRequest) {
  const { event, data, verbose, category } = await req.json();
  if (verbose) {
    // Client-side verbose logs → written to debug.log file only
    debugLogVerbose(category || "tool", event, data);
  } else {
    debugLog(category || "event", event, data);
  }
  return NextResponse.json({ ok: true });
}
