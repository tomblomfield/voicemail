import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockGetSessionUserId, mockLogLatencyTelemetry } = vi.hoisted(() => ({
  mockGetSessionUserId: vi.fn(),
  mockLogLatencyTelemetry: vi.fn(),
}));

vi.mock("@/app/lib/session", () => ({
  SESSION_COOKIE_NAME: "voicemail_session",
  getSessionUserId: mockGetSessionUserId,
}));

vi.mock("@/app/lib/telemetry", () => ({
  logLatencyTelemetry: mockLogLatencyTelemetry,
}));

function requestWithCookie(cookieValue?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (cookieValue) {
    headers.set("Cookie", `voicemail_session=${cookieValue}`);
  }

  return new NextRequest("http://localhost/api/telemetry", {
    method: "POST",
    headers,
    body: JSON.stringify({
      provider: "openai",
      operation: "realtime.connect",
      durationMs: 123,
      status: "ok",
    }),
  });
}

describe("POST /api/telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests without a valid session cookie", async () => {
    const { POST } = await import("./route");

    const noCookieResponse = await POST(requestWithCookie());
    expect(noCookieResponse.status).toBe(401);

    mockGetSessionUserId.mockReturnValueOnce(null);
    const badCookieResponse = await POST(requestWithCookie("bad"));
    expect(badCookieResponse.status).toBe(401);
    expect(mockLogLatencyTelemetry).not.toHaveBeenCalled();
  });

  it("logs authenticated browser telemetry as browser-sourced", async () => {
    mockGetSessionUserId.mockReturnValueOnce("user_123");
    const { POST } = await import("./route");

    const response = await POST(requestWithCookie("valid"));

    expect(response.status).toBe(200);
    expect(mockLogLatencyTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        operation: "realtime.connect",
        durationMs: 123,
        status: "ok",
        source: "browser",
      })
    );
  });
});
