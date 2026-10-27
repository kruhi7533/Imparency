import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse, NextRequest, type NextFetchEvent } from "next/server";
import {
  deriveTraceContext,
  formatTraceparent,
  TRACEPARENT_HEADER,
  CORRELATION_HEADER,
} from "@/lib/correlation";
import { checkCsrf } from "@/lib/csrf";
import { getToken } from "next-auth/jwt";
import { adminApiDecision, adminHome, adminPageAllowed, isReadMethod, isRestrictedAdmin } from "@/lib/admin-roles";

/** Stamped on every request (client values overwritten) so lib/auth-guards.ts can apply admin sub-role policy. */
const METHOD_HEADER = "x-ib-method";
const PATH_HEADER = "x-ib-path";
const SESSION_COOKIES = ["next-auth.session-token", "__Secure-next-auth.session-token"];

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
    // A field worker's home is the field app (only their own tasks), not the org dashboard.
    if (path.startsWith("/ngo/dashboard") && token?.ngoTeamRole === "FIELD_STAFF") {
      return stamp(NextResponse.redirect(new URL("/ngo/field", req.url)));
    }
    if (path.startsWith("/admin") && token?.role !== "ADMIN") {
      return stamp(NextResponse.redirect(new URL("/unauthorized", req.url)));
    }
    // Admin sub-roles (lib/admin-roles.ts): a finance admin opening a page
    // outside finance is sent to their own home rather than a dead end.
    if (path.startsWith("/admin") && !adminPageAllowed(token?.adminRole, path)) {
      return stamp(NextResponse.redirect(new URL(adminHome(token?.adminRole), req.url)));
    }
    // Shared contract screen: /donor/contracts/[id] is reachable by DONOR, NGO
    // and ADMIN (the page decides access per contract; NGOs and admins also
    // have /ngo/contracts/[id] and /admin/contracts/[id]). The contract LIST is
    // the donor's; an NGO is sent to its own.
    if (path.startsWith("/donor/contracts/")) {
      if (token?.role !== "DONOR" && token?.role !== "NGO" && token?.role !== "ADMIN") {
        return stamp(NextResponse.redirect(new URL("/unauthorized", req.url)));
      }
    } else if (path === "/donor/contracts" && token?.role === "NGO") {
      return stamp(NextResponse.redirect(new URL("/ngo/contracts", req.url)));
    } else if (path.startsWith("/donor") && token?.role !== "DONOR") {
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
  requestHeaders.set(METHOD_HEADER, req.method);
  requestHeaders.set(PATH_HEADER, req.nextUrl.pathname);

  const stamp = (res: NextResponse): NextResponse => {
    res.headers.set(TRACEPARENT_HEADER, traceparent);
    res.headers.set(CORRELATION_HEADER, trace.traceId);
    return res;
  };

  // Cross-site writes to the API are refused before any route runs (lib/csrf.ts).
  const csrf = checkCsrf({
    method: req.method,
    pathname: req.nextUrl.pathname,
    origin: req.headers.get("origin"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    host: req.headers.get("host"),
    forwardedHost: req.headers.get("x-forwarded-host"),
    env: { NEXTAUTH_URL: process.env.NEXTAUTH_URL, ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS },
  });
  if (!csrf.ok) {
    return stamp(NextResponse.json({ error: "Cross-site request refused." }, { status: 403 }));
  }

  // Admin sub-roles on API writes: an auditor never writes, a finance admin
  // writes only in finance. lib/auth-guards.ts enforces the same policy from
  // the fresh session; this catches routes that never call verifySessionRole.
  // Only decoded when a session cookie is present on a write.
  if (
    req.nextUrl.pathname.startsWith("/api/") &&
    !isReadMethod(req.method) &&
    SESSION_COOKIES.some((c) => req.cookies.has(c))
  ) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);
    if (token?.role === "ADMIN" && isRestrictedAdmin(token.adminRole)) {
      const decision = adminApiDecision(token.adminRole, req.method, req.nextUrl.pathname);
      if (decision.kind === "deny") {
        return stamp(NextResponse.json({ error: decision.reason, code: "ADMIN_ROLE_FORBIDDEN" }, { status: 403 }));
      }
    }
  }

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
