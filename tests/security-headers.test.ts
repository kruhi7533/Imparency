import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Security headers (next.config.mjs). Pins two facts that each broke something
 * real: the field app needs geolocation on our own origin (geolocation=()
 * silently recorded every capture as NO_GPS_DATA), and the enforced CSP must
 * stay the subset that cannot break a working page.
 */
const cfg = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");

describe("security headers", () => {
  it("allows geolocation and camera for our own origin only", () => {
    expect(cfg).toMatch(/geolocation=\(self\)/);
    expect(cfg).toMatch(/camera=\(self\)/);
    expect(cfg).not.toMatch(/geolocation=\(\)/);
  });

  it("enforces a CSP, and only the directives that cannot break pages", () => {
    const enforced = cfg.match(/const CSP_ENFORCED = \[([^\]]+)\]/)?.[1] ?? "";
    expect(enforced).toContain("object-src 'none'");
    expect(enforced).toContain("frame-ancestors 'none'");
    expect(enforced).not.toContain("form-action");
    expect(enforced).not.toContain("script-src");
    expect(cfg).toMatch(/key: "Content-Security-Policy", value: CSP_ENFORCED/);
  });

  it("keeps HSTS, frame denial and nosniff", () => {
    for (const h of ["Strict-Transport-Security", "X-Frame-Options", "X-Content-Type-Options"]) expect(cfg).toContain(h);
  });
});
