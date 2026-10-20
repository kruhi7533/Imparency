# ImpactBridge — end-to-end walkthrough, week by week

How to run every check, and how to see every feature yourself, in the order the
roadmap built them: Week 1 → Week 12, each week across NGO, donor and admin.

- **Part A** sets up your machine (once).
- **Part B** runs all the automated checks (about 25 minutes).
- **Part C** is the hands-on tour, week by week: who to log in as, which page
  to open, what to do, and what you should see.
- **Part D** covers resetting, troubleshooting, and what is not yet built.

---

## Part A — Set up (once)

You need Node.js 20+ and this repository on the branch with all three tracks:
`feat/admin-platform` (it contains the NGO and donor branches too).

```bash
git fetch origin
git checkout feat/admin-platform
npm install
npx playwright install chromium        # browser for the end-to-end tests
```

### A1. Database

`.env` must point at the dev database (`DATABASE_URL` and `DIRECT_URL`). Check
it is current:

```bash
npm run db:status          # expect: "Database schema is up to date!"
```

The shared dev database was already updated (54/54 migrations) and seeded on
2026-10-21. If you point at a **new, empty** database instead, run
`npx prisma migrate deploy`, then the seeds in A2.

### A2. Demo data

All three of these are safe to re-run (they only add what is missing). Each
does a dry run unless you pass `-- --apply`:

```bash
npx tsx -r dotenv/config tools/seed-metric-registry.ts -- --apply   # the 5 governed impact metrics
npm run seed:csr -- --apply      # Acme Industries CSR company + its team + one requirement
npm run seed:ngo -- --apply      # Akshar NGO's finance + field staff, field tasks, matching profiles
```

> **Do not run `npm run seed` on the shared dev database.** The base seed
> deletes *every* fraud alert in the database (not just demo ones) and
> recreates the demo NGOs. It is only for a fresh, private database, and it
> must run *before* the three seeds above.

### A3. Logins

Every demo password is `demoPassword123` unless stated.

| Role | Email | Used for |
|---|---|---|
| Admin | `admin@impactbridge.com` / `adminpassword123` | Admin console |
| NGO owner | `akshar@demo.org` | Akshar Foundation |
| NGO finance | `finance.akshar@demo.org` | Confirming payments |
| NGO field staff | `field.akshar@demo.org` | Field App |
| Other NGOs | `jeevan@demo.org`, `greenroots@demo.org`, `sahaara@demo.org`, … | Tenant isolation, Riverbank Cleanup (incomplete profile) |
| CSR owner | `csr.acme@demo.com` | Acme Industries |
| CSR approver | `approver.acme@demo.com` | Approves proposals, signs, pays |
| CSR viewer | `viewer.acme@demo.com` | Read-only team member |
| Individual donor | `priya.sharma@demo.com` | Donations, isolation checks |

### A4. Start the app

```bash
npm run dev
```

It applies any pending migration, then serves on **http://localhost:3000**.

> If port 3000 is already used by another program, Next.js silently moves to
> 3001. The browser tests expect 3000, so stop the other program first. On
> Windows: `netstat -ano | findstr :3000`, then end that process.

The first visit to each page in dev mode compiles it (5–30 seconds). That is
normal; the second visit is instant.

---

## Part B — Run all the automated checks

Run these in a second terminal while `npm run dev` is running.

| # | Command | What it proves | Time |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | The whole codebase type-checks | ~1 min |
| 2 | `npm test` | 2,220 unit tests: rules, permissions, tenant isolation, idempotency, AI guards (no database needed) | ~2 min |
| 3 | `npx next build` | Every page compiles exactly as in production, including browser bundles. Use this, **not** `npm run build` (that one still runs `db push`; see Part D) | ~5 min |
| 4 | `npm run e2e:donor` | 10 donor journeys in a real browser | ~3 min |
| 5 | `npm run e2e:ngo` | NGO portal pages | ~2 min |
| 6 | `npm run e2e:admin` | 20 admin console checks | ~3 min |
| 7 | `npm run e2e:security` | Access control and negative cases | ~2 min |
| 8 | `npm run e2e:e2e` | 8 cross-portal journeys | ~3 min |
| 9 | `npm run e2e:golden` | **The full product, end to end**, in two journeys (below) | ~4 min |

To **watch** a browser test instead of running it headless, add `-- --headed`
(e.g. `npm run e2e:golden -- --headed`). Playwright's step-by-step UI is
`npx playwright test --ui`. After any run, `npm run e2e:report` opens the HTML
report, with screenshots of failures.

### The two golden journeys (step 9)

**`golden-path.spec.ts`: contracts and money.** Covers Weeks 2 and 4–6.

