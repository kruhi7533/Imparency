import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }));

import { ctasFor } from "@/components/home/HeroCtas";

/**
 * The homepage hero used to offer every visitor "Register your NGO" and nothing
 * for donors — a logged-in donor was invited to register an NGO.
 */

const labels = (role: string | null) => ctasFor(role).map((c) => c.label);

describe("homepage hero CTAs", () => {
  it("visitors see both sides of the platform", () => {
    expect(labels(null)).toEqual(["Browse campaigns", "Become a donor", "Register your NGO"]);
  });

  it("a signed-in donor is never asked to register an NGO", () => {
    expect(labels("DONOR")).not.toContain("Register your NGO");
    expect(ctasFor("DONOR").map((c) => c.href)).toContain("/donor/dashboard");
  });

  it("an NGO goes to its dashboard, not to registration", () => {
    expect(labels("NGO")).not.toContain("Register your NGO");
    expect(ctasFor("NGO")[0].href).toBe("/ngo/dashboard");
  });

  it("exactly one primary button per role", () => {
    for (const role of [null, "DONOR", "NGO", "ADMIN"]) {
      expect(ctasFor(role).filter((c) => c.primary)).toHaveLength(1);
    }
  });

  it("the homepage uses the role-aware component, and login honours ?mode=signup&role=", () => {
    expect(readFileSync(join(process.cwd(), "app/page.tsx"), "utf8")).toMatch(/<HeroCtas \/>/);
    const login = readFileSync(join(process.cwd(), "app/login/page.tsx"), "utf8");
    expect(login).toMatch(/searchParams\.get\("mode"\) === "signup"/);
    expect(login).toMatch(/searchParams\.get\("role"\) === "NGO"/);
  });
});
