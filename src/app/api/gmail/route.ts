import { NextRequest, NextResponse } from "next/server";
import {
  hasRequiredGoogleScopes,
  getUnreadEmails,
  getEmailBody,
  getThreadMessages,
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
import {
  getGoogleAccounts,
  getUserById,
  updateUserProfileById,
  getUserMemoriesById,
  saveUserMemoriesById,
  renameGoogleAccount,
} from "@/app/lib/db";
import { SESSION_COOKIE_NAME, getSessionUserId } from "@/app/lib/session";

// ────────────────────────────────────────────
// Auth resolution
// ────────────────────────────────────────────

interface AccountInfo {
  id: string;
  email: string;
  displayName: string | null;
  tokens: any;
  isPrimary: boolean;
}

interface AuthContext {
  userId: string;
  accounts: AccountInfo[];
}

async function resolveAuth(request: NextRequest): Promise<AuthContext | null> {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (!sessionCookie) return null;

  const userId = getSessionUserId(sessionCookie.value);
  if (!userId) return null;

  const dbAccounts = await getGoogleAccounts(userId);
  const accounts: AccountInfo[] = [];
  for (const a of dbAccounts) {
    try {
      const tokens = decryptTokens(a.encrypted_tokens);
      if (hasRequiredGoogleScopes(tokens)) {
        accounts.push({
          id: a.id,
          email: a.email,
          displayName: a.display_name,
          tokens,
          isPrimary: a.is_primary,
        });
      }
    } catch {
      // skip accounts with bad tokens
    }
  }

  if (accounts.length === 0) return null;
  return { userId, accounts };
}

function getAccount(
  auth: AuthContext,
  accountId?: string
): AccountInfo | null {
  if (accountId) {
    return auth.accounts.find((a) => a.id === accountId) || null;
  }
  return (
    auth.accounts.find((a) => a.isPrimary) || auth.accounts[0] || null
  );
}

// ────────────────────────────────────────────
// Action handler
// ────────────────────────────────────────────

async function handleAction(
  action: string,
  params: any,
  auth: AuthContext
): Promise<any> {
  switch (action) {
    // ── Email listing (multi-account) ─────────────
    case "list": {
      const perAccountTokens: Record<string, string | null> =
        params.accountPageTokens || {};

      // If accountId is specified, only fetch from that account
      const accountsToFetch = params.accountId
        ? auth.accounts.filter((a) => a.id === params.accountId)
        : auth.accounts;

      const results = await Promise.all(
        accountsToFetch.map(async (account) => {
          const pageToken = perAccountTokens[account.id];
          // null means exhausted for this account
          if (pageToken === null)
            return {
              emails: [],
              nextPageToken: undefined,
              accountId: account.id,
            };

          const result = await getUnreadEmails(
            account.tokens,
            params.maxResults || 50,
            pageToken || undefined
          );
          const actionable = result.emails
            .filter(
              (e) =>
                !e.from.toLowerCase().includes(account.email.toLowerCase())
            )
            .map((e) => ({
              ...e,
              accountId: account.id,
              accountName: account.displayName || account.email,
              accountEmail: account.email,
            }));
          return {
            emails: actionable,
            nextPageToken: result.nextPageToken,
            accountId: account.id,
          };
        })
      );

      const allEmails = results.flatMap((r) => r.emails);
      allEmails.sort(
        (a, b) =>
          new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      const accountPageTokens: Record<string, string | null> = {};
      for (const r of results) {
        accountPageTokens[r.accountId] = r.nextPageToken || null;
      }

      return { emails: allEmails, accountPageTokens };
    }

    // ── Single-email reads ────────────────────────
    case "read": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      const body = await getEmailBody(account.tokens, params.messageId);
      return { body };
    }
    case "readThread": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      const messages = await getThreadMessages(
        account.tokens,
        params.threadId,
        params.maxMessages || 5
      );
      return { messages };
    }

    // ── Write operations (require accountId) ──────
    case "reply": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      await sendReply(
        account.tokens,
        params.messageId,
        params.threadId,
        params.body,
        account.email
      );
      return { success: true };
    }
    case "archive": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      await archiveEmail(account.tokens, params.threadId);
      return { success: true };
    }
    case "markRead": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      await markAsRead(account.tokens, params.messageId);
      return { success: true };
    }
    case "blockSender": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      return await blockSender(account.tokens, params.messageId);
    }
    case "unsubscribeInfo": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      return await getUnsubscribeInfo(account.tokens, params.messageId);
    }
    case "unsubscribe": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      return await performUnsubscribe(account.tokens, params.messageId, params.threadId);
    }

    // ── Search (multi-account) ────────────────────
    case "search": {
      const results = await Promise.all(
        auth.accounts.map(async (account) => {
          const emails = await searchEmails(
            account.tokens,
            params.query,
            params.maxResults || 10
          );
          return emails.map((e) => ({
            ...e,
            accountId: account.id,
            accountName: account.displayName || account.email,
            accountEmail: account.email,
          }));
        })
      );
      const allEmails = results
        .flat()
        .sort(
          (a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
        );
      return { emails: allEmails.slice(0, params.maxResults || 10) };
    }

    // ── Find contact (multi-account, dedup) ───────
    case "findContact": {
      const results = await Promise.all(
        auth.accounts.map(async (account) => {
          return await findContact(account.tokens, params.name);
        })
      );
      const contactMap = new Map<
        string,
        { name: string; email: string }
      >();
      for (const contacts of results) {
        for (const c of contacts) {
          if (!contactMap.has(c.email)) {
            contactMap.set(c.email, c);
          }
        }
      }
      return { contacts: Array.from(contactMap.values()) };
    }

    // ── Compose ───────────────────────────────────
    case "compose": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      await sendNewEmail(
        account.tokens,
        params.to,
        params.subject,
        params.body,
        account.email
      );
      return { success: true };
    }

    // ── Calendar (merged view) ────────────────────
    case "calendarList": {
      const results = await Promise.all(
        auth.accounts.map(async (account) => {
          const events = await listCalendarEvents(account.tokens, {
            startTime: params.startTime,
            endTime: params.endTime,
            maxResults: params.maxResults || 100,
            query: params.query,
          });
          return events.map((e: any) => ({
            ...e,
            accountId: account.id,
            accountEmail: account.email,
          }));
        })
      );
      // Deduplicate events that appear on multiple calendars (same event ID)
      const seenIds = new Set<string>();
      const allEvents: any[] = [];
      for (const event of results.flat()) {
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          allEvents.push(event);
        }
      }
      allEvents.sort((a: any, b: any) => {
        const aStart = a.start?.dateTime || a.start?.date || "";
        const bStart = b.start?.dateTime || b.start?.date || "";
        return aStart.localeCompare(bStart);
      });
      return { events: allEvents };
    }
    case "calendarSetup": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      const profile = await inferCalendarProfile(account.tokens);
      if (auth.userId) {
        try {
          await updateUserProfileById(auth.userId, {
            workAddress: profile.workAddress?.value ?? null,
            homeAddress: profile.homeAddress?.value ?? null,
            conferenceLink: profile.zoomLink?.value ?? null,
          });
        } catch (e) {
          debugLog("error", "calendarSetup: failed to persist profile", e);
        }
      }
      return { profile };
    }
    case "calendarUpdate": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      const event = await updateCalendarEvent(account.tokens, {
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
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      await deleteCalendarEvent(
        account.tokens,
        params.eventId,
        params.sendUpdates || "all"
      );
      return { success: true };
    }
    case "calendarCreate": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      return await createCalendarInvite(account.tokens, {
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

    // ── Filters (per-account) ─────────────────────
    case "listFilters": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      const filters = await listActiveFilters(account.tokens);
      return { filters };
    }
    case "previewArchiveFilter": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      return await previewArchiveFilterForEmail(
        account.tokens,
        params.messageId
      );
    }
    case "upsertArchiveFilter": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      return await upsertArchiveFilterForEmail(
        account.tokens,
        params.messageId,
        params.matchStrategy,
        params.existingFilterId
      );
    }
    case "applyFilterToExisting": {
      const account = getAccount(auth, params.accountId);
      if (!account) return { error: "Account not found" };
      return await applyFilterToExistingEmails(
        account.tokens,
        params.messageId,
        params.matchStrategy
      );
    }

    // ── Profile & Memories (user-level) ───────────
    case "getProfile": {
      if (!auth.userId) return { error: "Database not available" };
      const user = await getUserById(auth.userId);
      const primary =
        auth.accounts.find((a) => a.isPrimary) || auth.accounts[0];
      return {
        email: primary?.email || user?.email || "",
        homeAddress: user?.home_address || null,
        workAddress: user?.work_address || null,
        phoneNumber: user?.phone_number || null,
        conferenceLink: user?.conference_link || null,
      };
    }
    case "updateProfile": {
      if (!auth.userId) return { error: "Database not available" };
      await updateUserProfileById(auth.userId, {
        homeAddress: params.homeAddress,
        workAddress: params.workAddress,
        phoneNumber: params.phoneNumber,
        conferenceLink: params.conferenceLink,
      });
      return { success: true };
    }
    case "getMemories": {
      if (!auth.userId) return { error: "Database not available" };
      const content = await getUserMemoriesById(auth.userId);
      return { memories: content };
    }
    case "saveMemories": {
      if (!auth.userId) return { error: "Database not available" };
      await saveUserMemoriesById(auth.userId, params.content);
      return { success: true };
    }

    // ── Account management (called by agent) ──────
    case "getAccounts": {
      return {
        accounts: auth.accounts.map((a) => ({
          id: a.id,
          email: a.email,
          displayName: a.displayName,
          isPrimary: a.isPrimary,
        })),
      };
    }
    case "renameAccount": {
      if (!auth.userId) return { error: "Database not available" };
      await renameGoogleAccount(params.accountId, params.displayName);
      return { success: true };
    }

    default:
      return null;
  }
}

