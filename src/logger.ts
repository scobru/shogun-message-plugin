import { getConfig } from "./config";

type LogLevel = "debug" | "info" | "warn" | "error";

const levelRank: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(desired: LogLevel): boolean {
  try {
    const cfg = getConfig();
    const configured = (cfg.logLevel || "info") as LogLevel;
    return levelRank[desired] >= levelRank[configured];
  } catch {
    return desired !== "debug" && desired !== "info"; // safe default
  }
}

function mask(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length <= 12) return "[masked]";
    return value.slice(0, 6) + "…" + value.slice(-4);
  }
  if (typeof value === "object" && value !== null) {
    const clone: any = Array.isArray(value) ? [] : {};
    for (const [k, v] of Object.entries(value as any)) {
      if (k.toLowerCase().includes("pub") || k.toLowerCase().includes("epub") || k.toLowerCase().includes("content")) {
        clone[k] = "[masked]";
      } else {
        clone[k] = v;
      }
    }
    return clone;
  }
  return value;
}

function logWith(level: LogLevel, args: any[]): void {
  if (!shouldLog(level)) return;
  const cfg = getConfig();
  const redact = cfg.logLevel === "warn" || cfg.logLevel === "error";
  const payload = redact ? args.map(mask) : args;
  const fn = level === "debug" ? console.debug : level === "info" ? console.info : level === "warn" ? console.warn : console.error;
  try {
    fn.apply(console, payload);
  } catch {
    // swallow logging errors
  }
}

export const logger = {
  debug: (...args: any[]) => logWith("debug", args),
  info: (...args: any[]) => logWith("info", args),
  warn: (...args: any[]) => logWith("warn", args),
  error: (...args: any[]) => logWith("error", args),
};

export type Logger = typeof logger;


