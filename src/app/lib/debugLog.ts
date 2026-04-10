const IS_DEV = process.env.NODE_ENV !== "production";
const IS_SERVER = typeof window === "undefined";

const COLORS = {
  tool: "\x1b[36m",    // cyan
  api: "\x1b[33m",     // yellow
  llm: "\x1b[35m",     // magenta
  calendar: "\x1b[32m", // green
  event: "\x1b[34m",   // blue
  error: "\x1b[31m",       // red
  unsubscribe: "\x1b[95m", // bright magenta
  reset: "\x1b[0m",
} as const;

type Category = keyof Omit<typeof COLORS, "reset">;

function formatValue(val: unknown): string {
  if (val === undefined) return "undefined";
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

function appendToFile(line: string) {
  if (!IS_SERVER) return;
  try {
    // Dynamic import hidden from webpack static analysis
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = "fs";
    const fs = __non_webpack_require__(mod);
    const logFile = __non_webpack_require__("path").join(process.cwd(), "debug.log");
    fs.appendFileSync(logFile, line + "\n");
  } catch {
    // Silently fail — don't break the app over logging
  }
}

// Prevent webpack from analyzing the require calls
declare const __non_webpack_require__: typeof require;

export function debugLog(category: Category, label: string, data?: unknown) {
  if (!IS_DEV) return;
  const color = COLORS[category] || "";
  const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  const prefix = `${color}[${ts}] [${category.toUpperCase()}]${COLORS.reset}`;
  if (data !== undefined) {
    console.log(`${prefix} ${label}`, formatValue(data));
  } else {
    console.log(`${prefix} ${label}`);
  }

  // Also write to debug.log (no ANSI colors)
  const fileLine = data !== undefined
    ? `[${ts}] [${category.toUpperCase()}] ${label} ${formatValue(data)}`
    : `[${ts}] [${category.toUpperCase()}] ${label}`;
  appendToFile(fileLine);
}

/**
 * Verbose file-only logging — writes full payloads to debug.log without
 * cluttering the terminal. Use for complete API responses, LLM request
 * bodies, and other high-volume data you want during audits.
 */
export function debugLogVerbose(category: Category, label: string, data?: unknown) {
  if (!IS_DEV) return;
  const ts = new Date().toISOString().slice(11, 23);
  const fileLine = data !== undefined
    ? `[${ts}] [${category.toUpperCase()}] [VERBOSE] ${label} ${formatValue(data)}`
    : `[${ts}] [${category.toUpperCase()}] [VERBOSE] ${label}`;
  appendToFile(fileLine);
}

/**
 * Client-side verbose logging — fires-and-forgets a POST to /api/log which
 * writes to debug.log. Use for full tool results, email bodies, and other
 * payloads flowing between client tools and the LLM. No console output.
 */
export function debugLogClientVerbose(category: Category, label: string, data?: unknown) {
  if (!IS_DEV) return;
  try {
    fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: label, data, verbose: true, category }),
    }).catch(() => {}); // fire-and-forget
  } catch {}
}

// Client-side version (no ANSI colors, uses console.group)
export function debugLogClient(category: Category, label: string, data?: unknown) {
  if (!IS_DEV) return;
  const ts = new Date().toISOString().slice(11, 23);
  const prefix = `[${ts}] [${category.toUpperCase()}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${label}`, data);
  } else {
    console.log(`${prefix} ${label}`);
  }
}
