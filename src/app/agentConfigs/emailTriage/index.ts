import { RealtimeAgent, tool } from "@openai/agents/realtime";

async function gmailApi(body: Record<string, any>) {
  const res = await fetch("/api/gmail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export const emailTriageAgent = new RealtimeAgent({
  name: "emailTriage",
  voice: "ash",
  handoffDescription: "Voice email triage assistant for hands-free driving",

  instructions: `
# Role
You are a hands-free email assistant designed for someone driving to work. Be concise, conversational, and efficient. The user cannot look at a screen — everything must be communicated by voice.

# Behavior
1. When the session starts, immediately call get_email_count to check how many unread emails there are, then greet the user with the count.
2. Then call get_next_email to fetch the first email and read a brief summary: who it's from, the subject, and a 1-2 sentence summary of the content.
3. After summarizing, ask: "Would you like to reply, skip, or archive this one?"
4. Based on their response:
   - **Reply**: Ask what they'd like to say. Draft the reply, read it back to them, and ask to confirm before sending. If they confirm, call reply_to_email.
   - **Skip**: Call skip_email and move to the next one.
   - **Archive**: Call archive_email and move to the next one.
5. After each action, automatically move to the next email by calling get_next_email.
6. When there are no more emails, let them know they're all caught up.

# Style
- Keep summaries SHORT — sender name, subject, and the key point. Don't read the full email unless asked.
- For senders, just use the name (not the full email address) unless it's unclear.
- Be natural and conversational, like a helpful assistant riding along.
- If the user says something ambiguous, default to the most likely intent (e.g., "next" means skip).
- Don't repeat options every time — just ask "What would you like to do?" after the first couple.
`,

  tools: [
    tool({
      name: "get_email_count",
      description:
        "Get the count of unread emails in the inbox. Call this first to tell the user how many emails they have.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: async () => {
        const data = await gmailApi({ action: "list", maxResults: 50 });
        if (data.error) return { error: data.error };
        return { count: data.emails?.length || 0 };
      },
    }),

    tool({
      name: "get_next_email",
      description:
        "Fetch the next unread email from the inbox. Returns the sender, subject, and full body text. Call this to get the next email to present to the user.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: async () => {
        // Get the list of unread emails
        const listData = await gmailApi({ action: "list", maxResults: 1 });
        if (listData.error) return { error: listData.error };
        if (!listData.emails || listData.emails.length === 0) {
          return { done: true, message: "No more unread emails." };
        }

        const email = listData.emails[0];

        // Get the full body
        const bodyData = await gmailApi({
          action: "read",
          messageId: email.id,
        });

        return {
          id: email.id,
          threadId: email.threadId,
          from: email.from,
          subject: email.subject,
          date: email.date,
          body: bodyData.body || email.snippet,
        };
      },
    }),

    tool({
      name: "reply_to_email",
      description:
        "Send a reply to the current email. Only call this after the user has confirmed the reply text.",
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
        const data = await gmailApi({
          action: "reply",
          messageId: args.message_id,
          threadId: args.thread_id,
          body: args.reply_text,
        });
        if (data.error) return { error: data.error };
        return { success: true, message: "Reply sent successfully." };
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
        const data = await gmailApi({
          action: "archive",
          messageId: args.message_id,
        });
        if (data.error) return { error: data.error };
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
        const data = await gmailApi({
          action: "markRead",
          messageId: args.message_id,
        });
        if (data.error) return { error: data.error };
        return { success: true, message: "Email marked as read." };
      },
    }),
  ],

  handoffs: [],
});

export const emailTriageScenario = [emailTriageAgent];
