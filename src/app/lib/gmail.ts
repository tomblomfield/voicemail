import { google } from "googleapis";
import crypto from "crypto";
import {
  inferCalendarProfile as inferCalendarProfileFromEvents,
  resolveCalendarInviteDetails,
  type CalendarInferenceEvent,
  type InferredCalendarProfile,
} from "@/app/lib/calendar";

const REQUIRED_GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.settings.basic",
] as const;

export const GMAIL_FILTER_WRITE_SCOPE =
  "https://www.googleapis.com/auth/gmail.settings.basic";

export type FilterMatchStrategy = "from" | "fromAndSubject";

export interface GmailFilterCriteria {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
  excludeChats?: boolean;
}

export interface GmailFilterAction {
  addLabelIds?: string[];
  removeLabelIds?: string[];
  forward?: string;
}

export interface GmailFilterSummary {
  id: string;
  criteria: GmailFilterCriteria;
  action: GmailFilterAction;
  archives: boolean;
  description: string;
}

export interface ArchiveFilterSuggestion {
  matchStrategy: FilterMatchStrategy;
  criteria: GmailFilterCriteria;
  description: string;
}

export interface ArchiveFilterPreview {
  message: {
    from: string;
    fromName: string;
    fromEmail: string;
    subject: string;
  };
  recommendedStrategy: FilterMatchStrategy;
  suggestions: ArchiveFilterSuggestion[];
  similarFilters: Array<
    GmailFilterSummary & {
      score: number;
      isVeryClose: boolean;
      reasons: string[];
    }
  >;
}

export class GmailScopeError extends Error {
  missingScopes: string[];

  constructor(missingScopes: string[]) {
    super("Missing required Gmail scopes");
    this.name = "GmailScopeError";
    this.missingScopes = missingScopes;
  }
}

const FOOTER_ELIGIBLE_SENDERS = new Set([
  "tomblomfield@gmail.com",
  "tb@ycombinator.com",
]);

function getEncryptionKey(): string {
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error("SESSION_SECRET environment variable is required");
  return key;
}

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(): string {
  return getOAuth2Client().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...REQUIRED_GOOGLE_SCOPES],
  });
}

