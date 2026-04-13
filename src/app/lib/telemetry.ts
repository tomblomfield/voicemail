type TelemetryProvider = "openai" | "gmail" | "gemini";
type TelemetrySource = "server" | "browser";
type TelemetryStatus = "ok" | "error" | "unauthorized";
type TelemetryValue = string | number | boolean | null | undefined;

export interface LatencyTelemetryInput {
  provider: TelemetryProvider;
  operation: string;
  durationMs: number;
  status: TelemetryStatus;
  source?: TelemetrySource;
  route?: string;
  httpStatus?: number;
  model?: string;
  errorType?: string;
  metrics?: Record<string, TelemetryValue>;
}

export interface LatencyTelemetryEvent {
  event: "api_latency";
  schemaVersion: 1;
  timestamp: string;
  dayUtc: string;
  hourUtc: string;
  provider: TelemetryProvider;
  operation: string;
  durationMs: number;
  status: TelemetryStatus;
  source: TelemetrySource;
  route?: string;
  httpStatus?: number;
  model?: string;
  errorType?: string;
  metrics?: Record<string, string | number | boolean | null>;
}

const SAFE_LABEL_RE = /^[a-zA-Z0-9_.:/-]{1,100}$/;
const SAFE_STRING_METRIC_KEYS = new Set(["accountScope", "outputType"]);

function shouldEmitTelemetry(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.TELEMETRY_LOGS === "true" ||
    process.env.NEXT_PUBLIC_TELEMETRY_LOGS === "true"
  );
}

function safeLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return SAFE_LABEL_RE.test(trimmed) ? trimmed : fallback;
}

function safeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(value));
}

function safeProvider(value: unknown): TelemetryProvider | null {
  return value === "openai" || value === "gmail" || value === "gemini"
    ? value
    : null;
}

function safeStatus(value: unknown): TelemetryStatus | null {
  return value === "ok" || value === "error" || value === "unauthorized"
    ? value
    : null;
}

function safeSource(value: unknown): TelemetrySource {
  return value === "browser" ? "browser" : "server";
}

function sanitizeMetrics(
  metrics?: Record<string, TelemetryValue>
): Record<string, string | number | boolean | null> | undefined {
  if (!metrics) return undefined;

  const out: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, value] of Object.entries(metrics)) {
    const key = safeLabel(rawKey, "");
    if (!key) continue;

    if (typeof value === "number") {
      const numberValue = safeNumber(value);
      if (numberValue !== undefined) out[key] = numberValue;
    } else if (typeof value === "boolean" || value === null) {
      out[key] = value;
    } else if (typeof value === "string") {
      if (!SAFE_STRING_METRIC_KEYS.has(key)) continue;
      const labelValue = safeLabel(value, "");
      if (labelValue) out[key] = labelValue;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildLatencyTelemetryEvent(
  input: LatencyTelemetryInput,
  now = new Date()
): LatencyTelemetryEvent | null {
  const durationMs = safeNumber(input.durationMs);
  if (durationMs === undefined) return null;
  const provider = safeProvider(input.provider);
  const status = safeStatus(input.status);
  if (!provider || !status) return null;

  const timestamp = now.toISOString();
  const event: LatencyTelemetryEvent = {
    event: "api_latency",
    schemaVersion: 1,
    timestamp,
    dayUtc: timestamp.slice(0, 10),
    hourUtc: timestamp.slice(11, 13),
    provider,
    operation: safeLabel(input.operation, "unknown"),
    durationMs,
    status,
    source: safeSource(input.source),
  };

  if (input.route) event.route = safeLabel(input.route, "unknown");
  if (input.httpStatus !== undefined) {
    const httpStatus = safeNumber(input.httpStatus);
    if (httpStatus !== undefined) event.httpStatus = httpStatus;
  }
  if (input.model) event.model = safeLabel(input.model, "unknown");
  if (input.errorType) event.errorType = safeLabel(input.errorType, "Error");

  const metrics = sanitizeMetrics(input.metrics);
  if (metrics) event.metrics = metrics;

  return event;
}

export function logLatencyTelemetry(input: LatencyTelemetryInput): void {
  if (!shouldEmitTelemetry()) return;

  const event = buildLatencyTelemetryEvent(input);
  if (!event) return;

  console.info(JSON.stringify(event));
}

export function logClientLatencyTelemetry(input: LatencyTelemetryInput): void {
  if (typeof window === "undefined") {
    logLatencyTelemetry({ ...input, source: input.source || "server" });
    return;
  }

  if (!shouldEmitTelemetry()) return;

  try {
    fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, source: "browser" }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}
