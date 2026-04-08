import { NextRequest, NextResponse } from "next/server";
import { decryptTokens, hasRequiredGoogleScopes } from "@/app/lib/gmail";
import { google } from "googleapis";
import { debugLog } from "@/app/lib/debugLog";
import { initDb, upsertUser, isDbAvailable } from "@/app/lib/db";

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get("gmail_tokens");
  if (!cookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tokens = decryptTokens(cookie.value);
    if (!hasRequiredGoogleScopes(tokens)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Log session start with user email
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );
      oauth2Client.setCredentials(tokens);
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: "me" });
      const email = profile.data.emailAddress;
      console.log(`session_started: ${email}`);
      if (email && isDbAvailable()) {
        await initDb();
        await upsertUser(email);
      }
    } catch {
      console.log("session_started: unknown_user");
    }
    debugLog("api", "Creating OpenAI realtime session...");
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-realtime-1.5",
        }),
      }
    );
    const data = await response.json();
    debugLog("api", "OpenAI realtime session created", { id: data.id, model: data.model, expires_at: data.expires_at });
    return NextResponse.json({ ...data, dbAvailable: isDbAvailable() });
  } catch (error) {
    console.error("Error in /session:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
