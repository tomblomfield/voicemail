import { NextRequest, NextResponse } from "next/server";
import {
  getUnreadEmails,
  getEmailBody,
  sendReply,
  archiveEmail,
  markAsRead,
  decryptTokens,
} from "@/app/lib/gmail";

function getTokens(request: NextRequest) {
  const cookie = request.cookies.get("gmail_tokens");
  if (!cookie) return null;
  try {
    return decryptTokens(cookie.value);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const tokens = getTokens(request);
  if (!tokens) {
    return NextResponse.json(
      { error: "Not authenticated. Please connect Gmail first." },
      { status: 401 }
    );
  }

  const { action, ...params } = await request.json();

  try {
    switch (action) {
      case "list": {
        const emails = await getUnreadEmails(tokens, params.maxResults || 10);
        return NextResponse.json({ emails });
      }
      case "read": {
        const body = await getEmailBody(tokens, params.messageId);
        return NextResponse.json({ body });
      }
      case "reply": {
        await sendReply(tokens, params.messageId, params.threadId, params.body);
        return NextResponse.json({ success: true });
      }
      case "archive": {
        await archiveEmail(tokens, params.messageId);
        return NextResponse.json({ success: true });
      }
      case "markRead": {
        await markAsRead(tokens, params.messageId);
        return NextResponse.json({ success: true });
      }
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error(`Gmail API error (${action}): ${error.message || "unknown"}`);
    return NextResponse.json(
      { error: "Gmail API error" },
      { status: 500 }
    );
  }
}
