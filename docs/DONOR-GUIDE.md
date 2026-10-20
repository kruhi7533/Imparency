# ImpactBridge for donors and CSR teams — guide and UAT script

For donors, for CSR teams at companies, and for whoever runs the donor user
acceptance test (roadmap row 14). Plain language first; the engineering detail
is in [`ARCHITECTURE.md`](ARCHITECTURE.md) §13.7, §14.1, §15.1, §16 and §17.

---

## The short version

There are two ways to fund work here:

- **Give** to an NGO project you find on **Discover** — a card or UPI payment,
  with an 80G receipt where the NGO is eligible.
- **Fund through CSR** — publish what your company wants to fund, get matched
  with verified NGOs, review their proposals, sign a contract, pay against
  milestones, and receive outcomes that a human has checked.

Either way, every figure you are shown about impact has been reviewed. If it
has not, it says **unverified** — never 0.

---

## Your CSR team

A company account can have several people. Add them from **Team**
(`/donor/team`).

| Role | Can do |
|---|---|
| **Owner** (the account that registered) | Everything |
| **Admin** | Everything, including the team (only the owner adds admins) |
| **Approver** | Run matching, invite NGOs, ask for changes, approve a proposal, sign contracts, record payments — not edit the requirement itself |
| **Viewer** | See everything, change nothing |

Requirements, contracts and verification belong to the company, not to a
person: when someone leaves the team, the work stays.

---

## 1. Get your organisation verified

**Profile** (`/donor/profile`) → choose *CSR officer*, then enter the company
name, CIN, CSR registration number, CSR budget, your CSR policy in brief and
your focus areas. An admin checks the company and approves it. Until then you
can prepare a requirement, but you cannot put it in front of NGOs.

## 2. Publish what you want to fund

**CSR Requirements** (`/donor/requirements`): upload your CSR document (the AI
reads it and you correct anything it got wrong) or fill in the form. Sector,
state, budget, beneficiaries, KPIs and reporting cadence are what matching
compares, so fill them in. Then **submit for admin verification**.

Changed your mind? **Withdraw** it (a reason is required) at any point before
you approve a proposal. Any NGO that responded is told it was withdrawn — not
that its proposal was judged.

## 3. Find and choose an NGO

Once an admin validates the requirement, **Find matches** ranks verified NGO
projects against it and explains every score. Invite the ones you like; they
see a brief, never your document. Review proposals, ask for changes, and use
the **assistant** to ask questions — it answers only from the proposals and
cites them, or says *"The proposals do not say."*

## 4. Contract and pay

Approving a proposal lets you draft a **contract** with milestones. Both sides
sign; the NGO accepts. You record each payment (sandbox or a manual bank
reference); the NGO confirms it arrived, or matches it from its bank statement.
Only confirmed money counts. When every committed rupee is confirmed, the
project shows **Funded ✓**.

## 5. Follow the work

- **Funded project** (`/donor/funded/[projectId]`): milestones, your money,
  approved field photos (only ones the beneficiary agreed to share) and
  reported outcomes.
- **Impact Feed**: updates from projects you follow. Tell the NGO whether an
  update was useful — they see it without your name.
- **Notifications**: everything we told you, in one list.

## 6. Report

**Impact Report** (`/donor/impact-report`): every project you fund, your
money, verified milestones and outcomes, and a portfolio total per metric that
counts verified figures only. **Print / save as PDF** for your board, or
**Download CSV**. Outcomes are the project's; they are not divided by your
share of its funding.

**Activity** (`/donor/activity`) is your audit trail: requirements, contracts,
payments, donations and verification, newest first.

---

## UAT script (donor + CSR)

```bash
npx prisma migrate deploy
npm run seed
npm run seed:csr -- --apply
npm run seed:ngo -- --apply
npx tsx -r dotenv/config tools/seed-metric-registry.ts -- --apply
```

Passwords: `demoPassword123`; admin `admin@impactbridge.com` / `adminpassword123`.

| # | As | Do | Expect |
|---|---|---|---|
| 1 | admin | `/admin/donors` → Acme Industries → verify the organisation | Status VERIFIED; the decision is in its timeline |
| 2 | `csr.acme@demo.com` | `/donor/requirements` → open the seeded requirement → submit for verification | Pending admin review |
| 3 | admin | `/admin/requirements` → validate it | Validated |
| 4 | `approver.acme@demo.com` | Open it → **Find matches** → invite Akshar | Ranked list with reasons; Akshar invited |
| 5 | `viewer.acme@demo.com` | Open it; try to withdraw | "View-only" banner; the API refuses |
| 6 | `akshar@demo.org` | `/ngo/match-inbox` or `/ngo/opportunities` → respond with a proposal | Proposal submitted |
| 7 | approver | Ask the assistant "What is the budget?"; request a change; then approve the revision | Cited answer; change sent; approved |
| 8 | owner + NGO | Draft and sign the contract; NGO accepts | Contract ACTIVE |
| 9 | approver + `finance.akshar@demo.org` | Record a payment for the full amount; NGO confirms | **Funded ✓** on both sides, one notification each |
| 10 | NGO + admin | Field evidence → outcome claim → admin approves (see NGO-GUIDE rows 4–10) | Claim APPROVED |
| 11 | owner | `/donor/impact-report`; print; download CSV | Approved figure shown; others read "unverified" |
| 12 | owner | Impact Feed → mark an update "I'd like more detail" with a note | NGO project page shows it, without your name |
| 13 | owner | `/donor/team` → add a colleague as viewer; `/donor/activity` | Member added; team and contract events listed |
| 14 | any donor on a phone | Open the donor menu → Impact Report | Menu opens below the navbar and navigates |

Record pass/fail, device and browser for each row.

---

## Not built yet

- Payouts moved by the platform (it records money, it does not move it).
- A deep link from each notification to the thing it is about.
- A downloadable PDF generated on the server (printing from the browser is the
  route today).
