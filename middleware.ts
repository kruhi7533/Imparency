import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import {
  deriveTraceContext,
  formatTraceparent,
  TRACEPARENT_HEADER,
  CORRELATION_HEADER,
} from "@/lib/correlation";

/**
 * Role guards, plus the point where every request gets a correlation id.
 *
 * ## Why the id is minted here
 *
 * Middleware is the only place that sees *every* request before anything else
 * does, so it is the one spot where an id can be guaranteed rather than added
 * route by route. It continues an inbound `traceparent` when a proxy already
 * started a trace, and mints a fresh one otherwise.
 *
 * The id goes onto both:
 *   - the **request**, so server code downstream can seed its ambient context
 *     (`withRequestContext` in lib/request-context.ts) from a header rather
 *     than inventing a second id for the same request;
 *   - the **response**, so a user reporting a problem can read the id out of
 *     their network tab and quote it, and a support conversation starts with
 *     one log query instead of a guess about timestamps.
 *
 * ## Runtime constraint worth knowing
 *
 * Middleware runs on the **Edge runtime**, so `node:async_hooks` is not
 * available here and the AsyncLocalStorage context cannot be opened at this
 * layer. That is why lib/correlation.ts is deliberately free of `node:`
 * imports — it has to work in Edge, Node and the browser — and why the handoff
 * to the Node side happens through a header. Adding the ALS module to this
 * file's import graph would break the middleware bundle outright.
 *
 * ## `/api/*` is NOT matched, deliberately
 *
 * The matcher below covers pages only. Adding `/api/:path*` to it would look
 * like a free win for API correlation and would in fact be an outage: this is
 * `withAuth`, whose `authorized` callback below rejects any request without a
 * session, so every public and machine-to-machine endpoint would start
 * returning redirects — `donations/webhook` (Razorpay), all nine `cron/*`
 * routes, `discover`, `[id]/follow`, `[id]/fcra-status`, `[id]/inquiry` and
 * `user-follows`. A payment provider does not carry a session cookie.
 *
 * API routes therefore open their own context with `withRequestContext`,
 * reading an inbound `traceparent` when the caller supplied one and minting an
 * id when not. That is a per-route line of code rather than one global hook,
 * which is the cost of not breaking the webhook.
 */

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;

    // Derived FIRST, before the role guards below can return, so an
    // authenticated-but-wrong-role bounce to /unauthorized is still traceable —
    // "it keeps sending me to /unauthorized" is exactly the report you want an
    // id for, and stamping only the happy path would lose it.
    //
    // One case this genuinely cannot cover: a request with NO session never
    // reaches this function at all. `withAuth`'s `authorized` callback (below)
    // runs first and redirects straight to /login, so that 307 carries no id.
    // Verified with curl, not assumed. Stamping it would mean hand-rolling the
    // wrapper instead of using `withAuth`, which is a change to the
    // authentication path and not worth it for an anonymous request that has
    // nothing to correlate with.
    const trace = deriveTraceContext(req.headers.get(TRACEPARENT_HEADER));
    const traceparent = formatTraceparent(trace);

    const stamp = (res: NextResponse): NextResponse => {
      res.headers.set(TRACEPARENT_HEADER, traceparent);
      res.headers.set(CORRELATION_HEADER, trace.traceId);
      return res;
    };

    // Route guards based on user role
    if ((path.startsWith("/ngo/dashboard") || path.startsWith("/ngo/projects")) && token?.role !== "NGO") {
      return stamp(NextResponse.redirect(new URL("/unauthorized", req.url)));
    }
    if (path.startsWith("/admin") && token?.role !== "ADMIN") {
      return stamp(NextResponse.redirect(new URL("/unauthorized", req.url)));
    }
    if (path.startsWith("/donor") && token?.role !== "DONOR") {
      return stamp(NextResponse.redirect(new URL("/unauthorized", req.url)));
    }

    // Pass the id inward too, so server code can seed its ambient context from
    // a header rather than minting a second id for the same request.
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set(TRACEPARENT_HEADER, traceparent);
    requestHeaders.set(CORRELATION_HEADER, trace.traceId);

    return stamp(NextResponse.next({ request: { headers: requestHeaders } }));
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

export const config = {
  matcher: [
    "/ngo/dashboard/:path*",
    "/ngo/projects/:path*",
    "/admin/:path*",
    "/donor/:path*"
  ],
};
