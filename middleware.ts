import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse, NextRequest, type NextFetchEvent } from "next/server";
import {
  deriveTraceContext,
  formatTraceparent,
  TRACEPARENT_HEADER,
  CORRELATION_HEADER,
} from "@/lib/correlation";

/**
 * Two jobs, deliberately separated: give every request a correlation id, and
 * guard the role-protected pages.
 *
 * ## Why they are separated
 *
 * The obvious implementation — wrap everything in `withAuth` and widen the
 * matcher to `/api/:path*` — is an outage. `withAuth`'s `authorized` callback
 * rejects any request without a session, so every public and
 * machine-to-machine endpoint would start returning redirects:
 * `donations/webhook` (Razorpay), all nine `cron/*` routes, `discover`,
 * `[id]/follow`, `[id]/fcra-status`, `[id]/inquiry`, `user-follows`. A payment
 * provider does not carry a session cookie.
 *
 * So this file exports a plain middleware that stamps the id on **everything**
 * matched, and hands only the protected page prefixes to `withAuth`. API routes
 * get correlation; they do not get an auth gate they never had.
 *
 * ## Why the id is minted here rather than in each route
 *
 * SPEC-1 originally expected routes to opt in with `withRouteContext`. One of
 * 169 did. Minting here means `lib/request-context.ts` can simply READ the
 * header, and every route, Server Component and `lib/` helper gets a stable id
 * with no code change. The id goes on:
 *
 *   - the **request**, so server code can read it via `next/headers`;
 *   - the **response**, so a user reporting a problem can quote it from their
 *     network tab and support starts with one log query instead of a guess
 *     about timestamps.
 *
 * ## Runtime constraint
 *
 * Middleware runs on the **Edge runtime**, so `node:async_hooks` is unavailable
 * and the AsyncLocalStorage context cannot be opened here. That is exactly why
 * `lib/correlation.ts` has no `node:` imports — it must work in Edge, Node and
 * the browser — and why the handoff happens through a header. Importing
 * `lib/request-context.ts` here would break the middleware bundle outright.
 */

/** Page prefixes that require a session and a role. Everything else is open. */
const PROTECTED_PREFIXES = ["/ngo/dashboard", "/ngo/projects", "/admin", "/donor"] as const;

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * The role guards, wrapped by next-auth. Behaviour is unchanged from before
 * correlation existed: same checks, same options, same redirects.
 */
const protectedPages = withAuth(
  function roleGuard(req: NextRequestWithAuth) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;

    // The ids are already on the request, put there by `middleware` below, so
    // these redirects carry one too — "it keeps sending me to /unauthorized" is
    // exactly the report you want an id for.
    const traceparent = req.headers.get(TRACEPARENT_HEADER) ?? "";
    const correlationId = req.headers.get(CORRELATION_HEADER) ?? "";
    const stamp = (res: NextResponse): NextResponse => {
      if (traceparent) res.headers.set(TRACEPARENT_HEADER, traceparent);
      if (correlationId) res.headers.set(CORRELATION_HEADER, correlationId);
      return res;
    };

    if ((path.startsWith("/ngo/dashboard") || path.startsWith("/ngo/projects")) && token?.role !== "NGO") {
      return stamp(NextResponse.redirect(new URL("/unauthorized", req.url)));
    }
    if (path.startsWith("/admin") && token?.role !== "ADMIN") {
      return stamp(NextResponse.redirect(new URL("/unauthorized", req.url)));
    }
    if (path.startsWith("/donor") && token?.role !== "DONOR") {
      return stamp(NextResponse.redirect(new URL("/unauthorized", req.url)));
    }

    return stamp(NextResponse.next({ request: { headers: req.headers } }));
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/login",
    },
  }
);

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  // Continue an upstream trace when a proxy or caller started one, else mint a
  // new one. Derived FIRST so every path below carries it.
  const trace = deriveTraceContext(req.headers.get(TRACEPARENT_HEADER));
  const traceparent = formatTraceparent(trace);

  // Put the ids on the INBOUND request. `lib/request-context.ts` reads them
  // back through `next/headers`, which is what makes the id identical at every
  // call site in the request — a generated one was measured changing between
  // call sites, which is worse than having none at all.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(TRACEPARENT_HEADER, traceparent);
  requestHeaders.set(CORRELATION_HEADER, trace.traceId);

  const stamp = (res: NextResponse): NextResponse => {
    res.headers.set(TRACEPARENT_HEADER, traceparent);
    res.headers.set(CORRELATION_HEADER, trace.traceId);
    return res;
  };

  if (!isProtectedPage(req.nextUrl.pathname)) {
    // Public pages and the whole API surface: correlation only, no auth gate.
    return stamp(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  // Protected pages. Rebuild the request so it carries the ids, then hand it to
  // next-auth exactly as before.
  const authed = new NextRequest(req, { headers: requestHeaders }) as NextRequestWithAuth;
  const res = await protectedPages(authed, event);

  // A session-less request never reaches `roleGuard`: next-auth short-circuits
  // to /login first, so that redirect would otherwise be unstamped.
  return res instanceof NextResponse ? stamp(res) : res;
}

export const config = {
  matcher: [
    "/ngo/dashboard/:path*",
    "/ngo/projects/:path*",
    "/admin/:path*",
    "/donor/:path*",
    // Added for correlation ONLY — see the header comment. These are not
    // auth-gated: `middleware` above returns before `withAuth` for them.
    "/api/:path*",
  ],
};
