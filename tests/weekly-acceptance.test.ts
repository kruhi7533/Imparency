import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Weekly acceptance regression guard.
 *
 * The pilot plan demos one integrated journey per Friday, and every later week
 * builds on the earlier ones: Week 11's pilot fixes run over Week 3's
 * marketplace, Week 5's proposals and Week 6's money. The failure this file
 * exists to catch is a later change quietly removing, renaming or disabling
 * something an earlier week's demo depends on — a route deleted in a cleanup,
 * a handler renamed from PATCH to PUT, a page moved, or a safety test switched
 * to `.skip` "for now".
 *
 * It is deliberately static (no imports of route modules): `tsc --noEmit`
 * already proves every module compiles and resolves its imports, and the
 * behavioural tests named below prove what each surface does. This file
 * proves the surfaces are still THERE and the behavioural tests still RUN.
 *
 * Changing this manifest is allowed — features do move — but it should be a
 * deliberate, reviewed edit in the same PR that moves the feature, never a
 * side effect. See docs/ACCEPTANCE-MATRIX.md for the week-by-week mapping.
 */

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface WeekContract {
  week: number;
  /** The plan's Friday proof, verbatim in substance. */
  demo: string;
  /** API routes (under app/api) and the HTTP handlers each must export. */
  routes: Record<string, Method[]>;
  /** Pages (under app) the demo is clicked through. */
  pages: string[];
  /** Behavioural tests that pin the demo. Must exist and must not be skipped. */
  tests: string[];
}

export const ACCEPTANCE: WeekContract[] = [
  {
    week: 1,
    demo: "All three portals log in and persist a real record (NGO project, CSR opportunity, admin record); unauthorised users are blocked.",
    routes: {
      "auth/signup": ["POST"],
      "ngo/projects": ["GET", "POST"],
      "ngo/projects/[id]": ["PATCH"],
      requirements: ["GET", "POST"],
    },
    pages: ["admin/today", "ngo/dashboard", "donor/dashboard"],
    tests: ["tenant-isolation.test.ts", "login-rate-limit.test.ts"],
  },
  {
    week: 2,
    demo: "NGO/CSR submits → admin verifies → portal status changes automatically; tenant isolation holds.",
    routes: {
      "ngo/register": ["POST"],
      "admin/verify-ngo": ["POST"],
      "admin/donors/[id]/org-review": ["POST"],
      "documents/[...path]": ["GET"],
    },
    pages: ["ngo/register", "ngo/settings/team", "admin/verification", "admin/donors"],
    tests: [
      "admin-verify-ngo.test.ts",
      "admin-org-review.test.ts",
      "csr-verification.test.ts",
      "verification-triage.test.ts",
      "week2-enhancements.test.ts",
      "document-access.test.ts",
    ],
  },
  {
    week: 3,
    demo: "A verified NGO initiative and a CSR opportunity/RFP both exist, versioned, and are submitted for matching.",
    routes: {
      opportunities: ["GET"],
      "opportunities/[id]": ["GET"],
      "requirements/upload": ["POST"],
      "requirements/[id]/versions": ["GET"],
      "requirements/[id]/file": ["GET"],
      "requirements/[id]/admin-approve": ["POST"],
    },
    pages: ["admin/opportunities", "admin/requirements", "donor/requirements", "ngo/opportunities"],
    tests: [
      "opportunities.test.ts",
      "requirements-upload.test.ts",
      "requirement-routes.test.ts",
      "requirement-status.test.ts",
      "requirement-form.test.ts",
      "versioning.test.ts",
      "private-storage.test.ts",
    ],
  },
  {
    week: 4,
    demo: "RFP → extracted requirements (human-correctable) → deterministic eligibility → ranked shortlist → human review; NGO sees it in the Match Inbox.",
    routes: {
      "admin/matching/jobs": ["POST"],
      "admin/matching/jobs/[jobId]/requeue": ["POST"],
      "admin/matching/candidates/[candidateId]/decision": ["POST"],
      "requirements/[id]/matches": ["GET", "POST"],
      "opportunities/[id]/interest": ["POST"],
      "ngo/matches/[id]/decline": ["POST"],
    },
    pages: ["ngo/match-inbox"],
    tests: [
      "matching-eligibility.test.ts",
      "matching-engine.test.ts",
      "matching-job-runner.test.ts",
      "admin-matching-jobs.test.ts",
      "admin-matching-decision.test.ts",
      "requirements-agent.test.ts",
      "extraction-guardrails.test.ts",
    ],
  },
  {
    week: 5,
    demo: "Proposal v1 → donor change request → NGO v2 → approval, with the approval gate unbypassable and audited.",
    routes: {
      proposals: ["POST"],
      "proposals/[id]": ["GET", "PUT"],
      "ngo/proposals": ["POST"],
      "admin/proposals/[id]": ["PATCH"],
      "requirements/[id]/responses/[responseId]/request-changes": ["POST"],
      "requirements/[id]/responses/[responseId]/versions": ["GET"],
      "requirements/[id]/select": ["POST"],
    },
    pages: ["admin/proposals", "admin/audit"],
    tests: [
      "ngo-proposal-workflow.test.ts",
      "ngo-proposal-submit.test.ts",
      "admin-proposal-lifecycle.test.ts",
      "response-change-requests.test.ts",
      "response-versioning.test.ts",
      "action-guard-prototype.test.ts",
      "admin-audit-coverage.test.ts",
    ],
  },
  {
    week: 6,
    demo: "Funding commitment → payment → reconciliation → milestone allocation → project FUNDED; replayed payments never double-apply.",
    routes: {
      "admin/allocations": ["POST"],
      "admin/allocations/[id]": ["PATCH"],
      "admin/allocations/[id]/payments": ["POST"],
      "admin/finance/reconcile": ["POST"],
      "admin/finance/exceptions/[id]": ["PATCH"],
      "donations/webhook": ["POST"],
      contracts: ["GET", "POST"],
      "contracts/[id]/accept": ["POST"],
      "contracts/[id]/payments": ["GET", "POST"],
      "contracts/[id]/payments/[paymentId]": ["PATCH"],
    },
    pages: ["admin/allocations", "admin/finance", "donor/contracts", "donor/contracts/[id]", "ngo/projects/[id]"],
    tests: [
      "ledger.test.ts",
      "reconciliation.test.ts",
      "allocation-rules.test.ts",
      "allocation-funding.test.ts",
      "admin-allocation-routes.test.ts",
      "contract-payments.test.ts",
      "donations-webhook.test.ts",
      "webhook-dedupe-key.test.ts",
      "finance-exceptions.test.ts",
    ],
  },
  {
    week: 7,
    demo: "Money → field activity → evidence → human verification → donor visibility, with consent (and its withdrawal) respected and duplicates flagged.",
    routes: {
      "ngo/field-tasks": ["GET", "POST"],
      "field/evidence": ["POST"],
      "field/evidence/[id]/photo": ["GET"],
      "field/feedback/[id]/withdraw": ["POST"],
      "admin/field-evidence/[id]": ["PATCH"],
      "ngo/submit-proof": ["POST"],
      "admin/review-proof": ["POST"],
      grievances: ["POST"],
      "admin/grievances/[id]": ["PATCH"],
      "donor/notification-preferences": ["GET", "PATCH"],
    },
    pages: ["ngo/field", "admin/field-evidence", "admin/proof-review", "admin/grievances", "donor/funded/[projectId]"],
    tests: [
      "field-evidence.test.ts",
      "consent-withdrawal.test.ts",
      "donor-funded-view.test.ts",
      "donor-update-optout.test.ts",
      "evidence-duplicates.test.ts",
      "proof-fingerprint.test.ts",
      "proof-duplicate-detection.test.ts",
      "proof-location.test.ts",
      "admin-review-proof.test.ts",
      "grievance-workflow.test.ts",
      "grievance-routes.test.ts",
    ],
  },
];

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** HTTP handlers a route module exports, by name. */
function exportedMethods(source: string): Set<string> {
  const found = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
    /export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
  ];
  for (const re of patterns) Array.from(source.matchAll(re)).forEach((m) => found.add(m[1]));
  // `export { handler as GET, handler as POST }`
  Array.from(source.matchAll(/export\s*\{([^}]*)\}/g)).forEach((m) => {
    Array.from(m[1].matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\b/g)).forEach((n) => found.add(n[1]));
  });
  return found;
}

