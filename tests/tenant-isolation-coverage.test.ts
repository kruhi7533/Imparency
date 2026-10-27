import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";

/**
 * ADM-019 / NEG-001 / NEG-002 — tenant isolation as a TESTED boundary.
 *
 * The tenant is the organisation (lib/tenant-scope.ts). Every route under the
 * org-owned API trees is enumerated here, and each one must:
 *   1. authenticate in EVERY exported handler (or be named in PUBLIC), and
 *   2. scope to the caller's organisation through a recognised ownership
 *      mechanism — or be named in SELF_SCOPED / PUBLIC with the reason it
 *      needs none.
 * A new route that does neither fails CI. Like tests/admin-audit-coverage,
 * the lists are the design: escaping the check is a reviewed line in a diff.
 *
 * "Recognised mechanism" means a call to a shared ownership helper, or an
 * explicit parent-id comparison — never just "the caller has role NGO",
 * which proves nothing about the row (CLAUDE.md, "Role is not ownership").
 */

const API = path.resolve(__dirname, "../app/api");
const TREES = ["ngo", "field", "contracts", "proposals", "donor", "requirements", "team-invites"];

function findRoutes(dir: string, prefix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...findRoutes(path.join(dir, entry.name), rel));
    else if (entry.name === "route.ts") out.push(prefix);
  }
  return out;
}

const routes = TREES.flatMap((t) => findRoutes(path.join(API, t), t)).sort();
const source = (r: string) => readFileSync(path.join(API, r, "route.ts"), "utf8");
/** Drop imports and comments so a name only counts where it is used. */
const body = (r: string) =>
  source(r)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*import\b/.test(l) && !/^\s*\/\//.test(l))
    .join("\n");

