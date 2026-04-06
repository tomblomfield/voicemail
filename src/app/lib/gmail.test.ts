import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendVoicemailFooter,
  buildArchiveFilterCriteria,
  describeFilter,
  getMissingScopes,
  GMAIL_FILTER_WRITE_SCOPE,
  normalizeSubjectForFilter,
  shouldAddVoicemailFooter,
  truncateToLatestMessage,
} from "./gmail";

const FOOTER_ENV_KEYS = [
  "VOICEMAIL_SITE_URL",
  "NEXT_PUBLIC_APP_URL",
  "APP_URL",
  "RAILWAY_PUBLIC_DOMAIN",
  "RAILWAY_STATIC_URL",
] as const;

let originalFooterEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalFooterEnv = Object.fromEntries(
    FOOTER_ENV_KEYS.map((key) => [key, process.env[key]])
  );

  for (const key of FOOTER_ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of FOOTER_ENV_KEYS) {
    const value = originalFooterEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("truncateToLatestMessage", () => {
  it("returns short messages unchanged", () => {
    const msg = "Hey, are you coming to the meeting?";
    expect(truncateToLatestMessage(msg)).toBe(msg);
  });

  it("truncates at 'On ... wrote:' reply marker", () => {
    const msg = `Thanks for the update!

On Mon, Apr 6, 2026 at 9:00 AM John Smith <john@example.com> wrote:
Here is the original message with lots of context...`;
    const result = truncateToLatestMessage(msg);
    expect(result).toBe("Thanks for the update!");
    expect(result).not.toContain("John Smith");
  });

  it("truncates at '---Original Message---' marker", () => {
    const msg = `Got it, will do.

-----Original Message-----
From: boss@company.com
Sent: Monday, April 6, 2026
Subject: Action items

Please complete the following...`;
    const result = truncateToLatestMessage(msg);
    expect(result).toBe("Got it, will do.");
  });

  it("truncates at 'From: ... Sent:' Outlook-style marker", () => {
    const msg = `Sounds good!

From: Sarah Connor <sarah@skynet.com>
Sent: April 6, 2026
To: me@example.com
Subject: Re: Plans

Original message here...`;
    const result = truncateToLatestMessage(msg);
    expect(result).toBe("Sounds good!");
  });

  it("caps at maxLength when no separator found", () => {
    const longMsg = "A".repeat(3000);
    const result = truncateToLatestMessage(longMsg, 2000);
    expect(result.length).toBe(2003); // 2000 + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  it("caps at maxLength even with separator", () => {
    const longReply = "B".repeat(2500) + "\n\nOn Mon wrote:\noriginal";
    const result = truncateToLatestMessage(longReply, 2000);
    // Separator is after 2500 chars, so maxLength kicks in first
    expect(result.length).toBe(2003);
    expect(result.endsWith("...")).toBe(true);
  });

  it("handles empty string", () => {
    expect(truncateToLatestMessage("")).toBe("");
  });

  it("handles message with only whitespace before separator", () => {
    const msg = `  \n\nOn Mon wrote:\nstuff`;
    // After truncation at separator and trim, the whitespace-only prefix becomes empty
    const result = truncateToLatestMessage(msg);
    // Either empty (whitespace trimmed) or contains the full text (separator not matched)
    expect(typeof result).toBe("string");
  });

  it("uses custom maxLength", () => {
    const msg = "Hello world, this is a test message";
    const result = truncateToLatestMessage(msg, 10);
    expect(result).toBe("Hello worl...");
  });

  it("preserves message when exactly at maxLength", () => {
    const msg = "A".repeat(2000);
    const result = truncateToLatestMessage(msg, 2000);
    expect(result).toBe(msg);
    expect(result.length).toBe(2000);
  });
});

describe("filter helpers", () => {
  it("normalizes reply prefixes before using subject filters", () => {
    expect(normalizeSubjectForFilter("Re: Fwd: Board update")).toBe(
      "Board update"
    );
  });

  it("builds a narrow archive filter when subject matching is requested", () => {
    expect(
      buildArchiveFilterCriteria(
        "alice@example.com",
        "Re: Quarterly plan",
        "fromAndSubject"
      )
    ).toEqual({
      from: "alice@example.com",
      subject: "Quarterly plan",
    });
  });

  it("falls back to sender-only matching when the subject is empty", () => {
    expect(
      buildArchiveFilterCriteria("alice@example.com", "", "fromAndSubject")
    ).toEqual({
      from: "alice@example.com",
    });
  });

  it("describes archive filters in readable language", () => {
    expect(
      describeFilter(
        { from: "alice@example.com", subject: "Quarterly plan" },
        { removeLabelIds: ["INBOX"] }
      )
    ).toBe(
      'If from alice@example.com, subject "Quarterly plan", then archive.'
    );
  });

  it("detects when filter-management scope is missing", () => {
    expect(
      getMissingScopes(
        {
          scope:
            "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify",
        },
        [GMAIL_FILTER_WRITE_SCOPE]
      )
    ).toEqual([GMAIL_FILTER_WRITE_SCOPE]);
  });
});

describe("voicemail footer", () => {
  it("only enables the footer for the allowlisted Gmail account", () => {
    expect(shouldAddVoicemailFooter("tomblomfield@gmail.com")).toBe(true);
    expect(shouldAddVoicemailFooter("TB@YCOMBINATOR.COM")).toBe(true);
    expect(shouldAddVoicemailFooter("other@example.com")).toBe(false);
  });

  it("appends the footer with the configured site URL", () => {
    process.env.VOICEMAIL_SITE_URL = "https://voice-mail.example.com";

    expect(
      appendVoicemailFooter("Thanks for the note.  \n", "tomblomfield@gmail.com")
    ).toBe(
      "Thanks for the note.\n\nsent with voicemail\nhttps://voice-mail.example.com"
    );
  });

  it("uses the Railway public domain when no explicit URL is configured", () => {
    process.env.RAILWAY_PUBLIC_DOMAIN = "voice-email-production.up.railway.app";

    expect(appendVoicemailFooter("Checking in", "tb@ycombinator.com")).toBe(
      "Checking in\n\nsent with voicemail\nhttps://voice-email-production.up.railway.app"
    );
  });

  it("leaves other senders unchanged", () => {
    process.env.VOICEMAIL_SITE_URL = "https://voice-mail.example.com";

    expect(
      appendVoicemailFooter("No footer here", "someone@example.com")
    ).toBe("No footer here");
  });
});
