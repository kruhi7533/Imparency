# Donor track — handover

For the engineer who picks up the donor side next (roadmap row 16). What
lives where, what must not break, how to stand it up, what is still open.
User-facing behaviour: [`DONOR-GUIDE.md`](DONOR-GUIDE.md). Code detail:
[`ARCHITECTURE.md`](ARCHITECTURE.md) §13.5, §13.7, §14.1, §15.1, §17. AI:
[`AI-EVALS.md`](AI-EVALS.md).

## 1. Stand it up

```bash
npx prisma migrate deploy
npm run seed
npm run seed:csr -- --apply      # Acme Industries CSR account, team, one requirement
npm run seed:ngo -- --apply
npx next dev -p 3001
```

Donor-track migrations added most recently (additive, idempotent):
`20261021120000_requirement_withdrawn`, `20261021130000_donor_update_feedback`,
`20261021140000_donor_team`, `20261021150000_csr_policy_profile` — plus the NGO
track's list in `NGO-HANDOVER.md`. On the shared dev database, recompute the
schema difference rather than replaying migrations (see that file).

## 2. Module map

| Capability | Page | API | Rules (lib) | Tests |
|---|---|---|---|---|
| Profile, persona, PAN, org verification, CSR policy | `/donor/profile`, `/donor/onboarding` | `api/donor/profile`, `api/donor/persona` | `csr-verification`, `donor-events` | `csr-verification`, `donor-csr-policy` |
| Team roles | `/donor/team` | `api/donor/team/*` | `donor-team`, `donor-team-admin` | `donor-team` |
| CSR requirements | `/donor/requirements/*` | `api/requirements/*` | `requirements/*` (status, workflow, access) | `requirement-*`, `requirement-withdraw` |
| Matching & proposals | requirement detail | `api/requirements/[id]/matches`, `select`, `responses/*` | `gap-diagnoser/*`, `requirements/opportunities` | `matching-*`, `response-*` |
| Proposal assistant | requirement detail | `api/requirements/[id]/assistant` | `requirements/proposal-assistant` | `proposal-assistant`, `ai-regression` |
| Contracts & payments | `/donor/contracts/*` | `api/contracts/*` | `contract-service`, `contract-payments`, `project-funding` | `contract-payments`, `project-funding` |
| Funded view, evidence | `/donor/funded/[projectId]` | `api/field/evidence/[id]/photo` | `field-evidence`, `outcome-cockpit` | `donor-funded-view`, `field-evidence` |
| Impact report | `/donor/impact-report` | `api/donor/impact-report` | `donor-impact`, `outcome-format` | `donor-impact` |
| Activity / audit | `/donor/activity` | — | `donor-activity` | `donor-activity` |
| Notifications | `/notifications` (all roles) | `api/user/notifications` | — | `notifications-route` |
| Feedback & re-engagement | Impact Feed, funded page | `api/donor/update-feedback`, `api/cron/re-engagement` | `donor-feedback`, `re-engagement` | `donor-feedback`, `re-engagement` |
| Donations & receipts | `/donor/donations`, `/discover` | `api/donations/*`, `api/donor/receipts/*` | `razorpay-webhook`, receipts | `donations-webhook`, `tax-receipt-eligibility` |
| E2E | — | — | — | `e2e-tests/donor.spec.ts` |

## 3. Invariants — do not break

1. **Donor ownership goes through `lib/donor-team.ts`.** Never compare
   `donorId === session.user.id` or `sponsorId === actor.id` in a new route:
   a team member would be locked out, or — worse — checked against the wrong
   account. Use `checkDonorAction` / `resolveDonorAccount` /
   `workflowRole(req, actor, cap)`.
2. **A VIEWER changes nothing.** Every write path names its capability.
3. **Money counted is confirmed money**, as Decimal strings; donations stay
   personal, contracts belong to the account.
4. **Figures shown to a donor go through `claimDisplay()`.** Unverified is the
   word "unverified" — in the page and the CSV — never 0 or blank. Outcomes are
   never apportioned by funding share.
5. **The donor sees only what a human approved and, for photos of people, what
   the beneficiary agreed to share** (`DONOR_VISIBLE_EVIDENCE_WHERE`). The
   impact feed shows media only on `MILESTONE_COMPLETED`.
6. **Identity is the session id.** No email-fallback lookups, no creating
   `User` rows during a request (three such paths were removed).
7. **Crons are idempotent and opt-out aware** (`re-engagement`, the impact
   digest, delivery).
8. **NGO-facing donor signals are anonymous** (feedback), and audit payloads
   carry ids only.

## 4. Open items, in priority order

| # | Item | Why it matters |
|---|---|---|
| 1 | Run `DONOR-GUIDE.md` UAT with a real CSR team; run `e2e-tests/donor.spec.ts` against a migrated, seeded DB | Nothing here has been clicked through by a user yet |
| 2 | Rate-limit donation and contract-payment routes | Still the largest gap in `lib/rate-limiter.ts` coverage |
| 3 | `api/contracts` POST converts `totalGrantAmount` with `Number(...)` | Money through a float — move to `Prisma.Decimal` |
| 4 | Notification deep links (`link` column) | Notifications cannot take you to the thing they mention |
| 5 | Team members' personal profile still shows the CSR-officer org form | Harmless (it edits their own row, not the account) but confusing |
| 6 | Server-rendered PDF report | Browser print works; some funders want a file |
| 7 | `admin:health` and `eval:fraud-investigator` scripts point into gitignored `scripts/` | They fail on a fresh clone |

Observing real donors and shipping their top fixes (row 15) needs a pilot.
