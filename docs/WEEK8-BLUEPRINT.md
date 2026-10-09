# Week 8 blueprint — "Evidence → outcome → impact"

**Dates:** Oct 12–16 2026. **Plan deliverables (Intern 1 — Admin/Platform):**
Metric Registry (Mon) · impact approval workflow (Wed) · portfolio quality
dashboard (Fri).

**Friday acceptance, verbatim from the plan:** *"Approved evidence maps to
governed outcomes and donor report without unsupported claims."*

The Dependencies sheet makes Mon's deliverable a **contract owed to Intern 2**
at W8 ("Producer: Intern 1 · Consumer: Intern 2 · Metric Registry · fallback:
use metric fixtures"). So the registry has to be a real, queryable contract
early in the week, not a late-week refactor.

---

## 1. Where the week actually stands (code-grounded, 2026-10-08)

### Metric Registry — ZERO CODE

`lib/impact-metrics.ts` is **two flat dictionaries** and nothing else: 17 SDG
goal names and 11 IRIS codes, `Record<string, string>`, no model, no versioning,
no ownership, no evidence rules.

Impact claims are stored as **ungoverned free-text arrays**:

```prisma
model ImpactReport {
  aiGeneratedNarrative String
  sdgTags              String[]   // any string, from anywhere
  irisMetrics          String[]   // any string, from anywhere
}
```

`grep -i outcome prisma/schema.prisma` returns **nothing**. There is no outcome
model, no claimed value, no unit, no approval state, and no link from a number
to the evidence that would justify it. Today a donor-facing narrative can assert
any metric against any project and the platform has no way to contradict it —
which is precisely the "unsupported claims" the Friday gate forbids.

### Evidence — BUILT and approvable (Week 7)

Two approved-evidence sources now exist and both carry provenance:

- `MilestoneProof` + `MilestoneReview` — human milestone acceptance, with
  `contentHashes` and GPS classification.
- `FieldEvidence` (`status APPROVED`) + `BeneficiaryFeedback` — field captures
  with `duplicateVerdict`, `locationStatus`, `containsPeople`, and per-purpose
  consent that can be withdrawn.

This is the substrate Week 8 builds on, and it is in good shape.

### `/admin/impact-health` is NOT this

Despite the name it is about **donor-update delivery** — `ImpactSubscription` /
`ImpactDelivery` / `ProjectImpactEvent`, i.e. did the email/push go out and get
read. It measures message plumbing, not impact measurement. Week 8 must not be
bolted onto it; the two answer different questions and merging them would make
both unreadable.

### The money anchor — DECIDED 2026-10-08

Week 7 closed with two money→work paths and flagged that Week 8 could not build
outcomes until one was chosen. Verified again today: **`Allocation` has no
`projectId`** (Week 7's SPEC-3 was decided and never built), while
`Contract → projectId → Project → Milestone → evidence` works end to end.

**Decision: `Contract → Project` is the pilot's source of truth.** Outcomes hang
off `Project`/`Milestone` + approved evidence. `Allocation` remains the admin
commitment ledger. SPEC-3 is logged as known debt in §6 rather than left to look
half-built.

---

## 2. The spine: no number without evidence

The repo already has the right pattern for this, twice, and Week 8 is its third
application:

- `lib/compliance-evidence.ts` — a compliance badge is earned **only** by a
  field a human marked `VALIDATED`. A nightly sweep retracts badges whose
  evidence disappeared.
- `lib/verification-triage.ts` — **no model call**; deterministic rules decide
  the verdict, and an NGO with zero evidence renders "Not analysed" in red,
  never as clean.

Week 8's analogue, and the rule the whole week hangs on:

> **Only an APPROVED outcome claim, cited to APPROVED evidence, may appear as a
> number in a donor-facing report. An unbacked claim renders as "unverified" —
> never as zero, and never silently omitted.**

"Never as zero" matters as much as the rest. A claim that fails its evidence
check and renders as `0` reads to a donor as "this project achieved nothing",
which is a different false statement, not a safe default. Same reasoning as "a
missing 12A is not a defect" and "no evidence must never read as safe."

---

## 3. The shape of the week

| Spec | Deliverable | Size | Depends on |
|---|---|---|---|
| SPEC-1 — Metric Registry (governed definitions + evidence rules) | Mon | M | — |
| SPEC-2 — Outcome claims + impact approval workflow | Wed | L | SPEC-1 |
| SPEC-3 — Outcome triage (the intelligence layer) | Wed | M | SPEC-2 |
| SPEC-4 — Portfolio quality dashboard | Fri | M | SPEC-2, SPEC-3 |

---

## SPEC-1 — Metric Registry

**The claim to make true:** a metric means one thing, platform-wide, and a
number reported against it can be checked.

```prisma
enum MetricStatus  { DRAFT ACTIVE DEPRECATED }
enum MetricUnit    { COUNT_PEOPLE COUNT_ITEMS COUNT_EVENTS CURRENCY_INR
                     PERCENTAGE HOURS KILOGRAMS LITRES AREA_SQM }
/// What kind of approved evidence can substantiate a claim on this metric.
enum EvidenceKind  { MILESTONE_PROOF FIELD_PHOTO BENEFICIARY_FEEDBACK
                     ATTENDANCE_RECORD FINANCIAL_RECORD }

model MetricDefinition {
  code             String   @id        // e.g. "IB-TRAINED-001"
  name             String
  unit             MetricUnit
  /// What counts and what does not — the text an admin judges a claim against.
  definition       String
  status           MetricStatus @default(DRAFT)
  /// Optional crosswalk. A metric is valid WITHOUT these; they are reporting
  /// conveniences, not the identity of the metric.
  sdgGoals         String[]
  irisCode         String?
  /// At least one required kind, or the metric cannot be ACTIVE.
  requiredEvidence EvidenceKind[]
  /// Whether values may be summed across projects on a portfolio roll-up.
  aggregatable     Boolean @default(true)
  version          Int     @default(1)
}
```

Decisions worth not re-litigating:

- **`code` is the primary key, not a uuid.** A metric code appears in donor
  reports and in Intern 2's fixtures; a stable human-readable key *is* the
  contract. Renaming a metric is deliberately hard.
- **A metric cannot go `ACTIVE` with an empty `requiredEvidence`.** This is the
  constraint that makes §2's rule enforceable at all — a metric with no evidence
  rule can never fail an evidence check, so it would be a permanent hole.
  Enforced in `lib/metric-registry.ts`, not just in the UI.
- **`DEPRECATED` never deletes.** Existing approved claims keep their metric;
  deprecation only blocks *new* claims. Deleting a metric would silently rewrite
  history already sent to donors.
- **SDG/IRIS stay optional and advisory.** The existing dictionaries in
  `lib/impact-metrics.ts` are kept and reused for display names rather than
  replaced — they are correct as far as they go, and nothing is deleted.
- **Seeded, not hand-typed.** `lib/metric-registry.ts` ships a small ACTIVE
  starter set (people trained, meals served, individuals reached, items
  distributed, sessions held) so Intern 2 has a real contract on Monday instead
  of a fixture. Seeding is idempotent and upserts by `code`.

Surfaces: `/admin/metrics` (list + create/edit/deprecate), `GET /api/metrics`
(the read contract Intern 2 consumes), `POST|PATCH /api/admin/metrics/[code]`
with `logAdminAction`.

## SPEC-2 — Outcome claims and the impact approval workflow

**The claim to make true:** a reported number is an object with a state, an
author, an approver, and citations.

```prisma
enum OutcomeClaimStatus { DRAFT SUBMITTED NEEDS_EVIDENCE APPROVED REJECTED WITHDRAWN }

model OutcomeClaim {
  id           String  @id @default(uuid())
  ngoId        String
  projectId    String
  milestoneId  String?
  metricCode   String
  metric       MetricDefinition @relation(fields: [metricCode], references: [code])
  /// Decimal, never float — same rule as money (CLAUDE.md §Finance).
  value        Decimal @db.Decimal(14, 2)
  /// Snapshotted: a later unit change must not silently restate an approved number.
  unit         MetricUnit
  periodStart  DateTime
  periodEnd    DateTime
  method       String             // how the NGO arrived at the number
  status       OutcomeClaimStatus @default(DRAFT)
  decidedById  String?
  decidedAt    DateTime?
  decisionNote String?
  citations    OutcomeClaimEvidence[]
}

/// A claim's citation to one piece of APPROVED evidence. The join is explicit
/// so "is this evidence already counted elsewhere" is one indexed query.
model OutcomeClaimEvidence {
  claimId    String
  claim      OutcomeClaim @relation(fields: [claimId], references: [id], onDelete: Cascade)
  kind       EvidenceKind
  /// Exactly one of these is set, per `kind`.
  proofId    String?
  evidenceId String?
  feedbackId String?
}
```

Non-negotiables:

- **`REJECTED` and `NEEDS_EVIDENCE` require a note.** Same rule as a proposal
  rejection, an allocation rejection, and a dismissed grievance.
- **Compare-and-swap on every transition, 409 on a race.** Copied from
  `lib/grievance-workflow.ts`, including `Object.prototype.hasOwnProperty.call`
  for the action guard — the `in`-operator prototype hole fixed in Week 7 must
  not be reintroduced here.
- **`APPROVED` is terminal except via `WITHDRAWN`.** A number sent to a donor
  cannot be quietly edited; it is withdrawn, with a note, and superseded.
- **Only an admin approves.** `verifySessionRole("ADMIN")` *and*, for NGO-side
  reads/writes, an explicit `claim.ngoId !== profile.id → 403` ownership check.
  Role is not ownership (CLAUDE.md).

## SPEC-3 — Outcome triage: the intelligence layer

**No model call.** `lib/verification-triage.ts` is the precedent and the reason:
the admin needs an answer that is identical every time, explainable in one
sentence, and testable with plain objects. An LLM guessing whether 120 is
supported by 40 photos would be both slower and less trustworthy than
arithmetic.

`lib/outcome-triage.ts` computes an **evidence ledger** per claim and emits
findings. Each finding is a sentence an admin can act on:

| Finding | Severity | Why it fires |
|---|---|---|
| `NO_EVIDENCE_CITED` | BLOCK | A number with no citations cannot be approved at all. |
| `EVIDENCE_NOT_APPROVED` | BLOCK | Cites a `PENDING_REVIEW`/rejected item. Unreviewed evidence is not evidence. |
| `REQUIRED_KIND_MISSING` | BLOCK | Metric requires `BENEFICIARY_FEEDBACK`; none cited. |
| `UNIT_MISMATCH` | BLOCK | Claim unit ≠ metric unit. |
| `METRIC_NOT_ACTIVE` | BLOCK | New claim against a `DRAFT`/`DEPRECATED` metric. |
| `DOUBLE_COUNTED` | HIGH | **The headline.** The same evidence row is already cited by another APPROVED claim on the same metric. |
| `CLAIM_EXCEEDS_EVIDENCE` | HIGH | Claimed value exceeds what the citations can arithmetically support. |
| `DUPLICATE_SOURCE_EVIDENCE` | HIGH | Cites evidence whose Week-7 `duplicateVerdict` is `CROSS_PROJECT`/`REUSED_IN_PROJECT`. |
| `CONSENT_MISSING` | HIGH | Beneficiary-derived claim citing feedback with no `consentToRecord`, or withdrawn. |
| `PERIOD_OUTSIDE_EVIDENCE` | MEDIUM | Claim period does not contain the evidence capture dates. |

Verdict: `CLEAN` (nothing fired — the admin confirms rather than investigates),
`NEEDS_REVIEW` (MEDIUM/HIGH present), `BLOCKED` (any BLOCK present). **A
`BLOCKED` claim cannot be approved through the API**, not merely discouraged in
the UI — the gate lives in the route.

**Double counting is the week's genuine "wow", and the direct sequel to Week 7.**
Week 7 stopped the same *photograph* being reused as evidence. Week 8 stops the
same *evidence* being counted twice as impact — the quieter and more expensive
version of the same fraud, and the one that inflates a portfolio total. It is
exactly the check a human reviewer cannot do by eye across 40 projects.

Two rules that keep it honest:

- **`CLEAN` must never mean "no evidence was examined."** A claim whose metric
  has no `requiredEvidence` cannot reach `CLEAN`; SPEC-1's ACTIVE constraint is
  what makes that unreachable by construction.
- **Severity is the platform's call, not the NGO's.** Nothing on the claim is
  author-settable beyond value/method/citations.

## SPEC-4 — Portfolio quality dashboard

`/admin/impact-quality`. Not a metric showroom — a **defect dashboard** that
answers "how much of what this platform reports is actually backed?"

- **Evidence-backed share** — approved-and-backed value ÷ total claimed value,
  per metric and portfolio-wide. The single number the week is judged by.
- **Unsupported claim rate by organisation** — claims that hit a BLOCK or HIGH
  finding, as a share of submitted. Repeat offenders surface without an
  accusation.
- **Double-counting incidents** — count, and deep links to both claims.
- **Registry hygiene** — ACTIVE metrics never claimed; DRAFT metrics being
  claimed against; metrics with no evidence rule (must be zero by construction,
  shown so a regression is visible).
- **Queue age** — oldest `SUBMITTED` claim, against an SLA target in
  `lib/sla.ts`, with the same "nothing escalates automatically" honesty note
  `/admin/sla` and `/admin/grievances` already carry.

Plus an "Impact Review" queue in `lib/today-sources.ts` / `today-inbox.ts` —
category **Waiting on you** — and a nav entry in `hubs.ts` under Insight.

---

## 4. Day plan

| Day | Work |
|---|---|
| Mon Oct 12 | SPEC-1: schema + hand-written additive migration, `lib/metric-registry.ts` + seed, `GET /api/metrics`, `/admin/metrics`, tests. Publish the contract to Intern 2. |
| Tue Oct 13 | SPEC-2 schema + `lib/outcome-workflow.ts` (CAS transitions) + routes. |
| Wed Oct 14 | SPEC-3 `lib/outcome-triage.ts` + `/admin/impact-review` queue showing findings; approval gate wired to `BLOCKED`. |
| Thu Oct 15 | SPEC-4 dashboard + Today queue + SLA + nav; donor-report read path renders "unverified" rather than 0. |
| Fri Oct 16 | Tests to green, `tsc` + full suite, browser walkthrough, acceptance-matrix row, PR. |

## 5. Tests (CLAUDE.md's five mandatory kinds, mapped)

1. **Tenant isolation** — NGO A gets 403 on NGO B's claim; the admin review
   route rejects a non-ADMIN session.
2. **Approval state machine** — every `OutcomeClaimStatus` transition, note
   required on `REJECTED`/`NEEDS_EVIDENCE`, `APPROVED` terminal except
   `WITHDRAWN`, CAS loser gets 409, **and a `BLOCKED` triage verdict cannot be
   approved through the route**.
3. **Idempotency** — re-running the metric seed upserts and never duplicates;
   re-submitting a claim does not create a second citation row.
4. **AI output** — n/a by design this week; instead `lib/outcome-triage.ts` gets
   a table test over all ten findings **including the false-positive
   boundaries**: a legitimate second claim on a *different* metric citing the
   same evidence is NOT double counting; evidence cited by a `REJECTED` claim is
   free to cite again.
5. **Admin audit coverage** — the new admin routes must call `logAdminAction`
   (`tests/admin-audit-coverage.test.ts` fails the build otherwise), with ids
   only — no metric names, no claim text, no org names in the payload.

Plus `tests/weekly-acceptance.test.ts` gains its W8 row, and
`docs/ACCEPTANCE-MATRIX.md` the matching entry.

## 6. Known debt carried into Week 8 (explicitly, not silently)

- **SPEC-3 from Week 7 is not built.** `Allocation` has no `projectId`, so
  admin-track committed money still reaches no evidence obligation. Week 8
  builds on the `Contract` path by decision (§1). Anything funded through
  `Allocation` will have no outcomes — a real gap, not a rendering bug.
- **Two evidence queues remain** (`/admin/proof-review`,
  `/admin/field-evidence`); field-evidence approval completes the task but never
  moves the milestone.
- **`/admin/impact-health` and `/admin/impact-quality` have confusingly similar
  names** for different jobs (delivery plumbing vs evidence backing). Renaming
  the former is a follow-up, not a Week 8 change.

---

## 7. Build status (2026-10-08, branch `feat/week8-metric-registry`)

Verified before this was written: `npx tsc --noEmit` exit 0; the two new pure
modules' suites green (56 tests); `tests/admin-audit-coverage.test.ts` and
`admin-audit-gaps.test.ts` green with the new admin routes in place.

| Spec | State |
|---|---|
| **SPEC-1 Metric Registry** | **Built and live.** Schema + hand-written additive migration `20261012090000_metric_registry_and_outcome_claims` (**applied** to the Neon dev DB), `lib/metric-registry.ts`, `tools/seed-metric-registry.ts` (idempotent — verified by re-running), `GET /api/metrics`, `POST /api/admin/metrics`, `PATCH /api/admin/metrics/[code]`, `/admin/metrics` with the registry-health panel, nav entry, `tests/metric-registry.test.ts`. Five metrics seeded and ACTIVE. |
| **SPEC-2 claims workflow** | **Built.** `lib/outcome-workflow.ts` (CAS transitions, note rules), `POST /api/ngo/outcome-claims`, `PATCH /api/ngo/outcome-claims/[id]` (SUBMIT/WITHDRAW), `PATCH /api/admin/outcome-claims/[id]` (APPROVE/REQUEST_EVIDENCE/REJECT), `/admin/impact-review` queue, nav entry, `tests/outcome-workflow.test.ts` (32) + `tests/outcome-claim-routes.test.ts` (25). |
| **SPEC-3 outcome triage** | **Built and wired.** `lib/outcome-triage.ts` + `lib/outcome-evidence.ts` (the DB-side gatherer). Findings render in the review queue; the approval gate reads the verdict. `tests/outcome-triage.test.ts` (29 tests, all ten findings plus the false-positive boundaries). |
| **SPEC-4 quality dashboard** | **Built.** `lib/impact-quality.ts` (pure roll-up + `claimDisplay`), `approvedCitationIndex` / `incidentsFromIndex` in `lib/outcome-evidence.ts`, `/admin/impact-quality`, `"Impact Review"` SLA target, the Today queue (`today-sources.ts` / `today-inbox.ts`, icon `impact`), nav entry. `tests/impact-quality.test.ts` (32) + 3 added to `tests/today-inbox.test.ts`. W8 row added to `tests/weekly-acceptance.test.ts` and `docs/ACCEPTANCE-MATRIX.md`. |

So Monday's and Wednesday's deliverables are complete, and the dependency owed
to the NGO track (`GET /api/metrics`, five ACTIVE codes) is live. Friday's
portfolio quality dashboard is not built.

Verified live against the dev database, not just in tests — with
`tools/seed-week8-demo.ts`, which computes its verdict through the real triage
rather than writing one by hand:

- A claim citing a proof that proof review has not approved comes back
  **BLOCKED** (`EVIDENCE_NOT_APPROVED` + `REQUIRED_KIND_MISSING`), and
  `/admin/impact-review` renders "Cannot be approved" with no Approve button.
- `PATCH` with `action: APPROVE`, sent directly and bypassing the UI entirely,
  returns **422**. This is the week's load-bearing guarantee: the gate is in the
  route, not the component.
- An admin sending the organisation's own `WITHDRAW` gets **403**;
  `action: "toString"` gets **400**; a rejection with a 2-character note gets
  **400**.
- `REQUEST_EVIDENCE` with a real note moves the claim to `NEEDS_EVIDENCE`
  (200), and replaying the same call returns **409** with
  "This action needs the claim to be submitted; it is needs evidence."
- The `AdminActionLog` row carries status, metric code, triage verdict, finding
  CODES and a citation count — and no `@`, no method text, no decision-note
  text.

`tests/weekly-acceptance.test.ts` now carries its W8 row, added in the same
change as SPEC-4 — the manifest is only allowed to assert a week that is
actually finished, which is why the row was deliberately withheld while two
specs were outstanding.

### SPEC-4 decisions that departed from this document

Written down because the spec above is wrong on both points, and the code is
right:

1. **"Backed value ÷ total claimed value, portfolio-wide" is not computable.**
   Across metrics it adds unlike units — 400,000 meals plus 50 people trained —
   and the larger magnitude swamps the ratio, so a million unbacked meals would
   read as catastrophe and fifty fabricated training claims as noise. The
   headline is therefore the share of asserted CLAIMS that are backed, which is
   unit-free; value shares survive per metric, where the unit is constant.
2. **Deep links to both claims in a double-count incident are not built.**
   There is no per-claim admin page to link to — `/admin/impact-review` only
   lists SUBMITTED claims, and an incident is by definition between two
   APPROVED ones. The incident table shows both claim ids as text. A claim
   detail route is the honest follow-up rather than a link that goes nowhere.

Also still open from the §4 day plan: the **donor-facing read path**.
`claimDisplay()` enforces "unverified, never 0" and is tested, but the only
donor surface that renders impact (`app/donor/dashboard/page.tsx`) does not
consume it yet. The contract is published; the donor track has to adopt it.

Verified in a browser, signed in as ADMIN against the dev database — not just
in tests, per the Week 7 lesson below:

- `/admin/impact-quality` renders every panel. With one NEEDS_EVIDENCE claim it
  reads "0 of 1 asserted numbers", one "cannot be approved", and — the rule
  working in a real render — "Oldest waiting: —", not `0d`.
- Registry hygiene shows zero ACTIVE metrics without an evidence rule, and the
  four seeded metrics nobody has claimed against.
- Flipping the claim to SUBMITTED (and back) exercised the SLA branch:
  "0d / 3d left · 3-day target", and the Today card "IMPACT REVIEW · 40 —
  Individuals trained ... waiting 0d" with the queue chip "Impact Review · 1".
- `/admin/today` still renders all fourteen other queues; console clean apart
  from a pre-existing CSP report-only warning.
### Found while building, fixed

`/admin/proof-review` was returning **HTTP 500** on `main`'s Week 7 code:
`ProofReviewClient.tsx` is a `"use client"` component and imported
`duplicateLabel` from `lib/proof-fingerprint.ts`, whose first line was
`import { createHash } from "node:crypto"`. Webpack does not polyfill the
`node:` scheme, so the route failed to build outright. The full 1668-test suite
was green throughout, because vitest runs in Node and resolves `node:crypto`
happily — only the client bundler objects.

Fixed on `feat/week7-completion` in `c31a0bd`: hashing moved to
`lib/proof-hash.ts`, and `tests/client-bundle-safety.test.ts` now walks every
`"use client"` file under `app/`, follows `@/lib` value imports transitively,
and fails on any Node builtin in the closure. Verified against the real bug by
reintroducing it.

**The lesson worth keeping:** every page this week ships must be opened in a
browser before it is called done. Three Week 7 migrations were also unapplied,
so `FieldEvidence` had no table at all — neither gap was visible from the test
suite.
