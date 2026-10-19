import { currentCorrelationId } from "@/lib/correlation";

/**
 * Structured application logging.
 *
 * One line of JSON per event, with the correlation id merged in automatically
 * so every line emitted while serving one request can be grouped by it. That
 * grouping is the entire point: `console.log("done")` in a codebase serving
 * concurrent requests is noise, because nothing says which request it belongs
 * to.
 *
 * Isomorphic by construction — it imports only `lib/correlation.ts`, never the
 * AsyncLocalStorage module, so it is safe anywhere. Outside a request the
 * correlation id is simply absent, which is a normal state, not an error.
 *
 * ## The two guarantees, inherited from `lib/observability.ts`
 *
 * 1. **It never throws.** Logging is called from error paths, including inside
 *    catch blocks. A logger that can throw turns a handled failure into an
 *    unhandled one.
 * 2. **It never awaits network I/O.** Forwarding to a collector is
 *    `captureError`'s job, which does it fire-and-forget. Nothing here can slow
 *    a request down.
 *
 * ## Privacy — the same rule as the audit log and `captureError`
 *
 * **Ids, counts, enum values and booleans only.** Never names, emails,
 * donation amounts, document contents or free-text a person wrote. These lines
 * outlive PII retention on the main tables and may reach a third-party
 * collector, which is exactly the reasoning CLAUDE.md §Privacy applies to
 * `logAdminAction()`. The `LogFields` type makes the cheap half of that rule
 * mechanical; the rest is reviewer discipline.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Primitive-only, so a whole object of user data cannot be passed by accident. */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

/** Prefix for one-filter alerting, matching `[capture]` in lib/observability.ts. */
const LOG_PREFIX = "[log]";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Minimum level emitted.
 *
 * `debug` is dropped unless asked for, because the alternative is a production
 * log too expensive to read. Tests set it to silence output.
 */
function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? "").toLowerCase() as LogLevel;
  if (configured in LEVEL_ORDER) return LEVEL_ORDER[configured];
  if (process.env.NODE_ENV === "test") return LEVEL_ORDER.error + 10; // silent
  return LEVEL_ORDER.info;
}

function safeStringify(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload) ?? "{}";
  } catch {
    // A circular or unserialisable field must not lose the whole line.
    return JSON.stringify({ level: payload.level, event: payload.event, unserialisable: true });
  }
}

/**
 * Drop keys whose value is `undefined`.
 *
 * `JSON.stringify` already omits them, but normalising first keeps the field
 * count honest for anything that inspects the object before it is serialised —
 * and makes `fields` with an absent optional read the same as one never passed.
 */
function compact(fields: LogFields): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  try {
    if (LEVEL_ORDER[level] < threshold()) return;

    const correlationId = currentCorrelationId();
    const line = safeStringify({
      level,
      event,
      at: new Date().toISOString(),
      env: process.env.NODE_ENV ?? "unknown",
      ...(correlationId ? { correlationId } : {}),
      ...compact(fields),
    });

    // stderr for warn/error so it lands with the platform's other error output;
    // stdout otherwise. Same split as lib/observability.ts.
    if (level === "error" || level === "warn") console.error(`${LOG_PREFIX} ${line}`);
    else console.log(`${LOG_PREFIX} ${line}`);
  } catch {
    // Last resort. Logging must never become the thing that breaks a request.
  }
}

export const log = {
  debug: (event: string, fields?: LogFields) => emit("debug", event, fields),
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};

/**
 * Time an operation and log its outcome once, with a duration.
 *
 * Rethrows after logging: this measures, it does not swallow. Use
 * `captureAsync` from `lib/observability.ts` when the failure should be
 * absorbed instead.
 */
export async function logDuration<T>(
  event: string,
  fields: LogFields,
  operation: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  try {
    const result = await operation();
    log.info(event, { ...fields, ok: true, durationMs: Date.now() - started });
    return result;
  } catch (err) {
    log.error(event, {
      ...fields,
      ok: false,
      durationMs: Date.now() - started,
      errorName: err instanceof Error ? err.name : "NonError",
    });
    throw err;
  }
}
