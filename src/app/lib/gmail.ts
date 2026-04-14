import crypto from "crypto";
import { getOAuth2Client, getGmailClient } from "@/app/lib/google-auth";
import { debugLog, debugLogVerbose } from "@/app/lib/debugLog";

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
const MAX_RETURNED_ARCHIVED_IDS = 200;

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
  suggestedSubjectPhrases: string[];
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

export function getAuthUrl(
  redirectUri?: string,
  options?: { state?: string }
): string {
  return getOAuth2Client(redirectUri).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...REQUIRED_GOOGLE_SCOPES],
    ...(options?.state ? { state: options.state } : {}),
  });
}

export async function exchangeCode(code: string, redirectUri?: string) {
  const client = getOAuth2Client(redirectUri);
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

export interface MailboxAddress {
  name: string;
  email: string;
}

export interface ThreadParticipant {
  name: string;
  email: string;
}

export interface ThreadMessage {
  from: string;
  to: string;
  cc: string;
  date: string;
  subject: string;
  replyTo: string;
  messageId: string;
  body: string;
}

export interface GmailAttachmentPart {
  filename: string;
  mimeType: string;
  attachmentId?: string;
  data?: string;
  size: number;
  contentDisposition: string;
  contentId: string;
}

export interface OutboundAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
  contentDisposition?: string;
  contentId?: string;
}

const MAX_GMAIL_RAW_MESSAGE_BYTES = 25 * 1024 * 1024;

function splitAddressHeader(value: string): string[] {
  const entries: string[] = [];
  let current = "";
  let inQuotes = false;
  let angleDepth = 0;

  for (const char of value) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (!inQuotes) {
      if (char === "<") {
        angleDepth++;
      } else if (char === ">") {
        angleDepth = Math.max(0, angleDepth - 1);
      } else if (char === "," && angleDepth === 0) {
        if (current.trim()) entries.push(current.trim());
        current = "";
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) {
    entries.push(current.trim());
  }

  return entries;
}

function parseMailbox(value: string): MailboxAddress {
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

export function parseAddressList(value: string): MailboxAddress[] {
  return splitAddressHeader(value)
    .map((entry) => parseMailbox(entry))
    .filter((entry) => entry.name || entry.email);
}

function formatMailbox(address: MailboxAddress): string {
  if (address.name && address.email) {
    return `${address.name} <${address.email}>`;
  }
  return address.email || address.name;
}

function dedupeAddresses(
  values: MailboxAddress[],
  excludedEmails: string[] = []
): MailboxAddress[] {
  const excluded = new Set(excludedEmails.map(normalizeEmailAddress));
  const seen = new Set<string>();

  return values.filter((value) => {
    const email = value.email ? normalizeEmailAddress(value.email) : "";
    const key = email || value.name.trim().toLowerCase();

    if (!key) return false;
    if (email && excluded.has(email)) return false;
    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function mergeAddressHeaders(
  baseValues: string[],
  extraValues: string[] = [],
  excludedEmails: string[] = []
): string {
  const merged = dedupeAddresses(
    [...baseValues, ...extraValues].flatMap((value) => parseAddressList(value)),
    excludedEmails
  );
  return merged.map(formatMailbox).join(", ");
}

function ensureSubjectPrefix(subject: string, prefix: "Re" | "Fwd"): string {
  const trimmed = subject.trim();
  const pattern =
    prefix === "Re" ? /^\s*re:\s*/i : /^\s*(fwd?|fw):\s*/i;

  if (!trimmed) {
    return `${prefix}:`;
  }

  return pattern.test(trimmed) ? trimmed : `${prefix}: ${trimmed}`;
}

export function formatReplySubject(subject: string): string {
  return ensureSubjectPrefix(subject, "Re");
}

export function formatForwardSubject(subject: string): string {
  return ensureSubjectPrefix(subject, "Fwd");
}

function formatReplyDate(dateHeader: string): string {
  const parsed = new Date(dateHeader);
  if (Number.isNaN(parsed.getTime())) {
    return dateHeader.trim();
  }

  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
  }).format(parsed);
  const month = new Intl.DateTimeFormat("en-US", {
    month: "short",
  }).format(parsed);
  const day = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
  }).format(parsed);
  const year = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
  }).format(parsed);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);

  return `${weekday}, ${month} ${day}, ${year} at ${time}`;
}