// ────────────────────────────────────────────
// Route handler
// ────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await resolveAuth(request);
  if (!auth) {
    debugLog("api", "POST /api/gmail — UNAUTHORIZED (no valid auth)");
    return NextResponse.json(
      {
        error:
          "Not authenticated. Please reconnect your Google account.",
      },
      { status: 401 }
    );
  }

  const { action, ...params } = await request.json();
  debugLog("api", `POST /api/gmail — action=${action}`, params);
  const startMs = Date.now();

  try {
    const result = await handleAction(action, params, auth);
    const elapsed = Date.now() - startMs;

    if (result === null) {
      debugLog("error", `Unknown action: ${action}`);
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 }
      );
    }

    debugLog(
      "api",
      `POST /api/gmail — action=${action} DONE [${elapsed}ms]`,
      result
    );
    return NextResponse.json(result);
  } catch (error: any) {
    const elapsed = Date.now() - startMs;
    if (error instanceof GmailScopeError) {
      debugLog("error", `Gmail scope error (${action}) [${elapsed}ms]`, {
        missingScopes: error.missingScopes,
      });
      return NextResponse.json(
        {
          error: "Reconnect Gmail to grant filter-management access.",
          missingScopes: error.missingScopes,
          reauthRequired: true,
        },
        { status: 403 }
      );
    }
    debugLog("error", `Google API error (${action}) [${elapsed}ms]`, {
      message: error.message,
      stack: error.stack,
    });
    console.error(
      `Google API error (${action}): ${error.message || "unknown"}`
    );

    return NextResponse.json(
      { error: error.message || "Google API error" },
      { status: 500 }
    );
  }
}
