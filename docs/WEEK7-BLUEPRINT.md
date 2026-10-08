# Week 7 blueprint — "Money → work → evidence"

**Dates:** Oct 5–9 2026. **Plan deliverables:** evidence/risk queue ·
provenance/duplicate checks · grievance triage.

Week 6 closed on `1e7b614` (ledger, reconciliation, finance exceptions,
allocation approval + funding confirmation). This week has to make the sentence
"money went somewhere, work happened, here is the evidence" true end to end —
and today it is not, for a reason that is structural rather than cosmetic.

---

## 1. Where the week actually stands (code-grounded, 2026-10-05)

### Evidence queue — BUILT, with two real defects

`/admin/proof-review` (`page.tsx` 113 lines + `ProofReviewClient.tsx` 944)
lists every milestone in `PROOF_SUBMITTED`, shows the Gemini validation result
and Theory-of-Change alignment, and writes a `MilestoneReview` row per
decision. `app/api/ngo/submit-proof/route.ts` always parks the milestone in
`PROOF_SUBMITTED` regardless of AI score — the score is advisory, never the
decision, which is the right call and must stay that way. The queue also
surfaces in `/admin/today` as "Proof Review" via `lib/today-sources.ts` and
carries an SLA target from `lib/sla.ts`.

Defects:

- **D-1 (perf, real):** `app/admin/proof-review/page.tsx:34` loads
  `prisma.milestoneReview.findMany()` with **no `take` and no date window** —
  the full decision history, every page load, with four levels of `include`.
  The Today page learned this lesson already (project completions are windowed
  to 30 days because `Project` has no `completedAt`). Same fix shape here.
