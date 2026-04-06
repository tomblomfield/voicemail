import { google } from "googleapis";
import fs from "fs";
import path from "path";

const TOKEN_PATH = path.join(process.cwd(), "token.json");

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

function loadTokens() {
  try {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    oauth2Client.setCredentials(tokens);
    return true;
  } catch {
    return false;
  }
}

function saveTokens(tokens: any) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

// Auto-refresh tokens
oauth2Client.on("tokens", (tokens) => {
  const existing = fs.existsSync(TOKEN_PATH)
    ? JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"))
    : {};
  saveTokens({ ...existing, ...tokens });
});

export function getAuthUrl(): string {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ],
  });
}

export async function handleCallback(code: string) {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  saveTokens(tokens);
}

export function isAuthenticated(): boolean {
  return loadTokens();
}

function getGmail() {
  loadTokens();
  return google.gmail({ version: "v1", auth: oauth2Client });
}

export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
}

export async function getUnreadEmails(
  maxResults = 10
): Promise<EmailSummary[]> {
  const gmail = getGmail();
  const res = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread in:inbox",
    maxResults,
  });

  if (!res.data.messages) return [];

  const emails: EmailSummary[] = [];
  for (const msg of res.data.messages) {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id!,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });

    const headers = detail.data.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name === name)?.value || "";

    emails.push({
      id: msg.id!,
      threadId: msg.threadId!,
      from: getHeader("From"),
      subject: getHeader("Subject"),
      snippet: detail.data.snippet || "",
      date: getHeader("Date"),
    });
  }

  return emails;
}

export async function getEmailBody(messageId: string): Promise<string> {
  const gmail = getGmail();
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const payload = res.data.payload;
  if (!payload) return "";

  function extractText(parts: any[]): string {
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
      if (part.parts) {
        const text = extractText(part.parts);
        if (text) return text;
      }
    }
    return "";
  }

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    return extractText(payload.parts);
  }

  return res.data.snippet || "";
}

export async function sendReply(
  messageId: string,
  threadId: string,
  body: string
): Promise<void> {
  const gmail = getGmail();

  // Get the original message to extract headers for the reply
  const original = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["From", "Subject", "Message-ID"],
  });

  const headers = original.data.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name === name)?.value || "";

  const to = getHeader("From");
  const subject = getHeader("Subject").startsWith("Re:")
    ? getHeader("Subject")
    : `Re: ${getHeader("Subject")}`;
  const messageIdHeader = getHeader("Message-ID");

  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${messageIdHeader}`,
    `References: ${messageIdHeader}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    body,
  ].join("\r\n");

  const encoded = Buffer.from(raw)
    .toString("base64url");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encoded,
      threadId,
    },
  });
}

export async function archiveEmail(messageId: string): Promise<void> {
  const gmail = getGmail();
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      removeLabelIds: ["INBOX"],
    },
  });
}

export async function markAsRead(messageId: string): Promise<void> {
  const gmail = getGmail();
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      removeLabelIds: ["UNREAD"],
    },
  });
}
