# Week-5 gap closure — implementation specs

Companion to [`WEEK5-GAPS.md`](WEEK5-GAPS.md), which says what is broken and how
we know. This says what to build, precisely enough that two people could pick up
different specs without colliding.

Every spec below follows the house rules: a state change goes through
`assertTransition` and `commitRequirementChange`, never a bare `status` write;
new models need **both** a schema edit and a migration (`npm run db:migrate`);
and the four mandatory test kinds from CLAUDE.md — tenant isolation, approval
state machine, idempotency, AI output — apply where relevant.

Specs are ordered by dependency. SPEC-1 and SPEC-2 are independent of everything
else and can start immediately. SPEC-4 depends on SPEC-3.

| Spec | Closes | Size | Depends on |
|---|---|---|---|
| [SPEC-1](#spec-1--wire-the-funder-gate) | D-1 | S | — |
| [SPEC-2](#spec-2--give-candidate-stage-exclusions-a-reason) | X-1 | M | — |
| [SPEC-3](#spec-3--changes_requested-the-donorngo-revision-loop) | D-2 | L | — |
| [SPEC-4](#spec-4--proposal-versioning-retain-v1) | N-1 | M | SPEC-3 |
| [SPEC-5](#spec-5--the-admin-shortlist-review) | A-1 | M | — |
| [SPEC-6](#spec-6--the-terminal-approval) | D-3 | S | SPEC-3 |
| [SPEC-7](#spec-7--the-small-ones) | A-2, A-3, N-2, N-3, X-2, X-4 | S each | — |

---

## SPEC-1 — wire the funder gate

**Closes D-1.** Today an organisation with `orgVerificationStatus=NOT_SUBMITTED`
can create a requirement, have it validated, and match against verified NGOs.
Admin's verification decision has no downstream effect, which makes step 4 of the
acceptance test theatre and reopens the asymmetry the CSR work closed.

### Service layer

Add to `lib/requirements/access.ts`:

```ts
/**
 * Can this donor put a requirement in front of an NGO?
 *
 * Reuses lib/matching/funder.ts rather than re-deriving the rule: the funder-led
 * engine and this one must not disagree about who is allowed to fund.
 */
export async function requireVerifiedFunder(actor: Actor): Promise<void>
```

It calls `checkFunderEligibility(actor.id)` from `lib/matching/funder.ts` and, on
`!ok`, throws `new RequirementWorkflowError(check.message, 403)`. That function
already returns a distinct, donor-actionable message per failure reason
(`NOT_INSTITUTIONAL`, `NOT_VERIFIED`, `ORG_NOT_VERIFIED`) — do not replace those
strings with a generic one.

### Call sites — three, and only three

| Where | When |
|---|---|
| `createRequirementFromForm` (`lib/requirements/workflow.ts:48`) | after the `actor.role !== "DONOR"` check, before validation |
| `POST /api/requirements/upload` | after the actor is resolved, before the file is written to private storage |
| `runMatching` (`gapAnalysisService.ts:84`) | after `loadRequirementForActor`, **skip when `actor.role === "ADMIN"`** |

`runMatching` must check the **requirement's owner** (`req.sponsorId`), not the
caller, so an admin re-running matching on behalf of an offline funder is not
blocked by their own lack of a donor persona — but an unverified owner still is.

### Deliberately NOT gated

Editing fields, submitting for review, and admin validation stay open. A company
whose verification is still `PENDING` must be able to finish preparing its
requirement while it waits; blocking the edit would create a deadlock where the
donor cannot act and the admin has nothing to look at. The gate belongs where
money and NGO attention start: creation and matching.

### Tests — `tests/requirement-funder-gate.test.ts`

1. `NOT_SUBMITTED` donor → `createRequirementFromForm` throws 403 with the "not submitted" remedy text.
2. `PENDING` donor → 403, and the message tells them it is in the queue (not "go verify it").
3. `VERIFIED` + institutional persona → succeeds.
4. `INDIVIDUAL` persona, PAN verified → 403 `NOT_INSTITUTIONAL`.
5. Owner `NOT_SUBMITTED`, caller ADMIN → `runMatching` still throws (the gate follows the owner).
6. Owner `VERIFIED`, caller ADMIN → succeeds.

### Acceptance

Re-run PROBE 1 from `WEEK5-GAPS.md` as `Hi-ideals Technologies`
(`orgVerificationStatus=NOT_SUBMITTED`): it must fail at creation with a 403,
where today it completes the entire chain.

---

## SPEC-2 — give candidate-stage exclusions a reason

**Closes X-1.** `loadCandidates()` (`gapAnalysisService.ts:30`) filters on
`status: "ACTIVE"`, `isDeleted: false`, and `ngo: { verificationStatus: "VERIFIED", isSuspended: false, isDeleted: false }`.
Anything filtered there produces no `RequirementMatch` row, so it is invisible in
all three portals — indistinguishable from an NGO nobody considered. The live run
reported *"1 projects evaluated · 1 eligible · 0 excluded by hard rules"* while a
second project sat in `DRAFT`, unmentioned. The reasons machinery works; this is
about the exclusions that never reach it.

### Approach — widen the load, exclude in the engine

Do **not** add a second reason store. Move the filter into the rule layer so one
mechanism explains every exclusion.

1. `loadCandidates()` drops the `status` and `ngo.verificationStatus` /
   `isSuspended` conditions from the `where`. Keep `isDeleted: false` on both —
   a deleted row is not a candidate and has no story worth telling.
2. `CandidateProject` (`matchingEngine.ts:52`) gains:
   ```ts
   projectStatus: string;          // ACTIVE | DRAFT | PENDING_APPROVAL | …
   ngoVerificationStatus: string;  // VERIFIED | PENDING | REJECTED
   ngoSuspended: boolean;
   ```
3. Three new hard rules in `matchingEngine.ts`, evaluated **first**, always
   applicable (no requirement field switches them on):

   | Rule label | Fails when | Explanation |
   |---|---|---|
   | `Verified organisation` | `ngoVerificationStatus !== "VERIFIED"` | "Only verified organisations can be shortlisted. This one is {status}." |
   | `Organisation in good standing` | `ngoSuspended` | "This organisation is currently suspended." |
   | `Active project` | `projectStatus !== "ACTIVE"` | "Only an active project can be matched. This one is {status}." |

   These mirror `VERIFIED_STATUS`, `NOT_SUSPENDED` and `HAS_ACTIVE_PROJECT` in
   `lib/matching/rules.ts` — same three questions, same wording register.

### Volume control

Widening the load means every draft project in the database lands in
`RequirementMatch`. Two mitigations, both required:

- Cap the excluded rows written per run at **50**, ordered by
  `project.updatedAt desc`. `GapReport.gapReport.excludedCount` already records
  the true total, so the count stays honest even when the list is truncated.
- `MatchResults.tsx` renders exclusions **collapsed** behind
  "N organisations were excluded — see why", expanded on click. The shortlist is
  the page's subject; exclusions are evidence, not content.

### Tests — extend `tests/matching-engine.test.ts`

1. Unverified NGO → `eligible=false`, `score=null`, hard rule `Verified organisation` FAIL with the status in the text.
2. Suspended NGO → FAIL on `Organisation in good standing`.
3. `DRAFT` project → FAIL on `Active project`.
4. All three pass → the pre-existing rules still decide the verdict (no regression).
5. A run with 60 ineligible candidates writes 50 rows and reports `excludedCount: 60`.

### Acceptance

With Tejamma's project left in `DRAFT`, a run must produce a
`RequirementMatch` row for it with `eligible=false` and the reason "Only an
active project can be matched. This one is DRAFT." The donor page must say
*1 eligible · 1 excluded*, not *0 excluded*.

> **For the demo, independent of this spec:** set the ineligible NGO's project to
> `ACTIVE` and give it a mismatching sector plus no FCRA. Step 6 then renders
> today, through the hard rules that already work.

---

## SPEC-3 — `CHANGES_REQUESTED`: the donor↔NGO revision loop

**Closes D-2.** Steps 9 and 10 of the acceptance test. The donor's only action on
a response is *Select this NGO*; `UNDER_REVIEW` and `SHORTLISTED` exist on
`OpportunityResponseStatus` and no code writes either.

### Schema

```prisma
enum OpportunityResponseStatus {
  INTERESTED
  PROPOSAL_SUBMITTED
  CHANGES_REQUESTED   // donor asked for a revision; the NGO may edit again
  UNDER_REVIEW
  SHORTLISTED
  REJECTED
  SELECTED
}

model OpportunityResponse {
  // … existing fields …
  /// What the donor asked to be changed, verbatim. Kept because the NGO's next
  /// version is a reply to it, and "why is this back with me" must have an
  /// answer that survives a later edit to the requirement.
  changeRequestNote String?
  changeRequestedAt DateTime?
  changeRequestedById String?
  /// How many times the donor has sent it back. Renders as "Revision 2".
  revisionRounds    Int      @default(0)
}
```

Migration: `npm run db:migrate --name add_response_change_requests`. Adding an
enum value is additive; no backfill needed since no row can currently be in the
new state.

### Response state machine — new module

There is no state machine for `OpportunityResponse` today; statuses are set
inline. Add `lib/requirements/response-status.ts`, modelled on
`lib/requirements/status.ts`:

```ts
const RESPONSE_TRANSITIONS: Record<OpportunityResponseStatus, Partial<Record<OpportunityResponseStatus, ActorRole[]>>> = {
  INTERESTED:         { PROPOSAL_SUBMITTED: ["NGO"], REJECTED: ["DONOR", "ADMIN"] },
  PROPOSAL_SUBMITTED: { CHANGES_REQUESTED: ["DONOR", "ADMIN"], SELECTED: ["DONOR", "ADMIN"], REJECTED: ["DONOR", "ADMIN"] },
  CHANGES_REQUESTED:  { PROPOSAL_SUBMITTED: ["NGO"], REJECTED: ["DONOR", "ADMIN"] },
  UNDER_REVIEW:       { CHANGES_REQUESTED: ["DONOR", "ADMIN"], SELECTED: ["DONOR", "ADMIN"], REJECTED: ["DONOR", "ADMIN"] },
  SHORTLISTED:        { SELECTED: ["DONOR", "ADMIN"], REJECTED: ["DONOR", "ADMIN"] },
  REJECTED:           {},
  SELECTED:           {},
};
```

`UNDER_REVIEW` and `SHORTLISTED` are given legal exits rather than deleted, so
a future "donor is reading this" marker has somewhere to land. Nothing writes
them in this spec.

### Service layer — `lib/requirements/opportunities.ts`

```ts
/** Donor (or admin) sends a submitted proposal back with a required note. */
export async function requestResponseChanges(
  requirementId: string, actor: Actor, responseId: string, note: unknown
)
```

Rules:
- `loadRequirementForActor` then `workflowRole` — owner or admin only.
- `note` is **mandatory**, trimmed, 10–4000 chars. A change request with no
  change named is the same dead end as a rejection with no reason, which
  `lib/proposal-workflow.ts` already refuses to allow.
- `assertResponseTransition(current, "CHANGES_REQUESTED", role)`.
- In one transaction: set status, `changeRequestNote`, `changeRequestedAt`,
  `changeRequestedById`, `revisionRounds: { increment: 1 }`; snapshot the current
  version (SPEC-4); `recordRequirementEvent` with a new audit action
  `NGO_RESPONSE_CHANGES_REQUESTED`; notify the NGO.
- The **requirement** status does not move. It stays `NGO_RESPONSE` — the round
  trip is between two parties about one response, not a change to the
  opportunity. Do not add a requirement-level status for it.

Amend `submitInterest`:
- The resubmission guard at line ~196 becomes
  `["INTERESTED", "PROPOSAL_SUBMITTED", "CHANGES_REQUESTED"]`.
- `OPEN_STATUSES` already contains `NGO_RESPONSE`, so a requirement that has
  moved on still accepts the revision. No change needed there.

### Notification

Reuse the existing thread machinery — `openThread` / `appendToThread` from
`lib/inquiry-thread.ts`, as `lib/matching/notify.ts` does — with
`entityType: "OPPORTUNITY"`, `entityId: requirementId`. One thread per
opportunity per NGO; each change request appends. The NGO already has
`/ngo/inquiries` as an inbox; the donor has bell + email only, which is a known
asymmetry and out of scope here.

### API

`POST /api/requirements/[id]/responses/[responseId]/request-changes`
— body `{ note: string }`. Follows the shape of the existing
`request-correction` route (`app/api/requirements/[id]/request-correction/route.ts`):
`requireActor`, call the service, `errorResponse(err, …)`.

### UI

**Donor** — `components/requirements/ResponsesPanel.tsx`:
- New secondary button **"Request changes"** beside *Select this NGO*, shown when
  `status === "PROPOSAL_SUBMITTED"`. Opens a required-note textarea; submit is
  disabled until 10 characters. Mirror the reject-with-reason interaction in
  `app/admin/proposals/[id]/ProposalActions.tsx` — do not invent a second
  pattern.
- A `CHANGES_REQUESTED` response renders the note and "Revision N — waiting on
  the organisation", with no action buttons.

**NGO** — `app/ngo/opportunities/[id]/OpportunityClient.tsx`:
- When the response is `CHANGES_REQUESTED`, show the donor's note prominently
  above the form, keep the previous values prefilled, and label the submit button
  **"Submit revision"**.
- Add a read-only "Previous versions" list once SPEC-4 lands.

### Tests — `tests/response-change-requests.test.ts`

1. **State machine:** every illegal transition throws 400; every legal one made by the wrong role throws 403. Table-driven over `RESPONSE_TRANSITIONS`.
2. **Required note:** empty / 9-char note → 400, and no status change is written.
3. **Tenant isolation:** NGO B cannot submit a revision against NGO A's response (403); donor B cannot request changes on donor A's requirement (403).
4. **Round trip:** submit → request changes → resubmit → `PROPOSAL_SUBMITTED`, `revisionRounds = 1`.
5. **Idempotency:** requesting changes twice on an already-`CHANGES_REQUESTED` response throws and does not increment `revisionRounds` a second time.
6. A `SELECTED` response cannot be sent back.

### Acceptance

Steps 9 and 10 of the acceptance test run in the UI, by two different people, and
the requirement stays `NGO_RESPONSE` throughout.

---

## SPEC-4 — proposal versioning (retain V1)

**Closes N-1.** `submitInterest` calls `opportunityResponse.update` in place, and
`@@unique([requirementId, ngoId])` guarantees one row, so a revision destroys its
predecessor. Confirmed in the run: after v2, one row, and v1's implementation
plan unrecoverable.

### Schema — snapshot table, not a second live row

Keep one live response per NGO per requirement. Mirror `RequirementRevision`
exactly, because the two will be read side by side.

```prisma
model OpportunityResponseRevision {
  id                     String              @id @default(uuid())
  responseId             String
  response               OpportunityResponse @relation(fields: [responseId], references: [id], onDelete: Cascade)
  version                Int
  proposedBudget         Decimal?            @db.Decimal(14, 2)
  proposedDurationMonths Int?
  implementationPlan     String?
  milestones             Json?
  expectedOutcomes       String?
  complianceNotes        String?
  /// Why this version was superseded — the donor's change-request note when the
  /// NGO was sent back, null when the NGO revised on its own initiative.
  supersededBecause      String?
  changedById            String?
  changedByRole          String?
  createdAt              DateTime            @default(now())

  @@unique([responseId, version])
  @@index([responseId])
}

model OpportunityResponse {
  // … existing fields …
  version   Int                           @default(1)
  revisions OpportunityResponseRevision[]
}
```

Migration: `npm run db:migrate --name add_response_versioning`. Backfill: none —
existing rows are version 1 with no history, which is true.

### Service layer

In `submitInterest`, inside the existing `$transaction`, **before** the update:

```ts
if (existing) {
  await tx.opportunityResponseRevision.create({ data: { responseId: existing.id, version: existing.version, …snapshot of existing… , supersededBecause: existing.changeRequestNote } });
  payload.version = existing.version + 1;
}
```

Same ordering as `commitRequirementChange` (`lib/requirements/commit.ts:59`):
snapshot the outgoing values, then write the new ones, in one transaction. If the
snapshot fails the update must not happen.

Add to `lib/requirements/queries.ts`:

```ts
export async function listResponseRevisions(responseId: string)
```

Ordered `version desc`, and `GET /api/requirements/[id]/responses/[responseId]/versions`
to serve it — owner, admin, or the owning NGO.

### UI

Reuse `components/requirements/VersionHistory.tsx`, which already renders the
requirement's revisions; it takes a list of `{ version, changeSummary, changedBy, createdAt }`
and a diff view. Feed response revisions through the same component rather than
writing a second one. Surfaces: the donor's `ResponsesPanel` and the NGO's
`OpportunityClient`.

### Tests — `tests/response-versioning.test.ts`

1. Resubmission writes a revision row holding the **old** values and bumps `version` to 2.
2. Three submissions → two revisions, versions 1 and 2, live row version 3.
3. A revision created by a change-request round carries `supersededBecause` = the donor's note.
4. **Tenant isolation:** NGO B gets 403 on NGO A's revisions endpoint; the requirement owner and an admin get 200.
5. Deleting the response cascades its revisions (no orphans).

### Acceptance

Step 10 runs and **V1 is still readable** in both portals after V2 is submitted.

---

## SPEC-5 — the admin shortlist review

**Closes A-1.** `GapReport.reviewStatus` defaults to `PENDING` and the donor's
match run renders **"Admin review: pending"**. `PUT /api/gap-analysis/report/[id]`
exists; no admin page references `gapReport` or `reviewStatus`, so that label can
never change. The audit vocabulary already anticipates this —
`GAP_REPORT_APPROVED` and `GAP_REPORT_REJECTED` are in
`RequirementAuditAction` with nothing emitting them.

### Decide first

Two honest options. **Pick one and write it into `hubs.ts`; do not ship both.**

**Option A — admin reviews the shortlist (what `WEEK5-FLOW.md` describes).**
The ranking is advisory and an NGO is about to be approached in the platform's
name, so a human checks the list first.

- `/admin/requirements/[id]` gains a **Shortlist** section listing the latest
  `GapReport` with its matches, reusing `components/requirements/MatchResults.tsx`
  in a read-only mode (`canInvite={false}`).
- Actions **Approve shortlist** / **Reject shortlist** (reject requires a note),
  writing `reviewStatus`, `reviewedBy`, `reviewedAt`, `reviewNote` and emitting
  the two existing audit actions.
- **`inviteMatch` becomes gated:** it must throw 400 unless
  `gapReport.reviewStatus === "APPROVED"`. Without this the review is still
  decorative — the donor can invite regardless, which is exactly today's bug.
- Badge: add `PENDING` gap reports to the Verification hub count in
  `app/admin/layout.tsx`, next to `pendingRequirementCount`.

**Option B — no admin review.** Delete `reviewStatus`, `reviewedBy`,
`reviewedAt`, `reviewNote` from `GapReport` (migration), drop the PUT route and
the two audit actions, and remove the "Admin review" line from
`MatchResults.tsx`. The donor owns its own shortlist.

**Recommendation: A.** The shortlist email carries the platform's credibility to
an NGO, and `lib/matching/notify.ts` already argues that case at length for the
funder-led track. Also, A is the only option that keeps `WEEK5-FLOW.md` true.

### Tests — `tests/gap-report-review.test.ts` (Option A)

1. Non-admin PUT → 403.
2. Reject with no note → 400.
3. `inviteMatch` on a `PENDING` report → 400 with a message naming the missing review.
4. `inviteMatch` after approval → succeeds.
5. Approving twice is idempotent — second call does not re-emit the audit event.

### Acceptance

Either the donor's "Admin review: pending" can be moved to approved by an admin
in the UI and invitations are blocked until then, or that line no longer exists.

---

## SPEC-6 — the terminal approval

**Closes D-3.** `selectResponse` moves the requirement to `SELECTED`, marks the
chosen response `SELECTED`, and auto-rejects every other response in the same
transaction. That is "pick a winner", not "approve version 2", and the donor page
ends at *Initiate Contract* rather than the required wording.

### Minimum change

Keep `selectResponse` as the single act — it is the right shape, and splitting
approval from selection would let a donor approve two competing proposals. Change
what it *says*:

1. `lib/requirements/status.ts` → `STATUS_LABELS.SELECTED` becomes
   **"Proposal approved — ready for contracting"**.
2. `app/donor/requirements/[id]/RequirementDetailClient.tsx` — the `SELECTED`
   panel heading becomes **"Proposal Approved — Ready for Contracting"**, above
   the existing *Initiate Contract* button.
3. `components/requirements/RequirementStepper.tsx` — step 8's label follows.
4. NGO side: `OpportunityClient` shows the same words when its own response is
   `SELECTED`, so all three portals use one phrase for one state. An NGO whose
   response was auto-rejected sees "Not selected for this opportunity" — never a
   bare `REJECTED`, which reads as a judgement on the organisation.

### Also record what selection approved

`selectResponse` should stamp the approved response version onto the requirement:
`selectedResponseVersion Int?` (needs SPEC-4). Without it, "approved" points at a
row that a later edit could change, and the contract is prefilled from something
nobody approved.

### Tests

Extend `tests/requirement-status.test.ts`: `SELECTED` renders the new label
everywhere it is derived, and `selectedResponseVersion` matches the response's
version at the moment of selection.

### Acceptance

Step 11 ends on a screen reading **"Proposal Approved — Ready for Contracting"**
in the donor portal, with the NGO portal agreeing.

---

## SPEC-7 — the small ones

**A-3 — `predev` must apply migrations.** Restore
`"predev": "prisma generate && prisma migrate deploy"` in `package.json`.
`origin/chat` dropped the deploy; CLAUDE.md relies on it, and a demo box that
silently runs behind the schema is how this whole exercise started.

**X-4 — clear the residual drift.** `migrate diff` reports seven
`SponsorRequirement` columns carrying database-side defaults (`''`, `'{}'`,
`'UPLOADED'`) that `schema.prisma` does not declare, left by
`20260905120000_reconcile_sponsor_requirement_drift`. Either declare the defaults
in the schema or drop them in a migration. Declaring them is less churn and
matches what the data actually looks like.

**N-2 — seed the demo NGO.** `kiran.welfare@example.org` was created through the
UI, so no password exists in the repo and the acceptance run cannot be reproduced
by anyone else. Extend `scripts/seed-csr-donor.ts` (or add
`scripts/seed-week5-demo.ts`) to create both demo NGOs — one eligible, one
ineligible-with-an-ACTIVE-project per SPEC-2 — plus their projects, with the
password in the script. Note `scripts/` is gitignored, so also add the fixture
it depends on somewhere tracked, or the seed is local-only too.

**N-3 — "Not interested" as state.** Add `DECLINED` to
`OpportunityResponseStatus` and an NGO action that writes it with an optional
reason, so "invited and said no" is queryable rather than inferred from silence.
Legal from `INTERESTED` and `CHANGES_REQUESTED`, by the NGO only. Small, but it
is the difference between a funnel you can measure and one you cannot.

**X-2 — sector and geography: doc or engine.** `WEEK5-FLOW.md`'s acceptance table
promises "ineligible — wrong sector"; the engine scores sector at 25% and
geography at 20% and never excludes on either. Two defensible answers:
(a) amend the doc — a sector mismatch is a ranking signal, and a 0-score
candidate is already effectively excluded; or (b) add an optional
`sectorIsMandatory` flag on the requirement that promotes sector to a hard rule
when the donor says so. **Recommend (a)**, plus deleting that row from the
acceptance table, because a donor who wants a hard sector filter is better served
by the score than by a gate they cannot see the effect of.

**A-2 — one engine, decided.** `FundingOpportunity` / `MatchCandidate` /
`Proposal` and `SponsorRequirement` / `RequirementMatch` / `OpportunityResponse`
both ship and answer the same question. The nav no longer offers the first, but
its routes still work. Decide: keep it read-only for offline funders represented
by admin (and say so in `hubs.ts`), or delete it — routes, models, admin pages,
`lib/matching/*`, and the tests that cover them. Do not leave it undecided; two
systems with one purpose drift, and the next person will not know which to
extend.

---

## Definition of done, for all of the above

- `npx tsc --noEmit && npm test` green.
- A migration committed for every schema change; `npm run db:status` clean.
- The eleven-step acceptance test in `WEEK5-FLOW.md` runs start to finish with
  three people on one shared environment, no database edits in between.
- `WEEK5-GAPS.md` updated: each closed gap struck through with the commit that
  closed it, so the document stays a record rather than becoming stale.
