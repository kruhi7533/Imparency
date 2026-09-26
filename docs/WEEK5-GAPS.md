# Week-5 end-to-end run — what worked, and every gap found

Run date: 2026-09-26, against `merge/week5-csr-workflow` (= `main` + `origin/chat`),
on the dev database, with all 30 migrations applied.

The eleven-step acceptance test in [`WEEK5-FLOW.md`](WEEK5-FLOW.md) was driven
through the real workflow layer (`lib/requirements/*`,
`src/agents/gap-diagnoser/*`) with real actors and real persistence — not mocks —
and the resulting state was then read back from the donor and admin portals in a
browser. Nothing in this document is inferred from reading code alone; each
finding names the evidence.

Artifacts from the run: requirement `4f56ce66-5ef7-40f7-8778-9cfb5f049bac`
("E2E Education Programme — Karnataka"), gap report
`9f06d91b-17db-4271-bdb4-99e5888482e6`.

---

## The headline

**Nine of the eleven steps work end to end and persist.** The flow is much
further along than a reading of the branch suggests. Two steps do not exist, one
step passes for the wrong reason, and one admin gate is decorative.

| # | Step | Result |
|---|---|---|
| 1 | NGO registers, creates a project | ✅ |
| 2 | Admin verifies the NGO | ✅ |
| 3a | Donor creates the CSR organisation | ✅ |
| 3b | Donor creates/uploads the requirement | ✅ `DONOR_REVIEW`, v1 |
| 4 | Admin verifies the donor | ⚠️ works, but changes nothing — see D-1 |
| 5 | Show AI extraction, correct one value | ✅ `budgetMax` → 750000, `source=DONOR_ENTERED`, v2 |
| — | Donor submits for validation → admin validates | ✅ `PENDING_ADMIN_REVIEW` → `VALIDATED` |
| 6 | Ineligible NGO excluded **with its reason** | ⚠️ works only for candidates — see P-1, P-2 |
| 7 | Eligible NGO on the ranked shortlist | ✅ rank #1, score 82, coverage 70% |
| 8 | NGO opens it, submits proposal v1 | ✅ `PROPOSAL_SUBMITTED`, ₹550,000 |
| 9 | Donor requests a change | ❌ **does not exist** — see D-2 |
| 10 | NGO submits v2, v1 retained | ❌ **v1 destroyed** — see N-1 |
| 11 | Donor approves → ready for contracting | ⚠️ different act, different wording — see D-3 |

Verbatim trace of the passing run:

```
[3b create]        ✓ status=DONOR_REVIEW v1
[5  correct]       ✓ budgetMax -> 750000 source=DONOR_ENTERED v2
[5b submit]        ✓ status=PENDING_ADMIN_REVIEW
[4  admin validate]✓ status=VALIDATED
[6+7 matching]     ✓ candidateCount=1 eligibleCount=1
                   - Kiran Welfare Society | eligible=true rank=1 score=82 coverage=70%
                       PASS: 80G registration — verified on the platform
                       PASS: 12A registration — verified on the platform
[8a invite]        ✓ invited Kiran Welfare Society
[8b ngo inbox]     ✓ 1 opportunity visible: "Education CSR opportunity in Karnataka"
[8b proposal v1]   ✓ status=PROPOSAL_SUBMITTED budget=550000
[10 proposal v2]   ✗ same row overwritten — 1 response; v1 plan no longer recoverable
[11 approve]       ✓ requirement=SELECTED response=SELECTED
```

And the negative case, run separately against an FCRA-requiring requirement:

```
PROBE 2 — candidateCount=1 eligibleCount=0
  - Kiran Welfare Society | eligible=false rank=null score=null
      FAIL: FCRA registration — Requirement specifies FCRA, but the NGO's FCRA status is NONE.
      PASS: 12A registration — 12A registration is verified on the platform.
```

That is exactly the demonstration step 6 asks for: one NGO, two opportunities,
two opposite verdicts, and the reason stored per rule. It works.

---

## Gaps by portal

### Donor portal

