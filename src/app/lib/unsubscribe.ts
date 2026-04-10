import { getGmailClient } from "@/app/lib/google-auth";
import { archiveEmail } from "@/app/lib/gmail";
import { debugLog } from "@/app/lib/debugLog";

const BROWSER_USE_API_BASE = "https://api.browser-use.com/api/v3";

/**
 * Validate that a URL is safe to fetch from the server (SSRF protection).
 * Blocks private/internal IPs, localhost, and non-http(s) schemes.
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Only allow http(s)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return false;
    }

    // Block private IP ranges (RFC 1918, link-local, metadata endpoints)
    // 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 169.254.x.x (AWS metadata)
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const [, a, b] = ipMatch.map(Number);
      if (a === 10) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 169 && b === 254) return false; // AWS/cloud metadata
      if (a === 0) return false;
    }

    // Block common cloud metadata hostnames
    if (hostname === "metadata.google.internal") return false;
    if (hostname === "metadata.google.com") return false;

    return true;
  } catch {
    return false;
  }
}

export interface UnsubscribeResult {
  success: boolean;
  method: "one-click" | "mailto" | "browser" | "none";
  message: string;
  browserTaskId?: string;
  browserLiveUrl?: string;
}

interface UnsubscribeInfo {
  /** Raw List-Unsubscribe header value */
  listUnsubscribe: string | null;
  /** Raw List-Unsubscribe-Post header value (RFC 8058 one-click) */
  listUnsubscribePost: string | null;
  /** HTTPS URLs extracted from List-Unsubscribe header */
  httpsUrls: string[];
  /** mailto: addresses extracted from List-Unsubscribe header */
  mailtoUrls: string[];
  /** Unsubscribe links found in the HTML body */
  bodyLinks: string[];
  /** Sender email for context */
  senderEmail: string;
  /** Sender name for context */
  senderName: string;
}

/**
 * Parse a List-Unsubscribe header value into https and mailto URLs.
 * The header format is: <url1>, <url2>, ...
 */
export function parseListUnsubscribeHeader(
  headerValue: string | null
): { httpsUrls: string[]; mailtoUrls: string[] } {
  const httpsUrls: string[] = [];
  const mailtoUrls: string[] = [];

  if (!headerValue) return { httpsUrls, mailtoUrls };

  const urlMatches = headerValue.match(/<([^>]+)>/g) || [];
  for (const match of urlMatches) {
    const url = match.slice(1, -1).trim();
    if (url.startsWith("https://") || url.startsWith("http://")) {
      httpsUrls.push(url);
    } else if (url.startsWith("mailto:")) {
      mailtoUrls.push(url);
    }
  }

  return { httpsUrls, mailtoUrls };
}

/**
 * Extract unsubscribe information from a Gmail message.
 * Checks List-Unsubscribe header first, then falls back to parsing the HTML body.
 */
export async function getUnsubscribeInfo(
  tokens: any,
  messageId: string
): Promise<UnsubscribeInfo> {
  const gmail = getGmailClient(tokens);
  const detail = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
    metadataHeaders: [
      "From",
      "List-Unsubscribe",
      "List-Unsubscribe-Post",
    ],
  });

  const headers = detail.data.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())
      ?.value || "";

  const from = getHeader("From");
  const listUnsubscribe = getHeader("List-Unsubscribe") || null;
  const listUnsubscribePost = getHeader("List-Unsubscribe-Post") || null;

  // Parse sender
  const bracketMatch = from.match(/<([^>]+)>/);
  const senderEmail = bracketMatch
    ? bracketMatch[1].trim().toLowerCase()
    : from.trim().toLowerCase();
  const senderName = from.replace(/<[^>]+>/, "").trim().replace(/^"|"$/g, "") || senderEmail;

  // Parse List-Unsubscribe header
  const { httpsUrls, mailtoUrls } = parseListUnsubscribeHeader(listUnsubscribe);

  // Parse HTML body for unsubscribe links as fallback
  const bodyLinks: string[] = [];
  if (httpsUrls.length === 0 && mailtoUrls.length === 0) {
    const htmlBody = extractHtmlBody(detail.data.payload);
    if (htmlBody) {
      const links = extractUnsubscribeLinks(htmlBody);
      bodyLinks.push(...links);
    }
  }

  return {
    listUnsubscribe,
    listUnsubscribePost,
    httpsUrls,
    mailtoUrls,
    bodyLinks,
    senderEmail,
    senderName,
  };
}

/**
 * Extract HTML body from a Gmail message payload (recursive through MIME parts).
 */
export function extractHtmlBody(payload: any): string | null {
  if (!payload) return null;

  if (payload.mimeType === "text/html" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const html = extractHtmlBody(part);
      if (html) return html;
    }
  }

  return null;
}

/**
 * Extract unsubscribe-related links from HTML content.
 * Looks for anchor tags with "unsubscribe" in text or href.
 */
