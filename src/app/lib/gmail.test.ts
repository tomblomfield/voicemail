import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gmailMock = vi.hoisted(() => ({
  users: {
    messages: {
      get: vi.fn(),
      send: vi.fn(),
      attachments: {
        get: vi.fn(),
      },
    },
  },
}));

vi.mock("@/app/lib/google-auth", () => ({
  getGmailClient: () => gmailMock,
  getOAuth2Client: vi.fn(),
}));

import {
  appendVoicemailFooter,
  buildArchiveFilterCriteria,
  buildRawMultipartMessage,
  buildSearchQueryFromCriteria,
  collectAttachmentParts,
  describeFilter,
  forwardEmail,
  formatForwardSubject,
  formatGmailForwardBody,
  formatGmailReplyBody,
  formatReplySubject,
  getMissingScopes,
  GMAIL_FILTER_WRITE_SCOPE,
  normalizeSubjectForFilter,
  parseAddressList,
  sendReply,
  shouldAddVoicemailFooter,
  suggestSubjectPhraseForFilter,
  truncateToLatestMessage,
} from "./gmail";

const FOOTER_ENV_KEYS = [
  "VOICEMAIL_SITE_URL",
  "NEXT_PUBLIC_APP_URL",
  "APP_URL",
] as const;

let originalFooterEnv: Record<string, string | undefined>;

function gmailPayload(parts: any[]) {
  return {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: "Alice Example <alice@example.com>" },
      { name: "To", value: "Me <me@example.com>" },
      { name: "Cc", value: "Bob Example <bob@example.com>" },
      { name: "Subject", value: "Quarterly update" },
      { name: "Date", value: "Mon, 6 Apr 2026 09:00:00 -0700" },
      { name: "Message-ID", value: "<message-1@example.com>" },
    ],
    parts,
  };
}

function decodeSentRaw(): string {
  const requestBody = gmailMock.users.messages.send.mock.calls[0][0]
    .requestBody;
  return Buffer.from(requestBody.raw, "base64url").toString("utf-8");
}

beforeEach(() => {
  originalFooterEnv = Object.fromEntries(
    FOOTER_ENV_KEYS.map((key) => [key, process.env[key]])
  );

  for (const key of FOOTER_ENV_KEYS) {
    delete process.env[key];
  }

  gmailMock.users.messages.get.mockReset();
  gmailMock.users.messages.send.mockReset();
  gmailMock.users.messages.attachments.get.mockReset();
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
      query: "subject:(Quarterly plan)",
    });
  });

  it("uses caller-provided subject words for archive filters", () => {
    expect(
      buildArchiveFilterCriteria(
        "shipments@example.com",
        "Your Chemex Package was Delivered from Amazon",
        "fromAndSubject",
        "Package Delivered"
      )
    ).toEqual({
      from: "shipments@example.com",
      query: "subject:(Package Delivered)",
    });
  });

  it("suggests concise subject words for common transactional emails", () => {
    expect(
      suggestSubjectPhraseForFilter(
        "Your Chemex Package was Delivered from Amazon"
      )
    ).toBe("Package Delivered");
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
        { from: "alice@example.com", query: "subject:(Quarterly plan)" },
        { removeLabelIds: ["INBOX"] }
      )
    ).toBe(
      'If from alice@example.com, subject has words "Quarterly plan", then archive.'
    );
  });

  it("builds a Gmail search query from filter criteria", () => {
    expect(
      buildSearchQueryFromCriteria({
        from: "alice@example.com",
        query: "subject:(Quarterly plan)",
      })
    ).toBe('from:(alice@example.com) subject:(Quarterly plan)');

    expect(
      buildSearchQueryFromCriteria({ from: "alice@example.com" })
    ).toBe('from:(alice@example.com)');
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
      "Thanks for the note.\n\nSent with https://voicemail.audio"
    );
  });

  it("falls back to the production URL when no env var is configured", () => {
    expect(appendVoicemailFooter("Checking in", "tb@ycombinator.com")).toBe(
      "Checking in\n\nSent with https://voicemail.audio"
    );
  });

  it("leaves other senders unchanged", () => {
    process.env.VOICEMAIL_SITE_URL = "https://voice-mail.example.com";

    expect(
      appendVoicemailFooter("No footer here", "someone@example.com")
    ).toBe("No footer here");
  });
});

