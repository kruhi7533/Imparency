# NGO track — handover

For the engineer who picks up the NGO side next (roadmap row 16). It tells you
where each piece lives, what must not break, how to stand it up, and what is
still open. User-facing behaviour is in [`NGO-GUIDE.md`](NGO-GUIDE.md). Code
detail is in [`ARCHITECTURE.md`](ARCHITECTURE.md): §13 for team/WhatsApp/CRM,
§14.1 for contracts and payments, §15 for field work, and §16 for outcomes,
funding, matching profile, activity and accessibility.

---

## 1. Stand it up

```bash
npx prisma migrate deploy        # the shared Neon dev DB: see "Database" below
npm run seed                     # demo NGOs, donors, admin
npx tsx -r dotenv/config tools/seed-metric-registry.ts -- --apply
npx tsx -r dotenv/config tools/seed-ngo-demo.ts -- --apply   # team + field tasks
npx next dev -p 3001
```

All demo passwords are `demoPassword123`. The admin login is
`admin@impactbridge.com` / `adminpassword123`. The 12-step NGO/field UAT
script is in `NGO-GUIDE.md`.

### Database

The dev database is shared with other branches and has been wiped by their
`db push` before. These additive migrations are the NGO track's recent ones.
Apply them in order with `migrate deploy`, or with `prisma db execute --file
…` if `migrate deploy` is blocked by drift:

| Migration | Adds |
|---|---|
| `20261005200000_field_evidence` | field tasks, evidence, beneficiary feedback |
| `20261008090000_consent_withdrawal_and_update_optout` | consent withdrawal |
| `20261012090000_metric_registry_and_outcome_claims` | metrics, outcome claims |
| `20261020100000_bank_statement_matching` | bank statement import + matching |
| `20261021090000_project_funded_at` | `Project.fundedAt` |
| `20261021100000_project_beneficiary_group` | `Project.beneficiaryGroup` |
| `20261021110000_proof_field_evidence` | `MilestoneProof.fieldEvidenceIds` |

Never `prisma db push`; see the schema section of `CLAUDE.md`.

---

## 2. Module map

| Capability | Page | API | Rules (lib) | Tests |
|---|---|---|---|---|
| Registration & verification | `/ngo/register` | `api/ngo/register` | `gemini/extract-ngo-fields`, `verification-triage` | `verification-triage`, `admin-verify-ngo` |
| Team & roles | `/ngo/settings/team` | `api/ngo/settings/*` | `field-evidence` (`resolveNgoActor`) | `tenant-isolation` |
| Projects | `/ngo/projects/new`, `/ngo/projects/[id]` | `api/ngo/projects/*` | — | `tenant-isolation` |
| Matching profile | project page panel | `api/ngo/projects/[id]/matching-profile` | `project-readiness`, `matchingEngine` | `project-readiness-and-cohort` |
| Opportunities → proposals | `/ngo/opportunities`, `/ngo/proposals/*` | `api/ngo/proposals/*` | `requirements/*` | `ngo-proposal-*` |
| Contracts | `/ngo/contracts`, `/ngo/contracts/[id]` | `api/contracts/*` | `contract-payments` | `contract-payments` |
| Bank reconciliation | `/ngo/bank-reconciliation` | `api/ngo/bank-statements/*` | `bank-statement` | `bank-statement` |
| Project FUNDED | badge on project/donor/admin pages | (payment confirm + bank rematch) | `project-funding` | `project-funding`, `bank-statement` |
| Field tasks & evidence | `/ngo/field`, project panel | `api/ngo/field-tasks/*`, `api/field/*` | `field-evidence`, `field-queue` | `field-evidence`, `field-task-edit`, `consent-withdrawal` |
| Milestone proof | dashboard modal | `api/ngo/submit-proof`, `api/ngo/milestones/[id]/field-evidence` | `proof-field-evidence`, `proof-fingerprint` | `proof-field-evidence`, `proof-duplicate-detection` |
| Outcomes & impact | `/ngo/impact` | `api/ngo/outcome-claims/*` | `outcome-cockpit`, `outcome-triage`, `gemini/extract-outcomes` | `outcome-cockpit`, `outcome-extraction` |
| Activity & audit | `/ngo/activity` | — (server page) | `ngo-activity` | `ngo-activity` |
| Navigation / a11y | `Navbar` | — | — | `ngo-accessibility` |

---

## 3. Invariants — do not break

1. **Role is not ownership.** Every route touching an org-owned row checks
   `row.ngoId === actor.ngoId`. Another org's row is a 404 or 403, and never
   reveals that it exists.
2. **A human approves before anything reaches a donor.** That covers milestone
   proof, field evidence and outcome claims. AI output (proof score, outcome
   suggestions) is advice only. The proof modal must never say
   "auto-approved".
3. **Consent gates every field photo.** Only `isShareableWithDonor` /
   `DONOR_VISIBLE_EVIDENCE_WHERE` decide donor visibility. Field photos are
   referenced, never copied into public `mediaUrls`.
4. **Money is Decimal, and confirmed money is the only money.** A project is
   FUNDED only on RECONCILED payments covering signed contracts. The stamp is
   a compare-and-swap, so notifications go out once. Both the manual path and
   the bank path call `stampProjectFundedIfComplete`.
5. **Decisions are compare-and-swap.** Concurrent writes get a 409, never a
   silent overwrite. This applies to tasks, claims, payments and bank lines.
6. **Unverified is never zero.** An unbacked outcome renders "unverified"
   (`claimDisplay`).
7. **The NGO never sees internal investigation steps.** The activity view
   reads admin actions only from `NGO_VISIBLE_ADMIN_ACTIONS`.
8. **Editing a live project's pitch returns it to approval.** Matching data has
   its own endpoint, so a live project stays live.

---

## 4. Open items, in priority order

| # | Item | Why it matters |
|---|---|---|
| 1 | Run the UAT script with real NGO and field staff on real phones (rows 14–15) | Every row above is tested in code, not by users |
| 2 | Apply the migrations in §1 to the shared DB and open each NGO page in a browser | Pages error on missing tables; vitest cannot catch a page that fails to render |
| 3 | Outcome triage: treat a proof's `fieldEvidenceIds` as the same source as that evidence | A claim citing both is not flagged as duplicate source |
| 4 | Surface `Notification` rows (bell/list) | Funded, payment and review notifications are stored and pushed but never listed |
| 5 | Rate-limit `submit-proof` and the contract payment routes | Only extraction is rate-limited on the NGO side |
| 6 | Make lint blocking in CI | About 40 errors of backlog |

Payouts are deliberately not built. The platform records money but does not
move it. Don't start them until asked.