1. Admin verifies Acme and its PAN.
2. The donor creates and submits a CSR requirement, and admin validates it.
3. The approver runs matching and invites Akshar.
4. Akshar proposes v1; the donor requests a change; Akshar submits v2; the
   approver approves.
5. The contract is drafted, proposed and signed by both sides, and Akshar
   accepts it.
6. The approver records the full payment and Akshar's finance member confirms
   it. The project is **FUNDED**, Akshar is notified, and the donor report
   exports.

**`golden-path-impact.spec.ts`: evidence and impact.** Covers Weeks 7–8.

1. Field staff capture a photo. Donors cannot see it before review.
2. Admin approves it. The funding donor can now see it; a donor from another
   organisation gets a 404.
3. Akshar files an outcome claim citing the photo. The donor report reads
   **unverified** until admin approves it, then shows the verified figure.

---

## Part C — See it yourself, week by week

Each week: **the Friday proof** (what the roadmap promised), the automated
tests that pin it, then what to click. Use a private/incognito window per role
so you can be logged in as two people at once.

### Week 1 — Three portals log in and keep real records; outsiders are blocked

Tests: `tests/tenant-isolation.test.ts`, `tests/login-rate-limit.test.ts`,
`tests/tenant-isolation-donor-admin.test.ts`, `e2e-tests/security.spec.ts`.

| As | Open | Do | Expect |
|---|---|---|---|
| Anyone (logged out) | `/admin/today`, `/donor/requirements`, `/ngo/dashboard` | Open directly | Redirected to `/login` |
| NGO `akshar@demo.org` | `/login` | Sign in | NGO dashboard with Akshar's projects |
| Donor `priya.sharma@demo.com` | `/admin/today` | Open directly | Sent to `/unauthorized`, never the admin page |
| Admin | `/admin/today` | Sign in | The admin inbox: what needs you now |
| Admin | `/admin/audit` | Filter by action or date; **Export CSV** | Every admin decision, with who and when |
| Admin | `/admin/platform-trail` | Choose a source | Contract, requirement, compliance and donor-account history in one timeline |

### Week 2 — Submit → admin verifies → status changes; tenant isolation

Tests: `admin-verify-ngo`, `admin-org-review`, `csr-verification`,
`verification-triage`, `document-access`.

| As | Open | Do | Expect |
|---|---|---|---|
| New user | `/ngo/register` | Fill the form, upload a PDF | Registration submitted; the AI reads the documents once |
| Admin | `/admin/verification` | Open the NGO | Extracted fields with confidence; Approve is only possible with evidence |
| Admin | `/admin/document-review` | Validate a field | The field becomes VALIDATED; only then does it earn its compliance badge |
| Admin | `/admin/donor-orgs` | Open Acme | The CSR company verification queue, oldest first |
| Admin | `/admin/donors/<Acme>` | Verify organisation; verify PAN | Status VERIFIED; both appear in the donor's timeline |
| NGO owner | `/ngo/settings/team` | Invite a teammate | Invite sent; on signup they join automatically |
| CSR owner | `/donor/team` | See the approver and viewer; add someone | Roles: Admin, Approver, Viewer |

### Week 3 — A verified NGO initiative and a versioned CSR opportunity, ready for matching

Tests: `requirement-routes`, `requirement-status`, `requirement-form`,
`versioning`, `project-readiness-and-cohort`, `requirement-withdraw`.

| As | Open | Do | Expect |
|---|---|---|---|
| NGO owner | `/ngo/projects/new` | Create a project with beneficiaries ("who" and "how many") | Sent for admin approval |
| Admin | `/admin/project-review` | Approve | Project ACTIVE |
| NGO owner | `/ngo/projects/<id>` | **Beneficiary cohort & matching profile** panel | Checklist; **Ready for matching** when complete. Saving does not send a live project back for approval |
| NGO `greenroots@demo.org` | Riverbank Cleanup project | — | "3 to complete" (left incomplete on purpose) |
| Admin | `/admin/projects` | — | Per project: Ready for matching, or "N missing" |
| CSR owner | `/donor/requirements` | **Create from form** or **Upload** | A requirement; edits make new versions (Version history tab) |
| CSR viewer | Same requirement | Try to edit or withdraw | "View-only access" banner; the server refuses |
| CSR owner | A draft requirement | **Withdraw this requirement…** | Requires a reason; any NGOs that responded are told |

### Week 4 — CSR document → extraction → eligibility → ranked shortlist → human review

Tests: `matching-eligibility`, `matching-engine`, `matching-job-runner`,
`requirements-agent`, `extraction-guardrails`, `ai-regression`.