export function extractUnsubscribeLinks(html: string): string[] {
  const links: string[] = [];
  // Match <a> tags where the href or inner text contains "unsubscribe"
  const anchorRegex = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1];
    const text = match[2].replace(/<[^>]+>/g, "").trim(); // strip inner HTML tags
    const combined = `${href} ${text}`.toLowerCase();

    if (
      combined.includes("unsubscribe") ||
      combined.includes("opt out") ||
      combined.includes("opt-out") ||
      combined.includes("remove me") ||
      combined.includes("manage preferences") ||
      combined.includes("email preferences")
    ) {
      // Only include http(s) links
      if (href.startsWith("http://") || href.startsWith("https://")) {
        links.push(href);
      }
    }
  }

  // Deduplicate
  return [...new Set(links)];
}

/**
 * Perform the unsubscribe action using the best available method:
 * 1. RFC 8058 one-click POST (fastest, most reliable)
 * 2. mailto: unsubscribe (send an email)
 * 3. Browser Use Cloud (navigate the unsubscribe webpage)
 */
export async function performUnsubscribe(
  tokens: any,
  messageId: string,
  threadId?: string
): Promise<UnsubscribeResult> {
  // Resolve threadId if not provided (needed for thread-level archive)
  if (!threadId) {
    const gmail = getGmailClient(tokens);
    const msg = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "minimal",
    });
    threadId = msg.data.threadId || undefined;
  }

  const info = await getUnsubscribeInfo(tokens, messageId);

  debugLog("unsubscribe", "Unsubscribe info extracted", {
    sender: info.senderEmail,
    hasListUnsubscribe: !!info.listUnsubscribe,
    hasOneClick: !!info.listUnsubscribePost,
    httpsUrls: info.httpsUrls.length,
    mailtoUrls: info.mailtoUrls.length,
    bodyLinks: info.bodyLinks.length,
  });

  // SSRF protection: validate all URLs before fetching from the server
  info.httpsUrls = info.httpsUrls.filter((url) => {
    if (!isSafeUrl(url)) {
      debugLog("unsubscribe", `Blocked unsafe URL: ${url}`);
      return false;
    }
    return true;
  });
  info.bodyLinks = info.bodyLinks.filter((url) => {
    if (!isSafeUrl(url)) {
      debugLog("unsubscribe", `Blocked unsafe body link: ${url}`);
      return false;
    }
    return true;
  });

  // Strategy 1: RFC 8058 One-Click Unsubscribe
  if (info.listUnsubscribePost && info.httpsUrls.length > 0) {
    try {
      const result = await oneClickUnsubscribe(info.httpsUrls[0]);
      if (result.success) {
        await archiveEmail(tokens, threadId || messageId);
        return {
          ...result,
          message: `Unsubscribed from ${info.senderName} using one-click unsubscribe. Email archived.`,
        };
      }
      debugLog("unsubscribe", "One-click failed, falling through", result);
    } catch (err: any) {
      debugLog("unsubscribe", "One-click error, falling through", err.message);
    }
  }

  // Strategy 2: mailto: unsubscribe
  if (info.mailtoUrls.length > 0) {
    try {
      const result = await mailtoUnsubscribe(tokens, info.mailtoUrls[0]);
      if (result.success) {
        await archiveEmail(tokens, threadId || messageId);
        return {
          ...result,
          message: `Sent unsubscribe email for ${info.senderName}. Email archived.`,
        };
      }
      debugLog("unsubscribe", "Mailto failed, falling through", result);
    } catch (err: any) {
      debugLog("unsubscribe", "Mailto error, falling through", err.message);
    }
  }

  // Strategy 3: Browser Use Cloud — resolve shortened URLs first, then hand off to browser agent
  const candidateUrl = info.httpsUrls[0] || info.bodyLinks[0] || null;
  const urlToVisit = candidateUrl ? await resolveUrl(candidateUrl) : null;

  if (urlToVisit) {
    try {
      const result = await browserUnsubscribe(urlToVisit, info.senderName);
      if (result.browserTaskId) {
        // Session was created — archive and report pending
        await archiveEmail(tokens, threadId || messageId);
        return {
          ...result,
          message: `Started unsubscribing from ${info.senderName} in the background. Email archived.`,
        };
      }
      // Session creation failed (missing API key, etc.) — return error as-is
      return result;
    } catch (err: any) {
      debugLog("unsubscribe", "Browser unsubscribe error", err.message);
      return {
        success: false,
        method: "browser",
        message: `Failed to launch browser unsubscribe: ${err.message}`,
      };
    }
  }

  // No unsubscribe method found
  return {
    success: false,
    method: "none",
    message: `Could not find an unsubscribe link for ${info.senderName}. You may need to unsubscribe manually or block the sender instead.`,
  };
}

/**
 * Resolve a potentially shortened URL by following redirects.
 * Returns the final URL after all redirects, or the original URL if resolution fails.
 * This does NOT attempt to determine if the unsubscribe succeeded — that's the browser's job.
 */
