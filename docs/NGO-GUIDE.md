# ImpactBridge for NGOs — guide and UAT script

For NGO staff using the platform, and for whoever runs the NGO/field user
acceptance test (roadmap row 14). Plain language first; the engineering detail
is in [`ARCHITECTURE.md`](ARCHITECTURE.md) §13–16.

---

## The short version

You register, an admin checks your documents, and then you can publish
projects. Companies with CSR budgets find your projects, ask for proposals,
and sign contracts. When they pay, **you** confirm the money arrived. Your
field team records evidence from the ground. You then report outcomes, such
as "1,200 students reached", and back each number with that evidence. A donor
sees the number only after a human has checked it.

Nothing you report reaches a donor unchecked. That is the product, not a delay.

---

## Who can do what in your organisation

| Role | Can do |
|---|---|
| **Owner** (the account that registered) | Everything below, plus submit and withdraw outcome claims |
| **Admin** | Manage projects and the matching profile, assign field tasks, confirm or dispute payments |
| **Finance** | Confirm or dispute payments |
| **Field staff** | See and complete only their own field tasks, capture evidence and beneficiary feedback |

Invite people from **Settings → Team** (`/ngo/settings/team`).

---

## 1. Get verified

`/ngo/register` → upload your registration certificate, plus 12A and 80G if
you have them. Not having 12A or 80G is **not** a problem; you simply don't
get those badges.

The platform reads your documents once with AI, then an admin checks them. You
can't publish projects until you are verified.

## 2. Publish a project

`/ngo/projects/new`. Describe the problem, the outcome, the budget, the
milestones, and **who the beneficiaries are and how many**. An admin approves
the project before it goes live.

> Editing the main project details later sends a live project back for
> approval. The **Beneficiary cohort & matching profile** panel on the project
> page does not. Use it to keep matching data current.

## 3. Be ready for matching

On `/ngo/projects/[id]`, the matching-profile panel shows a checklist. A
project is **Ready for matching** when it has:

- a cause / sector and the state it works in (set in the main project form);
- a beneficiary cohort of at least one person, and a description of who they are;
- a duration in months.

Outcome KPIs and reporting cadence are optional, but they make the match
sharper. A CSR requirement asking for "1,000 beneficiaries, quarterly reports"
is compared directly against what you declare here. If you leave a field
blank, the match reads "insufficient data" for it rather than guessing.

Admins see the same readiness on `/admin/projects`.

## 4. Respond to opportunities and sign

`/ngo/opportunities` and `/ngo/match-inbox` list CSR requirements you fit.
Submit a proposal (`/ngo/proposals/...`); the funder may ask for changes.
Once a contract is signed, an Owner or Admin must **accept** it before any
payment can be recorded.

## 5. Confirm money

When the funder records a payment, it waits for you on the project page
(`/ngo/projects/[id]`, Funding panel). An Owner, Admin or Finance member
either:

- **Confirms** it once the money is in your bank, or
- **Disputes** it with a note. This opens a case the platform's finance team
  sees.

Only confirmed money counts. When confirmed payments cover everything every
signed contract committed, the project shows **Funded ✓**. You and the funder
are each notified once.

## 6. Field work and evidence

Owners and Admins assign tasks. Field staff open **Field App** (`/ngo/field`)
on a phone. It works offline, and captures sync when signal returns.

- Photos are stored privately. Location and a fingerprint are checked
  automatically, so a reused photo gets flagged.
- If a photo shows people, record their consent. Without consent to share, a
  donor never sees it, even after approval.
- Beneficiary feedback uses a reference code, never a name. The beneficiary
  can withdraw consent later, and that takes effect everywhere.

An admin reviews each item and either approves it, asks for a resubmission,
or rejects it.

## 7. Report outcomes

**Impact** (`/ngo/impact`) is where numbers come from.

1. **New claim** → pick the project, the metric (from the platform's metric
   registry), the value and period, and describe your method.
2. **Cite evidence.** Only approved evidence from your own organisation is
   offered.
3. **Check against review** shows what the reviewer will see before you
   submit. A *blocked* claim cannot be approved. Typical reasons: no evidence,
   evidence not yet approved, wrong unit, or the same evidence already counted
   in another claim.
4. **Suggest from evidence (AI)** reads your approved proofs and field notes
   and proposes values. Every suggestion quotes the exact text it came from.
   When the evidence doesn't say, it answers *insufficient data* rather than
   guessing. A suggestion is only a draft: you still save it and submit it.
5. **Submit.** If the reviewer asks for evidence, edit and resubmit. Once
   approved, a claim **cannot be edited**, only withdrawn with a reason,
   because a funder may already have seen it.

Donors see approved, still-backed numbers on their funded-project page.
Anything else shows as **unverified**, never as zero.

---

## UAT script (NGO + field)

Run on a fresh dev database:

```bash
npx prisma migrate deploy
npm run seed
npx tsx -r dotenv/config tools/seed-metric-registry.ts -- --apply
npx tsx -r dotenv/config tools/seed-ngo-demo.ts -- --apply
```

Every account's password is `demoPassword123`. The admin account is
`admin@impactbridge.com` / `adminpassword123`.

| # | As | Do | Expect |
|---|---|---|---|
| 1 | `akshar@demo.org` | Open each project's page | Every project shows **Ready for matching** |
| 2 | `greenroots@demo.org` | Open *Riverbank Cleanup Campaigns* | "3 to complete"; fill the panel → **Ready**; project status unchanged |
| 3 | admin | `/admin/projects` | Riverbank row flips from "N missing" to "Ready for matching" |
| 4 | `field.akshar@demo.org` | `/ngo/field` | Sees only the 3 seeded tasks; capture a photo offline, go online, it syncs |
| 5 | `finance.akshar@demo.org` | Try to edit the matching profile | Refused (owners/admins only) |
| 6 | admin | `/admin/field-evidence` | Approve the photo; the task becomes COMPLETED |
| 7 | `akshar@demo.org` | `/ngo/impact` → new claim citing that evidence → **Check against review** | Verdict shown, nothing saved |
| 8 | `akshar@demo.org` | **Suggest from evidence (AI)** | Each metric is a quoted value or *insufficient data* |
| 9 | `akshar@demo.org` | Save draft → Submit | Claim is SUBMITTED; the editor locks |
| 10 | admin | `/admin/impact-review` | Approve (or a BLOCKED claim is refused) |
| 11 | contract donor | `/donor/funded/[projectId]` | The approved figure shows; any other claim reads "unverified" |
| 12 | donor + `finance.akshar@demo.org` | Record the final payment, then confirm it | Project shows **Funded ✓**, one notification each |

Record the pass/fail, device and browser for each row. Rows 4 and 6 should
also be run on a real phone with mobile data switched off and then on.

---

## Not built yet

- Payouts from the platform. The platform records money but moves none.
- An in-app notifications list. Notifications are stored and pushed, but there
  is no bell or inbox yet.
- Editing or cancelling a field task after it is assigned.
