import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractHtmlBody,
  extractUnsubscribeLinks,
  parseListUnsubscribeHeader,
  performUnsubscribe,
} from "./unsubscribe";

// ─── Pure function tests (no mocks needed) ────────────────────────────

describe("parseListUnsubscribeHeader", () => {
  it("parses a single https URL", () => {
    const result = parseListUnsubscribeHeader(
      "<https://example.com/unsub?id=123>"
    );
    expect(result.httpsUrls).toEqual(["https://example.com/unsub?id=123"]);
    expect(result.mailtoUrls).toEqual([]);
  });

  it("parses a single mailto URL", () => {
    const result = parseListUnsubscribeHeader(
      "<mailto:unsub@example.com?subject=Unsubscribe>"
    );
    expect(result.httpsUrls).toEqual([]);
    expect(result.mailtoUrls).toEqual([
      "mailto:unsub@example.com?subject=Unsubscribe",
    ]);
  });

  it("parses both https and mailto in one header", () => {
    const result = parseListUnsubscribeHeader(
      "<https://example.com/unsub>, <mailto:unsub@example.com>"
    );
    expect(result.httpsUrls).toEqual(["https://example.com/unsub"]);
    expect(result.mailtoUrls).toEqual(["mailto:unsub@example.com"]);
  });

  it("parses multiple https URLs", () => {
    const result = parseListUnsubscribeHeader(
      "<https://a.com/unsub>, <https://b.com/unsub>"
    );
    expect(result.httpsUrls).toHaveLength(2);
  });

  it("handles http (not just https)", () => {
    const result = parseListUnsubscribeHeader(
      "<http://legacy.example.com/unsub>"
    );
    expect(result.httpsUrls).toEqual(["http://legacy.example.com/unsub"]);
  });

  it("returns empty arrays for null header", () => {
    const result = parseListUnsubscribeHeader(null);
    expect(result.httpsUrls).toEqual([]);
    expect(result.mailtoUrls).toEqual([]);
  });

  it("returns empty arrays for empty string", () => {
    const result = parseListUnsubscribeHeader("");
    expect(result.httpsUrls).toEqual([]);
    expect(result.mailtoUrls).toEqual([]);
  });

  it("ignores malformed entries without angle brackets", () => {
    const result = parseListUnsubscribeHeader(
      "https://example.com/unsub"
    );
    expect(result.httpsUrls).toEqual([]);
  });

  it("ignores unknown URL schemes", () => {
    const result = parseListUnsubscribeHeader(
      "<ftp://example.com/unsub>, <https://example.com/unsub>"
    );
    expect(result.httpsUrls).toEqual(["https://example.com/unsub"]);
    expect(result.mailtoUrls).toEqual([]);
  });

  it("trims whitespace inside angle brackets", () => {
    const result = parseListUnsubscribeHeader(
      "< https://example.com/unsub >"
    );
    expect(result.httpsUrls).toEqual(["https://example.com/unsub"]);
  });
});

describe("extractUnsubscribeLinks", () => {
  it("finds an anchor tag with 'unsubscribe' in text", () => {
    const html = `
      <p>You received this email because you signed up.</p>
      <a href="https://example.com/unsub?id=123">Unsubscribe</a>
    `;
    const links = extractUnsubscribeLinks(html);
    expect(links).toEqual(["https://example.com/unsub?id=123"]);
  });

  it("finds 'unsubscribe' in the href (not just text)", () => {
    const html = `<a href="https://example.com/unsubscribe/abc">Click here</a>`;
    const links = extractUnsubscribeLinks(html);
    expect(links).toEqual(["https://example.com/unsubscribe/abc"]);
  });

  it("finds 'opt out' and 'opt-out' variations", () => {
    const html = `
      <a href="https://a.com/optout">Opt out</a>
      <a href="https://b.com/prefs">opt-out here</a>
    `;
    const links = extractUnsubscribeLinks(html);
    expect(links).toContain("https://a.com/optout");
    expect(links).toContain("https://b.com/prefs");
  });

  it("finds 'manage preferences' and 'email preferences'", () => {
    const html = `
      <a href="https://example.com/prefs">Manage Preferences</a>
      <a href="https://example.com/email-prefs">Email Preferences</a>
    `;
    const links = extractUnsubscribeLinks(html);
    expect(links).toHaveLength(2);
  });

  it("is case-insensitive", () => {
    const html = `<a href="https://example.com/unsub">UNSUBSCRIBE</a>`;
    const links = extractUnsubscribeLinks(html);
    expect(links).toHaveLength(1);
  });

  it("ignores non-http links", () => {
    const html = `<a href="mailto:unsub@example.com">Unsubscribe</a>`;
    const links = extractUnsubscribeLinks(html);
    expect(links).toEqual([]);
  });

  it("ignores irrelevant links", () => {
    const html = `
      <a href="https://example.com/privacy">Privacy Policy</a>
      <a href="https://example.com/terms">Terms of Service</a>
      <a href="https://example.com/contact">Contact Us</a>
    `;
    const links = extractUnsubscribeLinks(html);
    expect(links).toEqual([]);
  });

  it("deduplicates identical URLs", () => {
    const html = `
      <a href="https://example.com/unsub">Unsubscribe</a>
      <a href="https://example.com/unsub">Click to unsubscribe</a>
    `;
    const links = extractUnsubscribeLinks(html);
    expect(links).toEqual(["https://example.com/unsub"]);
  });

  it("returns empty array for HTML with no links", () => {
    const html = `<p>Just some text, no links at all.</p>`;
    const links = extractUnsubscribeLinks(html);
    expect(links).toEqual([]);
  });

  it("handles nested HTML inside anchor tags", () => {
    const html = `<a href="https://example.com/unsub"><span style="color:gray">Unsubscribe</span></a>`;
    const links = extractUnsubscribeLinks(html);
    expect(links).toEqual(["https://example.com/unsub"]);
  });
});

