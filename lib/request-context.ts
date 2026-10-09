import { AsyncLocalStorage } from "node:async_hooks";
import {
  deriveTraceContext,
  formatTraceparent,
  setCorrelationResolver,
  TRACEPARENT_HEADER,
  CORRELATION_HEADER,
  type CorrelationId,
  type TraceContext,
} from "@/lib/correlation";

/**
 * The ambient request context — **server only**.
 *
 * ## What problem this solves
 *
 * A single user action touches an API route, several Prisma queries, sometimes
 * a Gemini call and sometimes a Twilio send. Before this module, the log lines
 * from those stages could not be tied to each other, so the first question of
 * every real investigation — "what else happened during the request that
 * failed?" — had no answer. `AsyncLocalStorage` carries the id down through
 * call stacks that never receive the request object, which is most of `lib/`:
 * `captureError` inside `lib/compliance-evidence.ts` has no idea what request
 * it is serving, and threading a parameter through every helper to tell it
 * would be a change to hundreds of signatures.
 *
 * ## Why this file is separate from `lib/correlation.ts`
 *
 * `node:async_hooks` is a Node builtin, and webpack does not polyfill the
 * `node:` scheme. One import of this module inside a `"use client"` import
 * closure makes the page fail to build and serve a 500 — the exact Week 7
 * failure (`node:crypto` in `lib/proof-fingerprint.ts` killed
 * /admin/proof-review while 1668 tests stayed green). So this module registers
 * itself with the isomorphic one and nothing bundler-visible imports it.
 *
 * `tests/client-bundle-safety.test.ts` guards that boundary — and note that its
 * builtin list had no entry for `async_hooks` until this spec added one, so the
 * guard could not have caught this particular mistake before now.
 */

export interface RequestContext {
  /** The W3C trace-id. The id a user can quote off a response header. */
  correlationId: CorrelationId;
  /** Full trace context, for propagating onward to another service. */
  trace: TraceContext;
  /** Route or job label, e.g. "api/admin/review-proof" or "cron/deliver-impact". */
  scope: string;
  /** Acting user's id. Never their email or name (CLAUDE.md §Privacy). */
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

// Re-exported for convenience: server code importing this module should not
// have to reach into lib/correlation.ts for the header names. They are DEFINED
// there because middleware.ts needs them and cannot import this file.
export { TRACEPARENT_HEADER, CORRELATION_HEADER };

/** The context for the current async execution, or null outside a request. */
export function getRequestContext(): RequestContext | null {
  return storage.getStore() ?? null;
}

/** The current correlation id, or null. */
export function getCorrelationId(): CorrelationId | null {
  return storage.getStore()?.correlationId ?? null;
}

/**
 * Run `fn` with an ambient request context.
 *
 * `inboundTraceparent` continues an upstream trace when present and starts a
 * new one otherwise, so a request arriving from a proxy that already traced it
 * keeps the same id.
 */
export function withRequestContext<T>(
  init: { scope: string; inboundTraceparent?: string | null; userId?: string },
  fn: (ctx: RequestContext) => T
): T {
  const trace = deriveTraceContext(init.inboundTraceparent);
  const ctx: RequestContext = {
    correlationId: trace.traceId,
    trace,
    scope: init.scope,
    userId: init.userId,
  };
  return storage.run(ctx, () => fn(ctx));
}

/**
 * Open a context for an API route handler, from the inbound request.
 *
 * `middleware.ts` cannot do this for `/api/*` — its matcher excludes those
 * paths, because `withAuth` would then reject every sessionless caller and take
 * the Razorpay webhook and all nine cron endpoints down with it. So API routes
 * opt in here instead.
 *
 * Reads the `traceparent` middleware set for page requests, or the one a proxy
 * or another service supplied, and mints a fresh id when there is none.
 *
 * @example
 * export async function GET(req: Request) {
 *   return withRouteContext(req, "api/media-proxy", async () => {
 *     // every log line and capture in here shares one id
 *   });
 * }
 */
export function withRouteContext<T>(
  req: Request,
  scope: string,
  fn: (ctx: RequestContext) => T
): T {
  return withRequestContext(
    { scope, inboundTraceparent: req.headers.get(TRACEPARENT_HEADER) },
    fn
  );
}

/**
 * Attach the acting user to the live context, once authentication has resolved.
 *
 * Mutates in place rather than re-running the storage: the id must not change
 * mid-request, and by the time a route knows who is calling it is already deep
 * inside the callback. Returns false when there is no context to annotate,
 * which callers are free to ignore.
 */
export function setContextUser(userId: string): boolean {
  const ctx = storage.getStore();
  if (!ctx) return false;
  ctx.userId = userId;
  return true;
}

/** Headers to send to a downstream service so the trace continues. */
export function outboundTraceHeaders(): Record<string, string> {
  const ctx = storage.getStore();
  if (!ctx) return {};
  return {
    [TRACEPARENT_HEADER]: formatTraceparent(ctx.trace),
    [CORRELATION_HEADER]: ctx.correlationId,
  };
}

// Registering at import time is what lets `captureError` and `lib/logger.ts`
// pick up the id without importing this Node-only module themselves.
setCorrelationResolver(getCorrelationId);
