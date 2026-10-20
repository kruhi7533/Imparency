# Admin / platform track — handover

For the engineer who picks up admin and platform operations (roadmap row 16).
Day-to-day procedures: [`RUNBOOK.md`](RUNBOOK.md). What blocks the pilot:
[`PILOT-READINESS.md`](PILOT-READINESS.md). Presenting the console:
[`ADMIN-WALKTHROUGH.md`](ADMIN-WALKTHROUGH.md). Code: [`ARCHITECTURE.md`](ARCHITECTURE.md) §18.

## 1. The console, by hub

| Hub | Pages | Answers |
|---|---|---|
| Today | `/admin/today` | What needs me now |
| Verification | approvals, **donor organisations**, documents, FCRA, CSR requirements | Is this organisation what it claims to be |
| Campaigns | project review, all projects, milestone proof, field evidence | Is funded work real |
| Risk | radar, reviews & alerts, grievances | Has something gone wrong |
| People | donors, organisations, inquiries, **search** | Who is who |
| Insight | overview, **pilot health**, notifications, trust trends, impact health/review/quality, metrics, response targets, allocations, finance, scheduled jobs (**Run now**), audit trail, **platform trail** | Is the platform healthy and can we prove what happened |

Bold = added in this branch. Crisis, Initiatives and the funder track
(Opportunities, Proposals, Gap reports) are deliberately unlinked; their routes
still work (P1-7 in the readiness list).

## 2. Platform services

| Service | Where | Notes |
|---|---|---|
| Auth & roles | `middleware.ts`, `app/admin/layout.tsx`, `lib/auth-guards.ts` | Every `app/api/admin/**` route calls `verifySessionRole("ADMIN")`; tested admin-negative |
| Correlation | `middleware.ts` → `lib/correlation.ts` → `lib/request-context.ts` | Every request and response carries `x-correlation-id`; `tests/middleware-correlation.test.ts` pins it |
| CSRF | `lib/csrf.ts` in middleware | Cross-site writes to `/api` refused; webhooks, cron, NextAuth exempt |
| Rate limiting | `lib/rate-limiter.ts` | Auth, donations, all contract writes, AI, uploads, messaging — pinned by `contract-rate-limits` and `costly-route-rate-limits` tests |
| Headers / CSP | `next.config.mjs` | Safe CSP subset enforced, full policy report-only; geolocation/camera for our origin |
| Jobs | `lib/job-registry.ts`, `lib/job-runner.ts`, `app/api/cron/*` | 11 jobs; registry must match the cron folders (test); manual runs labelled MANUAL |
| SLA | `lib/sla.ts`, `lib/sla-escalation.ts` | Daily breach digest, idempotent per admin per day |
| Audit | `lib/admin-log.ts` (`/admin/audit`), `lib/platform-trail.ts` (`/admin/platform-trail`) | Every admin route logs or is in `EXEMPT` with a reason |
| Four-eyes | `lib/four-eyes.ts` | Allocation approval; `FOUR_EYES=off` only for a single-admin pilot |
| Health | `/api/health`, `lib/pilot-health.ts` (`/admin/pilot-health`) | Unknown signal is amber, never green |
| Backup | `tools/db-backup.mjs`, `tools/db-restore.mjs` | Restore refuses the live database |

## 3. Invariants — do not break

1. **Admin APIs check their own role.** The layout guards pages only.
2. **Every admin write is audit-logged with ids only**, or named in `EXEMPT`
   with a reason a reviewer can argue with.
3. **Correlation is middleware's job.** Do not narrow the matcher off `/api`,
   and never wrap `/api` in `withAuth` (webhooks and cron carry no session).
4. **Personal data never goes in a URL**: search is POST.
5. **Unknown is never green**: pilot health, triage and impact all follow it.
6. **Jobs are idempotent and registered**: a new cron folder without a registry
   entry fails the build.
7. **Migrations are hand-written and additive**; never `db push` (and fix the
   build script — P0-1).

## 4. Open items

See [`PILOT-READINESS.md`](PILOT-READINESS.md) — P0 1–8 before the pilot,
P1 1–9 during it. A release tag (`v0.9.0-rc1`) should be cut on `main` once the
NGO, donor and admin PRs are merged and P0-3/P0-4 pass; see `CHANGELOG.md`.