async function resolveUrl(url: string): Promise<string> {
  debugLog("unsubscribe", `Resolving URL: ${url}`);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const finalUrl = response.url;
    if (finalUrl && finalUrl !== url) {
      debugLog("unsubscribe", `Resolved to: ${finalUrl}`);
      return finalUrl;
    }
  } catch (err: any) {
    debugLog("unsubscribe", `URL resolution failed, using original: ${err.message}`);
  }

  return url;
}

/**
 * RFC 8058 one-click unsubscribe: POST to the unsubscribe URL with the standard body.
 */
async function oneClickUnsubscribe(url: string): Promise<UnsubscribeResult> {
  debugLog("unsubscribe", `One-click POST to ${url}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "List-Unsubscribe=One-Click-Unsubscribe",
    redirect: "follow",
  });

  // Most services return 200 or 202 for success
  if (response.ok || response.status === 202) {
    return {
      success: true,
      method: "one-click",
      message: "Successfully unsubscribed via one-click.",
    };
  }

  return {
    success: false,
    method: "one-click",
    message: `One-click unsubscribe returned status ${response.status}`,
  };
}

/**
 * Send an unsubscribe email via mailto: link.
 * Parses the mailto: URL for the recipient address and optional subject/body.
 */
async function mailtoUnsubscribe(
  tokens: any,
  mailtoUrl: string
): Promise<UnsubscribeResult> {
  debugLog("unsubscribe", `Mailto unsubscribe: ${mailtoUrl}`);

  // Parse mailto:address?subject=...&body=...
  const withoutScheme = mailtoUrl.replace(/^mailto:/i, "");
  const [address, queryString] = withoutScheme.split("?");

  let subject = "Unsubscribe";
  let body = "";

  if (queryString) {
    const params = new URLSearchParams(queryString);
    subject = params.get("subject") || subject;
    body = params.get("body") || body;
  }

  const gmail = getGmailClient(tokens);
  const raw = [
    `To: ${address}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    body || "Unsubscribe",
  ].join("\r\n");

  const encoded = Buffer.from(raw).toString("base64url");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });

  return {
    success: true,
    method: "mailto",
    message: "Unsubscribe email sent.",
  };
}

/**
 * Use Browser Use Cloud to navigate an unsubscribe webpage and complete the flow.
 * This is the fallback for pages that require clicking buttons/filling forms.
 */
async function browserUnsubscribe(
  url: string,
  senderName: string
): Promise<UnsubscribeResult> {
  const apiKey = process.env.BROWSER_USE_API_KEY;
  if (!apiKey) {
    debugLog("unsubscribe", "BROWSER_USE_API_KEY not set, skipping browser unsubscribe");
    return {
      success: false,
      method: "none",
      message: `I can't unsubscribe from ${senderName} automatically — this one requires a browser interaction and browser-based unsubscribe isn't configured. You can block the sender instead, or unsubscribe manually.`,
    };
  }

  debugLog("unsubscribe", `Browser unsubscribe for ${senderName}: ${url}`);

  const taskPrompt = `Navigate to this URL: ${url}

Your goal is to unsubscribe from ALL emails from this sender (${senderName}).

Instructions:
1. If there's a simple "Unsubscribe" or "Confirm" button, click it.
2. If there are checkboxes for different email types, UNCHECK ALL of them or select "Unsubscribe from all".
3. If there's an email field to confirm, it should already be filled. If not, leave it as-is.
4. If asked for a reason, select any option and proceed.
5. If there's a CAPTCHA, try to solve it. If you can't, report failure.
6. Wait for confirmation that the unsubscribe was successful.
7. Do NOT sign up for anything, create accounts, or provide any personal information.

Report back whether the unsubscribe was successful or not.`;

  const response = await fetch(`${BROWSER_USE_API_BASE}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Browser-Use-API-Key": apiKey,
    },
    body: JSON.stringify({
      task: taskPrompt,
      model: "bu-max",
      keepAlive: false,
      maxCostUsd: 0.50,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    debugLog("unsubscribe", `Browser Use API error: ${response.status}`, errorText);
    return {
      success: false,
      method: "browser",
      message: `Browser Use API error: ${response.status}`,
    };
  }

  const session = await response.json();
  debugLog("unsubscribe", "Browser Use session created", {
    id: session.id,
    status: session.status,
    liveUrl: session.liveUrl,
  });

  // Fire-and-forget: return immediately so the voice agent can move on.
  // Browser Use Cloud will complete the unsubscribe in the background.
  // We don't poll — the user is driving and doesn't need to wait 30-90s
  // for a newsletter unsubscribe confirmation.
  // Note: success is false because we can't confirm it worked yet.
  // The agent should say "I've started unsubscribing you" not "you're unsubscribed".
  return {
    success: false,
    method: "browser",
    message: `Browser agent has been launched to unsubscribe from ${senderName} in the background. This usually takes 15-30 seconds but we can't confirm it succeeded.`,
    browserTaskId: session.id,
    browserLiveUrl: session.liveUrl || undefined,
  };
}