**D-1 — the donor verification gate is not wired. Admin's step-4 decision has no effect.**
Empirically proven, not inferred. Acting as `Hi-ideals Technologies`
(`panStatus=VERIFIED`, `orgVerificationStatus=NOT_SUBMITTED`) the full chain ran:
requirement created, submitted, admin-validated, matched, 1 eligible candidate.

```
PROBE 1 — donor "Hi-ideals Technologies" pan=VERIFIED org=NOT_SUBMITTED
  ✗ NO GATE — created, validated and matched
```

`git grep` for `orgVerificationStatus`, `panStatus`, `checkFunderEligibility`
and `donorPersona` across `lib/requirements/`, `src/`, `app/api/requirements/`
and `app/donor/requirements/` returns nothing. `lib/matching/funder.ts` does
enforce the gate, but it guards the *other* (funder-led) engine, which this flow
does not use. So an unverified company can put an opportunity in front of a
verified NGO — the precise asymmetry the CSR verification work was built to
close.

*Fix:* call the funder check in `createRequirementFromForm`, the upload route,
and `runMatching`. Small, and it makes step 4 mean something.

**D-2 — there is no "request changes" on an NGO's proposal.** The donor's only
action on a response is *Select this NGO* (`ResponsesPanel.tsx:89` →
`selectResponse`). `OpportunityResponseStatus` contains `UNDER_REVIEW` and
`SHORTLISTED`, and **no code writes either** — they are dead values. Step 9 of
the acceptance test cannot be performed at all.

*Fix:* a `CHANGES_REQUESTED` status, a donor action that writes it with a
mandatory note, and an NGO-side reopen. This is the whole of the Week-5
collaboration loop and the largest single missing piece.

**D-3 — step 11 is a different act, and no screen says the required words.**
`selectResponse` moves the requirement to `SELECTED`, marks the chosen response
`SELECTED`, and **auto-rejects every other response** in the same transaction.
That is "pick a winner", not "approve version 2". The donor page then shows
*Initiate Contract*, not **"Proposal Approved — Ready for Contracting"**.
Functionally adjacent; verbally not the deliverable that was asked for.

*Fix:* either accept and restate the acceptance criterion, or add an explicit
approve-this-version transition ahead of selection, and the terminal wording.

### NGO portal

**N-1 — proposal v2 destroys v1.** `submitInterest` (`lib/requirements/opportunities.ts:200`)
calls `opportunityResponse.update` in place. There is a `RequirementRevision`
table for the *requirement* but nothing equivalent for a response, and
`@@unique([requirementId, ngoId])` guarantees one row. Confirmed in the run:
after submitting v2, one response row exists and v1's implementation plan is
gone. "V1 still readable" is impossible as the schema stands.

*Fix:* an `OpportunityResponseRevision` snapshot table written on every
resubmission, mirroring how `RequirementRevision` already works.

**N-2 — the NGO's portal state was verified at the service layer only.** The
invited opportunity is correctly visible — `listOpportunitiesForNgo` returned
"Education CSR opportunity in Karnataka" for the Kiran user — but the page was
not opened in a browser, because `kiran.welfare@example.org` was created through
the UI, not a seed, so no password is known and resetting a real user's
credential was out of scope. Everything the page renders comes from that call,
so the risk is presentational only, but it is untested.

*Fix:* seed the demo NGO through a seed script so the whole run is reproducible
from credentials in the repo.

**N-3 — "Interested / Not interested" is not state.** An NGO signals interest by
submitting a response; there is no explicit decline, and no queryable answer to
"who was invited and said no". `invitedAt` records the invitation; nothing
records a refusal.

### Admin portal

Admin is the strongest surface and the nav is now coherent — **Verification →
Approvals | Documents | FCRA | CSR requirements**, confirmed live, with the
funder-led Grants hub gone. Three gaps remain.

**A-1 — the shortlist review an admin is promised does not exist.** The donor's
match run renders **"Admin review: pending"**, and `GapReport.reviewStatus`
defaults to `PENDING`. `PUT /api/gap-analysis/report/[id]` can change it, but no
admin screen calls it: no page under `app/admin/` references `gapReport` or
`reviewStatus`. So every shortlist ever produced will read "pending" forever,
and the Week-4 human shortlist review is a label rather than a step.

