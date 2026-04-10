import { RealtimeAgent, tool } from "@openai/agents/realtime";
import type { InferredCalendarProfile } from "@/app/lib/calendar";
import { debugLogClient, debugLogClientVerbose } from "@/app/lib/debugLog";

async function gmailApi(body: Record<string, any>) {
  debugLogClient("tool", `gmailApi request: action=${body.action}`, body);
  const startMs = Date.now();
  const res = await fetch("/api/gmail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  debugLogClient("tool", `gmailApi response: action=${body.action} [${Date.now() - startMs}ms] status=${res.status}`, data);
  return data;
}

export interface AccountInfo {
  id: string;
  email: string;
  displayName: string | null;
  isPrimary: boolean;
}

export interface EmailData {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  snippet: string;
  date: string;
  body?: string;
  accountId?: string;
  accountName?: string;
  accountEmail?: string;
}

export interface EmailTriageDeps {
  emails: () => EmailData[];
  setEmails: (emails: EmailData[]) => void;
  emailIndex: () => number;
  setEmailIndex: (index: number) => void;
  advanceIndex: () => void;
  recordAction: (action: "reply" | "skip" | "archive" | "block" | "unsubscribe") => void;
  getActionSummary: () => { replied: number; skipped: number; archived: number; blocked: number; unsubscribed: number };
  calendarProfile: () => InferredCalendarProfile | null;
  setCalendarProfile: (profile: InferredCalendarProfile) => void;
  nextPageTokens: () => Record<string, string | null>;
  setNextPageTokens: (tokens: Record<string, string | null>) => void;
  dbAvailable: boolean;
  onMute: () => void;
  onStop: () => void;
  onLogout: () => void;
  accounts: AccountInfo[];
  focusedAccountId: () => string | null;
  setFocusedAccountId: (id: string | null) => void;
}

function buildMultiAccountInstructions(accounts: AccountInfo[]): string {
  if (accounts.length <= 1) return "";

  const accountList = accounts
    .map((a) => `- "${a.displayName || a.email}" (${a.email})`)
    .join("\n");

  const unnamed = accounts.filter((a) => !a.displayName);
  const namingPrompt =
    unnamed.length > 0
      ? `\n\nIMPORTANT: ${unnamed.length === accounts.length ? "None of your" : "Some of your"} connected accounts have names yet. Before starting email triage, ask the user what they'd like to call each unnamed account (e.g., "Work", "Personal"). Use rename_account to save the name. Once named, use the name to refer to that account going forward.`
      : "";

  return `
# Multiple Accounts
You have access to ${accounts.length} Gmail accounts:
${accountList}

When triaging emails from multiple accounts, briefly mention which account when switching between accounts (e.g., "This next email is to your ${accounts[0].displayName || "first"} account."). Don't mention the account if consecutive emails are from the same account. When composing a new email, ask which account to send from unless the context makes it obvious.

If the user wants to focus on just one account (e.g., "just my work emails", "focus on personal"), call focus_account to filter the inbox to that account only. This re-fetches emails from just that account. When they want all accounts again, call focus_all_accounts.${namingPrompt}
`;
}

export function createEmailTriageAgent(deps: EmailTriageDeps) {
  const isMultiAccount = deps.accounts.length > 1;

  async function getOrLoadCalendarProfile() {
    const cached = deps.calendarProfile();
    if (cached) return { profile: cached, cached: true };

    const data = await gmailApi({ action: "calendarSetup" });
    if (data.error) return { error: data.error };
    deps.setCalendarProfile(data.profile);
    return { profile: data.profile as InferredCalendarProfile, cached: false };
  }

  function summarizeCalendarProfile(profile: InferredCalendarProfile, cached: boolean) {
    return {
      cached,
      scannedEvents: profile.scannedEvents,
      homeAddress: profile.homeAddress?.value || null,
      homeConfidence: profile.homeAddress?.confidence || null,
      workAddress: profile.workAddress?.value || null,
      workConfidence: profile.workAddress?.confidence || null,
      zoomLink: profile.zoomLink?.value || null,
      zoomConfidence: profile.zoomLink?.confidence || null,
    };
  }

  // Helper: look up threadId for a given email message
  function getThreadIdForEmail(messageId: string): string | undefined {
    const emails = deps.emails();
    const email = emails.find((e) => e.id === messageId);
    return email?.threadId;
  }

  // Helper: look up accountId for a given email message
  function getAccountIdForEmail(messageId: string): string | undefined {
    const emails = deps.emails();
    const email = emails.find((e) => e.id === messageId);
    return email?.accountId;
  }

  const agent = new RealtimeAgent({
    name: "emailTriage",
    voice: "ash",
    handoffDescription: "Voice email and calendar assistant for hands-free driving",

    instructions: `
# Role
You are a hands-free email and calendar assistant designed for someone driving to work. Be concise, conversational, and efficient. The user cannot look at a screen, so everything must be communicated by voice.

# CRITICAL RULE
NEVER invent, guess, or assume any email content. You MUST call get_email_count and get_next_email and wait for results before mentioning any sender, subject, or content. If you don't have tool results yet, just say you're checking their inbox — do NOT make up placeholder emails.

# Behavior
1. When the session starts, immediately call get_email_count. While waiting, say something brief like "Hey, let me check your inbox." Once you have the result, announce the count and briefly note which ones look most urgent or important based on the email list returned. For example: "You have 14 unread emails. A couple look urgent — one from your board member and one about a deadline. Let's start with those."
2. Then call get_next_email. Wait for the result before saying anything about the email. Once you have it, read a brief summary: who it's from, the subject, and a 1-2 sentence summary of the content. If threadLength > 1, the body contains the full conversation thread with multiple messages from different people — summarize the whole thread, not just the latest message. For example: "This is a thread with 3 messages. You replied to Harshita about ESTA requirements, and now Yasith is asking about visa specifics." If the user is in the CC or BCC (not in the "to" field), mention that — e.g., "You're CC'd on this one" — since CC'd emails are usually lower priority.
3. After summarizing, ask: "Would you like to reply, skip, or archive this one?"
4. Based on their response:
   - **Reply**: Ask what they'd like to say. Draft the reply, read it back to them, and ask to confirm before sending. If they confirm, call reply_to_email. The email will be automatically archived after sending.
   - **Skip**: Call skip_email and move to the next one.
   - **Archive**: Call archive_email and move to the next one.
   - **Block**: If the user says "block this sender", "block them", or similar, confirm who they're blocking, then call block_sender. This creates a Gmail filter that sends all future emails from that sender to trash and archives the current email.
   - **Unsubscribe**: If the user says "unsubscribe", "unsubscribe from this", "stop these emails", or similar, call unsubscribe_from_email. This automatically finds the unsubscribe mechanism (one-click, email, or browser automation) and handles it. Tell the user what method was used and whether it succeeded. The email is automatically archived after unsubscribing.
5. After each action, automatically call get_next_email for the next one.
6. When get_next_email returns done=true, let them know they're all caught up and give the session summary.
7. When the user says "I'm done", "that's all", "wrap up", or similar, call get_session_summary. Announce it naturally: "All set. You replied to X, skipped Y, archived Z, blocked W, and unsubscribed from U. You still have N left for later. Have a great day!"
8. If the user asks to check for new emails or refresh their inbox, call reload_emails. This re-fetches the full unread list from Gmail and resets the queue.
9. When you finish processing all loaded emails and there are more available (has_more_emails is true in the results), let the user know and offer to load the next batch. If they agree, call fetch_more_emails to load the next 50.

# Search & Compose
- The user can ask to find old emails at any time (e.g., "Did Sarah send me that report?"). Use search_emails with Gmail search syntax.
- The user can ask to send a new email (e.g., "Send an email to Denisa"). Use find_contact to resolve the name to an email address. If multiple matches, read the top 2-3 and ask which one. Then ask what they want to say, draft it, read it back, and confirm before sending with send_new_email.
- Always confirm recipient, subject, and body before sending a new email.

# Calendar
- If the user asks about their calendar, use list_calendar_events.
- To search for a specific meeting or person (e.g. "Am I meeting with Natasha?"), use list_calendar_events with the query parameter. You can combine query with a time range to narrow results.
- Before the first calendar-related task in a session, call run_calendar_setup. This is the setup phase. It scans past calendar invites and tries to infer the user's home address, work address, and Zoom link for this runtime only.
- When you describe the setup results, make clear these are inferred from past invites, not stored facts.
- If the user asks "what's my home address", "what's my work address", or "what's my Zoom link", call run_calendar_setup and answer from the results.
- When the user wants to schedule or send a calendar invite, confirm the title, date, start time, end time, attendees, and location before using create_calendar_invite.
- If the user says "at home", "at my office", "at work", or "on Zoom", use create_calendar_invite with the matching location_preference.
- When the user wants to edit or update an existing calendar event, use list_calendar_events to find it first, then use edit_calendar_event with only the fields that need to change.
- When the user wants to delete or cancel a calendar event, use list_calendar_events to find it first, then ALWAYS confirm with the user before calling delete_calendar_event. Tell them whether attendees will be notified.
- Never invent a home address, work address, or Zoom link. If setup cannot infer one confidently enough, tell the user and ask for a custom location instead.

${deps.dbAvailable ? `# Profile
- The user has a saved profile with home address, work address, phone number, and conference link.
- If the user asks "what's my home address?" or similar, call get_my_profile to look it up.
- If the user says "my home address is 123 Main St" or "update my phone number to ...", call update_my_profile with the relevant fields.
- When creating calendar events that need a location, prefer the saved profile over re-inferring from calendar history.

# Memories
- You can save and recall freeform notes across sessions using get_memories and save_memories.
- If the user says "remember that...", "make a note...", or "save this for later", first call get_memories to read existing content, then call save_memories with the updated content (existing + new).
- If the user asks "what do you remember?" or "do you have any notes?", call get_memories.
- Never overwrite memories — always append or edit specific entries.` : ''}
# Filters
- If the user asks what Gmail filters are active, call list_gmail_filters and summarize the relevant ones.
- If the user wants to auto-archive emails like the current one, first call preview_archive_filter_for_email for the current message. Explain the recommended match strategy before making changes.
- Gmail subject filters use **partial matching** (substring search). A filter with subject "Your Receipt" will match emails with subject "Your Receipt from Carphone Warehouse", "Monthly Your Receipt", etc. When explaining the from_and_subject strategy, make this clear — the user does not need the exact full subject line.
- Prefer the narrower "from_and_subject" strategy unless the user clearly wants every message from that sender archived.
- If preview_archive_filter_for_email shows a very close existing filter, offer to replace that filter instead of adding a duplicate. Be explicit that Gmail doesn't support editing filters directly, so replacing means delete-and-recreate.
- Before calling apply_archive_filter_for_email, confirm whether they want a new filter or to replace an existing one.
- After creating a filter, the response includes matchingInboxCount — the number of existing inbox emails that match. If matchingInboxCount > 0, tell the user and ask if they'd like to apply the filter retroactively. If they confirm, call apply_filter_to_existing_emails.
- If a filter tool says Gmail needs to be reconnected, tell the user to reconnect Gmail and do not keep retrying.

# Prioritization
When you receive the email list from get_email_count, mentally sort them. Present emails in this order:
- URGENT first: direct asks, deadlines, board/investor emails, people issues, anything time-sensitive
- IMPORTANT next: project updates, meeting follow-ups, interesting discussions
- FYI last: newsletters, automated notifications, CC'd threads
You decide the order — use your judgment. The user trusts you to surface the important stuff first.

# Session Controls
- **Mute**: If the user asks you to be quiet, mute them, go on mute, hold on, or similar — call mute_microphone. Tell them they're muted and can tap the mic button to unmute when ready.
- **End session**: If the user explicitly says "end the session", "disconnect", "shut down", or "I want to quit" — first give the session summary (call get_session_summary), then ask if they'd also like to log out. If they say yes, call log_out. If they say no, call end_session. IMPORTANT: "stop", "hold on", "wait", "I'm done", or "that's all" are NOT requests to end the session — those are normal conversational interrupts. Only call end_session when the user clearly and explicitly wants to disconnect.
- **Log out**: If the user explicitly asks to log out, sign out, or switch accounts — call log_out. This ends the conversation and signs them out of their Google account.

# Style
- Keep summaries SHORT — sender name, subject, and the key point. Don't read the full email unless asked.
- For senders, just use the name (not the full email address) unless it's unclear.
- Be natural and conversational, like a helpful assistant riding along.
- If the user says something ambiguous, default to the most likely intent (e.g., "next" means skip).
- Don't repeat options every time — just ask "What would you like to do?" after the first couple.
${buildMultiAccountInstructions(deps.accounts)}`,

    tools: [
      tool({
        name: "run_calendar_setup",
        description:
          "Infer the user's home address, work address, and Zoom link from past Google Calendar invites. Call this before the first calendar task in a session and whenever the user asks what those defaults are.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        execute: async () => {
          debugLogClient("tool", "run_calendar_setup: executing");
          const result = await getOrLoadCalendarProfile();
          if ("error" in result) {
            debugLogClient("error", "run_calendar_setup: failed", result.error);
            return { error: result.error };
          }
          const summary = summarizeCalendarProfile(result.profile, result.cached);
          debugLogClient("tool", "run_calendar_setup: result", summary);
          return summary;
        },
      }),

      tool({
        name: "get_email_count",
        description:
          "Get all unread emails from the inbox. Returns the full list with sender, subject, to/cc, and snippet for each email. Call this first so you can tell the user how many emails they have and which ones look urgent." +
          (isMultiAccount
            ? " Fetches from ALL connected accounts. Each email includes accountId and accountName."
            : ""),
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        execute: async () => {
          debugLogClient("tool", "get_email_count: executing");
          const focused = deps.focusedAccountId();
          const data = await gmailApi({ action: "list", maxResults: 50, ...(focused ? { accountId: focused } : {}) });
          if (data.error) {
            debugLogClient("error", "get_email_count: failed", data.error);
            return { error: data.error };
          }
          const emails = data.emails || [];
          deps.setEmails(emails);
          deps.setEmailIndex(0);
          deps.setNextPageTokens(data.accountPageTokens || {});

          // Build per-account counts for multi-account
          const accountCounts: Record<string, number> = {};
          for (const e of emails) {
            const key = e.accountName || e.accountId || "default";
            accountCounts[key] = (accountCounts[key] || 0) + 1;
          }

          const result: any = {
            count: emails.length,
            has_more_emails: Object.values(data.accountPageTokens || {}).some(
              (t: any) => t !== null
            ),
            emails: emails.map((e: any) => ({
              id: e.id,
              from: e.from,
              to: e.to,
              cc: e.cc,
              subject: e.subject,
              snippet: e.snippet,
              date: e.date,
              ...(isMultiAccount
                ? {
                    accountId: e.accountId,
                    accountName: e.accountName,
                  }
                : {}),
            })),
          };

          if (isMultiAccount) {
            result.account_counts = accountCounts;
          }

          debugLogClient("tool", `get_email_count: ${emails.length} emails`);
          debugLogClientVerbose("tool", "get_email_count → LLM TOOL RESULT", result);
          return result;
        },
      }),

      tool({
        name: "reload_emails",
        description:
          "Re-fetch the unread email list from Gmail. Use this when the user asks to check for new emails, refresh their inbox, or see if anything new has come in. Resets the email queue and starts from the top.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        execute: async () => {
          debugLogClient("tool", "reload_emails: executing");
          const focused = deps.focusedAccountId();
          const data = await gmailApi({ action: "list", maxResults: 50, ...(focused ? { accountId: focused } : {}) });
          if (data.error) {
            debugLogClient("error", "reload_emails: failed", data.error);
            return { error: data.error };
          }
          const emails = data.emails || [];
          deps.setEmails(emails);
          deps.setEmailIndex(0);
          deps.setNextPageTokens(data.accountPageTokens || {});

          const result = {
            count: emails.length,
            has_more_emails: Object.values(data.accountPageTokens || {}).some(
              (t: any) => t !== null
            ),
            emails: emails.map((e: any) => ({
              id: e.id,
              from: e.from,
              to: e.to,
              cc: e.cc,
              subject: e.subject,
              snippet: e.snippet,
              date: e.date,
              ...(isMultiAccount
                ? { accountId: e.accountId, accountName: e.accountName }
                : {}),
            })),
          };
          debugLogClient("tool", `reload_emails: ${emails.length} emails`);
          debugLogClientVerbose("tool", "reload_emails → LLM TOOL RESULT", result);
          return result;
        },
      }),

      tool({
        name: "fetch_more_emails",
        description:
          "Fetch the next batch of unread emails beyond what's already loaded. Call this when you've finished processing the current batch and has_more_emails was true. Appends the new emails to the existing list.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        execute: async () => {
          debugLogClient("tool", "fetch_more_emails: executing");
          const pageTokens = deps.nextPageTokens();
          const hasMore = Object.values(pageTokens).some((t) => t !== null);
          if (!hasMore) {
            debugLogClient("tool", "fetch_more_emails: no more pages");
            return { count: 0, has_more_emails: false, emails: [], message: "No more emails to load." };
          }
          const focused = deps.focusedAccountId();
          const data = await gmailApi({
            action: "list",
            maxResults: 50,
            accountPageTokens: pageTokens,
            ...(focused ? { accountId: focused } : {}),
          });
          if (data.error) {
            debugLogClient("error", "fetch_more_emails: failed", data.error);
            return { error: data.error };
          }
          const newEmails = data.emails || [];
          const existingEmails = deps.emails();
          deps.setEmails([...existingEmails, ...newEmails]);
          deps.setNextPageTokens(data.accountPageTokens || {});
          const result = {
            count: newEmails.length,
            total_loaded: existingEmails.length + newEmails.length,
            has_more_emails: Object.values(data.accountPageTokens || {}).some(
              (t: any) => t !== null
            ),
            emails: newEmails.map((e: any) => ({
              id: e.id,
              from: e.from,
              to: e.to,
              cc: e.cc,
              subject: e.subject,
              snippet: e.snippet,
              date: e.date,
              ...(isMultiAccount
                ? { accountId: e.accountId, accountName: e.accountName }
                : {}),
            })),
          };
          debugLogClient("tool", `fetch_more_emails: ${newEmails.length} new emails`);
          debugLogClientVerbose("tool", "fetch_more_emails → LLM TOOL RESULT", result);
          return result;
        },
      }),

      tool({
        name: "get_next_email",
        description:
          "Get the next email to present to the user. Returns the full body text. You decide the order based on your assessment of urgency from the email list.",
        parameters: {
          type: "object",
          properties: {
            email_id: {
              type: "string",
              description:
                "The ID of the email to fetch. Choose based on your priority assessment. If omitted, fetches the next one in list order.",
            },
          },
          required: [],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          debugLogClient("tool", "get_next_email: executing", args);
          const emails = deps.emails();
          if (emails.length === 0) {
            const summary = deps.getActionSummary();
            return {
              done: true,
              message: "No more unread emails.",
              sessionSummary: {
                replied: summary.replied,
                skipped: summary.skipped,
                archived: summary.archived,
                blocked: summary.blocked,
                unsubscribed: summary.unsubscribed,
                total: summary.replied + summary.skipped + summary.archived + summary.blocked + summary.unsubscribed,
              },
            };
          }

          let emailIdx: number;
          if (args.email_id) {
            emailIdx = emails.findIndex((e) => e.id === args.email_id);
            if (emailIdx === -1) emailIdx = 0;
          } else {
            emailIdx = deps.emailIndex();
            if (emailIdx >= emails.length) {
              const summary = deps.getActionSummary();
              return {
                done: true,
                message: "No more unread emails.",
                sessionSummary: {
                  replied: summary.replied,
                  skipped: summary.skipped,
                  archived: summary.archived,
                  blocked: summary.blocked,
                  unsubscribed: summary.unsubscribed,
                  total: summary.replied + summary.skipped + summary.archived + summary.blocked + summary.unsubscribed,
                },
              };
            }
          }

          const email = emails[emailIdx];
          deps.advanceIndex();

          // Fetch thread context
          const threadData = await gmailApi({
            action: "readThread",
            threadId: email.threadId,
            accountId: email.accountId,
          });

          const threadMessages = threadData.messages || [];
          let conversationContext = "";
          if (threadMessages.length > 1) {
            conversationContext = threadMessages
              .map((m: any) => `[${m.from}]: ${m.body}`)
              .join("\n---\n");
          } else if (threadMessages.length === 1) {
            conversationContext = threadMessages[0].body;
          } else {
            const bodyData = await gmailApi({
              action: "read",
              messageId: email.id,
              accountId: email.accountId,
            });
            conversationContext = bodyData.body || email.snippet;
          }

          const emailResult: any = {
            id: email.id,
            threadId: email.threadId,
            from: email.from,
            to: email.to,
            cc: email.cc,
            subject: email.subject,
            date: email.date,
            threadLength: threadMessages.length,
            body: conversationContext,
          };

          if (isMultiAccount) {
            emailResult.accountId = email.accountId;
            emailResult.accountName = email.accountName;
          }

          debugLogClient("tool", `get_next_email: returning email from=${email.from} subject="${email.subject}" bodyLen=${emailResult.body.length} threadLen=${threadMessages.length}`);
          debugLogClientVerbose("tool", "get_next_email → LLM TOOL RESULT (FULL)", emailResult);
          return emailResult;
        },
      }),

      tool({
        name: "reply_to_email",
        description:
          "Send a reply to the current email. Only call this after the user has confirmed the reply text. The email will be automatically archived after sending.",
        parameters: {
          type: "object",
          properties: {
            message_id: {
              type: "string",
              description: "The ID of the email to reply to",
            },
            thread_id: {
              type: "string",
              description: "The thread ID of the email",
            },
            reply_text: {
              type: "string",
              description: "The text content of the reply",
            },
          },
          required: ["message_id", "thread_id", "reply_text"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          debugLogClient("tool", "reply_to_email: executing", args);
          const accountId = getAccountIdForEmail(args.message_id);
          const data = await gmailApi({
            action: "reply",
            messageId: args.message_id,
            threadId: args.thread_id,
            body: args.reply_text,
            accountId,
          });
          if (data.error) { debugLogClient("error", "reply_to_email: failed", data.error); return { error: data.error }; }
          await gmailApi({
            action: "archive",
            threadId: args.thread_id,
            accountId,
          });
          deps.recordAction("reply");
          debugLogClient("tool", "reply_to_email: success");
          return { success: true, message: "Reply sent and email archived." };
        },
      }),

      tool({
        name: "archive_email",
        description:
          "Archive the current email thread (remove from inbox). This archives the entire conversation. Call this when the user says to archive.",
        parameters: {
          type: "object",
          properties: {
            message_id: {
              type: "string",
              description: "The ID of the email to archive",
            },
          },
          required: ["message_id"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          debugLogClient("tool", "archive_email: executing", args);
          const accountId = getAccountIdForEmail(args.message_id);
          const threadId = getThreadIdForEmail(args.message_id);
          const data = await gmailApi({
            action: "archive",
            threadId: threadId || args.message_id,
            accountId,
          });
          if (data.error) { debugLogClient("error", "archive_email: failed", data.error); return { error: data.error }; }
          deps.recordAction("archive");
          debugLogClient("tool", "archive_email: success");
          return { success: true, message: "Email archived." };
        },
      }),

      tool({
        name: "block_sender",
        description:
          "Block a sender so all their future emails go straight to trash. Also archives the current email. Only call this after the user explicitly confirms they want to block the sender.",
        parameters: {
          type: "object",
          properties: {
            message_id: {
              type: "string",
              description: "The ID of the email whose sender should be blocked",
            },
          },
          required: ["message_id"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          const accountId = getAccountIdForEmail(args.message_id);
          const data = await gmailApi({
            action: "blockSender",
            messageId: args.message_id,
            accountId,
          });
          if (data.error) return data;
          deps.recordAction("block");
          return {
            success: true,
            blockedEmail: data.blockedEmail,
            blockedName: data.blockedName,
            message: `Blocked ${data.blockedName || data.blockedEmail}. All future emails from them will go to trash.`,
          };
        },
      }),

      tool({
        name: "unsubscribe_from_email",
        description:
          "Unsubscribe from a mailing list or newsletter. Automatically detects the best unsubscribe method (one-click, email, or browser automation) and handles it. The email is archived after unsubscribing. Call this when the user says 'unsubscribe', 'stop these emails', 'unsubscribe from this', or similar.",
        parameters: {
          type: "object",
          properties: {
            message_id: {
              type: "string",
              description: "The ID of the email to unsubscribe from",
            },
          },
          required: ["message_id"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          debugLogClient("tool", "unsubscribe_from_email: executing", args);
          const accountId = getAccountIdForEmail(args.message_id);
          const threadId = getThreadIdForEmail(args.message_id);
          const data = await gmailApi({
            action: "unsubscribe",
            messageId: args.message_id,
            threadId,
            accountId,
          });
          if (data.error) {
            debugLogClient("error", "unsubscribe_from_email: failed", data.error);
            return { error: data.error };
          }
          if (data.success || data.method === "browser") {
            deps.recordAction("unsubscribe");
          }
          debugLogClient("tool", `unsubscribe_from_email: ${data.method} — success=${data.success}`, data);
          return {
            success: data.success,
            method: data.method,
            message: data.message,
            browserTaskId: data.browserTaskId || null,
          };
        },
      }),

      tool({
        name: "skip_email",
        description:
          "Skip the current email — marks it as read and moves on. Call this when the user says skip or next.",
        parameters: {
          type: "object",
          properties: {
            message_id: {
              type: "string",
              description: "The ID of the email to skip",
            },
          },
          required: ["message_id"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          debugLogClient("tool", "skip_email: executing", args);
          const accountId = getAccountIdForEmail(args.message_id);
          const data = await gmailApi({
            action: "markRead",
            messageId: args.message_id,
            accountId,
          });
          if (data.error) { debugLogClient("error", "skip_email: failed", data.error); return { error: data.error }; }
          deps.recordAction("skip");
          debugLogClient("tool", "skip_email: success");
          return { success: true, message: "Email marked as read." };
        },
      }),

      tool({
        name: "search_emails",
        description:
          "Search the user's email history. Use Gmail search syntax (e.g. 'from:john budget', 'subject:Q3 report', 'to:me project update'). Call this when the user asks about a past email or wants to find something." +
          (isMultiAccount ? " Searches across all connected accounts." : ""),
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Gmail search query. Examples: 'from:sarah invoice', 'subject:board deck', 'budget Q3', 'has:attachment from:john'",
            },
            max_results: {
              type: "number",
              description: "Number of results to return. Defaults to 5.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          debugLogClient("tool", "search_emails: executing", args);
          const data = await gmailApi({
            action: "search",
            query: args.query,
            maxResults: args.max_results || 5,
          });
          if (data.error) { debugLogClient("error", "search_emails: failed", data.error); return { error: data.error }; }
          const result = {
            count: data.emails?.length || 0,
            emails: (data.emails || []).map((e: any) => ({
              id: e.id,
              threadId: e.threadId,
              from: e.from,
              to: e.to,
              subject: e.subject,
              snippet: e.snippet,
              date: e.date,
              ...(isMultiAccount
                ? { accountId: e.accountId, accountName: e.accountName }
                : {}),
            })),
          };
          debugLogClient("tool", `search_emails: ${result.count} results`);
          debugLogClientVerbose("tool", "search_emails → LLM TOOL RESULT", result);
          return result;
        },
      }),

      tool({
        name: "find_contact",
        description:
          "Find someone's email address by name. Searches the user's email history for messages involving that person and returns matching contacts sorted by how often they appear. Call this when the user wants to send an email to someone by name.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The person's name to search for (e.g. 'Denisa', 'John Smith')",
            },
          },
          required: ["name"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          debugLogClient("tool", "find_contact: executing", args);
          const data = await gmailApi({
            action: "findContact",
            name: args.name,
          });
          if (data.error) { debugLogClient("error", "find_contact: failed", data.error); return { error: data.error }; }
          const result = {
            contacts: data.contacts || [],
            message:
              data.contacts?.length > 0
                ? `Found ${data.contacts.length} match(es). The most frequent contact is ${data.contacts[0].name} <${data.contacts[0].email}>.`
                : "No contacts found with that name.",
          };
          debugLogClient("tool", `find_contact: ${result.contacts.length} matches`, result);
          return result;
        },
      }),

      tool({
        name: "send_new_email",
        description:
          "Compose and send a new email (not a reply). Only call this after confirming the recipient, subject, and body with the user. Use find_contact first if the user gives a name instead of an email address." +
          (isMultiAccount
            ? " Include account_id to specify which account to send from. If not specified, sends from the primary account."
            : ""),
        parameters: {
          type: "object",
          properties: {
            to: {
              type: "string",
              description: "Recipient email address",
            },
            subject: {
              type: "string",
              description: "Email subject line",
            },
            body: {
              type: "string",
              description: "Email body text",
            },
            ...(isMultiAccount
              ? {
                  account_id: {
                    type: "string",
                    description:
                      "The account ID to send from. Use get_connected_accounts to see available accounts.",
                  },
                }
              : {}),
          },
          required: ["to", "subject", "body"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          debugLogClient("tool", "send_new_email: executing", args);
          const data = await gmailApi({
            action: "compose",
            to: args.to,
            subject: args.subject,
            body: args.body,
            accountId: args.account_id,
          });
          if (data.error) { debugLogClient("error", "send_new_email: failed", data.error); return { error: data.error }; }
          debugLogClient("tool", "send_new_email: success");
          return { success: true, message: "Email sent." };
        },
      }),

      tool({
        name: "list_calendar_events",
        description:
          "List Google Calendar events in a time range, or search for events by keyword. Use this when the user asks what is on their calendar today, tomorrow, this afternoon, or during any specific window." +
          (isMultiAccount ? " Merges calendars from all connected accounts." : ""),
        parameters: {
          type: "object",
          properties: {
            start_time: {
              type: "string",
              description: "Start of the time window in ISO 8601 format.",
            },
            end_time: {
              type: "string",
              description: "End of the time window in ISO 8601 format.",
            },
            query: {
              type: "string",
              description: "Optional Google Calendar search query.",
            },
            max_results: {
              type: "number",
              description: "Maximum number of events to return. Defaults to 100.",
            },
          },
          required: [],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          debugLogClient("tool", "list_calendar_events: executing", args);
          const data = await gmailApi({
            action: "calendarList",
            startTime: args.start_time,
            endTime: args.end_time,
            query: args.query,
            maxResults: args.max_results || 100,
          });
          if (data.error) { debugLogClient("error", "list_calendar_events: failed", data.error); return { error: data.error }; }
          const result = {
            count: data.events?.length || 0,
            events: (data.events || []).map((event: any) => ({
              id: event.id,
              summary: event.summary,
              start: event.start,
              end: event.end,
              location: event.location,
              attendees: event.attendees,
              htmlLink: event.htmlLink,
            })),
          };
          debugLogClient("tool", `list_calendar_events: ${result.count} events`, result);
          return result;
        },
      }),

      tool({
        name: "list_gmail_filters",
        description:
          "List the user's active Gmail filters. Use this when the user asks what filters are currently active.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        execute: async () => {
          const data = await gmailApi({ action: "listFilters" });
          if (data.error) return { error: data.error };
          return {
            count: data.filters?.length || 0,
            filters: data.filters || [],
          };
        },
      }),

      tool({
        name: "create_calendar_invite",
        description:
          "Create a Google Calendar event and send invitations to attendees. Use run_calendar_setup first if the event should use the user's home address, work address, or Zoom link.",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Event title",
            },
            start_time: {
              type: "string",
              description: "Event start time in ISO 8601 format.",
            },
            end_time: {
              type: "string",
              description: "Event end time in ISO 8601 format.",
            },
            time_zone: {
              type: "string",
              description: "Optional IANA timezone like America/Los_Angeles.",
            },
            attendee_emails: {
              type: "array",
              items: { type: "string" },
              description: "Attendee email addresses.",
            },
            notes: {
              type: "string",
              description: "Optional event notes or description.",
            },
            location_preference: {
              type: "string",
              enum: ["home", "work", "zoom", "custom", "none"],
              description:
                "Use an inferred runtime default or a custom location.",
            },
            custom_location: {
              type: "string",
              description: "Required when location_preference is custom.",
            },
          },
          required: ["title", "start_time", "end_time"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          debugLogClient("tool", "create_calendar_invite: executing", args);
          let inferredProfile = deps.calendarProfile();
          if (
            !inferredProfile &&
            ["home", "work", "zoom"].includes(args.location_preference)
          ) {
            debugLogClient("tool", "create_calendar_invite: loading calendar profile first");
            const setup = await getOrLoadCalendarProfile();
            if ("error" in setup) { debugLogClient("error", "create_calendar_invite: profile load failed", setup.error); return { error: setup.error }; }
            inferredProfile = setup.profile;
          }

          const data = await gmailApi({
            action: "calendarCreate",
            title: args.title,
            startTime: args.start_time,
            endTime: args.end_time,
            timeZone: args.time_zone,
            attendeeEmails: args.attendee_emails,
            notes: args.notes,
            locationPreference: args.location_preference,
            customLocation: args.custom_location,
            inferredProfile,
          });
          if (data.error) { debugLogClient("error", "create_calendar_invite: failed", data.error); return { error: data.error }; }
          const result = {
            success: true,
            event: data.event,
            usedProfileFields: data.usedProfileFields || [],
            message: "Calendar invite created.",
          };
          debugLogClient("tool", "create_calendar_invite: success", result);
          return result;
        },
      }),

      tool({
        name: "edit_calendar_event",
        description:
          "Edit an existing Google Calendar event. Use list_calendar_events first to find the event ID. Only provide the fields that need to change.",
        parameters: {
          type: "object",
          properties: {
            event_id: {
              type: "string",
              description: "The ID of the calendar event to edit.",
            },
            title: { type: "string", description: "New event title." },
            start_time: { type: "string", description: "New start time in ISO 8601 format." },
            end_time: { type: "string", description: "New end time in ISO 8601 format." },
            time_zone: { type: "string", description: "Optional IANA timezone." },
            attendee_emails: {
              type: "array",
              items: { type: "string" },
              description: "Full list of attendee email addresses.",
            },
            notes: { type: "string", description: "New event description." },
            location: { type: "string", description: "New event location." },
          },
          required: ["event_id"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          const data = await gmailApi({
            action: "calendarUpdate",
            eventId: args.event_id,
            title: args.title,
            startTime: args.start_time,
            endTime: args.end_time,
            timeZone: args.time_zone,
            attendeeEmails: args.attendee_emails,
            notes: args.notes,
            location: args.location,
          });
          if (data.error) return { error: data.error };
          return {
            success: true,
            event: data.event,
            message: "Calendar event updated.",
          };
        },
      }),

      tool({
        name: "delete_calendar_event",
        description:
          "Delete a Google Calendar event. Use list_calendar_events first to find the event ID. ALWAYS confirm with the user before deleting.",
        parameters: {
          type: "object",
          properties: {
            event_id: {
              type: "string",
              description: "The ID of the calendar event to delete.",
            },
            notify_attendees: {
              type: "boolean",
              description: "Whether to send cancellation emails to attendees. Defaults to true.",
            },
          },
          required: ["event_id"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          debugLogClient("tool", "delete_calendar_event: executing", args);
          const data = await gmailApi({
            action: "calendarDelete",
            eventId: args.event_id,
            sendUpdates: args.notify_attendees === false ? "none" : "all",
          });
          if (data.error) { debugLogClient("error", "delete_calendar_event: failed", data.error); return { error: data.error }; }
          debugLogClient("tool", "delete_calendar_event: success");
          return { success: true, message: "Calendar event deleted." };
        },
      }),

      tool({
        name: "preview_archive_filter_for_email",
        description:
          "Preview archive filter options for the current email and identify close existing filters. Use this before creating or replacing a filter.",
        parameters: {
          type: "object",
          properties: {
            message_id: {
              type: "string",
              description: "The ID of the current email",
            },
          },
          required: ["message_id"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          const accountId = getAccountIdForEmail(args.message_id);
          const data = await gmailApi({
            action: "previewArchiveFilter",
            messageId: args.message_id,
            accountId,
          });
          if (data.error) return data;
          return data;
        },
      }),

      tool({
        name: "apply_archive_filter_for_email",
        description:
          "Create a new Gmail archive filter for the current email, or replace a close existing filter. Only call this after previewing and confirming with the user.",
        parameters: {
          type: "object",
          properties: {
            message_id: {
              type: "string",
              description: "The ID of the current email",
            },
            match_strategy: {
              type: "string",
              enum: ["from", "from_and_subject"],
              description: "How narrowly to match.",
            },
            existing_filter_id: {
              type: "string",
              description: "Optional existing Gmail filter ID to replace.",
            },
          },
          required: ["message_id", "match_strategy"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          const accountId = getAccountIdForEmail(args.message_id);
          const data = await gmailApi({
            action: "upsertArchiveFilter",
            messageId: args.message_id,
            matchStrategy:
              args.match_strategy === "from_and_subject"
                ? "fromAndSubject"
                : "from",
            existingFilterId: args.existing_filter_id,
            accountId,
          });
          if (data.error) return data;
          return data;
        },
      }),

      tool({
        name: "apply_filter_to_existing_emails",
        description:
          "Apply an archive filter retroactively to matching emails already in the inbox.",
        parameters: {
          type: "object",
          properties: {
            message_id: {
              type: "string",
              description: "The ID of the email used to create the filter",
            },
            match_strategy: {
              type: "string",
              enum: ["from", "from_and_subject"],
              description: "The same match strategy used when creating the filter.",
            },
          },
          required: ["message_id", "match_strategy"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          const accountId = getAccountIdForEmail(args.message_id);
          const data = await gmailApi({
            action: "applyFilterToExisting",
            messageId: args.message_id,
            matchStrategy:
              args.match_strategy === "from_and_subject"
                ? "fromAndSubject"
                : "from",
            accountId,
          });
          if (data.error) return data;
          return data;
        },
      }),

      // ── Multi-account tools ──────────────────────
      ...(isMultiAccount
        ? [
            tool({
              name: "get_connected_accounts",
              description:
                "List the user's connected Gmail accounts with their names and email addresses. Use this to see which accounts are available.",
              parameters: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
              execute: async () => {
                debugLogClient("tool", "get_connected_accounts: executing");
                const data = await gmailApi({ action: "getAccounts" });
                if (data.error) return { error: data.error };
                return { accounts: data.accounts };
              },
            }),

            tool({
              name: "rename_account",
              description:
                "Set or update the display name for a connected Gmail account (e.g., 'Work', 'Personal'). Call this when the user tells you what to call one of their accounts.",
              parameters: {
                type: "object",
                properties: {
                  account_id: {
                    type: "string",
                    description: "The ID of the account to rename",
                  },
                  display_name: {
                    type: "string",
                    description: "The new display name (e.g., 'Work', 'Personal')",
                  },
                },
                required: ["account_id", "display_name"],
                additionalProperties: false,
              },
              execute: async (args: any) => {
                debugLogClient("tool", "rename_account: executing", args);
                const data = await gmailApi({
                  action: "renameAccount",
                  accountId: args.account_id,
                  displayName: args.display_name,
                });
                if (data.error) return { error: data.error };
                debugLogClient("tool", "rename_account: success");
                return {
                  success: true,
                  message: `Account renamed to "${args.display_name}".`,
                };
              },
            }),

            tool({
              name: "focus_account",
              description:
                "Focus on emails from a single account only. Use this when the user says things like 'just show me work emails', 'focus on personal', or 'I only want to see my work inbox'. This re-fetches emails filtered to that one account and resets the queue.",
              parameters: {
                type: "object",
                properties: {
                  account_id: {
                    type: "string",
                    description: "The ID of the account to focus on.",
                  },
                },
                required: ["account_id"],
                additionalProperties: false,
              },
              execute: async (args: any) => {
                debugLogClient("tool", "focus_account: executing", args);
                deps.setFocusedAccountId(args.account_id);
                // Re-fetch emails for just this account
                const data = await gmailApi({ action: "list", maxResults: 50, accountId: args.account_id });
                if (data.error) {
                  debugLogClient("error", "focus_account: failed", data.error);
                  return { error: data.error };
                }
                const emails = data.emails || [];
                deps.setEmails(emails);
                deps.setEmailIndex(0);
                deps.setNextPageTokens(data.accountPageTokens || {});
                const account = deps.accounts.find((a) => a.id === args.account_id);
                const name = account?.displayName || account?.email || "selected account";
                debugLogClient("tool", `focus_account: focused on ${name}, ${emails.length} emails`);
                return {
                  success: true,
                  focused_account: name,
                  count: emails.length,
                  has_more_emails: Object.values(data.accountPageTokens || {}).some((t: any) => t !== null),
                  emails: emails.map((e: any) => ({
                    id: e.id,
                    from: e.from,
                    to: e.to,
                    cc: e.cc,
                    subject: e.subject,
                    snippet: e.snippet,
                    date: e.date,
                  })),
                };
              },
            }),

            tool({
              name: "focus_all_accounts",
              description:
                "Stop focusing on a single account and show emails from all connected accounts again. Use this when the user says 'show me everything', 'all accounts', 'include personal too', or similar.",
              parameters: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
              execute: async () => {
                debugLogClient("tool", "focus_all_accounts: executing");
                deps.setFocusedAccountId(null);
                // Re-fetch from all accounts
                const data = await gmailApi({ action: "list", maxResults: 50 });
                if (data.error) {
                  debugLogClient("error", "focus_all_accounts: failed", data.error);
                  return { error: data.error };
                }
                const emails = data.emails || [];
                deps.setEmails(emails);
                deps.setEmailIndex(0);
                deps.setNextPageTokens(data.accountPageTokens || {});
                debugLogClient("tool", `focus_all_accounts: ${emails.length} emails from all accounts`);
                return {
                  success: true,
                  count: emails.length,
                  has_more_emails: Object.values(data.accountPageTokens || {}).some((t: any) => t !== null),
                  emails: emails.map((e: any) => ({
                    id: e.id,
                    from: e.from,
                    to: e.to,
                    cc: e.cc,
                    subject: e.subject,
                    snippet: e.snippet,
                    date: e.date,
                    accountId: e.accountId,
                    accountName: e.accountName,
                  })),
                };
              },
            }),
          ]
        : []),

      // ── Profile & memory tools (DB-only) ────────
      ...(deps.dbAvailable
        ? [
            tool({
              name: "get_my_profile",
              description:
                "Retrieve the user's saved profile: home address, work address, phone number, and conference link.",
              parameters: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
              execute: async () => {
                debugLogClient("tool", "get_my_profile: executing");
                const data = await gmailApi({ action: "getProfile" });
                if (data.error) { debugLogClient("error", "get_my_profile: failed", data.error); return { error: data.error }; }
                debugLogClient("tool", "get_my_profile: success", data);
                return data;
              },
            }),

            tool({
              name: "update_my_profile",
              description:
                "Update the user's saved profile. Only provide the fields that need to change.",
              parameters: {
                type: "object",
                properties: {
                  home_address: { type: "string", description: "The user's home address." },
                  work_address: { type: "string", description: "The user's work address." },
                  phone_number: { type: "string", description: "The user's phone number." },
                  conference_link: {
                    type: "string",
                    description: "The user's preferred video conference link.",
                  },
                },
                required: [],
                additionalProperties: false,
              },
              execute: async (args: any) => {
                debugLogClient("tool", "update_my_profile: executing", args);
                const data = await gmailApi({
                  action: "updateProfile",
                  homeAddress: args.home_address,
                  workAddress: args.work_address,
                  phoneNumber: args.phone_number,
                  conferenceLink: args.conference_link,
                });
                if (data.error) { debugLogClient("error", "update_my_profile: failed", data.error); return { error: data.error }; }
                debugLogClient("tool", "update_my_profile: success");
                return { success: true, message: "Profile updated." };
              },
            }),

            tool({
              name: "get_memories",
              description:
                "Retrieve the user's saved memories — a freeform notes document.",
              parameters: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
              execute: async () => {
                debugLogClient("tool", "get_memories: executing");
                const data = await gmailApi({ action: "getMemories" });
                if (data.error) { debugLogClient("error", "get_memories: failed", data.error); return { error: data.error }; }
                debugLogClient("tool", "get_memories: success");
                return { memories: data.memories || "No memories saved yet." };
              },
            }),

            tool({
              name: "save_memories",
              description:
                "Save or update the user's memories. Always read existing memories first with get_memories, then append or update.",
              parameters: {
                type: "object",
                properties: {
                  content: {
                    type: "string",
                    description: "The full updated markdown content to save.",
                  },
                },
                required: ["content"],
                additionalProperties: false,
              },
              execute: async (args: any) => {
                debugLogClient("tool", "save_memories: executing", args);
                const data = await gmailApi({
                  action: "saveMemories",
                  content: args.content,
                });
                if (data.error) { debugLogClient("error", "save_memories: failed", data.error); return { error: data.error }; }
                debugLogClient("tool", "save_memories: success");
                return { success: true, message: "Memories saved." };
              },
            }),
          ]
        : []),

      tool({
        name: "mute_microphone",
        description:
          "Mute the user's microphone. Use this when the user asks you to be quiet, mute, hold on, or needs a moment. The user can unmute anytime by tapping the mic button on screen.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        execute: async () => {
          debugLogClient("tool", "mute_microphone: executing");
          deps.onMute();
          return { success: true, message: "Microphone muted. The user can tap the mic button to unmute when ready." };
        },
      }),

      tool({
        name: "end_session",
        description:
          "End the voice session and disconnect completely. ONLY use this when the user EXPLICITLY asks to end or disconnect the session — e.g. 'end the session', 'disconnect', 'shut down'. Do NOT call this for normal conversational interrupts like 'stop', 'hold on', 'wait', or 'that's all'. Before calling, always ask whether they'd also like to log out.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        execute: async () => {
          debugLogClient("tool", "stop_conversation: executing");
          // Small delay so the AI's final words can be spoken before disconnect
          setTimeout(() => deps.onStop(), 1500);
          return { success: true, message: "Conversation will end momentarily." };
        },
      }),

      tool({
        name: "log_out",
        description:
          "Log the user out of their Google account and end the session. Use this when the user explicitly asks to log out, sign out, or switch accounts.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        execute: async () => {
          debugLogClient("tool", "log_out: executing");
          // Small delay so the AI's farewell can be spoken
          setTimeout(() => deps.onLogout(), 1500);
          return { success: true, message: "Logging out. Goodbye!" };
        },
      }),

      tool({
        name: "get_session_summary",
        description:
          "Get a summary of actions taken this session. Call this when the user says 'I'm done', 'that's all', 'wrap up', or wants to end the session.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        execute: async () => {
          const summary = deps.getActionSummary();
          const emails = deps.emails();
          const idx = deps.emailIndex();
          const result = {
            replied: summary.replied,
            skipped: summary.skipped,
            archived: summary.archived,
            blocked: summary.blocked,
            unsubscribed: summary.unsubscribed,
            totalProcessed: summary.replied + summary.skipped + summary.archived + summary.blocked + summary.unsubscribed,
            remaining: Math.max(0, emails.length - idx),
          };
          try {
            await fetch("/api/log", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ event: "session_summary", data: result }),
            });
          } catch {}
          return result;
        },
      }),
    ],

    handoffs: [],
  });

  debugLogClientVerbose("llm", "REALTIME AGENT CONFIG", {
    name: agent.name,
    voice: agent.voice,
    instructionLength: agent.instructions?.length,
    instructions: agent.instructions,
    toolCount: agent.tools?.length,
    toolNames: agent.tools?.map((t: any) => t.name),
  });

  return agent;
}
