import { NextRequest, NextResponse } from "next/server";
import {
  createCalendarInvite,
  updateCalendarEvent,
  hasRequiredGoogleScopes,
  inferCalendarProfile,
  getUnreadEmails,
  getEmailBody,
  getThreadMessages,
  getUserEmail,
  listCalendarEvents,
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
    const tokens = decryptTokens(cookie.value);
    return hasRequiredGoogleScopes(tokens) ? tokens : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const tokens = getTokens(request);
  if (!tokens) {
    return NextResponse.json(
      { error: "Not authenticated. Please reconnect your Google account." },
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
      case "calendarList": {
        const events = await listCalendarEvents(tokens, {
          startTime: params.startTime,
          endTime: params.endTime,
          maxResults: params.maxResults || 10,
          query: params.query,
        });
        return NextResponse.json({ events });
      }
      case "calendarSetup": {
        const profile = await inferCalendarProfile(tokens);
        return NextResponse.json({ profile });
      }
      case "calendarUpdate": {
        const event = await updateCalendarEvent(tokens, {
          eventId: params.eventId,
          title: params.title,
          startTime: params.startTime,
          endTime: params.endTime,
          timeZone: params.timeZone,
          attendeeEmails: params.attendeeEmails,
          notes: params.notes,
          location: params.location,
        });
        return NextResponse.json({ event });
      }
      case "calendarCreate": {
        const created = await createCalendarInvite(tokens, {
          title: params.title,
          startTime: params.startTime,
          endTime: params.endTime,
          timeZone: params.timeZone,
          attendeeEmails: params.attendeeEmails,
          notes: params.notes,
          customLocation: params.customLocation,
          locationPreference: params.locationPreference,
          inferredProfile: params.inferredProfile,
        });
        return NextResponse.json(created);
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
    console.error(`Google API error (${action}): ${error.message || "unknown"}`);

    return NextResponse.json(
      { error: error.message || "Google API error" },
      { status: 500 }
    );
  }
}