export async function exchangeCode(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export function encryptTokens(tokens: any): string {
  const key = crypto.scryptSync(getEncryptionKey(), "salt", 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(JSON.stringify(tokens), "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted}`;
}

export function decryptTokens(encrypted: string): any {
  const key = crypto.scryptSync(getEncryptionKey(), "salt", 32);
  const [ivB64, tagB64, data] = encrypted.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(data, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return JSON.parse(decrypted);
}

export function hasRequiredGoogleScopes(tokens: any): boolean {
  const grantedScopes = String(tokens?.scope || "")
    .split(/\s+/)
    .filter(Boolean);

  if (grantedScopes.length === 0) return false;

  return REQUIRED_GOOGLE_SCOPES.every((scope) => grantedScopes.includes(scope));
}

export function getMissingScopes(
  tokens: any,
  requiredScopes: readonly string[] = GMAIL_SCOPES
): string[] {
  const grantedScopes = new Set(
    String(tokens?.scope || "")
      .split(/\s+/)
      .filter(Boolean)
  );

  return requiredScopes.filter((scope) => !grantedScopes.has(scope));
}

function getAuthedClient(tokens: any) {
  const client = getOAuth2Client();
  client.setCredentials(tokens);
  return client;
}

function getGmail(tokens: any) {
  return google.gmail({ version: "v1", auth: getAuthedClient(tokens) });
}

function getCalendar(tokens: any) {
  return google.calendar({ version: "v3", auth: getAuthedClient(tokens) });
}

function requireScopes(tokens: any, requiredScopes: readonly string[]) {
  const missingScopes = getMissingScopes(tokens, requiredScopes);
  if (missingScopes.length > 0) {
    throw new GmailScopeError(missingScopes);
  }
}

function getHeaders(detail: any) {
  return detail.data.payload?.headers || [];
}

function getHeaderValue(headers: any[], name: string) {
  return headers.find((h) => h.name === name)?.value || "";
}

function parseMailbox(value: string): { name: string; email: string } {
  const trimmed = value.trim();
  const bracketMatch = trimmed.match(/^(.*?)(?:<([^>]+)>)$/);
  if (bracketMatch) {
    return {
      name: bracketMatch[1].trim().replace(/^"|"$/g, ""),
      email: bracketMatch[2].trim().toLowerCase(),
    };
  }

  if (trimmed.includes("@")) {
    return { name: "", email: trimmed.toLowerCase() };
  }

  return { name: trimmed, email: "" };
}

function parseAddressList(value: string) {
  return value
    .split(",")
    .map((entry) => parseMailbox(entry))
    .filter((entry) => entry.name || entry.email);
}

export function normalizeSubjectForFilter(subject: string): string {
  return subject
    .replace(/^\s*((re|fwd?|aw):\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildArchiveFilterCriteria(
  fromEmail: string,
  subject: string,
  matchStrategy: FilterMatchStrategy
): GmailFilterCriteria {
  const normalizedSubject = normalizeSubjectForFilter(subject);
  if (matchStrategy === "fromAndSubject" && normalizedSubject) {
    return {
      from: fromEmail,
      subject: normalizedSubject,
    };
  }

  return { from: fromEmail };
}

function filterArchives(action: GmailFilterAction = {}): boolean {
  return action.removeLabelIds?.includes("INBOX") || false;
}

function summarizeFilterCriteria(criteria: GmailFilterCriteria) {
  const parts: string[] = [];

  if (criteria.from) parts.push(`from ${criteria.from}`);
  if (criteria.to) parts.push(`to ${criteria.to}`);
  if (criteria.subject) parts.push(`subject "${criteria.subject}"`);
  if (criteria.query) parts.push(`query "${criteria.query}"`);
  if (criteria.negatedQuery) parts.push(`excluding "${criteria.negatedQuery}"`);
  if (criteria.hasAttachment) parts.push("has attachments");
  if (criteria.excludeChats) parts.push("excluding chats");

  return parts.length > 0 ? parts.join(", ") : "all matching mail";
}

function summarizeFilterAction(action: GmailFilterAction) {
  const parts: string[] = [];

  if (filterArchives(action)) parts.push("archive");
  if (action.addLabelIds?.length) {
    parts.push(`add labels ${action.addLabelIds.join(", ")}`);
  }
  if (action.removeLabelIds?.length) {
    const remaining = action.removeLabelIds.filter((label) => label !== "INBOX");
    if (remaining.length) {
      parts.push(`remove labels ${remaining.join(", ")}`);
    }
  }
  if (action.forward) parts.push(`forward to ${action.forward}`);

  return parts.length > 0 ? parts.join("; ") : "take no visible action";
}

export function describeFilter(
  criteria: GmailFilterCriteria,
  action: GmailFilterAction
): string {
  return `If ${summarizeFilterCriteria(criteria)}, then ${summarizeFilterAction(action)}.`;
}

function summarizeExistingFilter(filter: any): GmailFilterSummary {
  const criteria = (filter.criteria || {}) as GmailFilterCriteria;
  const action = (filter.action || {}) as GmailFilterAction;

  return {
    id: filter.id || "",
    criteria,
    action,
    archives: filterArchives(action),
    description: describeFilter(criteria, action),
  };
}

function getFilterMatchDetails(
  filter: GmailFilterSummary,
  fromEmail: string,
  subject: string
) {
  const reasons: string[] = [];
  let score = 0;
  const normalizedSubject = normalizeSubjectForFilter(subject).toLowerCase();
  const query = filter.criteria.query?.toLowerCase() || "";
  const filterSubject = normalizeSubjectForFilter(
    filter.criteria.subject || ""
  ).toLowerCase();

  if ((filter.criteria.from || "").toLowerCase() === fromEmail) {
    score += 70;
    reasons.push("matches this sender");
  } else if (query.includes(`from:${fromEmail}`)) {
    score += 55;
    reasons.push("query already matches this sender");
  }

  if (normalizedSubject && filterSubject === normalizedSubject) {
    score += 25;
    reasons.push("matches this subject");
  } else if (normalizedSubject && query.includes(normalizedSubject)) {
    score += 15;
    reasons.push("query mentions this subject");
  }

  if (filter.archives) {
    score += 20;
    reasons.push("already archives matching mail");
  }

  return {
    score,
    reasons,
    isVeryClose:
      reasons.includes("matches this sender") &&
      (reasons.includes("matches this subject") || filter.archives),
  };
}

function mergeArchiveAction(action?: GmailFilterAction): GmailFilterAction {
  return {
    addLabelIds: action?.addLabelIds,
    forward: action?.forward,
    removeLabelIds: Array.from(
      new Set([...(action?.removeLabelIds || []), "INBOX"])
    ),
  };
}

async function getEmailMetadata(
  tokens: any,
  messageId: string
): Promise<{ from: string; fromName: string; fromEmail: string; subject: string }> {
  const gmail = getGmail(tokens);
  const detail = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["From", "Subject"],
  });

  const headers = getHeaders(detail);
  const from = getHeaderValue(headers, "From");
  const subject = getHeaderValue(headers, "Subject");
  const sender = parseMailbox(from);

  if (!sender.email) {
    throw new Error("Could not determine the sender for this email");
  }

  return {
    from,
    fromName: sender.name || sender.email,
    fromEmail: sender.email,
    subject,
  };
}

function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function shouldAddVoicemailFooter(userEmail: string): boolean {
  return FOOTER_ELIGIBLE_SENDERS.has(normalizeEmailAddress(userEmail));
}

export function getVoicemailSiteUrl(): string {
  const candidates = [
    process.env.VOICEMAIL_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN,
    process.env.RAILWAY_STATIC_URL,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const url = normalizeUrl(candidate);
    if (url) return url;
  }

  return "https://railway.app";
}

export function appendVoicemailFooter(body: string, userEmail: string): string {
  if (!shouldAddVoicemailFooter(userEmail)) return body;

  const trimmedBody = body.replace(/\s+$/, "");
  const footer = `sent with voicemail\n${getVoicemailSiteUrl()}`;

  if (!trimmedBody) return footer;

  return `${trimmedBody}\n\n${footer}`;
}

export async function getUserEmail(tokens: any): Promise<string> {
  const gmail = getGmail(tokens);
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.emailAddress || "";
}

export interface CalendarEventSummary {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  location: string;
  attendees: string[];
  htmlLink: string;
}

export interface CalendarListOptions {
  startTime?: string;
  endTime?: string;
  maxResults?: number;
  query?: string;
}

export interface UpdateCalendarEventInput {
  eventId: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  timeZone?: string;
  attendeeEmails?: string[];
  notes?: string;
  location?: string;
}

export interface CreateCalendarInviteInput {
  title: string;
  startTime: string;
  endTime: string;
  timeZone?: string;
  attendeeEmails?: string[];
  notes?: string;
  customLocation?: string;
  locationPreference?: "home" | "work" | "zoom" | "custom" | "none";
  inferredProfile?: InferredCalendarProfile | null;
}

export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  snippet: string;
  date: string;
}

export async function getUnreadEmails(
  tokens: any,
  maxResults = 10
): Promise<EmailSummary[]> {
  const gmail = getGmail(tokens);
  const res = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread in:inbox",
    maxResults,
  });

  if (!res.data.messages) return [];

  const emails: EmailSummary[] = await Promise.all(
    res.data.messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["From", "To", "Cc", "Subject", "Date"],
      });

      const headers = detail.data.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name === name)?.value || "";

      return {
        id: msg.id!,
        threadId: msg.threadId!,
        from: getHeader("From"),
        to: getHeader("To"),
        cc: getHeader("Cc"),
        subject: getHeader("Subject"),
        snippet: detail.data.snippet || "",
        date: getHeader("Date"),
      };
    })
  );

  return emails;
}

