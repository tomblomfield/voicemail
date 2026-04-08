import { NextRequest, NextResponse } from "next/server";
import {
  hasRequiredGoogleScopes,
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
  blockSender,
  applyFilterToExistingEmails,
} from "@/app/lib/gmail";
import { getUnsubscribeInfo, performUnsubscribe } from "@/app/lib/unsubscribe";
import {
  createCalendarInvite,
  deleteCalendarEvent,
  updateCalendarEvent,
  inferCalendarProfile,
  listCalendarEvents,
} from "@/app/lib/calendar-api";
import { debugLog } from "@/app/lib/debugLog";
import { updateUserProfile, getUserByEmail, getUserMemories, saveUserMemories } from "@/app/lib/db";

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

async function handleAction(action: string, params: any, tokens: any): Promise<any> {
  switch (action) {
    case "list": {
      const emails = await getUnreadEmails(tokens, params.maxResults || 10);
      const userEmail = await getUserEmail(tokens);
      const actionable = emails.filter(
        (e) => !e.from.toLowerCase().includes(userEmail.toLowerCase())
      );
      return { emails: actionable };
    }
    case "read": {
      const body = await getEmailBody(tokens, params.messageId);
      return { body };
    }
    case "readThread": {
      const messages = await getThreadMessages(
        tokens,
        params.threadId,
        params.maxMessages || 5
      );
      return { messages };
    }
    case "reply": {
      const userEmail = await getUserEmail(tokens);
      await sendReply(tokens, params.messageId, params.threadId, params.body, userEmail);
      return { success: true };
    }
    case "archive": {
      await archiveEmail(tokens, params.messageId);
      return { success: true };
    }
    case "markRead": {
      await markAsRead(tokens, params.messageId);
      return { success: true };
    }
    case "listFilters": {
      const filters = await listActiveFilters(tokens);
      return { filters };
    }
    case "previewArchiveFilter": {
      return await previewArchiveFilterForEmail(tokens, params.messageId);
    }
    case "upsertArchiveFilter": {
      return await upsertArchiveFilterForEmail(
        tokens,
        params.messageId,
        params.matchStrategy,
        params.existingFilterId
      );
    }
    case "applyFilterToExisting": {
      return await applyFilterToExistingEmails(
        tokens,
        params.messageId,
        params.matchStrategy
      );
    }
    case "blockSender": {
      return await blockSender(tokens, params.messageId);
    }
    case "unsubscribeInfo": {
      return await getUnsubscribeInfo(tokens, params.messageId);
    }
    case "unsubscribe": {
      return await performUnsubscribe(tokens, params.messageId);
    }
    case "search": {
      const emails = await searchEmails(tokens, params.query, params.maxResults || 10);
      return { emails };
    }
    case "findContact": {
      const contacts = await findContact(tokens, params.name);
      return { contacts };
    }
    case "compose": {
      const userEmail = await getUserEmail(tokens);
      await sendNewEmail(tokens, params.to, params.subject, params.body, userEmail);
      return { success: true };
    }
    case "calendarList": {
      const events = await listCalendarEvents(tokens, {
        startTime: params.startTime,
        endTime: params.endTime,
        maxResults: params.maxResults || 100,
        query: params.query,
      });
      return { events };
    }
    case "calendarSetup": {
      const profile = await inferCalendarProfile(tokens);
      try {
        const email = await getUserEmail(tokens);
        if (email) {
          await updateUserProfile(email, {
            workAddress: profile.workAddress?.value ?? null,
            homeAddress: profile.homeAddress?.value ?? null,
            conferenceLink: profile.zoomLink?.value ?? null,
          });
        }
      } catch (e) {
        debugLog("error", "calendarSetup: failed to persist profile", e);
      }
      return { profile };
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
      return { event };
    }
    case "calendarDelete": {
      await deleteCalendarEvent(tokens, params.eventId, params.sendUpdates || "all");
      return { success: true };
    }
    case "calendarCreate": {
      return await createCalendarInvite(tokens, {
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
    }
    case "getProfile": {
      const email = await getUserEmail(tokens);
      const user = await getUserByEmail(email);
      return {
        email,
        homeAddress: user?.home_address || null,
        workAddress: user?.work_address || null,
        phoneNumber: user?.phone_number || null,
        conferenceLink: user?.conference_link || null,
      };
    }
    case "updateProfile": {
      const email = await getUserEmail(tokens);
      await updateUserProfile(email, {
        homeAddress: params.homeAddress,
        workAddress: params.workAddress,
        phoneNumber: params.phoneNumber,
        conferenceLink: params.conferenceLink,
      });
      return { success: true };
    }
    case "getMemories": {
      const email = await getUserEmail(tokens);
      const content = await getUserMemories(email);
      return { memories: content };
    }
    case "saveMemories": {
      const email = await getUserEmail(tokens);
      await saveUserMemories(email, params.content);
      return { success: true };
    }
    default:
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

  try {
    const result = await handleAction(action, params, tokens);
    const elapsed = Date.now() - startMs;

    if (result === null) {
      debugLog("error", `Unknown action: ${action}`);
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    debugLog("api", `POST /api/gmail — action=${action} DONE [${elapsed}ms]`, result);
    return NextResponse.json(result);
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
