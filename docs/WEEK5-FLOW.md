# The Week-5 Flow: one connected NGO ↔ Donor workflow

Target, in one sentence: **a verified CSR posts a real requirement, the platform
excludes the NGOs that legally cannot participate, ranks the ones that can, the
NGO responds with a proposal, the donor asks for a change, and the second version
is approved — persisted, and visible identically in all three portals.**

This document is the flow we are building to. It says who acts at each step, what
the database state is called, and — honestly — what already exists in this repo
versus what does not.

---

## The one rule that must not be blurred

Two different questions, asked in a fixed order, never mixed:

| | Question | Output | May it be overridden? |
|---|---|---|---|
| **1. Eligibility** | *Can this NGO legally and contractually participate at all?* | `ELIGIBLE` / `INELIGIBLE` / `UNKNOWN` | No. A failed mandatory rule excludes. |
| **2. Matching** | *Among the eligible ones, how well does this NGO's project fit?* | a rank / fit score | Yes — it is advice to a human. |

Eligibility runs **first**, and the matching score is computed **only over the
survivors**. A high fit score on an ineligible NGO must never reach a shortlist,
because it invites someone to pick it.

`UNKNOWN` is a third outcome on purpose. "We could not evaluate this
organisation" must never render the same as "we checked and it passed."

### Worked example — the negative test

```
"International Foundation Education Grant"  requires  FCRA_ACTIVE
        |
JJRT's profile says  fcraStatus = NONE
        |
mandatory rule FAILS
        |
JJRT is marked INELIGIBLE for this opportunity
        |
its fit score is never computed, and it cannot appear on the shortlist
```

The same JJRT row is `ELIGIBLE` for the domestic CSR education opportunity —
sector, geography and budget all match and no FCRA rule applies. **One NGO, two
opportunities, two opposite verdicts** is the thing worth demonstrating: it shows
the platform is filtering, not just ranking whatever it finds.

Other mandatory rules that can legitimately exclude an NGO: wrong geography,
wrong thematic sector, a missing required registration (12A / 80G / CSR-1), an
**expired** mandatory document, too short an operating history, a project budget
outside the permitted range, or any other explicit donor condition.

> A missing 12A or 80G is only a failure when *that opportunity asked for it*.
> Plenty of legitimate NGOs hold neither. Absence is not a defect.

---

## The flow

### Weeks 1-2 — get verified participants in

```
NGO registers --> ADMIN verifies --> VERIFIED
CSR registers --> ADMIN verifies --> VERIFIED
                      \ reject / request correction -> fix -> resubmit
```

Admin's verification role is real and stays. Nothing unverified may enter
matching or proposals — on either side.

- NGO: `NGOProfile.verificationStatus` → `PENDING | VERIFIED | REJECTED`
- CSR: `User.orgVerificationStatus` → `NOT_SUBMITTED | PENDING | VERIFIED | REJECTED`

**Status: built, both sides.** The funder gate in `lib/matching/funder.ts` already
requires a donor to be institutional (`CSR_OFFICER` / `FOUNDATION` /
`GOVERNMENT`), PAN-verified **and** org-verified before it may stand behind money.

### Week 3 — both sides declare what they have and what they need

| NGO creates a project | CSR creates a requirement |
|---|---|
| sector, geography, beneficiary group, requested budget, duration, activities, milestones, expected outcomes, KPIs | sector, geography, available budget, expected beneficiaries, duration, KPIs, eligibility criteria, reporting expectations |

**Status: partly built.** `Project` has `causeCategory`, `location` /
`stateName` / `districtName`, `targetAmount`, `expected_outcome` and real
`Milestone` rows. It has **no** duration, no beneficiary group, and no structured
KPIs. `FundingOpportunity` + `OpportunityCriterion` cover the requirement and its
eligibility rules, but there is **no CSR-facing screen** that creates one — only
an admin screen.

### Week 4 — from requirement to a shortlist the NGO can see

```
CSR enters requirement  -- or --  CSR uploads an RFP document
                                          |
                               AI extracts sector, geography,
                               budget, duration, KPIs, criteria
                                          |
                            CSR reviews and corrects the extraction   <- human gate
                                          |
                                 requirement is VALIDATED
                                          |
                   +------ ELIGIBILITY CHECK (hard rules) ------+
                   |                                            |
              INELIGIBLE                                    ELIGIBLE
            excluded, with                                      |
            the reason kept                            PROJECT MATCHING / RANKING
                                                                |
                                                        RANKED SHORTLIST
                                                                |
                                                   HUMAN SHORTLIST REVIEW
                                                                |
                                              selected NGOs receive the opportunity
                                                                |
                                            NGO: "Interested" / "Not interested"
```

The extraction must be **reviewed by the CSR before it counts**. An AI reading of
a PDF is a draft, and a requirement nobody confirmed would silently decide who is
excluded.

**Status: the eligibility half is built; the ranking half is not.**

- Built: `OpportunityCriterion` rows (absence of a row = rule does not apply),
  the rule library in `lib/matching/rules.ts` — including `FCRA_ACTIVE`, exactly
  the JJRT case above — the runner, and `MatchCandidate` storing the verdict plus
  the per-criterion reasons for **every** rule evaluated, including the ones that
  passed.
- Missing: **RFP upload and AI extraction.** No such path exists; the nine
  `lib/gemini/*` passes are all NGO-document or project work.
