import { describe, expect, it } from "vitest";
import { buildLatencyTelemetryEvent } from "./telemetry";

describe("buildLatencyTelemetryEvent", () => {
  it("adds UTC day and hour fields for grouping", () => {
    const event = buildLatencyTelemetryEvent(
      {
        provider: "gmail",
        operation: "list",
        durationMs: 123.4,
        status: "ok",
        route: "/api/gmail",
      },
      new Date("2026-04-13T21:35:10.000Z")
    );

    expect(event).toMatchObject({
      event: "api_latency",
      dayUtc: "2026-04-13",
      hourUtc: "21",
      durationMs: 123,
    });
  });

  it("drops free-form strings from metrics", () => {
    const event = buildLatencyTelemetryEvent({
      provider: "openai",
      operation: "responses.create",
      durationMs: 250,
      status: "ok",
      metrics: {
        inputTokens: 1000,
        accountScope: "multi",
        query: "from:alice@example.com quarterly plan",
        url: "https://example.com/unsubscribe",
        ok: true,
      },
    });

    expect(event?.metrics).toEqual({
      inputTokens: 1000,
      accountScope: "multi",
      ok: true,
    });
  });

  it("drops invalid telemetry payloads", () => {
    expect(
      buildLatencyTelemetryEvent({
        provider: "anthropic" as any,
        operation: "responses.create",
        durationMs: 100,
        status: "ok",
      })
    ).toBeNull();

    expect(
      buildLatencyTelemetryEvent({
        provider: "openai",
        operation: "responses.create",
        durationMs: Number.POSITIVE_INFINITY,
        status: "ok",
      })
    ).toBeNull();

    expect(
      buildLatencyTelemetryEvent({
        provider: "openai",
        operation: "responses.create",
        durationMs: 100,
        status: "pending" as any,
      })
    ).toBeNull();
  });

  it("keeps model identifiers for future model comparisons", () => {
    const event = buildLatencyTelemetryEvent({
      provider: "gemini",
      operation: "responses.create",
      durationMs: 500,
      status: "ok",
      model: "gemini-2.5-flash",
    });

    expect(event).toMatchObject({
      provider: "gemini",
      model: "gemini-2.5-flash",
    });
  });
});