export function truncateToLatestMessage(body: string, maxLength = 2000): string {
  const separators = [
    /\r?\nOn .+wrote:\r?\n/,
    /\r?\n-{3,}Original Message-{3,}\r?\n/,
    /\r?\nFrom: .+\r?\nSent: /,
  ];

  let truncated = body;
  for (const sep of separators) {
    const match = truncated.search(sep);
    if (match > 0) {
      truncated = truncated.substring(0, match);
      break;
    }
  }

  truncated = truncated.trim();
  if (truncated.length > maxLength) {
    truncated = truncated.substring(0, maxLength) + "...";
  }
  return truncated;
}

export async function getEmailBody(
  tokens: any,
  messageId: string
): Promise<string> {
  const gmail = getGmail(tokens);
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

export async function getThreadMessages(
  tokens: any,
  threadId: string,
  maxMessages = 5
): Promise<{ from: string; date: string; body: string }[]> {
  const gmail = getGmail(tokens);
  const thread = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });

  const messages = thread.data.messages || [];
  // Take the last N messages (most recent context)
  const recent = messages.slice(-maxMessages);

  return recent.map((msg) => {
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name === name)?.value || "";

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

    let rawText = "";
    if (msg.payload?.body?.data) {
      rawText = Buffer.from(msg.payload.body.data, "base64url").toString("utf-8");
    } else if (msg.payload?.parts) {
      rawText = extractText(msg.payload.parts);
    } else {
      rawText = msg.snippet || "";
    }

    return {
      from: getHeader("From"),
      date: getHeader("Date"),
      body: rawText,
    };
  });
}