describe("extractHtmlBody", () => {
  it("extracts HTML from a simple text/html payload", () => {
    const payload = {
      mimeType: "text/html",
      body: {
        data: Buffer.from("<h1>Hello</h1>").toString("base64url"),
      },
    };
    expect(extractHtmlBody(payload)).toBe("<h1>Hello</h1>");
  });

  it("extracts HTML from nested multipart payload", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        {
          mimeType: "text/plain",
          body: { data: Buffer.from("plain text").toString("base64url") },
        },
        {
          mimeType: "text/html",
          body: {
            data: Buffer.from("<p>html body</p>").toString("base64url"),
          },
        },
      ],
    };
    expect(extractHtmlBody(payload)).toBe("<p>html body</p>");
  });

  it("handles deeply nested MIME structures", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            {
              mimeType: "text/plain",
              body: { data: Buffer.from("text").toString("base64url") },
            },
            {
              mimeType: "text/html",
              body: {
                data: Buffer.from("<div>deep</div>").toString("base64url"),
              },
            },
          ],
        },
        {
          mimeType: "application/pdf",
          body: { data: "" },
        },
      ],
    };
    expect(extractHtmlBody(payload)).toBe("<div>deep</div>");
  });

  it("returns null when no HTML part exists", () => {
    const payload = {
      mimeType: "text/plain",
      body: { data: Buffer.from("just text").toString("base64url") },
    };
    expect(extractHtmlBody(payload)).toBeNull();
  });

  it("returns null for null/undefined payload", () => {
    expect(extractHtmlBody(null)).toBeNull();
    expect(extractHtmlBody(undefined)).toBeNull();
  });
});

// ─── Integration tests (with mocks) ───────────────────────────────────

// Mock the Gmail client and archiveEmail
vi.mock("@/app/lib/google-auth", () => ({
  getGmailClient: vi.fn(),
}));

vi.mock("@/app/lib/gmail", () => ({
  archiveEmail: vi.fn().mockResolvedValue(undefined),
}));

import { getGmailClient } from "@/app/lib/google-auth";

const mockGetGmailClient = vi.mocked(getGmailClient);
const mockFetch = vi.fn();

