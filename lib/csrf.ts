/**
 * Cross-site request forgery guard for the API (roadmap row 13, security).
 *
 * Session cookies are SameSite=Lax, which already stops most cross-site POSTs.
 * This adds the second, independent check the security review asked for: a
 * state-changing request (POST/PUT/PATCH/DELETE) whose browser-supplied origin
 * is a DIFFERENT site is refused before any route runs.
 *
 * - Decided from `Origin`, falling back to `Sec-Fetch-Site`. Browsers send at
 *   least one on every cross-site write; a request with neither is not from a
 *   browser (curl, a server, a payment provider) and has no ambient cookie to
 *   abuse — it still has to pass the route's own auth.
 * - Allowed origins: the request's own host (respecting x-forwarded-host behind
 *   a proxy), NEXTAUTH_URL, and ALLOWED_ORIGINS (comma-separated).
 * - Machine-to-machine endpoints are exempt by path: payment and crisis
 *   webhooks, WhatsApp (Twilio), cron, and NextAuth's own routes (which carry
 *   their own CSRF token).
 *
 * Pure and dependency-free: runs in the Edge middleware.
 */

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const CSRF_EXEMPT_PREFIXES = [
  "/api/auth/",
  "/api/cron/",
  "/api/donations/webhook",
  "/api/crisis/webhook",
  "/api/whatsapp",
  "/api/test/mock-webhook",
];

export interface CsrfInput {
  method: string;
  pathname: string;
  origin: string | null;
  secFetchSite: string | null;
  host: string | null;
  forwardedHost: string | null;
  env?: { NEXTAUTH_URL?: string; ALLOWED_ORIGINS?: string };
}

const hostOf = (url: string | undefined | null): string | null => {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

export function checkCsrf(i: CsrfInput): { ok: true } | { ok: false; reason: string } {
  if (!UNSAFE.has(i.method.toUpperCase())) return { ok: true };
  if (!i.pathname.startsWith("/api/")) return { ok: true };
  if (CSRF_EXEMPT_PREFIXES.some((p) => i.pathname.startsWith(p))) return { ok: true };

  if (i.origin && i.origin !== "null") {
    const allowed = new Set<string>(
      [
        (i.forwardedHost ?? i.host ?? "").split(",")[0].trim().toLowerCase(),
        hostOf(i.env?.NEXTAUTH_URL),
        ...(i.env?.ALLOWED_ORIGINS ?? "").split(",").map((o) => hostOf(o.trim())),
      ].filter((h): h is string => !!h)
    );
    const originHost = hostOf(i.origin);
    if (!originHost || !allowed.has(originHost)) return { ok: false, reason: "cross-origin request" };
    return { ok: true };
  }
  // An opaque ("null") origin, or no Origin but the browser says cross-site.
  if (i.origin === "null" || i.secFetchSite === "cross-site") return { ok: false, reason: "cross-site request" };
  return { ok: true };
}
