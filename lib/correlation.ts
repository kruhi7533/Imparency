/**
 * W3C trace context — id generation, parsing, and the resolver seam.
 *
 * This module is deliberately **isomorphic**: no `node:` imports, no
 * `AsyncLocalStorage`, nothing a bundler has to polyfill. It is safe to import
 * from a `"use client"` component, and that is the whole reason it exists
 * separately from `lib/request-context.ts`.
 *
 * Why the split matters: `lib/observability.ts` (`captureError`) is imported by
 * route handlers today but its docstring promises that wiring in extra
 * machinery costs call sites nothing. If `captureError` imported the
 * AsyncLocalStorage module directly it would become server-only, and any
 * teammate who later imported it into a client component would get the Week 7
 * failure — a page that fails to build and serves a 500 while the whole test
 * suite stays green, because webpack does not polyfill the `node:` scheme.
 * So the Node-only half registers itself here through `setCorrelationResolver`,
 * and everything else reads `currentCorrelationId()` without knowing how it is
 * produced. When no resolver is registered the answer is simply `null`.
 *
 * ## Why W3C `traceparent` rather than a homegrown `x-correlation-id`
 *
 * Week 9's SPEC-1 ships correlation without an OpenTelemetry SDK (see
 * docs/WEEK9-BLUEPRINT.md §SPEC-1 — an SDK with no collector exports nothing
 * readable). Using OTel's own wire format now means adopting the SDK later is
 * configuration rather than a migration of every log line, every header and
 * every stored id. The format is also what upstream proxies and downstream
 * services already understand, so a request that arrives with a trace context
 * keeps it instead of starting a new one.
 *
 * Format: `00-<32 hex trace-id>-<16 hex parent-id>-<2 hex flags>`
 */

/**
 * Header we read and echo. Standard name, so proxies and tracers agree.
 *
 * Declared here rather than in lib/request-context.ts because `middleware.ts`
 * needs it too and cannot import that module — it pulls in `node:async_hooks`,
 * which the Edge runtime does not have. Two copies with a "keep these in sync"
 * comment is how one of them eventually drifts.
 */
export const TRACEPARENT_HEADER = "traceparent";

/**
 * Header carrying the bare id, for humans and for log search.
 *
 * `traceparent` is the interoperable format, but asking someone in a support
 * conversation to read the middle field out of a four-part header is a bad
 * instruction. This one is the id on its own.
 */
export const CORRELATION_HEADER = "x-correlation-id";

/** The human-quotable id. 32 lowercase hex chars — the W3C trace-id. */
export type CorrelationId = string;

export interface TraceContext {
  version: string;
  /** 32 hex chars. This is what we surface as the correlation id. */
  traceId: CorrelationId;
  /** 16 hex chars. The caller's span; ours is generated per request. */
  parentId: string;
  /** 2 hex chars. "01" = sampled. */
  flags: string;
}

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO_TRACE = "0".repeat(32);
const ZERO_PARENT = "0".repeat(16);
const HEX = "0123456789abcdef";

/**
 * Random hex, via the **Web Crypto global** rather than `node:crypto`.
 *
 * `globalThis.crypto` exists in Node 18+, in the Edge runtime that
 * `middleware.ts` runs on, and in browsers — so one implementation covers all
 * three. Importing `node:crypto` here would make this module unbundleable and
 * defeat the split described above.
 *
 * The `Math.random` branch is a last resort for an exotic runtime with no Web
 * Crypto. A correlation id is not a secret and carries no authority — it labels
 * log lines — so a weaker random source degrades traceability, never security.
 */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  const webcrypto = globalThis.crypto;
  if (webcrypto && typeof webcrypto.getRandomValues === "function") {
    webcrypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < bytes; i += 1) buf[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < buf.length; i += 1) {
    out += HEX[buf[i] >> 4] + HEX[buf[i] & 15];
  }
  return out;
}

/**
 * Repair an all-zero id, which the spec treats as invalid rather than unlucky.
 *
 * Deterministic rather than a re-roll loop, on purpose. `while (id === ZERO)
 * id = randomHex(n)` reads fine and is a hang: a stubbed, broken or
 * exhausted entropy source that keeps returning zeros spins forever, and this
 * runs on the path of every single request. Flipping one nibble terminates,
 * costs nothing, and the only input it alters is one that was unusable anyway.
 */
function repairIfZero(id: string): string {
  return /[1-9a-f]/.test(id) ? id : `${id.slice(0, -1)}1`;
}

/** A fresh 32-hex trace id. Never all zeros, which the spec forbids. */
export function newCorrelationId(): CorrelationId {
  return repairIfZero(randomHex(16));
}

/** A fresh 16-hex span id. Never all zeros. */
export function newSpanId(): string {
  return repairIfZero(randomHex(8));
}

/** Serialise a context back to a `traceparent` header value. */
export function formatTraceparent(ctx: TraceContext): string {
  return `${ctx.version}-${ctx.traceId}-${ctx.parentId}-${ctx.flags}`;
}

/**
 * Parse an inbound `traceparent`, or return null when it cannot be trusted.
 *
 * Rejects a malformed header, an all-zero trace or parent id (both invalid per
 * spec), and any version other than `00`. The spec asks implementations to
 * parse future versions leniently; this returns null instead, so the caller
 * mints a fresh valid context. Inventing structure for a header we do not
 * understand risks propagating a broken trace to every downstream service,
 * whereas starting a new trace loses one hop of linkage and nothing else.
 */
export function parseTraceparent(value: string | null | undefined): TraceContext | null {
  if (!value) return null;
  const match = TRACEPARENT.exec(value.trim().toLowerCase());
  if (!match) return null;

  const [, version, traceId, parentId, flags] = match;
  if (version !== "00") return null;
  if (traceId === ZERO_TRACE || parentId === ZERO_PARENT) return null;

  return { version, traceId, parentId, flags };
}

/**
 * Continue an inbound trace, or start a new one.
 *
 * Our own span id is always fresh: we are a new hop, and reusing the caller's
 * parent id would make two spans indistinguishable in any tracer that later
 * consumes this.
 */
export function deriveTraceContext(inbound: string | null | undefined): TraceContext {
  const parsed = parseTraceparent(inbound);
  return {
    version: "00",
    traceId: parsed?.traceId ?? newCorrelationId(),
    parentId: newSpanId(),
    flags: parsed?.flags ?? "01",
  };
}

// --- the resolver seam ----------------------------------------------------

type Resolver = () => CorrelationId | null;

let resolver: Resolver | null = null;

/**
 * Register how `currentCorrelationId()` should answer.
 *
 * Called once, at import time, by `lib/request-context.ts` — the server-only
 * module that owns the AsyncLocalStorage. Nothing else should call this outside
 * a test.
 */
export function setCorrelationResolver(fn: Resolver | null): void {
  resolver = fn;
}

/**
 * The correlation id for whatever is executing right now, or null.
 *
 * Never throws. Returning null is a perfectly normal answer — a module-scope
 * call, a script, a test, or any code running outside a request context has no
 * id, and a logger must not fall over because of that.
 */
export function currentCorrelationId(): CorrelationId | null {
  if (!resolver) return null;
  try {
    return resolver();
  } catch {
    return null;
  }
}