- **D-2 (structural, the week's headline):** evidence is attached to
  `Milestone → Project`. Money is attached to `Allocation → Proposal →
  FundingOpportunity`. **Nothing joins the two.** `Proposal.milestones` is an
  unstructured `Json` column and `Allocation` has no `projectId`. So an
  approved, funded, confirmed-paid allocation produces no milestone, no
  evidence obligation, and no queue item. "Funded project exists" is still only
  half true, exactly as the Week 6 note said.

### Provenance — HALF BUILT

GPS provenance is done and done well: `lib/proof-location.ts` (haversine +
`classifyProofLocation`, 50 km threshold with its rationale written down),
`MilestoneProof.proofLatitude/proofLongitude/gpsSource`, and a `MISMATCH`
raises a HIGH `PROOF_LOCATION_MISMATCH` fraud alert from the submit route.
`NO_GPS_DATA` deliberately raises nothing — same principle as "a missing 12A is
not a defect."

**Duplicate checking does not exist.** There is no content hash anywhere on
`MilestoneProof`; `grep` for `sha256|phash|perceptual` over `lib/` and
`app/api/` returns only the PAN/identity dedupe in `lib/fraud-alerts.ts` and
`lib/extraction-runner.ts`. Today the same photograph can be submitted against
three milestones, two projects, or two different NGOs and the platform will
score each one independently and notice nothing. For a transparency product
this is the single most embarrassing missing check.

### Grievance triage — ZERO CODE

No model, no enum, no route, no page. `grep -ril "grievance|complaint"` over
`app/ lib/ prisma/ docs/` hits exactly one file: `app/privacy-policy/page.tsx`,
which **promises a grievance officer and a redress channel that does not
exist**. That makes this a stated-policy gap, not just an unbuilt feature.

### Carryover worth folding in

- Finance exceptions still do not appear in `/admin/today` (`grep
  FinanceException lib/today-sources.ts` → nothing). One queue, ~20 lines.
- Donation/payment routes still have no rate limiting.

---

## 2. The shape of the week

Four specs, ordered by dependency. SPEC-1 and SPEC-2 are independent and can
start immediately; SPEC-3 is the structural one and should be started early
because everything demo-related hangs off it; SPEC-4 is self-contained and can
slip to Thursday without hurting the others.

| Spec | Closes | Size | Depends on |
|---|---|---|---|
| SPEC-1 — proof fingerprinting + duplicate detection | provenance gap | M | — |
| SPEC-2 — evidence queue hardening | D-1, finance-exception queue | S | — |
| SPEC-3 — bind committed money to the work it funds | D-2 | L | — |
| SPEC-4 — grievance intake and triage | grievance deliverable | L | — |

---

## SPEC-1 — Proof fingerprinting and duplicate detection

**The claim to make true:** a photograph already used as evidence cannot be
reused as new evidence without a human being told.

Schema (`MilestoneProof`, additive migration by hand per CLAUDE.md):

```prisma
/// SHA-256 of each uploaded file, positionally aligned with mediaUrls ++
/// documentUrls. Stored as an array rather than a child table because a proof
/// is never queried "which proof contains this hash" from the UI — only the
/// reverse — and the duplicate sweep is a single `has` query on a GIN index.
contentHashes String[]
```

Pipeline, in `app/api/ngo/submit-proof/route.ts` where every other submission
side effect already lives:

1. Hash each buffer with `node:crypto` `createHash("sha256")` as it is read —
   the buffers are already in memory for the AI call, so this costs nothing
   extra and adds no dependency.
2. After the `milestoneProof.create`, look for prior proofs sharing any hash.
   Three verdicts, three different meanings, and **they must not collapse into
   one alert**:
   - **same milestone** — a resubmission. Not suspicious. No alert.
   - **different milestone, same project** — MEDIUM. Could be a legitimately
     reused site photo; a human decides.
   - **different project, or a different NGO entirely** — HIGH
     `PROOF_DUPLICATE_MEDIA`, with the prior proof's id and milestone title in
     the description so the admin can open both.
3. Reuse `createFraudAlert`, which already dedupes on
   `(type, entityId, description, resolved:false)` — the description is
   load-bearing there, so include the colliding proof id in it.

Separation of concerns follows `lib/proof-location.ts` exactly: put the pure
classification in **`lib/proof-fingerprint.ts`** (`hashBuffer`,
`classifyDuplicate(matches, context) → "RESUBMISSION" | "REUSED_IN_PROJECT" |
"CROSS_PROJECT" | "NONE"`) so the decision table is testable with plain
objects, and leave the file I/O and the alert write in the route.

Backfill: `tools/backfill-proof-hashes.ts` (dry-run by default, `--apply` to
write — `scripts/` is gitignored, so anything that writes goes in `tools/`).
Existing proofs have no hashes, and without a backfill the first new submission
can only collide with other new submissions.

**Exact vs perceptual hashing:** start with exact SHA-256. It is deterministic,
dependency-free, trivially testable, and catches the actual observed
behaviour — the same file re-uploaded. A perceptual hash (pHash/dHash) would
also catch a re-crop or a re-compress, but it needs a library, a similarity
threshold, and a false-positive story for the many near-identical photos a real
field visit produces. Exact first; leave `contentHashes` as the seam and
revisit with real submission data, the same way the 50 km GPS threshold is
documented as revisitable.

---

## SPEC-2 — Evidence queue hardening

1. **Window the audit trail.** `app/admin/proof-review/page.tsx`: add
   `take: 100` plus a 90-day `reviewedAt` window, and say so in the UI
   ("last 100 decisions") rather than silently truncating. The full history is
   already reachable through `/admin/audit`.
2. **Finance exceptions into Today.** Add the `FinanceException` query to
   `lib/today-sources.ts` and a "Finance Exceptions" queue to
   `lib/today-inbox.ts` with an SLA target in `lib/sla.ts`. Category is
   "Waiting on you" — an unmatched payment is nobody else's move. Closes a
   Week 6 carryover for ~20 lines.
3. **Show provenance in the queue.** `ProofReviewClient.tsx` already calls
   `classifyProofLocation`; add the duplicate verdict from SPEC-1 next to it so
   a reviewer sees both provenance signals in one place. `NO_GPS_DATA` must
   render as "no location data" in neutral grey, never as a warning — absence
   of evidence is not evidence of a problem, the same rule the NGO verification
   module runs on.

---

## SPEC-3 — Bind committed money to the work it funds

**The claim to make true:** an approved allocation creates a work plan, and
that plan creates the evidence obligation the admin reviews.

This is the week's theme and the only one of the four specs that cannot be
faked in a demo. Two ways to do it:

**Option A — link the allocation to an existing project.** Add
`projectId String?` to `Allocation`, set at approval time from a project the
NGO already owns, and let the existing `Milestone`/`MilestoneProof` machinery
carry the evidence. Smallest change, reuses everything, and the whole proof
queue immediately gains "this evidence is against ₹X of committed money."
Risk: the project model was built for public campaigns (`raisedAmount`,
followers, donations) and an allocation-funded project has no donations — the
reconciler's two planes problem again, so the ledger scoping in
`CASH_ENTRY_TYPES` must be left strictly alone.

**Option B — a first-class `FundedEngagement` with its own deliverables.**
Models the real thing: a grant with structured deliverables, due dates, and
evidence per deliverable, independent of the public-campaign project. Correct
long-term, and it is where `Proposal.milestones`-as-Json is obviously heading.
But it is a new model, a new queue, a new review surface and a new state
machine — a week of work on its own, not a third of one.

**Recommendation: Option A this week.** It makes the week demonstrable, and
Week 8 ("Evidence → outcome → impact", Metric Registry) is the natural place
for structured deliverables — at which point Option B becomes an extraction
from something that works, rather than a speculative model.

Either way, the rule from Week 6 holds: **a new `LedgerEntryType` belongs in
`CASH_ENTRY_TYPES` only if money genuinely moved.** Linking a project to an
allocation must not add a cash entry.

---

## SPEC-4 — Grievance intake and triage

**The claim to make true:** someone affected by a funded project can report a
problem, and that report lands in a queue with a response target and an
auditable outcome.

```prisma
enum GrievanceCategory { FUND_MISUSE SERVICE_FAILURE SAFEGUARDING DATA_PRIVACY OTHER }
enum GrievanceStatus   { OPEN TRIAGED INVESTIGATING RESOLVED DISMISSED }
enum GrievanceSeverity { LOW MEDIUM HIGH CRITICAL }
```

Non-negotiables, each for a reason:

- **Signed-in filing only** (decided 2026-10-05). `reporterUserId` is
  NOT NULL and the intake route calls the session guard; `lib/rate-limiter.ts`
  is still wired in, because an authenticated abuse loop is still an abuse
  loop. **Stated consequence:** the platform has no beneficiary accounts, so
  this channel serves donors and NGO staff, not the people a funded project
  actually touches — a beneficiary reporting fund misuse by the organisation
  that feeds them cannot use it. Anonymous intake is the natural companion to
  the beneficiary-scoped consent work that is already a P0 and also unbuilt;
  the column stays NOT NULL rather than nullable-but-unused so that whoever
  opens anonymous filing has to make the decision deliberately, with a
  migration.
- **Severity is a human's call, not the reporter's.** The reporter picks a
  category; an admin sets severity at triage. A self-selected CRITICAL field
  would be CRITICAL on every row within a week.
- **`DISMISSED` requires a note**, like a proposal rejection and an allocation
  rejection. A complaint closed with no reason given is indistinguishable from
  one that was never read.
- **A grievance against an NGO must never be visible to that NGO's users.**
  This is the tenancy trap inverted: the usual bug is forgetting an ownership
  check; here an ownership check would be the bug. Admin-only read, and a test
  that asserts an NGO session gets 403.
- **No PII in the audit log.** `logAdminAction` takes ids only — the grievance
  body is the most sensitive free text in the product and must not be
  snapshotted into a log that outlives PII retention.
- `SAFEGUARDING` and `CRITICAL` get the tightest SLA target in `lib/sla.ts`,
  and the page must say — as `/admin/sla` already does — that nothing
  escalates automatically, because it does not.

Surfaces: `POST /api/grievances` (session required, rate-limited),
`/admin/grievances` list + `[id]` detail with triage/resolve actions,
`PATCH /api/admin/grievances/[id]` (compare-and-swap, 409 on race, note
required on DISMISSED), a "Grievances" queue in Today, a nav entry in
`hubs.ts`, and new `AdminAction` values `GRIEVANCE_TRIAGED` /
`GRIEVANCE_RESOLVED` plus entity type `GRIEVANCE`.

**Where the intake form lives is a boundary question.** Admin owns the review
surface unambiguously. A public-facing report form is arguably the landing/
donor track's territory — see the Week 5 precedent where
`app/api/ngo/proposals/route.ts` was built API-only and flagged to its owner.
Default: build the API plus a minimal public page, and flag it.

---

## 3. Day plan

| Day | Work |
|---|---|
| Mon Oct 5 | SPEC-1 schema + migration + `lib/proof-fingerprint.ts` + tests; SPEC-2.1 window the audit trail |
| Tue Oct 6 | SPEC-1 wire into submit-proof, alerts, backfill tool; SPEC-2.2 finance exceptions in Today |
| Wed Oct 7 | SPEC-3 (allocation → project link, evidence rollup on the allocation detail page) |
| Thu Oct 8 | SPEC-4 schema, intake route, admin list/detail, triage actions |
| Fri Oct 9 | SPEC-4 tests + SPEC-2.3 queue provenance display; full `tsc` + suite; demo run; PR |

## 4. Tests (CLAUDE.md mandatory kinds, mapped)

1. **Tenant isolation** — NGO session gets 403 on `/api/admin/grievances/[id]`;
   a grievance filed against org B is invisible to org A *and* to org B.
2. **Approval state machine** — grievance transitions (`OPEN → TRIAGED →
   INVESTIGATING → RESOLVED|DISMISSED`), terminal statuses terminal, dismissal
   without a note is 400, CAS loser gets 409.
3. **Idempotency** — resubmitting an identical proof raises exactly one
   duplicate alert, not one per retry (leans on `createFraudAlert` dedupe);
   the backfill tool is re-runnable.
4. **AI output** — unchanged this week; the duplicate check is deterministic by
   design, and `classifyDuplicate` gets a table test over all four verdicts
   including the "same milestone = resubmission, no alert" false-positive
   boundary.
5. **Admin audit coverage** — the new admin grievance route must call
   `logAdminAction` or `tests/admin-audit-coverage.test.ts` fails the build;
   `tests/admin-audit-gaps.test.ts` will fail if any grievance text reaches the
   log.

## 5. Demo script (the week must be demonstrable, not merely coded)

1. Admin approves an allocation against an approved proposal, links it to the
   NGO's project, confirms a payment with a UTR → `/admin/finance` shows
   committed and confirmed.
2. NGO submits milestone proof with a geotagged photo → it appears in
   `/admin/proof-review` showing the location match **and** the funded amount
   behind it.
3. NGO resubmits the same photograph against a different project → a HIGH
   duplicate alert appears in `/admin/today` within the Fraud Alerts queue,
   deep-linked to the organisation.
4. An anonymous grievance is filed against that NGO → it lands in
   `/admin/grievances`, is triaged to HIGH, and resolves with a note; the
   `AdminActionLog` entry carries ids only.

## 5a. Build status (2026-10-05, branch `feat/week7-evidence-provenance`)

Verified green before this was written: `npx tsc --noEmit` exit 0, full suite
104 files / 1352 tests passing.

| Spec | State |
|---|---|
| SPEC-1 proof fingerprinting | **Built.** `lib/proof-fingerprint.ts`, `MilestoneProof.contentHashes` + GIN index, wired into submit-proof, `tools/backfill-proof-hashes.ts`, 2 test files. Migration written, **NOT APPLIED**. |
| SPEC-2.1 window the audit trail | **Built.** 90-day/100-row window, stated in the UI, `100+` badge when truncated. |
| SPEC-2.2 finance exceptions on Today | Not built. |
| SPEC-2.3 duplicate verdict in the review queue | Not built — this is what makes SPEC-1 visible to a reviewer. |
| SPEC-3 bind money to work | Not started. |
| SPEC-4 grievance intake + triage | **Built.** Model + migration (**NOT APPLIED**), `lib/grievance-workflow.ts`, intake + admin routes, `/admin/grievances` list and detail, Today queue, SLA target, nav entry, minimal `/report-concern` page, 2 test files + 4 inbox tests. |

Neither migration has been applied to the Neon dev DB, so neither feature can
be exercised in a browser yet.

Found while building, fixed: `isGrievanceAction` used the `in` operator, which
walks the prototype chain — `action: "toString"` passed the guard. Now
`Object.prototype.hasOwnProperty.call`. The same two-line hazard was present in
the category and severity checks on both routes. **`isProposalAction` in
`lib/proposal-workflow.ts` still has it** and is flagged separately.

Also noted, not fixed: `app/privacy-policy/page.tsx` §10 names a DPDP Grievance
Officer with `[PLACEHOLDER]` contact details. The new channel covers complaint
intake but does not fill those placeholders, and `/report-concern` points
anyone needing anonymity at that section — which is currently a dead end.

## 5b. Week 7 completion (2026-10-08, branch `feat/week7-completion`)

Gaps found by checking `main` @ `741257f` against the plan's Week 7 rows, and closed:

| Gap | Fix |
|---|---|
| **Consent could not be withdrawn.** `BeneficiaryFeedback.withdrawnAt` was read by every donor-visibility check but written by nothing. | `POST /api/field/feedback/[id]/withdraw` (any member of the owning NGO; 404 to others; idempotent, race-safe). Erases rating/feedback text, records `withdrawnById`. Button in the NGO project cockpit. `tests/consent-withdrawal.test.ts`. |
| **Two duplicate checks that never compared notes.** Field captures were compared only with field captures (globally, no alert, no verdict). Milestone proofs were compared only with milestone proofs. A photo could cross from one to the other unseen. | `lib/evidence-duplicates.ts` gathers candidates from BOTH tables; both routes classify with `classifyDuplicate`. Field evidence stores `duplicateVerdict` and raises `PROOF_DUPLICATE_MEDIA` (MEDIUM/HIGH) after commit. A field photo reused as the proof for the same milestone is a RESUBMISSION and raises nothing, since capture then proof is the intended flow. |
| SPEC-2.3: duplicate verdict not visible in `/admin/proof-review`. | One batched lookup per page load, shown next to the GPS badge. Unfingerprinted proofs read "not fingerprinted", never clean. |
| `NO_GPS_DATA` rendered red in the field-evidence queue and NGO cockpit, contradicting the "absence is not a defect" rule. | Neutral grey. Only `MISMATCH` is red. |
| "Approved notifications + opt-out" had no opt-out. | `User.projectUpdatesOptOut`, `GET/PATCH /api/donor/notification-preferences` (own row, DONOR only, set not toggle), filter inside the recipient query, toggle on `/donor/funded/[projectId]`. |
| Proof review said "threshold: 70+ for auto-completion". Nothing auto-completes. | Now reads "advisory only — a human decides". |

Migration `20261008090000_consent_withdrawal_and_update_optout` is additive and `IF NOT EXISTS`. **Not applied to any database yet.** Apply with `npx prisma migrate deploy`.

Regression guard: `tests/weekly-acceptance.test.ts` + `docs/ACCEPTANCE-MATRIX.md` pin W1–W7.

Still open for Week 7, and they need a decision rather than more code:
- **SPEC-3 is not built, and the plan now has two money→project paths.** `Contract` (donor track) already binds money to a `Project`. `Allocation` (admin track) still does not. Pick one as the pilot's source of truth before Week 8 builds outcomes on top of it.
- **Two evidence queues** (`/admin/proof-review` for milestone proofs, `/admin/field-evidence` for captures). Field-evidence approval completes the *task* but never moves the *milestone*. Human milestone acceptance only happens through proof review.

## 6. Decisions taken (2026-10-05)

- **SPEC-3: Option A** — `Allocation.projectId`, reusing the existing
  milestone/proof machinery. `FundedEngagement` is deferred to Week 8, where it
  becomes an extraction from something working rather than a speculative model.
- **SPEC-1: exact SHA-256.** `contentHashes` is the seam; perceptual hashing is
  revisited with real submission data, like the 50 km GPS threshold.
- **SPEC-4: signed-in filing only.** Tradeoff recorded in SPEC-4 above —
  beneficiaries are excluded because they have no accounts; anonymous intake
  travels with the beneficiary-consent P0.
- **SPEC-4 boundary: API-first plus a minimal page**, with the polished public
  form flagged to the landing/donor track's owner — the Week 5
  `app/api/ngo/proposals` precedent.
