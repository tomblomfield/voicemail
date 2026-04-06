import { NextRequest, NextResponse } from "next/server";
import {
  getUnreadEmails,
  getEmailBody,
  sendReply,
  archiveEmail,
  markAsRead,
  isAuthenticated,
} from "@/app/lib/gmail";

export async function POST(request: NextRequest) {
  if (!isAuthenticated()) {
    return NextResponse.json(
      { error: "Not authenticated. Please connect Gmail first." },
      { status: 401 }
    );
  }

  const { action, ...params } = await request.json();

  try {
    switch (action) {
      case "list": {
        const emails = await getUnreadEmails(params.maxResults || 10);
        return NextResponse.json({ emails });
      }
      case "read": {
        const body = await getEmailBody(params.messageId);
        return NextResponse.json({ body });
      }
      case "reply": {
        await sendReply(params.messageId, params.threadId, params.body);
        return NextResponse.json({ success: true });
      }
      case "archive": {
        await archiveEmail(params.messageId);
        return NextResponse.json({ success: true });
      }
      case "markRead": {
        await markAsRead(params.messageId);
        return NextResponse.json({ success: true });
      }
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error(`Gmail API error (${action}):`, error);
    return NextResponse.json(
      { error: error.message || "Gmail API error" },
      { status: 500 }
    );
  }
}