*Fix:* either an admin review action on the gap report, or stop rendering a
review state nobody can resolve. Leaving it as-is is the worst option — it tells
the donor a check happened that did not.

**A-2 — two parallel funding engines are still installed.** `FundingOpportunity`
/ `MatchCandidate` / `Proposal` (admin-led, `lib/matching/*`) and
`SponsorRequirement` / `RequirementMatch` / `OpportunityResponse` (donor-led,
`src/agents/gap-diagnoser/*`) both ship, with overlapping vocabulary. The nav no
longer offers the first one, but `/admin/opportunities` and `/admin/proposals`
still resolve and still work. Two systems that answer the same question will
drift.

*Fix:* decide which is canonical. If the funder-led one stays for offline
funders, say so in `hubs.ts` and make it read-only; if not, delete it.

**A-3 — `predev` no longer applies migrations.** `origin/chat` changed it from
`prisma generate && prisma migrate deploy` to `prisma generate`, contradicting
CLAUDE.md. Whoever starts the demo server will not get pending migrations
applied, which is how a demo box ends up silently behind the schema.

---

## Cross-cutting: where the three portals could disagree

**X-1 — exclusion happens in two places and only one of them explains itself.**
`loadCandidates()` returned **1 of the 2 projects in the database**: Tejamma's
project is `DRAFT`, so it is filtered out *before* eligibility runs and produces
no `RequirementMatch` row, no verdict and no reason. An NGO excluded there is
invisible to all three portals — indistinguishable from an NGO that was never
considered.

```
PROBE 3 — loadCandidates() returned 1 of 2 projects
  → 1 never reaches eligibility at all
```

The happy-path run reported **"1 projects evaluated · 1 eligible · 0 excluded by
hard rules"**, so on demo day step 6 has nothing to show unless the ineligible
NGO clears candidate loading first. This is the one finding most likely to make
the demo look broken: the reasons machinery works, and the demo would show an
empty exclusion list anyway.

*Fix:* record a reason for candidate-stage exclusions too, even a coarse one
("project not active", "NGO not verified"), so "why am I not here" always has an
answer. **And for the demo: make the ineligible NGO's project `ACTIVE`** so the
FCRA exclusion actually renders.

**X-2 — hard rules cover registrations and FCRA; sector and geography are only
scored.** A wrong-sector NGO is not `INELIGIBLE` with a reason — it appears on
the shortlist with a lower score. The `WEEK5-FLOW.md` acceptance table promises
"ineligible — wrong sector"; the engine does not deliver that, by design
(`DIMENSION_WEIGHTS`: sector 25%, geography 20%). Either the doc or the engine
has to move.

**X-3 — thin data reads as a high score.** The run scored 82% on **70% coverage**,
with geography, track record, beneficiaries and reporting cadence all marked
insufficient-data because `Project.stateName` is null on every project in the
database. The coverage figure is shown honestly next to the score, which is
good, but a demo audience will read "82%" and not "70% of criteria had data".

**X-4 — residual schema drift.** `migrate diff` reports seven
`SponsorRequirement` columns carrying database-side defaults (`''`, `'{}'`,
`'UPLOADED'`) that `schema.prisma` does not declare, left by the reconcile
migration. Harmless at runtime; it will surface as drift on the next
`migrate dev`.

---

## Fix order

1. **D-1** wire the funder gate into the requirements workflow — smallest change, biggest correctness win, and it makes admin's step 4 real.
2. **X-1** give candidate-stage exclusions a reason, and make the demo's ineligible NGO reach eligibility so step 6 renders.
3. **D-2 + N-1** `CHANGES_REQUESTED` plus response revisions — steps 9 and 10, the only fully missing steps.
4. **A-1** resolve the phantom admin shortlist review, one way or the other.
5. **D-3** the terminal approval wording and transition.
6. **A-2 / A-3 / X-2 / X-4** engine consolidation, `predev`, the doc-vs-engine mismatch on sector, drift cleanup.
7. **N-2** seed the demo NGO so the whole run is reproducible from the repo.

Still true, and unaffected by any of the above: **there is no staging
environment.** Every line of the acceptance test says "on staging", and this run
happened on a developer laptop against the shared dev database.