describe("weekly acceptance manifest is well-formed", () => {
  it("covers every week from 1 up to the current one, in order", () => {
    expect(ACCEPTANCE.map((w) => w.week)).toEqual(ACCEPTANCE.map((_, i) => i + 1));
  });
});

for (const week of ACCEPTANCE) {
  describe(`Week ${week.week} — ${week.demo}`, () => {
    for (const [route, methods] of Object.entries(week.routes)) {
      it(`route /api/${route} exports ${methods.join(", ")}`, () => {
        const file = `app/api/${route}/route.ts`;
        expect(existsSync(join(ROOT, file)), `${file} is missing`).toBe(true);
        const exported = exportedMethods(read(file));
        for (const m of methods) expect(exported.has(m), `${file} no longer exports ${m}`).toBe(true);
      });
    }

    for (const page of week.pages) {
      it(`page /${page} exists`, () => {
        expect(existsSync(join(ROOT, `app/${page}/page.tsx`)), `app/${page}/page.tsx is missing`).toBe(true);
      });
    }

    for (const test of week.tests) {
      it(`behavioural test ${test} exists and is not skipped`, () => {
        const file = `tests/${test}`;
        expect(existsSync(join(ROOT, file)), `${file} is missing`).toBe(true);
        const src = read(file);
        // `.only` silently skips every other test in the file; `.skip`/`.todo`
        // disable the guard outright. Either turns a pinned demo into a no-op.
        expect(src, `${file} contains a skipped or focused test`).not.toMatch(
          /\b(?:describe|it|test)\.(?:skip|only|todo)\b|\bx(?:it|describe)\(/,
        );
      });
    }
  });
}
