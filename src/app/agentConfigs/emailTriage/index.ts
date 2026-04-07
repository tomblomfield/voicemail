import { RealtimeAgent, tool } from "@openai/agents/realtime";
import type { InferredCalendarProfile } from "@/app/lib/calendar";
import { debugLogClient } from "@/app/lib/debugLog";

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
}

export interface EmailTriageDeps {
  emails: () => EmailData[];
  setEmails: (emails: EmailData[]) => void;
  emailIndex: () => number;
  advanceIndex: () => void;
  recordAction: (action: "reply" | "skip" | "archive") => void;
  getActionSummary: () => { replied: number; skipped: number; archived: number };
  calendarProfile: () => InferredCalendarProfile | null;
  setCalendarProfile: (profile: InferredCalendarProfile) => void;
}

export function createEmailTriageAgent(deps: EmailTriageDeps) {
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

  return new RealtimeAgent({
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
5. After each action, automatically call get_next_email for the next one.
6. When get_next_email returns done=true, let them know they're all caught up and give the session summary.
7. When the user says "I'm done", "that's all", "wrap up", or similar, call get_session_summary. Announce it naturally: "All set. You replied to X, skipped Y, and archived Z. You still have N left for later. Have a great day!"

# Search & Compose
- The user can ask to find old emails at any time (e.g., "Did Sarah send me that report?"). Use search_emails with Gmail search syntax.
- The user can ask to send a new email (e.g., "Send an email to Denisa"). Use find_contact to resolve the name to an email address. If multiple matches, read the top 2-3 and ask which one. Then ask what they want to say, draft it, read it back, and confirm before sending with send_new_email.
- Always confirm recipient, subject, and body before sending a new email.

# Calendar
- If the user asks about their calendar, use list_calendar_events.
- Before the first calendar-related task in a session, call run_calendar_setup. This is the setup phase. It scans past calendar invites and tries to infer the user's home address, work address, and Zoom link for this runtime only.
- When you describe the setup results, make clear these are inferred from past invites, not stored facts.
- If the user asks "what's my home address", "what's my work address", or "what's my Zoom link", call run_calendar_setup and answer from the results.
- When the user wants to schedule or send a calendar invite, confirm the title, date, start time, end time, attendees, and location before using create_calendar_invite.
- If the user says "at home", "at my office", "at work", or "on Zoom", use create_calendar_invite with the matching location_preference.
- Never invent a home address, work address, or Zoom link. If setup cannot infer one confidently enough, tell the user and ask for a custom location instead.

# Filters
- If the user asks what Gmail filters are active, call list_gmail_filters and summarize the relevant ones.
- If the user wants to auto-archive emails like the current one, first call preview_archive_filter_for_email for the current message. Explain the recommended match strategy before making changes.
- Prefer the narrower "from_and_subject" strategy unless the user clearly wants every message from that sender archived.
- If preview_archive_filter_for_email shows a very close existing filter, offer to replace that filter instead of adding a duplicate. Be explicit that Gmail doesn't support editing filters directly, so replacing means delete-and-recreate.
- Before calling apply_archive_filter_for_email, confirm whether they want a new filter or to replace an existing one.
- If a filter tool says Gmail needs to be reconnected, tell the user to reconnect Gmail and do not keep retrying.

# Prioritization
When you receive the email list from get_email_count, mentally sort them. Present emails in this order:
- URGENT first: direct asks, deadlines, board/investor emails, people issues, anything time-sensitive
- IMPORTANT next: project updates, meeting follow-ups, interesting discussions
- FYI last: newsletters, automated notifications, CC'd threads
You decide the order — use your judgment. The user trusts you to surface the important stuff first.

# Style
- Keep summaries SHORT — sender name, subject, and the key point. Don't read the full email unless asked.
- For senders, just use the name (not the full email address) unless it's unclear.
- Be natural and conversational, like a helpful assistant riding along.
- If the user says something ambiguous, default to the most likely intent (e.g., "next" means skip).
- Don't repeat options every time — just ask "What would you like to do?" after the first couple.
`,

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
          "Get all unread emails from the inbox. Returns the full list with sender, subject, to/cc, and snippet for each email. Call this first so you can tell the user how many emails they have and which ones look urgent.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        execute: async () => {
          debugLogClient("tool", "get_email_count: executing");
          const data = await gmailApi({ action: "list", maxResults: 50 });
          if (data.error) {
            debugLogClient("error", "get_email_count: failed", data.error);
            return { error: data.error };
          }
          const emails = data.emails || [];
          deps.setEmails(emails);
          const result = {
            count: emails.length,
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
          debugLogClient("tool", `get_email_count: ${emails.length} emails`, result);
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
                total: summary.replied + summary.skipped + summary.archived,
              },
            };
          }

          // Find the requested email or take the next one
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
                  total: summary.replied + summary.skipped + summary.archived,
                },
              };
            }
          }

          const email = emails[emailIdx];
          deps.advanceIndex();

          // Fetch thread context (last 5 messages) so the agent sees the full conversation
          const threadData = await gmailApi({
            action: "readThread",
            threadId: email.threadId,
          });

          const threadMessages = threadData.messages || [];

          // Format thread as a readable conversation for the agent
          let conversationContext = "";
          if (threadMessages.length > 1) {
            conversationContext = threadMessages
              .map((m: any) => `[${m.from}]: ${m.body}`)
              .join("\n---\n");
          } else if (threadMessages.length === 1) {
            conversationContext = threadMessages[0].body;
          } else {
            // Fallback to single message body
            const bodyData = await gmailApi({
              action: "read",
              messageId: email.id,
            });
            conversationContext = bodyData.body || email.snippet;
          }

          const emailResult = {
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
          debugLogClient("tool", `get_next_email: returning email from=${email.from} subject="${email.subject}"`, { ...emailResult, body: emailResult.body.slice(0, 200) + "..." });
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
          const data = await gmailApi({
            action: "reply",
            messageId: args.message_id,
            threadId: args.thread_id,
            body: args.reply_text,
          });
          if (data.error) { debugLogClient("error", "reply_to_email: failed", data.error); return { error: data.error }; }
          await gmailApi({
            action: "archive",
            messageId: args.message_id,
          });
          deps.recordAction("reply");
          debugLogClient("tool", "reply_to_email: success");
          return { success: true, message: "Reply sent and email archived." };
        },
      }),

      tool({
        name: "archive_email",
        description:
          "Archive the current email (remove from inbox). Call this when the user says to archive.",
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
          const data = await gmailApi({
            action: "archive",
            messageId: args.message_id,
          });
          if (data.error) { debugLogClient("error", "archive_email: failed", data.error); return { error: data.error }; }
          deps.recordAction("archive");
          debugLogClient("tool", "archive_email: success");
          return { success: true, message: "Email archived." };
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
          const data = await gmailApi({
            action: "markRead",
            messageId: args.message_id,
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
          "Search the user's email history. Use Gmail search syntax (e.g. 'from:john budget', 'subject:Q3 report', 'to:me project update'). Call this when the user asks about a past email or wants to find something.",
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
            })),
          };
          debugLogClient("tool", `search_emails: ${result.count} results`, result);
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
          "Compose and send a new email (not a reply). Only call this after confirming the recipient, subject, and body with the user. Use find_contact first if the user gives a name instead of an email address.",
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
          });
          if (data.error) { debugLogClient("error", "send_new_email: failed", data.error); return { error: data.error }; }
          debugLogClient("tool", "send_new_email: success");
          return { success: true, message: "Email sent." };
        },
      }),

      tool({
        name: "list_calendar_events",
        description:
          "List Google Calendar events in a time range. Use this when the user asks what is on their calendar today, tomorrow, this afternoon, or during any specific window.",
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
              description: "Maximum number of events to return. Defaults to 10.",
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
            maxResults: args.max_results || 10,
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
                "Use an inferred runtime default or a custom location. Choose home, work, or zoom when the user refers to those saved concepts.",
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
          const data = await gmailApi({
            action: "previewArchiveFilter",
            messageId: args.message_id,
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
              description:
                "How narrowly to match the current email. Use from_and_subject unless the user wants all email from that sender archived.",
            },
            existing_filter_id: {
              type: "string",
              description:
                "Optional existing Gmail filter ID to replace instead of creating a new filter.",
            },
          },
          required: ["message_id", "match_strategy"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          const data = await gmailApi({
            action: "upsertArchiveFilter",
            messageId: args.message_id,
            matchStrategy:
              args.match_strategy === "from_and_subject"
                ? "fromAndSubject"
                : "from",
            existingFilterId: args.existing_filter_id,
          });
          if (data.error) return data;
          return data;
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
            totalProcessed: summary.replied + summary.skipped + summary.archived,
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
}
