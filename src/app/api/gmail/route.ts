import { NextRequest, NextResponse } from "next/server";
import {
  getUnreadEmails,
  getEmailBody,
  getThreadMessages,
  getUserEmail,
  searchEmails,
  findContact,
  sendNewEmail,
  sendReply,
  archiveEmail,
  markAsRead,
  decryptTokens,
  GmailScopeError,
  listActiveFilters,
  previewArchiveFilterForEmail,
  upsertArchiveFilterForEmail,
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
        const userEmail = await getUserEmail(tokens);
        // Filter out emails where the user is the most recent sender (nothing to act on)
        const actionable = emails.filter(
          (e) => !e.from.toLowerCase().includes(userEmail.toLowerCase())
        );
        return NextResponse.json({ emails: actionable });
      }
      case "read": {
        const body = await getEmailBody(tokens, params.messageId);
        return NextResponse.json({ body });
      }
      case "readThread": {
        const messages = await getThreadMessages(
          tokens,
          params.threadId,
          params.maxMessages || 5
        );
        return NextResponse.json({ messages });
      }
      case "reply": {
        const userEmail = await getUserEmail(tokens);
        await sendReply(
          tokens,
          params.messageId,
          params.threadId,
          params.body,
          userEmail
        );
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
      case "listFilters": {
        const filters = await listActiveFilters(tokens);
        return NextResponse.json({ filters });
      }
      case "previewArchiveFilter": {
        const preview = await previewArchiveFilterForEmail(
          tokens,
          params.messageId
        );
        return NextResponse.json(preview);
      }
      case "upsertArchiveFilter": {
        const result = await upsertArchiveFilterForEmail(
          tokens,
          params.messageId,
          params.matchStrategy,
          params.existingFilterId
        );
        return NextResponse.json(result);
      }
      case "search": {
        const emails = await searchEmails(tokens, params.query, params.maxResults || 10);
        return NextResponse.json({ emails });
      }
      case "findContact": {
        const contacts = await findContact(tokens, params.name);
        return NextResponse.json({ contacts });
      }
      case "compose": {
        const userEmail = await getUserEmail(tokens);
        await sendNewEmail(
          tokens,
          params.to,
          params.subject,
          params.body,
          userEmail
        );
        return NextResponse.json({ success: true });
      }
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    if (error instanceof GmailScopeError) {
      return NextResponse.json(
        {
          error: "Reconnect Gmail to grant filter-management access.",
          missingScopes: error.missingScopes,
          reauthRequired: true,
        },
        { status: 403 }
      );
    }
    console.error(`Gmail API error (${action}): ${error.message || "unknown"}`);
    return NextResponse.json(
      { error: "Gmail API error" },
      { status: 500 }
    );
  }
}