export async function sendReply(
  tokens: any,
  messageId: string,
  threadId: string,
  body: string,
  userEmail: string
): Promise<void> {
  const gmail = getGmail(tokens);

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
  const bodyWithFooter = appendVoicemailFooter(body, userEmail);

  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${messageIdHeader}`,
    `References: ${messageIdHeader}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    bodyWithFooter,
  ].join("\r\n");

  const encoded = Buffer.from(raw).toString("base64url");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded, threadId },
  });
}

export async function archiveEmail(
  tokens: any,
  messageId: string
): Promise<void> {
  const gmail = getGmail(tokens);
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["INBOX"] },
  });
}

export async function markAsRead(
  tokens: any,
  messageId: string
): Promise<void> {
  const gmail = getGmail(tokens);
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
}

export async function listActiveFilters(
  tokens: any
): Promise<GmailFilterSummary[]> {
  const gmail = getGmail(tokens);
  const res = await gmail.users.settings.filters.list({ userId: "me" });

  return (res.data.filter || [])
    .map((filter) => summarizeExistingFilter(filter))
    .sort((a, b) => Number(b.archives) - Number(a.archives));
}

export async function previewArchiveFilterForEmail(
  tokens: any,
  messageId: string
): Promise<ArchiveFilterPreview> {
  const message = await getEmailMetadata(tokens, messageId);
  const filters = await listActiveFilters(tokens);
  const similarFilters = filters
    .map((filter) => {
      const match = getFilterMatchDetails(
        filter,
        message.fromEmail,
        message.subject
      );
      return {
        ...filter,
        score: match.score,
        reasons: match.reasons,
        isVeryClose: match.isVeryClose,
      };
    })
    .filter((filter) => filter.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const suggestionOrder: FilterMatchStrategy[] = [
    message.subject ? "fromAndSubject" : "from",
    "from",
  ];
  const suggestions = Array.from(new Set(suggestionOrder)).map((strategy) => {
    const criteria = buildArchiveFilterCriteria(
      message.fromEmail,
      message.subject,
      strategy
    );
    return {
      matchStrategy: strategy,
      criteria,
      description: describeFilter(criteria, { removeLabelIds: ["INBOX"] }),
    };
  });

  return {
    message,
    recommendedStrategy: message.subject ? "fromAndSubject" : "from",
    suggestions,
    similarFilters,
  };
}

export async function upsertArchiveFilterForEmail(
  tokens: any,
  messageId: string,
  matchStrategy: FilterMatchStrategy,
  existingFilterId?: string
): Promise<{
  operation: "created" | "replaced";
  matchStrategy: FilterMatchStrategy;
  filter: GmailFilterSummary;
  replacedFilter?: GmailFilterSummary;
}> {
  requireScopes(tokens, [GMAIL_FILTER_WRITE_SCOPE]);

  const gmail = getGmail(tokens);
  const preview = await previewArchiveFilterForEmail(tokens, messageId);
  const actualMatchStrategy =
    matchStrategy === "fromAndSubject" && !preview.message.subject
      ? "from"
      : matchStrategy;
  const criteria = buildArchiveFilterCriteria(
    preview.message.fromEmail,
    preview.message.subject,
    actualMatchStrategy
  );

  if (!existingFilterId) {
    const created = await gmail.users.settings.filters.create({
      userId: "me",
      requestBody: {
        criteria,
        action: { removeLabelIds: ["INBOX"] },
      },
    });

    return {
      operation: "created",
      matchStrategy: actualMatchStrategy,
      filter: summarizeExistingFilter(created.data),
    };
  }

  const filters = await listActiveFilters(tokens);
  const existingFilter = filters.find((filter) => filter.id === existingFilterId);
  if (!existingFilter) {
    throw new Error("The selected Gmail filter no longer exists");
  }

  await gmail.users.settings.filters.delete({
    userId: "me",
    id: existingFilterId,
  });

  try {
    const created = await gmail.users.settings.filters.create({
      userId: "me",
      requestBody: {
        criteria,
        action: mergeArchiveAction(existingFilter.action),
      },
    });

    return {
      operation: "replaced",
      matchStrategy: actualMatchStrategy,
      filter: summarizeExistingFilter(created.data),
      replacedFilter: existingFilter,
    };
  } catch (error) {
    try {
      await gmail.users.settings.filters.create({
        userId: "me",
        requestBody: {
          criteria: existingFilter.criteria,
          action: existingFilter.action,
        },
      });
    } catch {}

    throw error;
  }
}

export async function searchEmails(
  tokens: any,
  query: string,
  maxResults = 10
): Promise<EmailSummary[]> {
  const gmail = getGmail(tokens);
  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  if (!res.data.messages) return [];

  const emails: EmailSummary[] = await Promise.all(
    res.data.messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["From", "To", "Cc", "Subject", "Date"],
      });

      const headers = detail.data.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name === name)?.value || "";

      return {
        id: msg.id!,
        threadId: msg.threadId!,
        from: getHeader("From"),
        to: getHeader("To"),
        cc: getHeader("Cc"),
        subject: getHeader("Subject"),
        snippet: detail.data.snippet || "",
        date: getHeader("Date"),
      };
    })
  );

  return emails;
}

