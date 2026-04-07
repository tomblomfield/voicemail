const IS_DEV = process.env.NODE_ENV !== "production";

const COLORS = {
  tool: "\x1b[36m",    // cyan
  api: "\x1b[33m",     // yellow
  llm: "\x1b[35m",     // magenta
  calendar: "\x1b[32m", // green
  event: "\x1b[34m",   // blue
  error: "\x1b[31m",   // red
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