| As | Open | Do | Expect |
|---|---|---|---|
| CSR owner | Upload a CSR PDF on `/donor/requirements` | Wait for processing | Fields extracted with confidence; low-confidence ones flagged ⚠ |
| CSR owner | The requirement | Correct a field; **Submit for verification** | Marked as donor-corrected; pending admin |
| Admin | `/admin/requirements` | Validate | VALIDATED |
| CSR approver | The requirement → **Find matches** | — | Ranked NGO projects; each score explained per dimension (sector, state, budget, beneficiaries, reporting cadence, KPIs). Ineligible NGOs are listed separately with the reason |
| CSR approver | A match → **Invite** | — | The NGO sees a brief, never your document |

### Week 5 — Proposal v1 → change request → v2 → gated, audited approval

Tests: `ngo-proposal-workflow`, `ngo-proposal-submit`,
`response-change-requests`, `response-versioning`, `admin-audit-coverage`.

| As | Open | Do | Expect |
|---|---|---|---|
| NGO owner | `/ngo/match-inbox` or `/ngo/opportunities` | Respond with a budget, plan and milestones | Proposal v1 submitted |
| CSR owner | Requirement → **NGO responses** | Ask the assistant "What is the budget?" | An answer citing the proposal, or "The proposals do not say." |
| CSR owner | Same | **Request changes** with a note | The NGO is notified; status *Changes requested* |
| NGO owner | The opportunity | Revise and resubmit | v2; both versions kept |
| CSR approver | Same | **Approve** v2 | SELECTED; other proposals declined; the approved version is pinned |

### Week 6 — Commitment → payment → reconciliation → allocation → FUNDED

Tests: `contract-payments`, `project-funding`, `bank-statement`, `ledger`,
`reconciliation`, `allocation-*`, `donations-webhook`,
`contract-rate-limits`, `contract-amounts`, `four-eyes`.

| As | Open | Do | Expect |
|---|---|---|---|
| CSR owner | `/donor/contracts/new` | Draft from the approved proposal | Milestones must add up to the grant exactly, to the paisa |
| CSR approver + NGO owner | `/donor/contracts/<id>`, `/ngo/contracts/<id>` | Both sign; the NGO **accepts** the funded project | Contract ACTIVE; no payment can be recorded before acceptance |
| CSR approver | Contract → **Record payment** (sandbox) | — | Pending NGO confirmation |
| NGO finance | `/ngo/projects/<id>` funding panel, or `/ngo/bank-reconciliation` (upload a statement CSV) | **Confirm** | RECONCILED; when everything is confirmed, **Funded ✓** on NGO, donor and admin pages; one notification each |
| CSR viewer | Contract | — | No "Record payment" button; the API refuses |
| Admin | `/admin/finance` | Run reconciliation | Ledger matches; any mismatch appears as an exception |
| Admin | `/admin/allocations` | Approve an allocation you proposed | Refused (four-eyes); another admin must approve |
| Donor `priya.sharma@demo.com` | `/discover` → a project → Donate | Sandbox payment | Donation recorded via the webhook; receipt when eligible |

### Week 7 — Money → field work → evidence → verification → donor visibility (consent)

Tests: `field-evidence`, `field-task-edit`, `consent-withdrawal`,
`proof-field-evidence`, `evidence-duplicates`, `proof-duplicate-detection`,
`donor-funded-view`, `grievance-*`.

| As | Open | Do | Expect |
|---|---|---|---|
| NGO owner | `/ngo/projects/<id>` → Field tasks | Assign, edit or cancel a task | Only OPEN tasks can change |
| Field staff | `/ngo/field` (try phone width) | Capture a photo, note and GPS; try offline, then **Sync now** | Saved on the device first, synced later |
| Admin | `/admin/field-evidence` | Approve | The task completes |
| CSR owner | `/donor/funded/<projectId>` | — | Approved photos only; photos with people only if the beneficiary consented |
| NGO owner | Field tasks → **Beneficiary withdrew consent** | Confirm | The photo disappears for donors at once |
| NGO owner | Dashboard → Submit milestone proof | Tick approved field evidence instead of uploading | Attached by reference; never made public |
| Admin | `/admin/proof-review` | Review | Attached field photos shown; approve or reject |
| Anyone | `/report-concern` | File a grievance | Visible only to admins at `/admin/grievances` |

### Week 8 — Approved evidence → governed outcome → gated approval → backed donor figure

Tests: `metric-registry`, `outcome-workflow`, `outcome-claim-routes`,
`outcome-triage`, `outcome-cockpit`, `outcome-extraction`, `impact-quality`,
`donor-impact`.