export async function findContact(
  tokens: any,
  name: string
): Promise<{ name: string; email: string }[]> {
  const gmail = getGmail(tokens);
  // Search for recent emails involving this person
  const res = await gmail.users.messages.list({
    userId: "me",
    q: name,
    maxResults: 20,
  });

  if (!res.data.messages) return [];

  const details = await Promise.all(
    res.data.messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["From", "To", "Cc"],
      });
      return detail.data.payload?.headers || [];
    })
  );

  // Extract all email addresses from From/To/Cc headers
  const nameLower = name.toLowerCase();
  const contactMap = new Map<string, { name: string; email: string; count: number }>();

  for (const headers of details) {
    for (const h of headers) {
      if (!h.value) continue;
      const addresses = parseAddressList(h.value);
      for (const addr of addresses) {
        const displayName = addr.name;
        const email = addr.email;
        if (!email) continue;

        if (
          displayName.toLowerCase().includes(nameLower) ||
          email.includes(nameLower)
        ) {
          const existing = contactMap.get(email);
          if (existing) {
            existing.count++;
          } else {
            contactMap.set(email, {
              name: displayName || email,
              email,
              count: 1,
            });
          }
        }
      }
    }
  }

  // Sort by frequency (most emailed first)
  return Array.from(contactMap.values())
    .sort((a, b) => b.count - a.count)
    .map(({ name, email }) => ({ name, email }));
}

export async function sendNewEmail(
  tokens: any,
  to: string,
  subject: string,
  body: string,
  userEmail: string
): Promise<void> {
  const gmail = getGmail(tokens);
  const bodyWithFooter = appendVoicemailFooter(body, userEmail);

  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    bodyWithFooter,
  ].join("\r\n");

  const encoded = Buffer.from(raw).toString("base64url");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });
}

function formatEventDateTime(dateTime?: string | null, date?: string | null): string {
  if (dateTime) return dateTime;
  if (date) return `${date}T00:00:00`;
  return "";
}

function mapCalendarEvent(event: any): CalendarEventSummary {
  return {
    id: event.id || "",
    summary: event.summary || "(untitled)",
    description: event.description || "",
    start: formatEventDateTime(event.start?.dateTime, event.start?.date),
    end: formatEventDateTime(event.end?.dateTime, event.end?.date),
    location: event.location || "",
    attendees: (event.attendees || [])
      .map((attendee: any) => attendee.email)
      .filter(Boolean),
    htmlLink: event.htmlLink || "",
  };
}

