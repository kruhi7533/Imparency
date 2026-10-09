# Weekly acceptance matrix — what each Friday demo depends on

**Purpose.** The pilot plan stacks one integrated journey per week. Week 11
(controlled pilot) runs real users over everything built in Weeks 1–10, so a
fix shipped in Week 11 must not quietly break the Week 3 marketplace or the
Week 6 money path. This matrix is the contract for that.

**Enforced by** `tests/weekly-acceptance.test.ts`, which runs in CI with
`npm test`. For each week it fails the build if:

- a pinned API route is deleted, or stops exporting a pinned HTTP handler
  (e.g. `PATCH` renamed to `PUT`);
- a pinned page is moved or deleted;
- a pinned behavioural test file is deleted, or contains `.skip` / `.only` /
  `.todo` / `xit` (`.only` silently disables every other test in the file).

It is static by design. `tsc --noEmit` proves the modules compile; the
behavioural tests prove what they do; this file proves they are still there
and still run. Moving a feature means editing the manifest in the same PR,
where a reviewer can see it.

**Adding a week.** Append a `WeekContract` to `ACCEPTANCE` when that week's
Friday demo passes. Name the routes, pages and the tests that pin the demo.
The manifest must stay contiguous (1, 2, 3, …).

| Week | Friday proof | Pinned behavioural tests |
|---|---|---|
| 1 | Three portals log in and persist real records; unauthorised users blocked | tenant-isolation, login-rate-limit |
| 2 | Submit → admin verifies → status changes; tenant isolation | admin-verify-ngo, admin-org-review, csr-verification, verification-triage, week2-enhancements, document-access |
| 3 | Verified initiative + versioned CSR opportunity ready for matching | opportunities, requirements-upload, requirement-routes, requirement-status, requirement-form, versioning, private-storage |
| 4 | RFP → extraction → eligibility → ranked shortlist → human review | matching-eligibility, matching-engine, matching-job-runner, admin-matching-jobs, admin-matching-decision, requirements-agent, extraction-guardrails |
| 5 | v1 → change request → v2 → gated, audited approval | ngo-proposal-workflow, ngo-proposal-submit, admin-proposal-lifecycle, response-change-requests, response-versioning, action-guard-prototype, admin-audit-coverage |
| 6 | Commitment → payment → reconciliation → allocation → FUNDED; idempotent | ledger, reconciliation, allocation-rules, allocation-funding, admin-allocation-routes, contract-payments, donations-webhook, webhook-dedupe-key, finance-exceptions |
| 7 | Money → field work → evidence → verification → donor visibility (consent, withdrawal, duplicates) | field-evidence, consent-withdrawal, donor-funded-view, donor-update-optout, evidence-duplicates, proof-fingerprint, proof-duplicate-detection, proof-location, admin-review-proof, grievance-workflow, grievance-routes |
| 8 | Approved evidence → governed outcome claim → gated approval → backed donor figure; a blocked claim cannot be approved and an unbacked one reads "unverified", never 0 | metric-registry, outcome-workflow, outcome-claim-routes, outcome-triage, impact-quality |

**What this does not cover (yet).** It cannot catch a regression that keeps
every route and test in place but breaks behaviour that no test asserts. That
is what the Week 9 Playwright E2E suite (≥8 NGO + ≥8 donor journeys) is for;
when it lands, each week's E2E spec should be added to its row here.