describe("performUnsubscribe", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    originalEnv = process.env.BROWSER_USE_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env.BROWSER_USE_API_KEY;
    } else {
      process.env.BROWSER_USE_API_KEY = originalEnv;
    }
  });

  function mockGmailMessage(headers: { name: string; value: string }[], htmlBody?: string) {
    const parts: any[] = [];
    if (htmlBody) {
      parts.push({
        mimeType: "text/html",
        body: { data: Buffer.from(htmlBody).toString("base64url") },
      });
    }

    mockGetGmailClient.mockReturnValue({
      users: {
        messages: {
          get: vi.fn().mockResolvedValue({
            data: {
              payload: {
                headers,
                mimeType: parts.length ? "multipart/alternative" : "text/plain",
                parts: parts.length ? parts : undefined,
                body: parts.length ? undefined : { data: "" },
              },
            },
          }),
          send: vi.fn().mockResolvedValue({}),
        },
      },
    } as any);
  }

  it("uses one-click POST when List-Unsubscribe-Post header is present", async () => {
    mockGmailMessage([
      { name: "From", value: "Newsletter <news@example.com>" },
      {
        name: "List-Unsubscribe",
        value: "<https://example.com/unsub?token=abc>",
      },
      {
        name: "List-Unsubscribe-Post",
        value: "List-Unsubscribe=One-Click-Unsubscribe",
      },
    ]);

    // Mock the one-click POST response
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const result = await performUnsubscribe({}, "msg-1");

    expect(result.success).toBe(true);
    expect(result.method).toBe("one-click");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/unsub?token=abc",
      expect.objectContaining({
        method: "POST",
        body: "List-Unsubscribe=One-Click-Unsubscribe",
      })
    );
  });

  it("falls back to mailto when one-click fails", async () => {
    mockGmailMessage([
      { name: "From", value: "Newsletter <news@example.com>" },
      {
        name: "List-Unsubscribe",
        value:
          "<https://example.com/unsub>, <mailto:unsub@example.com?subject=Unsub>",
      },
      {
        name: "List-Unsubscribe-Post",
        value: "List-Unsubscribe=One-Click-Unsubscribe",
      },
    ]);

    // One-click POST fails
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await performUnsubscribe({}, "msg-1");

    expect(result.success).toBe(true);
    expect(result.method).toBe("mailto");
  });

  it("uses mailto when no one-click header exists", async () => {
    mockGmailMessage([
      { name: "From", value: "Updates <updates@example.com>" },
      {
        name: "List-Unsubscribe",
        value: "<mailto:leave@example.com?subject=Remove+Me>",
      },
    ]);

    const result = await performUnsubscribe({}, "msg-1");

    expect(result.success).toBe(true);
    expect(result.method).toBe("mailto");
  });

  it("resolves shortened URLs and passes to browser", async () => {
    process.env.BROWSER_USE_API_KEY = "bu_test_key";

    mockGmailMessage([
      { name: "From", value: "Promo <promo@shop.com>" },
      {
        name: "List-Unsubscribe",
        value: "<https://short.link/abc>",
      },
    ]);

    mockFetch
      // URL resolution — redirect followed
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: "https://shop.com/unsubscribe?id=xyz",
        redirected: true,
        text: async () => "",
      })
      // Browser Use API session creation
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "session-123",
          status: "created",
          liveUrl: "https://live.browser-use.com/session-123",
        }),
      });

    const result = await performUnsubscribe({}, "msg-1");

    expect(result.success).toBe(false);
    expect(result.method).toBe("browser");
    expect(result.browserTaskId).toBe("session-123");
    // Verify the resolved URL was sent to Browser Use, not the short link
    expect(mockFetch).toHaveBeenLastCalledWith(
      expect.stringContaining("sessions"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("shop.com/unsubscribe"),
      })
    );
  });

  it("falls back to body links when no List-Unsubscribe header exists", async () => {
    process.env.BROWSER_USE_API_KEY = "bu_test_key";

    mockGmailMessage(
      [{ name: "From", value: "Spam <spam@junk.com>" }],
      `<html><body><p>Buy stuff!</p><a href="https://junk.com/unsubscribe?u=99">Unsubscribe</a></body></html>`
    );

    mockFetch
      // URL resolution — no redirect
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: "https://junk.com/unsubscribe?u=99",
        redirected: false,
        text: async () => "",
      })
      // Browser Use session
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "session-456", status: "created" }),
      });

    const result = await performUnsubscribe({}, "msg-1");

    expect(result.success).toBe(false);
    expect(result.method).toBe("browser");
  });

  it("returns failure when no unsubscribe method is found", async () => {
    mockGmailMessage([
      { name: "From", value: "Person <person@company.com>" },
    ]);

    const result = await performUnsubscribe({}, "msg-1");

    expect(result.success).toBe(false);
    expect(result.method).toBe("none");
    expect(result.message).toContain("Could not find an unsubscribe link");
  });

  it("returns helpful error when Browser Use API key is missing", async () => {
    delete process.env.BROWSER_USE_API_KEY;

    mockGmailMessage([
      { name: "From", value: "Promo <promo@shop.com>" },
      {
        name: "List-Unsubscribe",
        value: "<https://shop.com/unsub?id=xyz>",
      },
    ]);

    // URL resolution
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://shop.com/unsub?id=xyz",
      redirected: false,
      text: async () => "",
    });

    const result = await performUnsubscribe({}, "msg-1");

    expect(result.success).toBe(false);
    expect(result.method).toBe("none");
    expect(result.message).toContain("browser");
  });

  it("returns failure when Browser Use API returns an error", async () => {
    process.env.BROWSER_USE_API_KEY = "bu_test_key";

    mockGmailMessage([
      { name: "From", value: "Promo <promo@shop.com>" },
      {
        name: "List-Unsubscribe",
        value: "<https://shop.com/unsub?id=xyz>",
      },
    ]);

    mockFetch
      // URL resolution
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: "https://shop.com/unsub?id=xyz",
        redirected: false,
        text: async () => "",
      })
      // Browser Use API returns error
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        text: async () => "Insufficient credits",
      });

    const result = await performUnsubscribe({}, "msg-1");

    expect(result.success).toBe(false);
    expect(result.method).toBe("browser");
    expect(result.message).toContain("402");
  });
});