export async function listCalendarEvents(
  tokens: any,
  options: CalendarListOptions = {}
): Promise<CalendarEventSummary[]> {
  const calendar = getCalendar(tokens);
  const now = new Date();
  const defaultEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const response = await calendar.events.list({
    calendarId: "primary",
    singleEvents: true,
    orderBy: "startTime",
    timeMin: options.startTime || now.toISOString(),
    timeMax: options.endTime || defaultEnd.toISOString(),
    maxResults: options.maxResults || 10,
    q: options.query || undefined,
  });

  return (response.data.items || []).map(mapCalendarEvent);
}

export async function inferCalendarProfile(
  tokens: any
): Promise<InferredCalendarProfile> {
  const calendar = getCalendar(tokens);
  const now = new Date();
  const timeMax = now.toISOString();
  const timeMin = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const response = await calendar.events.list({
    calendarId: "primary",
    singleEvents: true,
    orderBy: "startTime",
    timeMin,
    timeMax,
    maxResults: 250,
  });

  const events: CalendarInferenceEvent[] = (response.data.items || []).map((event: any) => ({
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: formatEventDateTime(event.start?.dateTime, event.start?.date),
    attendeeCount: event.attendees?.length || 0,
    conferenceUrls: (event.conferenceData?.entryPoints || [])
      .map((entryPoint: any) => entryPoint.uri)
      .filter(Boolean),
  }));

  return inferCalendarProfileFromEvents(events);
}

async function getPrimaryCalendarTimeZone(tokens: any): Promise<string | undefined> {
  const calendar = getCalendar(tokens);
  const response = await calendar.calendarList.get({ calendarId: "primary" });
  return response.data.timeZone || undefined;
}

export async function createCalendarInvite(
  tokens: any,
  input: CreateCalendarInviteInput
): Promise<{
  event: CalendarEventSummary;
  usedProfileFields: string[];
}> {
  const resolved = resolveCalendarInviteDetails({
    notes: input.notes,
    customLocation: input.customLocation,
    locationPreference: input.locationPreference,
    inferredProfile: input.inferredProfile,
  });

  if (resolved.error) {
    throw new Error(resolved.error);
  }

  const attendeeEmails = Array.from(
    new Set((input.attendeeEmails || []).map((email) => email.trim().toLowerCase()).filter(Boolean))
  );
  const timeZone = input.timeZone || (await getPrimaryCalendarTimeZone(tokens));
  const usedProfileFields: string[] = [];
  if (input.locationPreference === "home") usedProfileFields.push("homeAddress");
  if (input.locationPreference === "work") usedProfileFields.push("workAddress");
  if (input.locationPreference === "zoom") usedProfileFields.push("zoomLink");

  const calendar = getCalendar(tokens);
  const response = await calendar.events.insert({
    calendarId: "primary",
    sendUpdates: attendeeEmails.length > 0 ? "all" : "none",
    requestBody: {
      summary: input.title,
      description: resolved.description,
      location: resolved.location,
      start: {
        dateTime: input.startTime,
        timeZone,
      },
      end: {
        dateTime: input.endTime,
        timeZone,
      },
      attendees: attendeeEmails.map((email) => ({ email })),
    },
  });

  return {
    event: mapCalendarEvent(response.data),
    usedProfileFields,
  };
}

export async function updateCalendarEvent(
  tokens: any,
  input: UpdateCalendarEventInput
): Promise<CalendarEventSummary> {
  const calendar = getCalendar(tokens);
  const timeZone = input.timeZone || (await getPrimaryCalendarTimeZone(tokens));

  const requestBody: any = {};
  if (input.title !== undefined) requestBody.summary = input.title;
  if (input.notes !== undefined) requestBody.description = input.notes;
  if (input.location !== undefined) requestBody.location = input.location;
  if (input.startTime !== undefined) {
    requestBody.start = { dateTime: input.startTime, timeZone };
  }
  if (input.endTime !== undefined) {
    requestBody.end = { dateTime: input.endTime, timeZone };
  }
  if (input.attendeeEmails !== undefined) {
    requestBody.attendees = input.attendeeEmails.map((email) => ({ email }));
  }

  const hasAttendees = input.attendeeEmails && input.attendeeEmails.length > 0;
  const response = await calendar.events.patch({
    calendarId: "primary",
    eventId: input.eventId,
    sendUpdates: hasAttendees ? "all" : "none",
    requestBody,
  });

  return mapCalendarEvent(response.data);
}