| As | Open | Do | Expect |
|---|---|---|---|
| Admin | `/admin/metrics` | — | The 5 governed metrics, each with its required evidence |
| NGO owner | `/ngo/impact` → Report an outcome | Pick a metric and value; cite approved evidence; **Check against review** | The triage verdict shown before you submit |
| NGO owner | Same → **Suggest from evidence (AI)** | — | Suggested values quoting their source, or "insufficient data" |
| NGO owner | Save draft → **Submit** | — | SUBMITTED and locked |
| Admin | `/admin/impact-review` | Approve (a BLOCKED claim is refused) | APPROVED |
| CSR owner | `/donor/impact-report` → Print / **Download CSV** | — | Approved figures shown; everything else "unverified", never 0 |
| Admin | `/admin/impact-quality` | — | How much of what is reported is actually backed |

### Week 9 — Reliability: jobs, SLA, correlation, AI regression

Tests: `job-runner`, `admin-ops-run`, `sla-escalation-and-health`,
`middleware-correlation`, `ai-regression`, `re-engagement`.

| As | Open | Do | Expect |
|---|---|---|---|
| Admin | `/admin/ops` | **Run now** on any job | Run recorded as MANUAL; a run already in progress is skipped |
| Admin | `/admin/sla` | — | Queues past their response target; a daily digest notifies admins |
| Anyone | Browser dev tools → Network → any request | — | Every response carries an `x-correlation-id` header |
| Admin | `/notifications` | — | The full notification list (also behind the bell) |

### Week 10 — Pilot readiness: health, backups, runbook

Docs: `docs/RUNBOOK.md`, `docs/PILOT-READINESS.md`.

| As | Open | Do | Expect |
|---|---|---|---|
| Anyone | `/api/health` | — | `{"status":"ok","database":"up"}` |
| Admin | `/admin/pilot-health` | — | Red, amber or green, each line linking to where you act |
| Engineer | `node -r dotenv/config tools/db-backup.mjs` | Needs `pg_dump` 16+ | A dump in `backups/`; restore with `tools/db-restore.mjs --target <scratch DB>` (it refuses the live database) |

### Week 11 — Security, accessibility, audit

Tests: `csrf`, `costly-route-rate-limits`, `security-headers`,
`tenant-isolation-donor-admin`, `ngo-accessibility`, `admin-search`,
`platform-trail`, plus `e2e:security`.

| As | Open | Do | Expect |
|---|---|---|---|
| Any role, phone width | Any page | Open the menu | Every page reachable; nothing overlaps |
| Admin | `/admin/search` | Search an email, PAN or contract number | Results across all records; the query never appears in the URL |
| Donor or NGO | `/donor/activity`, `/ngo/activity` | — | Their own audit trail; admins appear as "Platform reviewer" |

### Week 12 — Handover

Read in order: `docs/NGO-HANDOVER.md`, `docs/DONOR-HANDOVER.md`,
`docs/ADMIN-HANDOVER.md`, `docs/AI-EVALS.md`, `CHANGELOG.md`.

The UAT scripts for real users are in `docs/NGO-GUIDE.md` and
`docs/DONOR-GUIDE.md`.

---

## Part D — Reset, troubleshooting, not built

### State of the shared dev database right now

The verification run on 2026-10-21 already pushed the demo data through the
whole flow:

- Acme is verified (organisation and PAN), and its seeded requirement is VALIDATED.
- A second requirement went all the way to CONTRACTED. Its contract is ACTIVE
  and fully paid, and the Akshar project is **FUNDED**.
- One field photo and one outcome claim are approved.

So you can **see** every end state immediately (Week 6–8 pages have real
data). To **walk the flow again from scratch**, create a new requirement from
the form on `/donor/requirements`. `npm run e2e:golden` does exactly that.

### If something fails

| Symptom | Cause | Fix |
|---|---|---|
| Every URL redirects to `/auth/sign-in` | Another app is on port 3000 | Stop it (Part A4) |
| A page shows "Schema out of sync" | The database is behind the code | `npm run db:status`, then `npx prisma migrate deploy` |
| Browser test times out on the first page | Dev mode compiling on first visit | Re-run; or warm up by opening the page once |
| "Executable doesn't exist" from Playwright | Browser not installed for this version | `npx playwright install chromium` |
| Matching refused: "PAN is unverified" | The funder gate, working as designed | Admin verifies the PAN on the donor page |
| `npm run build` warns about data loss | It still runs `db push` (open P0) | Use `npx next build` locally; see `docs/RUNBOOK.md` §5 |

### Not built, or not yet done (see `docs/PILOT-READINESS.md`)

- No staging environment or RC deployment. `main` protection and CI database
  secrets are GitHub settings for the team.
- The build-script P0 (needs production access), the hosting decision, the
  restore drill, scheduler and monitoring setup.
- UAT with real NGO and donor users, and pilot observation (people work).
- Payouts are deliberately not built: the platform records money, it does not
  move it.
