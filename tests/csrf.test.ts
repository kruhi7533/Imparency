import { describe, it, expect } from "vitest";
import { checkCsrf, type CsrfInput } from "@/lib/csrf";

/** Cross-site writes to the API are refused; everything legitimate passes. */

const base: CsrfInput = {
  method: "POST",
  pathname: "/api/contracts",
  origin: "https://impactbridge.example",
  secFetchSite: "same-origin",
  host: "impactbridge.example",
  forwardedHost: null,
  env: {},
};
const check = (over: Partial<CsrfInput>) => checkCsrf({ ...base, ...over });

describe("checkCsrf", () => {
  it("same-origin writes pass", () => {
    expect(check({}).ok).toBe(true);
  });

  it("a write from another site is refused", () => {
    expect(check({ origin: "https://evil.example", secFetchSite: "cross-site" }).ok).toBe(false);
    expect(check({ origin: "https://impactbridge.example.evil.example" }).ok).toBe(false);
  });

  it("an opaque origin, or a cross-site fetch with no Origin, is refused", () => {
    expect(check({ origin: "null" }).ok).toBe(false);
    expect(check({ origin: null, secFetchSite: "cross-site" }).ok).toBe(false);
  });

  it("non-browser callers (no Origin, no Sec-Fetch-Site) pass to the route's own auth", () => {
    expect(check({ origin: null, secFetchSite: null }).ok).toBe(true);
  });

  it("reads are never blocked", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) expect(check({ method, origin: "https://evil.example" }).ok).toBe(true);
  });

  it("machine-to-machine endpoints are exempt", () => {
    for (const pathname of ["/api/donations/webhook", "/api/crisis/webhook", "/api/whatsapp", "/api/cron/sla-escalation", "/api/auth/callback/credentials"]) {
      expect(check({ pathname, origin: "https://api.razorpay.com" }).ok).toBe(true);
    }
  });

  it("only /api is guarded (pages and server actions keep Next's own protection)", () => {
    expect(check({ pathname: "/ngo/settings/team", origin: "https://evil.example" }).ok).toBe(true);
  });

  it("behind a proxy the forwarded host is honoured; NEXTAUTH_URL and ALLOWED_ORIGINS are allowed", () => {
    expect(check({ host: "10.0.0.5:3000", forwardedHost: "impactbridge.example" }).ok).toBe(true);
    expect(check({ host: "10.0.0.5:3000", origin: "https://app.impactbridge.example", env: { NEXTAUTH_URL: "https://app.impactbridge.example" } }).ok).toBe(true);
    expect(check({ origin: "https://partner.example", env: { ALLOWED_ORIGINS: "https://partner.example, https://other.example" } }).ok).toBe(true);
  });
});