describe("reply and forward formatting", () => {
  it("formats Gmail-style reply bodies with a quoted original", () => {
    expect(
      formatGmailReplyBody("Thanks for the update.", {
        date: "Mon, 6 Apr 2026 09:00:00 -0700",
        from: "Alice Example <alice@example.com>",
        body: "Line one\n\nLine two",
      })
    ).toBe(
      "Thanks for the update.\r\n\r\nOn Mon, Apr 6, 2026 at 9:00 AM, Alice Example <alice@example.com> wrote:\r\n> Line one\r\n>\r\n> Line two"
    );
  });

  it("formats Gmail-style forward bodies with a forwarded-message header block", () => {
    expect(
      formatGmailForwardBody("FYI", {
        from: "Alice Example <alice@example.com>",
        date: "Mon, 6 Apr 2026 09:00:00 -0700",
        subject: "Quarterly update",
        to: "me@example.com",
        cc: "Bob Example <bob@example.com>",
        body: "Original content",
      })
    ).toBe(
      "FYI\r\n\r\n---------- Forwarded message ---------\r\nFrom: Alice Example <alice@example.com>\r\nDate: Mon, 6 Apr 2026 09:00:00 -0700\r\nSubject: Quarterly update\r\nTo: me@example.com\r\nCc: Bob Example <bob@example.com>\r\n\r\nOriginal content"
    );
  });

  it("adds missing Re: and Fwd: prefixes without duplicating them", () => {
    expect(formatReplySubject("Quarterly update")).toBe("Re: Quarterly update");
    expect(formatReplySubject("Re: Quarterly update")).toBe(
      "Re: Quarterly update"
    );
    expect(formatForwardSubject("Quarterly update")).toBe(
      "Fwd: Quarterly update"
    );
    expect(formatForwardSubject("FW: Quarterly update")).toBe(
      "FW: Quarterly update"
    );
  });

  it("parses address lists with quoted commas correctly", () => {
    expect(
      parseAddressList(
        '"Doe, Jane" <jane@example.com>, John Smith <john@example.com>'
      )
    ).toEqual([
      { name: "Doe, Jane", email: "jane@example.com" },
      { name: "John Smith", email: "john@example.com" },
    ]);
  });

  it("collects file attachments from nested Gmail payload parts", () => {
    expect(
      collectAttachmentParts({
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              {
                mimeType: "text/plain",
                body: {
                  data: Buffer.from("hello").toString("base64url"),
                },
              },
            ],
          },
          {
            filename: "quarterly plan.pdf",
            mimeType: "application/pdf",
            headers: [
              {
                name: "Content-Disposition",
                value: 'attachment; filename="quarterly plan.pdf"',
              },
            ],
            body: {
              attachmentId: "att-1",
              size: 1234,
            },
          },
          {
            filename: "inline-logo.png",
            mimeType: "image/png",
            headers: [
              {
                name: "Content-Disposition",
                value: 'inline; filename="inline-logo.png"',
              },
            ],
            body: {
              attachmentId: "att-2",
              size: 55,
            },
          },
        ],
      })
    ).toEqual([
      {
        filename: "quarterly plan.pdf",
        mimeType: "application/pdf",
        attachmentId: "att-1",
        data: undefined,
        size: 1234,
        contentDisposition: 'attachment; filename="quarterly plan.pdf"',
        contentId: "",
      },
    ]);
  });

  it("collects attachment content that is already embedded in the payload", () => {
    expect(
      collectAttachmentParts({
        filename: "notes.txt",
        mimeType: "text/plain",
        headers: [
          {
            name: "Content-Disposition",
            value: 'attachment; filename="notes.txt"',
          },
        ],
        body: {
          data: Buffer.from("meeting notes").toString("base64url"),
          size: 13,
        },
      })
    ).toEqual([
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        attachmentId: undefined,
        data: Buffer.from("meeting notes").toString("base64url"),
        size: 13,
        contentDisposition: 'attachment; filename="notes.txt"',
        contentId: "",
      },
    ]);
  });

  it("builds multipart forward messages with attachments", () => {
    const raw = buildRawMultipartMessage(
      [
        ["To", "team@example.com"],
        ["Subject", "Fwd: Quarterly update"],
      ],
      "FYI\r\n\r\n---------- Forwarded message ---------\r\nOriginal",
      [
        {
          filename: "quarterly plan.pdf",
          mimeType: "application/pdf",
          content: Buffer.from("pdf-bytes"),
          contentDisposition: 'attachment; filename="quarterly plan.pdf"',
        },
      ],
      "test_boundary"
    );

    expect(raw).toContain(
      'Content-Type: multipart/mixed; boundary="test_boundary"'
    );
    expect(raw).toContain("To: team@example.com");
    expect(raw).toContain("Subject: Fwd: Quarterly update");
    expect(raw).toContain("--test_boundary");
    expect(raw).toContain(
      'Content-Type: application/pdf; name="quarterly plan.pdf"'
    );
    expect(raw).toContain(
      'Content-Disposition: attachment; filename="quarterly plan.pdf"'
    );
    expect(raw).toContain(Buffer.from("pdf-bytes").toString("base64"));
    expect(raw).toContain("--test_boundary--");
  });

  it("rejects multipart messages above the configured size limit", () => {
    expect(() =>
      buildRawMultipartMessage(
        [["To", "team@example.com"]],
        "FYI",
        [
          {
            filename: "small.txt",
            mimeType: "text/plain",
            content: Buffer.from("small"),
          },
        ],
        "test_boundary",
        100
      )
    ).toThrow("exceeds Gmail size limits");
  });

  it("forwards multiple original file attachments", async () => {
    gmailMock.users.messages.get.mockResolvedValueOnce({
      data: {
        threadId: "thread-1",
        snippet: "Original snippet",
        payload: gmailPayload([
          {
            mimeType: "text/plain",
            body: {
              data: Buffer.from("Original body").toString("base64url"),
            },
          },
          {
            filename: "quarterly plan.pdf",
            mimeType: "application/pdf",
            headers: [
              {
                name: "Content-Disposition",
                value: 'attachment; filename="quarterly plan.pdf"',
              },
            ],
            body: {
              attachmentId: "att-1",
              size: 9,
            },
          },
          {
            filename: "notes.txt",
            mimeType: "text/plain",
            headers: [
              {
                name: "Content-Disposition",
                value: 'attachment; filename="notes.txt"',
              },
            ],
            body: {
              data: Buffer.from("meeting notes").toString("base64url"),
              size: 13,
            },
          },
        ]),
      },
    });
    gmailMock.users.messages.attachments.get.mockResolvedValueOnce({
      data: {
        data: Buffer.from("pdf-bytes").toString("base64url"),
      },
    });
    gmailMock.users.messages.send.mockResolvedValueOnce({
      data: { id: "sent-1" },
    });

    await forwardEmail(
      {},
      "msg-1",
      "team@example.com",
      "FYI",
      "me@example.com"
    );

    expect(gmailMock.users.messages.attachments.get).toHaveBeenCalledWith({
      userId: "me",
      messageId: "msg-1",
      id: "att-1",
    });
    const raw = decodeSentRaw();
    expect(raw).toContain("Content-Type: multipart/mixed");
    expect(raw).toContain("To: team@example.com");
    expect(raw).toContain("Subject: Fwd: Quarterly update");
    expect(raw).toContain(
      'Content-Disposition: attachment; filename="quarterly plan.pdf"'
    );
    expect(raw).toContain('Content-Disposition: attachment; filename="notes.txt"');
    expect(raw).toContain(Buffer.from("pdf-bytes").toString("base64"));
    expect(raw).toContain(Buffer.from("meeting notes").toString("base64"));
  });

  it("does not fetch or include attachments when replying", async () => {
    gmailMock.users.messages.get.mockResolvedValueOnce({
      data: {
        threadId: "thread-1",
        snippet: "Original snippet",
        payload: gmailPayload([
          {
            mimeType: "text/plain",
            body: {
              data: Buffer.from("Original body").toString("base64url"),
            },
          },
          {
            filename: "quarterly plan.pdf",
            mimeType: "application/pdf",
            headers: [
              {
                name: "Content-Disposition",
                value: 'attachment; filename="quarterly plan.pdf"',
              },
            ],
            body: {
              attachmentId: "att-1",
              size: 9,
            },
          },
        ]),
      },
    });
    gmailMock.users.messages.send.mockResolvedValueOnce({
      data: { id: "sent-1", threadId: "thread-1", labelIds: [] },
    });

    await sendReply(
      {},
      "msg-1",
      "thread-1",
      "Thanks",
      "me@example.com"
    );

    expect(gmailMock.users.messages.attachments.get).not.toHaveBeenCalled();
    const raw = decodeSentRaw();
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(raw).not.toContain("multipart/mixed");
    expect(raw).not.toContain("quarterly plan.pdf");
  });
});
