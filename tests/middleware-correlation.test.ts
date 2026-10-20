import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Correlation ids on every request (WEEK9 SPEC-1, commit b563515) were silently
 * reverted by a merge that took the older middleware.ts (db5ee0b), and every
 * test stayed green because nothing pinned the file's shape. These do.
 *
 * Behaviour was verified against the running app when this was restored:
 * cron without a secret → 401 (not a /login redirect), public API → 200,
 * protected page without a session → 307 to /login, all carrying
 * x-correlation-id, and an inbound traceparent is continued.
 */

const src = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");

describe("middleware.ts keeps correlation on every request", () => {
  it("matches the whole API surface for correlation", () => {
    expect(src).toMatch(/"\/api\/:path\*"/);
  });

  it("stamps both the request (for server code) and the response (for users quoting an id)", () => {
    expect(src).toMatch(/requestHeaders\.set\(CORRELATION_HEADER/);
    expect(src).toMatch(/res\.headers\.set\(CORRELATION_HEADER/);
    expect(src).toMatch(/deriveTraceContext\(req\.headers\.get\(TRACEPARENT_HEADER\)\)/);
  });

  it("hands only protected PAGES to withAuth — API routes are never auth-gated by middleware", () => {
    expect(src).toMatch(/if \(!isProtectedPage\(req\.nextUrl\.pathname\)\)/);
    const prefixes = src.match(/PROTECTED_PREFIXES = \[([^\]]+)\]/)?.[1] ?? "";
    expect(prefixes).not.toMatch(/\/api/);
    for (const p of ["/admin", "/donor", "/ngo/dashboard", "/ngo/projects"]) expect(prefixes).toContain(`"${p}"`);
  });

  it("keeps the role rules: admin pages, donor portal, shared contract screen", () => {
    expect(src).toMatch(/path\.startsWith\("\/admin"\) && token\?\.role !== "ADMIN"/);
    expect(src).toMatch(/path\.startsWith\("\/donor\/contracts\/"\)/);
    expect(src).toMatch(/path\.startsWith\("\/donor"\) && token\?\.role !== "DONOR"/);
  });
});
