import { NextRequest, NextResponse } from "next/server";
import {
  createCalendarInvite,
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
import { debugLog } from "@/app/lib/debugLog";

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
    debugLog("api", "POST /api/gmail — UNAUTHORIZED (no valid tokens)");
    return NextResponse.json(
      { error: "Not authenticated. Please reconnect your Google account." },
      { status: 401 }
    );
  }

  const { action, ...params } = await request.json();
  debugLog("api", `POST /api/gmail — action=${action}`, params);
  const startMs = Date.now();

  function respond(data: any, status = 200) {
    const elapsed = Date.now() - startMs;
    debugLog("api", `POST /api/gmail — action=${action} DONE [${elapsed}ms]`, data);
    return NextResponse.json(data, { status });
  }

  try {
    switch (action) {
      case "list": {
        const emails = await getUnreadEmails(tokens, params.maxResults || 10);
        const userEmail = await getUserEmail(tokens);
        const actionable = emails.filter(
          (e) => !e.from.toLowerCase().includes(userEmail.toLowerCase())
        );
        debugLog("api", `list: ${emails.length} total, ${actionable.length} actionable`);
        return respond({ emails: actionable });
      }
      case "read": {
        const body = await getEmailBody(tokens, params.messageId);
        debugLog("api", `read: body length=${body?.length || 0}`);
        return respond({ body });
      }
      case "readThread": {
        const messages = await getThreadMessages(
          tokens,
          params.threadId,
          params.maxMessages || 5
        );
        debugLog("api", `readThread: ${messages.length} messages`);
        return respond({ messages });
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
        return respond({ success: true });
      }
      case "archive": {
        await archiveEmail(tokens, params.messageId);
        return respond({ success: true });
      }
      case "markRead": {
        await markAsRead(tokens, params.messageId);
        return respond({ success: true });
      }
      case "listFilters": {
        const filters = await listActiveFilters(tokens);
        debugLog("api", `listFilters: ${filters.length} filters`);
        return respond({ filters });
      }
      case "previewArchiveFilter": {
        const preview = await previewArchiveFilterForEmail(
          tokens,
          params.messageId
        );
        return respond(preview);
      }
      case "upsertArchiveFilter": {
        const result = await upsertArchiveFilterForEmail(
          tokens,
          params.messageId,
          params.matchStrategy,
          params.existingFilterId
        );
        return respond(result);
      }
      case "search": {
        const emails = await searchEmails(tokens, params.query, params.maxResults || 10);
        debugLog("api", `search: ${emails.length} results for query="${params.query}"`);
        return respond({ emails });
      }
      case "findContact": {
        const contacts = await findContact(tokens, params.name);
        debugLog("api", `findContact: ${contacts.length} matches for "${params.name}"`);
        return respond({ contacts });
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
        return respond({ success: true });
      }
      case "calendarList": {
        debugLog("calendar", "calendarList request", { startTime: params.startTime, endTime: params.endTime, query: params.query });
        const events = await listCalendarEvents(tokens, {
          startTime: params.startTime,
          endTime: params.endTime,
          maxResults: params.maxResults || 10,
          query: params.query,
        });
        debugLog("calendar", `calendarList: ${events.length} events`, events);
        return respond({ events });
      }
      case "calendarSetup": {
        debugLog("calendar", "calendarSetup: inferring profile from past events...");
        const profile = await inferCalendarProfile(tokens);
        debugLog("calendar", "calendarSetup: profile inferred", profile);
        return respond({ profile });
      }
      case "calendarCreate": {
        debugLog("calendar", "calendarCreate request", params);
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
        debugLog("calendar", "calendarCreate: event created", created);
        return respond(created);
      }
      default:
        debugLog("error", `Unknown action: ${action}`);
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    const elapsed = Date.now() - startMs;
    if (error instanceof GmailScopeError) {
      debugLog("error", `Gmail scope error (${action}) [${elapsed}ms]`, { missingScopes: error.missingScopes });
      return NextResponse.json(
        {
          error: "Reconnect Gmail to grant filter-management access.",
          missingScopes: error.missingScopes,
          reauthRequired: true,
        },
        { status: 403 }
      );
    }
    debugLog("error", `Google API error (${action}) [${elapsed}ms]`, { message: error.message, stack: error.stack });
    console.error(`Google API error (${action}): ${error.message || "unknown"}`);

    return NextResponse.json(
      { error: error.message || "Google API error" },
      { status: 500 }
    );
  }
}