function extractTextFromPayload(payload: any): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }

  if (payload.mimeType === "text/html" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url")
      .toString("utf-8")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  }

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractTextFromPayload(part);
      if (text) return text;
    }
  }

  return "";
}

function getPayloadHeaderValue(headers: any[] = [], name: string): string {
  return (
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ||
    ""
  );
}

export function collectAttachmentParts(payload: any): GmailAttachmentPart[] {
  if (!payload) return [];

  const filename = String(payload.filename || "").trim();
  const contentDisposition = getPayloadHeaderValue(
    payload.headers,
    "Content-Disposition"
  );
  const dispositionType = contentDisposition.split(";")[0].trim().toLowerCase();
  const isFileAttachment =
    filename &&
    (dispositionType === "attachment" ||
      (!dispositionType &&
        !!(payload.body?.attachmentId || payload.body?.data)));

  const attachments: GmailAttachmentPart[] = [];
  if (isFileAttachment) {
    attachments.push({
      filename,
      mimeType: payload.mimeType || "application/octet-stream",
      attachmentId: payload.body?.attachmentId,
      data: payload.body?.data,
      size: payload.body?.size || 0,
      contentDisposition,
      contentId: getPayloadHeaderValue(payload.headers, "Content-ID"),
    });
  }

  for (const part of payload.parts || []) {
    attachments.push(...collectAttachmentParts(part));
  }

  return attachments;
}

async function resolveAttachments(
  gmail: ReturnType<typeof getGmailClient>,
  messageId: string,
  payload: any
): Promise<OutboundAttachment[]> {
  const parts = collectAttachmentParts(payload);

  return Promise.all(
    parts.map(async (part) => {
      let data = part.data || "";
      if (!data && part.attachmentId) {
        const attachment = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: part.attachmentId,
        });
        data = attachment.data.data || "";
      }

      return {
        filename: part.filename,
        mimeType: part.mimeType,
        content: Buffer.from(data, "base64url"),
        contentDisposition: part.contentDisposition,
        contentId: part.contentId,
      };
    })
  );
}

function normalizeBodyForCompose(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
}

function quoteBody(body: string): string {
  const normalized = normalizeBodyForCompose(body);
  if (!normalized) return ">";

  return normalized
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\r\n");
}

export function formatGmailReplyBody(
  replyText: string,
  original: { date: string; from: string; body: string }
): string {
  const sections = [normalizeBodyForCompose(replyText)];
  const formattedDate = formatReplyDate(original.date);
  const intro = formattedDate
    ? `On ${formattedDate}, ${original.from} wrote:`
    : `${original.from} wrote:`;
  sections.push(`${intro}\r\n${quoteBody(original.body)}`);

  return sections.filter(Boolean).join("\r\n\r\n");
}

export function formatGmailForwardBody(
  forwardText: string,
  original: {
    from: string;
    date: string;
    subject: string;
    to: string;
    cc: string;
    body: string;
  }
): string {
  const headerLines = [
    "---------- Forwarded message ---------",
    `From: ${original.from}`,
    `Date: ${original.date}`,
    `Subject: ${original.subject}`,
    `To: ${original.to}`,
    ...(original.cc ? [`Cc: ${original.cc}`] : []),
  ];

  return [normalizeBodyForCompose(forwardText), headerLines.join("\r\n"), normalizeBodyForCompose(original.body)]
    .filter(Boolean)
    .join("\r\n\r\n");
}

function buildReferencesHeader(references: string, messageId: string): string {
  const parts = `${references || ""} ${messageId || ""}`
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return Array.from(new Set(parts)).join(" ");
}