- Missing: **the ranked shortlist.** `lib/matching/types.ts` says in as many
  words that there is deliberately no score, no ordering and no weighting. The
  engine answers eligible-or-not and stops. "Match: Strong / KPI alignment:
  Strong" is a second stage that does not exist yet — and the fields it would
  rank on (duration, beneficiary group, KPIs) are not on `Project` yet either.
- Missing: **the NGO's Interested / Not interested action.** `MatchCandidate`
  has one decision column and only the admin route writes it. The NGO has no say
  and no screen.

### Week 5 — proposal collaboration, ending in the donor's approval

```
NGO is interested
        |
NGO writes proposal V1 — programme, activities, beneficiaries, budget,
        |                milestones, outputs, outcomes, KPIs, reporting plan
NGO submits V1
        |
DONOR reviews -------------+
        |                  |
  REQUEST CHANGES       APPROVE
        |
NGO opens the requested changes, updates, submits V2      (V1 is retained)
        |
DONOR reviews V2
        |
     APPROVE
        |
APPROVED — READY FOR CONTRACTING / FUNDING
```

**Status: a single-shot admin-approved version of this exists; the collaboration
does not.**

- Built: the `Proposal` model, `lib/proposal-workflow.ts` as a real state machine
  with compare-and-swap transitions, and a rejection that cannot be recorded
  without a reason.
- Missing: **versioning.** One `Proposal` row per NGO per opportunity, no version
  column. "Retain V1" is not possible as the schema stands.
- Missing: **`CHANGES_REQUESTED`.** The status enum is `DRAFT | SUBMITTED |
  UNDER_REVIEW | APPROVED | REJECTED | WITHDRAWN`. There is no way to say "change
  this and come back", which is the whole of the Week-5 loop.
- Missing: **the donor as approver.** Today only an admin can approve, via
  `app/api/admin/proposals/[id]`. Week 5 needs the funder to hold that decision.
- Missing: **both screens** — the NGO's proposal editor and the donor's review.
- Available for reuse: `DonorInquiry` / `DonorInquiryMessage` and
  `app/ngo/inquiries` already give a donor↔NGO message thread.

---

## Where admin belongs in all this

Admin verifies both organisations (Weeks 1-2) and reviews the shortlist before
NGOs are approached (Week 4). Admin is **not** a step in the proposal loop — the
donor approves its own proposal. The one place admin must re-enter is the
exception: a **cross-border pairing**, a foreign funder with an NGO that cannot
receive foreign contributions, or the reverse.

That exception cannot be detected yet. The NGO side has the full FCRA lifecycle,
but the funder side has **no jurisdiction field at all** — `companyName`, `cin`,
`csrRegistrationNumber` and nothing about where the money is from. The
`DonorCategory` enum (`INDIAN_IN_INDIA` / `INDIAN_ABROAD` / `FOREIGN_NATIONAL`)
exists and `lib/fcra-gate.ts` uses it for donations, but it says where a *person*
is resident, not where a funding *organisation* is. Detecting a foreign CSR needs
a field and a migration before any rule can fire.

---

## Build order (each item unblocks the one below it)

1. **`Project` fields** — duration, beneficiary group, structured KPIs. Nothing
   can be ranked on data that is not captured.
2. **CSR-facing opportunity screens** — create, edit criteria, publish. Replaces
   the admin doing it on the funder's behalf.
3. **RFP upload + AI extraction + CSR confirmation.** One Gemini pass, fixture-
   pinned tests, and the extraction is a *draft* until the CSR confirms it.
4. **The ranking stage** — a new, clearly separate layer over the eligible set.
   Do not put a score inside `lib/matching/eligibility.ts`; the gate stays a gate.
5. **NGO shortlist screen** + Interested / Not interested, as its own column.
6. **Proposal versioning** + `CHANGES_REQUESTED` + donor-held approval.
7. **NGO proposal editor** and **donor review screen.**
8. **Funder jurisdiction field** + the cross-border exception queue for admin.

---

## The acceptance test

Two NGO fixtures, two opportunities, four cells:

| | Domestic CSR education RFP | FCRA-required international RFP |
|---|---|---|
| **JJRT** — education, Telangana, `fcraStatus = NONE` | eligible | ineligible — no FCRA |
| **Second NGO** — health only, Karnataka | ineligible — wrong sector | ineligible — wrong sector, and FCRA |

Then one uninterrupted run, on staging, three people, no database edits in
between:

1. NGO — register, create the project
2. Admin — verify the NGO
3. Donor — register the CSR org, upload the RFP
4. Admin — verify the donor
5. Donor — show the AI-extracted requirements, correct one value
6. Platform — show the ineligible NGO excluded, **with its reason**
7. Platform — show the eligible NGO on the ranked shortlist
8. NGO — open the matched opportunity, submit proposal V1
9. Donor — request a change
10. NGO — submit V2, with V1 still readable
11. Donor — approve V2 → **Proposal Approved — Ready for Contracting**

Week 5 passes when that runs clean, the state persists, and all three portals
agree about it.

> Step 6 is the one to insist on. An excluded NGO that cannot say *why* it was
> excluded is indistinguishable from a bug, and the reasons are already stored
> per criterion — they only need showing.

---

## Open decisions

- **Staging.** Every acceptance criterion above says "on staging" and there is no
  staging environment. This is the top blocker, ahead of any of the eight build
  items.
- **Who owns the shortlist review** in Week 4 — admin, as drawn here, or the CSR?
  The two readings send the work to different panels.
- **Can an offline funder still be served by admin?** If the admin opportunity
  screens are removed rather than made read-only, a funder without an account
  cannot be represented at all.