/** Shared helpers and explicit comparisons that scope a query to the caller's organisation. */
const OWNERSHIP_MECHANISMS: RegExp[] = [
  /\brequireNgoMembership\s*\(/, // lib/tenant-scope.ts — the central NGO helper
  /\bgetNgoMembership\s*\(/,
  /\bresolveNgoActor\s*\(/, // lib/field-evidence.ts
  /\bresolveContractParty\s*\(/, // lib/contract-payments.ts
  /\b(donorActsFor|checkDonorAction|resolveDonorAccount)\s*\(/, // lib/donor-team.ts
  /\b(requireActor|getActor)\s*\(/, // lib/requirements/access.ts (+ loadRequirementForActor / workflowRole inside)
  /\bcanViewEvidencePhoto\s*\(/, // lib/evidence-access.ts
  /\b(loadReconciliationView|importBankStatement|rematchForUser)\s*\(/, // lib/bank-statement.ts finance actor
  /\b(listTeam|inviteTeamMember|changeTeamRole|removeTeamMember|cancelInvite)\s*\(/, // lib/donor-team-admin.ts
  /\b(acceptInvite|lookupInvite)\s*\(/, // lib/ngo-team-invites.ts — the hashed token IS the scope
  /\.ngoId\s*!==/, // explicit parent-org comparison
  /\bngo\.userId\s*!==/,
  /nGOProfile\.find(Unique|First)\(\{\s*where:\s*\{\s*userId\b/, // owner-only: the caller's own profile
];

/**
 * Routes whose data is the CALLER'S OWN (keyed on session.user.id), so no
 * organisation boundary applies. The regex proves the self-key is still there.
 */
const SELF_SCOPED: Record<string, { reason: string; proof: RegExp }> = {
  "donor/donations": { reason: "A donor's own donations (personal, not the org's).", proof: /donorId:\s*session\.user\.id/ },
  "donor/donations/summary": { reason: "Totals of the caller's own donations.", proof: /donorId:\s*session\.user\.id/ },
  "donor/impact-subscriptions": { reason: "The caller's own update subscriptions.", proof: /donorId:\s*auth\.session\.user\.id/ },
  "donor/notification-preferences": { reason: "The caller's own preferences.", proof: /session\.user\.id/ },
  "donor/notification-deliveries": { reason: "Deliveries addressed to the caller.", proof: /userId:\s*session\.user\.id/ },
  "donor/persona": { reason: "The caller's own persona flag.", proof: /id:\s*session\.user\.id/ },
  "donor/profile": { reason: "The caller's own profile.", proof: /id:\s*session\.user\.id/ },
  "donor/receipts/claim": { reason: "Receipts for the caller's own donations.", proof: /const donorId = auth\.session\.user\.id/ },
  "donor/update-feedback": { reason: "The caller's feedback; donorFollowsOrFunds gates the project.", proof: /donorFollowsOrFunds\s*\(/ },
  "ngo/[id]/follow": { reason: "The caller's own follow row on a public NGO.", proof: /const donorId = session\.user\.id/ },
  "ngo/[id]/inquiry": { reason: "The caller's own inquiry thread with a public NGO (keyed ngoId_donorId).", proof: /const donorId = session\.user\.id/ },
  "ngo/user-follows": { reason: "The caller's own follows.", proof: /donorId:\s*session\.user\.id/ },
  "ngo/register/draft": { reason: "The caller's own registration draft.", proof: /userId:\s*session\.user\.id/ },
};

/** No session required — with the reason it is safe. */
const PUBLIC: Record<string, string> = {
  "ngo/discover": "Public directory of VERIFIED NGOs with an explicit select (no risk, notes, PAN or bank data).",
  "ngo/[id]/fcra-status": "Public FCRA status/expiry only (explicit select).",
  "donor/persona/check": "Reads only the caller's session flag; anonymous gets personaSet=false.",
  "team-invites/lookup": "Scoped by the hashed one-time token; unknown tokens reveal nothing.",
  "team-invites/accept": "Scoped by the hashed one-time token; an existing account must also be signed in as the invitee.",
};

const AUTH = /\b(verifySessionRole|getServerSession|requireActor|getActor)\s*\(/;
const HANDLER = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;

function handlers(r: string): { method: string; text: string }[] {
  const src = body(r);
  const starts = Array.from(src.matchAll(HANDLER)).map((m) => ({ method: m[1], at: m.index! }));
  return starts.map((s, i) => ({ method: s.method, text: src.slice(s.at, starts[i + 1]?.at ?? src.length) }));
}

/** A handler may authenticate via a file-local helper (e.g. `resolveNgoId(session)` after verifySessionRole elsewhere). */
function handlerAuthenticates(r: string, text: string): boolean {
  if (AUTH.test(text)) return true;
  // Calls a local function that authenticates.
  const src = body(r);
  const locals = Array.from(src.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(/g))
    .map((m) => m[1])
    .filter((n) => !/^(GET|POST|PUT|PATCH|DELETE)$/.test(n));
  return locals.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(text) && AUTH.test(src.slice(src.indexOf(`function ${n}`))));
}

describe("tenant isolation coverage — route discovery", () => {
  it("finds the org-owned routes at all, so a broken scan cannot pass vacuously", () => {
    expect(routes.length).toBeGreaterThan(70);
    for (const known of ["ngo/field-tasks", "contracts/[id]/payments", "requirements/[id]", "donor/team", "proposals/[id]", "ngo/team/invites"]) {
      expect(routes).toContain(known);
    }
  });

  it("every list entry names a route that still exists (no stale exemptions)", () => {
    for (const r of [...Object.keys(SELF_SCOPED), ...Object.keys(PUBLIC)]) expect(routes, r).toContain(r);
  });
});

describe("tenant isolation coverage — every handler authenticates", () => {
  it("each exported handler of a non-public route checks the session", () => {
    const missing: string[] = [];
    for (const r of routes) {
      if (r in PUBLIC) continue;
      for (const h of handlers(r)) if (!handlerAuthenticates(r, h.text)) missing.push(`${h.method} ${r}`);
    }
    expect(missing).toEqual([]);
  });
});

describe("tenant isolation coverage — every route is scoped to the caller's organisation", () => {
  it("uses a recognised ownership mechanism, or is listed as self-scoped / public with a reason", () => {
    const unscoped = routes.filter((r) => {
      if (r in PUBLIC) return false;
      if (r in SELF_SCOPED) return false;
      const b = body(r);
      return !OWNERSHIP_MECHANISMS.some((re) => re.test(b));
    });
    // Failing here on a route you just added: scope it with requireNgoMembership
    // (lib/tenant-scope.ts) or the donor/requirements helpers, or — if it truly
    // serves only the caller's own data or is public — add it to SELF_SCOPED /
    // PUBLIC above with the reason.
    expect(unscoped).toEqual([]);
  });

  it("self-scoped routes still key on the caller (the listed proof is present)", () => {
    for (const [r, { proof }] of Object.entries(SELF_SCOPED)) expect(proof.test(body(r)), r).toBe(true);
  });

  it("no route trusts the JWT's ngoProfileId for org scope (it outlives a removed member)", () => {
    const trusting = routes.filter((r) => /session\.user(\s+as\s+any\))?\.ngoProfileId/.test(body(r)) || /\(session\.user as any\)\.ngoProfileId/.test(body(r)));
    expect(trusting).toEqual([]);
  });
});

describe("tenant isolation coverage — the detector itself", () => {
  it("does NOT accept a route that only checks the platform role (the IDOR shape)", () => {
    const idor = `const { authorized, session } = await verifySessionRole("NGO");
      const project = await prisma.project.findUnique({ where: { id: params.id } });
      await prisma.project.update({ where: { id: params.id }, data });`;
    expect(OWNERSHIP_MECHANISMS.some((re) => re.test(idor))).toBe(false);
  });
  it("accepts the reference ownership shape from CLAUDE.md", () => {
    expect(OWNERSHIP_MECHANISMS.some((re) => re.test("if (project.ngoId !== profile.id) return 403;"))).toBe(true);
    expect(OWNERSHIP_MECHANISMS.some((re) => re.test("const scope = await requireNgoMembership(session, ngoId, 'finance');"))).toBe(true);
  });
});