function normalizeRawBody(body: string): string {
  return body.replace(/\r\n/g, "\n").split("\n").join("\r\n");
}

function buildHeaderLines(headers: Array<[string, string]>): string[] {
  return headers
    .filter(([, value]) => value.trim().length > 0)
    .map(([name, value]) => `${name}: ${value}`);
}

function buildRawMessage(headers: Array<[string, string]>, body: string): string {
  return [
    "MIME-Version: 1.0",
    `Content-Type: text/plain; charset="UTF-8"`,
    ...buildHeaderLines(headers),
    "",
    normalizeRawBody(body),
  ].join("\r\n");
}

function makeMimeBoundary(): string {
  return `voicemail_${crypto.randomBytes(12).toString("hex")}`;
}

function encodeBase64Mime(content: Buffer): string {
  return content.toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function quoteMimeParameter(value: string): string {
  return value.replace(/[\r\n]/g, " ").replace(/(["\\])/g, "\\$1");
}

function getAttachmentDisposition(attachment: OutboundAttachment): string {
  const dispositionType = attachment.contentDisposition
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  return dispositionType === "inline" ? "inline" : "attachment";
}

export function buildRawMultipartMessage(
  headers: Array<[string, string]>,
  body: string,
  attachments: OutboundAttachment[],
  boundary = makeMimeBoundary(),
  maxBytes = MAX_GMAIL_RAW_MESSAGE_BYTES
): string {
  const parts = [
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    normalizeRawBody(body),
    ...attachments.flatMap((attachment) => {
      const filename = quoteMimeParameter(attachment.filename);
      return [
        `--${boundary}`,
        `Content-Type: ${
          attachment.mimeType || "application/octet-stream"
        }; name="${filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: ${getAttachmentDisposition(
          attachment
        )}; filename="${filename}"`,
        ...(attachment.contentId ? [`Content-ID: ${attachment.contentId}`] : []),
        "",
        encodeBase64Mime(attachment.content),
      ];
    }),
    `--${boundary}--`,
  ];

  const raw = [
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ...buildHeaderLines(headers),
    "",
    ...parts,
  ].join("\r\n");

  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new Error("Forwarded email with attachments exceeds Gmail size limits");
  }

  return raw;
}

async function getMessageContext(tokens: any, messageId: string) {
  const gmail = getGmailClient(tokens);
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const headers = getHeaders(res);

  return {
    from: getHeaderValue(headers, "From"),
    replyTo: getHeaderValue(headers, "Reply-To") || getHeaderValue(headers, "From"),
    to: getHeaderValue(headers, "To"),
    cc: getHeaderValue(headers, "Cc"),
    subject: getHeaderValue(headers, "Subject"),
    date: getHeaderValue(headers, "Date"),
    messageId: getHeaderValue(headers, "Message-ID"),
    references: getHeaderValue(headers, "References"),
    body: extractTextFromPayload(res.data.payload) || res.data.snippet || "",
    threadId: res.data.threadId || "",
    payload: res.data.payload,
  };
}

export function normalizeSubjectForFilter(subject: string): string {
  return subject
    .replace(/^\s*((re|fwd?|aw):\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSubjectPhraseForFilter(subjectPhrase: string): string {
  return normalizeSubjectForFilter(subjectPhrase)
    .replace(/^["']+|["']+$/g, "")
    .replace(/[(){}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function suggestSubjectPhraseForFilter(subject: string): string {
  const normalized = normalizeSubjectForFilter(subject);
  const words = normalized.match(/[a-z0-9][a-z0-9'-]*/gi) || [];
  const lowerWords = words.map((word) => word.toLowerCase());
  const hasWord = (word: string) => lowerWords.includes(word);

  const knownPatterns: Array<[string[], string]> = [
    [["package", "delivered"], "Package Delivered"],
    [["package", "shipped"], "Package Shipped"],
    [["order", "delivered"], "Order Delivered"],
    [["order", "shipped"], "Order Shipped"],
    [["delivery", "scheduled"], "Delivery Scheduled"],
    [["password", "reset"], "Password Reset"],
    [["verification", "code"], "Verification Code"],
    [["security", "alert"], "Security Alert"],
  ];

  for (const [requiredWords, phrase] of knownPatterns) {
    if (requiredWords.every(hasWord)) return phrase;
  }

  const stopWords = new Set([
    "a",
    "an",
    "and",
    "for",
    "from",
    "is",
    "of",
    "on",
    "the",
    "to",
    "was",
    "with",
    "your",
  ]);
  const candidates = words.filter((word) => !stopWords.has(word.toLowerCase()));
  return (candidates.length ? candidates : words).slice(0, 4).join(" ");
}

function buildSubjectSearchQuery(subjectPhrase: string): string {
  const normalized = normalizeSubjectPhraseForFilter(subjectPhrase);
  return `subject:(${normalized})`;
}

export function buildArchiveFilterCriteria(
  fromEmail: string,
  subject: string,
  matchStrategy: FilterMatchStrategy,
  subjectPhrase?: string
): GmailFilterCriteria {
  const normalizedSubjectPhrase = normalizeSubjectPhraseForFilter(
    subjectPhrase || suggestSubjectPhraseForFilter(subject)
  );
  if (matchStrategy === "fromAndSubject" && normalizedSubjectPhrase) {
    return {
      from: fromEmail,
      query: buildSubjectSearchQuery(normalizedSubjectPhrase),
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
  if (criteria.subject) parts.push(`subject contains "${criteria.subject}"`);
  if (criteria.query) {
    const subjectQuery = criteria.query.match(/^subject:\((.+)\)$/i);
    parts.push(
      subjectQuery
        ? `subject has words "${subjectQuery[1]}"`
        : `query "${criteria.query}"`
    );
  }
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
  const subjectQueryMatch = query.match(/subject:\(([^)]+)\)/);
  const subjectQueryTerms =
    subjectQueryMatch?.[1]
      .split(/\s+/)
      .map((term) => term.replace(/^["']+|["']+$/g, ""))
      .filter(Boolean) || [];

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
  } else if (
    normalizedSubject &&
    subjectQueryTerms.length > 0 &&
    subjectQueryTerms.every((term) => normalizedSubject.includes(term))
  ) {
    score += 20;
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

export function buildSearchQueryFromCriteria(criteria: GmailFilterCriteria): string {
  const parts: string[] = [];
  if (criteria.from) parts.push(`from:(${criteria.from})`);
  if (criteria.to) parts.push(`to:(${criteria.to})`);
  if (criteria.subject) parts.push(`subject:(${criteria.subject})`);
  if (criteria.query) parts.push(criteria.query);
  return parts.join(" ");
}

async function listMatchingInboxMessageIds(
  tokens: any,
  criteria: GmailFilterCriteria
): Promise<string[]> {
  const gmail = getGmailClient(tokens);
  const query = buildSearchQueryFromCriteria(criteria) + " in:inbox";
  const messageIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const res: any = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 500,
      pageToken,
    });

    if (res.data.messages) {
      messageIds.push(...res.data.messages.map((m: any) => m.id!));
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return messageIds;
}

async function countMatchingInboxEmails(
  tokens: any,
  criteria: GmailFilterCriteria
): Promise<number> {
  return (await listMatchingInboxMessageIds(tokens, criteria)).length;
}

export async function applyFilterToExistingEmails(
  tokens: any,
  messageId: string,
  matchStrategy: FilterMatchStrategy,
  subjectPhrase?: string
): Promise<{ archivedCount: number; archivedIds: string[] }> {
  const gmail = getGmailClient(tokens);
  const message = await getEmailMetadata(tokens, messageId);
  const actualMatchStrategy =
    matchStrategy === "fromAndSubject" && !message.subject
      ? "from"
      : matchStrategy;
  const criteria = buildArchiveFilterCriteria(
    message.fromEmail,
    message.subject,
    actualMatchStrategy,
    subjectPhrase
  );
  const messageIds = await listMatchingInboxMessageIds(tokens, criteria);

  if (messageIds.length === 0) return { archivedCount: 0, archivedIds: [] };

  for (let i = 0; i < messageIds.length; i += 1000) {
    const batch = messageIds.slice(i, i + 1000);
    await gmail.users.messages.batchModify({
      userId: "me",
      requestBody: {
        ids: batch,
        removeLabelIds: ["INBOX"],
      },
    });
  }

  return {
    archivedCount: messageIds.length,
    archivedIds: messageIds.slice(0, MAX_RETURNED_ARCHIVED_IDS),
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
): Promise<{
  from: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  threadId: string;
}> {
  const gmail = getGmailClient(tokens);
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
    threadId: detail.data.threadId || messageId,
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

const PROD_URL = "https://voicemail.audio";

export function getVoicemailSiteUrl(): string {
  const candidates = [
    process.env.VOICEMAIL_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const url = normalizeUrl(candidate);
    if (url) return url;
  }

  return PROD_URL;
}

export function appendVoicemailFooter(body: string, userEmail: string): string {
  if (!shouldAddVoicemailFooter(userEmail)) return body;

  const trimmedBody = body.replace(/\s+$/, "");
  const footer = `Sent with https://voicemail.audio`;

  if (!trimmedBody) return footer;

  return `${trimmedBody}\n\n${footer}`;
}

export async function getUserEmail(tokens: any): Promise<string> {
  const gmail = getGmailClient(tokens);
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.emailAddress || "";
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
  maxResults = 10,
  pageToken?: string
): Promise<{ emails: EmailSummary[]; nextPageToken?: string }> {
  const gmail = getGmailClient(tokens);

  // Use threads.list instead of messages.list so each conversation appears
  // exactly once, even when multiple messages in a thread are unread.
  const startMs = Date.now();
  const res = await gmail.users.threads.list({
    userId: "me",
    q: "is:unread in:inbox",
    maxResults,
    ...(pageToken ? { pageToken } : {}),
  });
  debugLog("api", `threads.list [${Date.now() - startMs}ms] — ${res.data.threads?.length ?? 0} threads`);
  debugLogVerbose("api", "threads.list FULL RESPONSE", {
    resultSizeEstimate: res.data.resultSizeEstimate,
    threads: res.data.threads?.map(t => ({ id: t.id, snippet: t.snippet })),
    nextPageToken: res.data.nextPageToken,
  });

  if (!res.data.threads) return { emails: [], nextPageToken: undefined };

  const emails: EmailSummary[] = await Promise.all(
    res.data.threads.map(async (thread) => {
      const threadGetStart = Date.now();
      const threadDetail = await gmail.users.threads.get({
        userId: "me",
        id: thread.id!,
        format: "metadata",
        metadataHeaders: ["From", "To", "Cc", "Subject", "Date"],
      });

      const messages = threadDetail.data.messages || [];
      debugLogVerbose("api", `threads.get(${thread.id}) [${Date.now() - threadGetStart}ms]`, {
        messageCount: messages.length,
        messageIds: messages.map(m => m.id),
        labels: messages.map(m => m.labelIds),
      });
      // Use the latest message in the thread for display metadata
      const latestMsg = messages[messages.length - 1];
      const headers = latestMsg?.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name === name)?.value || "";

      return {
        // id = latest message ID (needed for message-level ops like reply, unsubscribe)
        id: latestMsg?.id || thread.id!,
        threadId: thread.id!,
        from: getHeader("From"),
        to: getHeader("To"),
        cc: getHeader("Cc"),
        subject: getHeader("Subject"),
        snippet: latestMsg?.snippet || thread.snippet || "",
        date: getHeader("Date"),
      };
    })
  );

  return { emails, nextPageToken: res.data.nextPageToken ?? undefined };
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
  const gmail = getGmailClient(tokens);
  const startMs = Date.now();
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  debugLog("api", `messages.get(${messageId}, full) [${Date.now() - startMs}ms]`);
  debugLogVerbose("api", `getEmailBody FULL RESPONSE (${messageId})`, {
    threadId: res.data.threadId,
    labelIds: res.data.labelIds,
    snippet: res.data.snippet,
    sizeEstimate: res.data.sizeEstimate,
    mimeType: res.data.payload?.mimeType,
    partCount: res.data.payload?.parts?.length,
  });

  const payload = res.data.payload;
  if (!payload) return "";

  const text = extractTextFromPayload(payload);
  return text || res.data.snippet || "";
}

export async function getThreadMessages(
  tokens: any,
  threadId: string,
  maxMessages = 5,
  userEmail?: string
): Promise<{ messages: ThreadMessage[]; participants: ThreadParticipant[]; attachments: { filename: string; mimeType: string; size: number }[] }> {
  const gmail = getGmailClient(tokens);
  const startMs = Date.now();
  const thread = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });

  const messages = thread.data.messages || [];
  debugLog("api", `getThreadMessages(${threadId}) [${Date.now() - startMs}ms] — ${messages.length} messages, showing last ${maxMessages}`);
  debugLogVerbose("api", `getThreadMessages FULL RESPONSE (${threadId})`, {
    totalMessages: messages.length,
    messages: messages.map(m => ({
      id: m.id,
      labelIds: m.labelIds,
      snippet: m.snippet,
      sizeEstimate: m.sizeEstimate,
      from: m.payload?.headers?.find(h => h.name === "From")?.value,
      date: m.payload?.headers?.find(h => h.name === "Date")?.value,
    })),
  });
  // Take the last N messages (most recent context)
  const recent = messages.slice(-maxMessages);

  const recentMessages = recent.map((msg) => {
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name === name)?.value || "";

    return {
      from: getHeader("From"),
      to: getHeader("To"),
      cc: getHeader("Cc"),
      date: getHeader("Date"),
      subject: getHeader("Subject"),
      replyTo: getHeader("Reply-To"),
      messageId: getHeader("Message-ID"),
      body: extractTextFromPayload(msg.payload) || msg.snippet || "",
    };
  });

  const participants = dedupeAddresses(
    recentMessages.flatMap((message) =>
      [message.from, message.to, message.cc].flatMap((value) =>
        parseAddressList(value)
      )
    ),
    userEmail ? [userEmail] : []
  ).map((participant) => ({
    name: participant.name || participant.email,
    email: participant.email,
  }));

  // Collect attachment metadata (no data download) across all thread messages
  const attachments = recent.flatMap((msg) =>
    collectAttachmentParts(msg.payload).map((part) => ({
      filename: part.filename,
      mimeType: part.mimeType,
      size: part.size,
    }))
  );

  return {
    messages: recentMessages,
    participants,
    attachments,
  };
}

export async function sendReply(
  tokens: any,
  messageId: string,
  threadId: string,
  body: string,
  userEmail: string,
  options?: {
    mode?: "reply" | "replyAll";
    replyTo?: string;
    cc?: string[];
    bcc?: string[];
  }
): Promise<void> {
  const gmail = getGmailClient(tokens);
  const original = await getMessageContext(tokens, messageId);
  const excludedEmails = [userEmail];
  const defaultReplyTarget = options?.replyTo || original.replyTo;
  const subject = formatReplySubject(original.subject);
  const baseCc =
    options?.mode === "replyAll"
      ? mergeAddressHeaders(
          [original.to, original.cc],
          [],
          [
            ...excludedEmails,
            ...parseAddressList(defaultReplyTarget).map((address) => address.email),
          ]
        )
      : "";
  const cc = mergeAddressHeaders([baseCc], options?.cc || [], excludedEmails);
  const bcc = mergeAddressHeaders([], options?.bcc || [], excludedEmails);
  const references = buildReferencesHeader(
    original.references,
    original.messageId
  );
  const bodyWithFooter = appendVoicemailFooter(body, userEmail);
  const raw = buildRawMessage(
    [
      ["To", defaultReplyTarget],
      ["Cc", cc],
      ["Bcc", bcc],
      ["Subject", subject],
      ["In-Reply-To", original.messageId],
      ["References", references],
    ],
    formatGmailReplyBody(bodyWithFooter, {
      date: original.date,
      from: original.from,
      body: original.body,
    })
  );

  const encoded = Buffer.from(raw).toString("base64url");

  const startMs = Date.now();
  const sendRes = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded, threadId },
  });
  debugLog("api", `sendReply messages.send [${Date.now() - startMs}ms]`);
  debugLogVerbose("api", "sendReply FULL RESPONSE", {
    id: sendRes.data.id,
    threadId: sendRes.data.threadId,
    labelIds: sendRes.data.labelIds,
    to: defaultReplyTarget,
    cc,
    bcc,
    subject,
  });
}

export async function forwardEmail(
  tokens: any,
  messageId: string,
  to: string,
  body: string,
  userEmail: string,
  options?: {
    cc?: string[];
    bcc?: string[];
  }
): Promise<void> {
  const gmail = getGmailClient(tokens);
  const original = await getMessageContext(tokens, messageId);
  const subject = formatForwardSubject(original.subject);
  const cc = mergeAddressHeaders([], options?.cc || [], [userEmail]);
  const bcc = mergeAddressHeaders([], options?.bcc || [], [userEmail]);
  const bodyWithFooter = appendVoicemailFooter(body, userEmail);
  const forwardBody = formatGmailForwardBody(bodyWithFooter, {
    from: original.from,
    date: original.date,
    subject: original.subject,
    to: original.to,
    cc: original.cc,
    body: original.body,
  });
  const headers: Array<[string, string]> = [
    ["To", to],
    ["Cc", cc],
    ["Bcc", bcc],
    ["Subject", subject],
  ];
  const attachments = await resolveAttachments(
    gmail,
    messageId,
    original.payload
  );
  const raw =
    attachments.length > 0
      ? buildRawMultipartMessage(headers, forwardBody, attachments)
      : buildRawMessage(headers, forwardBody);

  const encoded = Buffer.from(raw).toString("base64url");
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });
}

export async function archiveEmail(
  tokens: any,
  threadId: string
): Promise<void> {
  const gmail = getGmailClient(tokens);
  // Use threads.modify so the INBOX label is removed from every message
  // in the conversation — not just a single message.
  const startMs = Date.now();
  const res = await gmail.users.threads.modify({
    userId: "me",
    id: threadId,
    requestBody: { removeLabelIds: ["INBOX"] },
  });
  debugLog("api", `archiveEmail threads.modify(${threadId}) [${Date.now() - startMs}ms]`);
  debugLogVerbose("api", `archiveEmail FULL RESPONSE (${threadId})`, {
    id: res.data.id,
    messages: (res.data.messages || []).map((m: any) => ({ id: m.id, labelIds: m.labelIds })),
  });
}

export async function markAsRead(
  tokens: any,
  messageId: string
): Promise<void> {
  const gmail = getGmailClient(tokens);
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
}

export async function listActiveFilters(
  tokens: any
): Promise<GmailFilterSummary[]> {
  const gmail = getGmailClient(tokens);
  const res = await gmail.users.settings.filters.list({ userId: "me" });

  return (res.data.filter || [])
    .map((filter) => summarizeExistingFilter(filter))
    .sort((a, b) => Number(b.archives) - Number(a.archives));
}

export async function previewArchiveFilterForEmail(
  tokens: any,
  messageId: string,
  subjectPhrase?: string
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

  const providedSubjectPhrase = normalizeSubjectPhraseForFilter(subjectPhrase || "");
  const suggestedSubjectPhrases = Array.from(
    new Set(
      [providedSubjectPhrase, suggestSubjectPhraseForFilter(message.subject)]
        .filter(Boolean)
    )
  );
  const suggestionOrder: FilterMatchStrategy[] = [
    message.subject ? "fromAndSubject" : "from",
    "from",
  ];
  const suggestions = Array.from(new Set(suggestionOrder)).map((strategy) => {
    const criteria = buildArchiveFilterCriteria(
      message.fromEmail,
      message.subject,
      strategy,
      strategy === "fromAndSubject" ? suggestedSubjectPhrases[0] : undefined
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
    suggestedSubjectPhrases,
    suggestions,
    similarFilters,
  };
}

export async function upsertArchiveFilterForEmail(
  tokens: any,
  messageId: string,
  matchStrategy: FilterMatchStrategy,
  existingFilterId?: string,
  subjectPhrase?: string
): Promise<{
  operation: "created" | "replaced";
  matchStrategy: FilterMatchStrategy;
  filter: GmailFilterSummary;
  replacedFilter?: GmailFilterSummary;
  matchingInboxCount: number;
}> {
  requireScopes(tokens, [GMAIL_FILTER_WRITE_SCOPE]);

  const gmail = getGmailClient(tokens);
  const preview = await previewArchiveFilterForEmail(tokens, messageId);
  const actualMatchStrategy =
    matchStrategy === "fromAndSubject" && !preview.message.subject
      ? "from"
      : matchStrategy;
  const criteria = buildArchiveFilterCriteria(
    preview.message.fromEmail,
    preview.message.subject,
    actualMatchStrategy,
    subjectPhrase
  );

  if (!existingFilterId) {
    const created = await gmail.users.settings.filters.create({
      userId: "me",
      requestBody: {
        criteria,
        action: { removeLabelIds: ["INBOX"] },
      },
    });

    const matchingInboxCount = await countMatchingInboxEmails(tokens, criteria);

    return {
      operation: "created",
      matchStrategy: actualMatchStrategy,
      filter: summarizeExistingFilter(created.data),
      matchingInboxCount,
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

    const matchingInboxCount = await countMatchingInboxEmails(tokens, criteria);

    return {
      operation: "replaced",
      matchStrategy: actualMatchStrategy,
      filter: summarizeExistingFilter(created.data),
      replacedFilter: existingFilter,
      matchingInboxCount,
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

export async function blockSender(
  tokens: any,
  messageId: string
): Promise<{
  blockedEmail: string;
  blockedName: string;
  filter: GmailFilterSummary;
}> {
  requireScopes(tokens, [GMAIL_FILTER_WRITE_SCOPE]);

  const gmail = getGmailClient(tokens);
  const message = await getEmailMetadata(tokens, messageId);

  // Create a filter that auto-deletes all future emails from this sender
  const criteria: GmailFilterCriteria = { from: message.fromEmail };
  const action: GmailFilterAction = {
    addLabelIds: ["TRASH"],
    removeLabelIds: ["INBOX"],
  };

  const created = await gmail.users.settings.filters.create({
    userId: "me",
    requestBody: { criteria, action },
  });

  // Archive the current email too
  await archiveEmail(tokens, message.threadId);

  return {
    blockedEmail: message.fromEmail,
    blockedName: message.fromName,
    filter: summarizeExistingFilter(created.data),
  };
}

export async function searchEmails(
  tokens: any,
  query: string,
  maxResults = 10
): Promise<EmailSummary[]> {
  const gmail = getGmailClient(tokens);
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
  const gmail = getGmailClient(tokens);
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
  userEmail: string,
  options?: {
    cc?: string[];
    bcc?: string[];
  }
): Promise<void> {
  const gmail = getGmailClient(tokens);
  const bodyWithFooter = appendVoicemailFooter(body, userEmail);
  const cc = mergeAddressHeaders([], options?.cc || [], [userEmail]);
  const bcc = mergeAddressHeaders([], options?.bcc || [], [userEmail]);
  const raw = buildRawMessage(
    [
      ["To", to],
      ["Cc", cc],
      ["Bcc", bcc],
      ["Subject", subject],
    ],
    bodyWithFooter
  );

  const encoded = Buffer.from(raw).toString("base64url");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });
}
