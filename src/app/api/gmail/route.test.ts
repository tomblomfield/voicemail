import { describe, expect, it } from "vitest";
import { gmailTelemetryMetrics } from "./route";

describe("gmailTelemetryMetrics", () => {
  it("returns counts and flags without email content", () => {
    const metrics = gmailTelemetryMetrics(
      "read",
      {
        accountId: "account_123",
        maxResults: 50,
        query: "from:alice@example.com quarterly plan",
      },
      {
        body: "Confidential email body",
        subject: "Quarterly plan",
        from: "Alice <alice@example.com>",
        emails: [
          {
            subject: "Payroll update",
            snippet: "Sensitive snippet",
            from: "Bob <bob@example.com>",
          },
        ],
        success: true,
      },
      2
    );

    expect(metrics).toEqual({
      accountCount: 2,
      accountScope: "single",
      maxResults: 50,
      emailCount: 1,
      success: true,
      bodyReturned: true,
    });
    expect(JSON.stringify(metrics)).not.toContain("Confidential");
    expect(JSON.stringify(metrics)).not.toContain("Quarterly");
    expect(JSON.stringify(metrics)).not.toContain("alice@example.com");
    expect(JSON.stringify(metrics)).not.toContain("Sensitive");
  });
});
