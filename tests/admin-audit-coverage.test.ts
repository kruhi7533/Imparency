import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";

/**
 * What this test protects.
 *
 * Two console-wide invariants that no per-route test can hold, because the way
 * they break is by someone adding a *new* route that forgets them:
 *
 *   NFR-1  every admin route proves the caller is an admin
 *   NFR-2  every admin route that changes state, spends money on a model, or
 *          moves data out of the platform leaves a record of who did it
 *
 * Both were measured by hand into docs/ADMIN-SYSTEM-DESIGN.md, and both were
 * true only on the day they were counted. A number in a document rots; this
 * runs in CI.
 *
 * The design that makes this test honest is the EXEMPT list. A route escapes
 * the audit requirement only by being named there with a reason — so "this
 * route needs no audit log" becomes a reviewed claim visible in the diff rather
 * than an omission nobody sees. Adding a route to EXEMPT is a decision a
 * reviewer can argue with. Forgetting logAdminAction is not.
 */

const ADMIN_API = path.resolve(__dirname, "../app/api/admin");
const REPO_ROOT = path.resolve(__dirname, "..");

/** Every route.ts under app/api/admin, as a path relative to that directory. */
function findRoutes(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...findRoutes(path.join(dir, entry.name), rel));
    else if (entry.name === "route.ts") out.push(prefix);
  }
  return out;
}

/**
 * Routes that legitimately write no audit log, each with the reason it does
 * not. The reason is required: if you cannot write one, the route probably
 * needs the log.
 */
const EXEMPT: Record<string, string> = {
  diagnostics:
    "Read-only. Returns live connection and retry counters, and touches no record.",
  initiatives:
    "Read-only list. The detail route is the one that discloses bank details, and it logs.",
  threads:
    "Read-only list of review threads. Replying and resolving are separate routes, and both log.",
  "today/visit":
    "Writes AdminInboxVisit, but that is the admin's own marker for when they last looked at " +
    "Today — per-admin UI bookkeeping, not a platform state change. Logging every page view " +
    "would bury real actions in noise, which is the one reliable way to make a trail useless.",
};

/**
 * Routes whose audit log is written by a shared library rather than by the
 * route file, so looking only at the route misses it. Each maps to the helper
 * that does the logging, so deleting the log from the helper breaks this test
 * too.
 *
 * Both of these were counted as gaps in the design document, which grepped
 * route files rather than following the call graph. They were never gaps.
 */
const LOGS_VIA_LIB: Record<string, string> = {
  "ngos/[id]/inquiry": "lib/inquiry-thread.ts",
  "matching/candidates/[candidateId]/notify": "lib/inquiry-thread.ts",
};

const routes = findRoutes(ADMIN_API);

const source = (route: string) =>
  readFileSync(path.join(ADMIN_API, route, "route.ts"), "utf8");

/** Drop import lines, so an identifier only counts where it is actually used. */
function bodyOf(code: string): string {
  return code
    .split(/\r?\n/)
    .filter((line) => !/^\s*import\b/.test(line))
    .join("\n");
}

const CALLS_LOG = /\blogAdminAction\s*\(/;

/**
 * Does this route actually *call* logAdminAction?
 *
 * Deliberately not a substring test for the name. The first version of this
 * file asked whether the source contained "logAdminAction" at all, and that
 * version kept passing when the call was deleted and the import left behind —
 * exactly the shape a careless refactor leaves. Verified by deleting a real
 * call and watching the old check stay green.
 */
function callsLogAdminAction(route: string): boolean {
  return CALLS_LOG.test(bodyOf(source(route)));
}

describe("every admin API route is discovered", () => {
  it("finds the routes at all, so a broken scan cannot pass vacuously", () => {
    // Guards the failure where findRoutes returns [] and everything below
    // trivially holds.
    expect(routes.length).toBeGreaterThan(40);
  });
});

describe("NFR-1 — authorisation", () => {
  it("every admin route calls verifySessionRole itself", () => {
    // The layout gate protects pages, not the API. A route trusting it is
    // reachable directly.
    const unguarded = routes.filter(
      (r) => !bodyOf(source(r)).includes("verifySessionRole")
    );
    expect(unguarded).toEqual([]);
  });
});

describe("NFR-2 — auditability", () => {
  it("every admin route either writes an audit log or is listed as exempt", () => {
    const missing = routes.filter(
      (r) => !callsLogAdminAction(r) && !(r in EXEMPT) && !(r in LOGS_VIA_LIB)
    );

    // Failing here on a route you just added means one of two things: call
    // logAdminAction, or add the route to EXEMPT with the reason it needs none.
    expect(missing).toEqual([]);
  });

  it("the routes that log through a shared helper really do reach a log", () => {
    for (const [route, lib] of Object.entries(LOGS_VIA_LIB)) {
      const libBody = bodyOf(readFileSync(path.join(REPO_ROOT, lib), "utf8"));
      expect(
        CALLS_LOG.test(libBody),
        `${lib} no longer calls logAdminAction, so ${route} no longer logs either`
      ).toBe(true);
    }
  });

  it("both export routes log, because an export moves data out of the platform", () => {
    // Called out by name: these are the actions an auditor asks about first,
    // and both are GETs, which is why they were missed to begin with.
    expect(bodyOf(source("audit/export"))).toContain("AUDIT_TRAIL_EXPORTED");
    expect(bodyOf(source("fcra-report/[id]/export"))).toContain("FCRA_REPORT_EXPORTED");
  });

  it("the only route that decrypts bank details logs the disclosure", () => {
    const detail = bodyOf(source("initiatives/[id]"));
    expect(detail).toContain("decryptBankAccountNumber");
    expect(detail).toContain("INITIATIVE_BANK_DETAILS_VIEWED");
  });
});

describe("the coverage check itself", () => {
  it("counts a call site, not a leftover import", () => {
    // Pins the bug this file shipped with first. If an import-only route ever
    // satisfies the check again, every assertion above is worthless.
    const importOnly = [
      'import { logAdminAction } from "@/lib/admin-log";',
      "export async function POST() {",
      "  return Response.json({});",
      "}",
    ].join("\n");

    expect(CALLS_LOG.test(bodyOf(importOnly))).toBe(false);
    expect(CALLS_LOG.test(bodyOf(`${importOnly}\nawait logAdminAction({});`))).toBe(true);
  });
});

describe("the exemption list stays honest", () => {
  it("names only routes that still exist", () => {
    // A stale exemption is a silent hole: the route it excused is gone, and the
    // entry sits ready to excuse a future route that lands on the same path.
    const stale = [...Object.keys(EXEMPT), ...Object.keys(LOGS_VIA_LIB)].filter(
      (r) => !routes.includes(r)
    );
    expect(stale).toEqual([]);
  });

  it("gives a real reason for every exemption", () => {
    for (const [route, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `${route} needs a real reason`).toBeGreaterThan(30);
    }
  });

  it("does not excuse a route that mutates the database", () => {
    // today/visit is the one deliberate exception, argued in EXEMPT above. It
    // is excluded by name so a future write-and-exempt route cannot quietly
    // shelter under the same allowance.
    const writes =
      /prisma\.[A-Za-z]+\.(create|update|upsert|delete|createMany|updateMany|deleteMany)/;
    const mutatingButExempt = Object.keys(EXEMPT).filter(
      (r) => writes.test(source(r)) && r !== "today/visit"
    );
    expect(mutatingButExempt).toEqual([]);
  });
});
