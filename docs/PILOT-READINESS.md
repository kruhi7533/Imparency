# Pilot readiness — P0 / P1 burn-down

Roadmap row 14. The list of what must be true before real users arrive (P0)
and what should be fixed during the pilot (P1). Keep it current: when an item
closes, strike it through and write the date, the PR and who verified it.
Procedures are in [`RUNBOOK.md`](RUNBOOK.md).

**P0** — blocks the pilot. **P1** — fix during the pilot; has a workaround.

## P0

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | **Build script runs `prisma db push --accept-data-loss`** against whatever `DATABASE_URL` the deploy has. Baseline production, then switch `build` to `migrate deploy` (RUNBOOK §5). | | Open — needs production access |
| 2 | **Decide where production runs** — Vercel (`DEPLOYMENT.md`, `vercel.json`) or own server with the generated crontab (`lib/job-registry.ts`). The scheduler, rollback and secrets steps differ. | | Open — team decision |
| 3 | **Apply the deferred database update** for the NGO, donor and admin branches: recompute the schema difference against the dev database, confirm no DROP, apply, mark migrations applied. | | Open — planned for after all three PRs |
| 4 | **Open every new page in a browser** after #3 (NGO, donor, admin) and run `e2e-tests/` against a seeded database. Unit tests cannot catch a page that fails to render. | | Open |
| 5 | **Restore drill**: back up, restore into a scratch branch, compare counts, record evidence (RUNBOOK §4). | | Open — needs PostgreSQL client tools |
| 6 | **Scheduler configured with `CRON_SECRET`**, and `/admin/ops` shows every job healthy for 48 hours. | | Open |
| 7 | **Outside monitoring**: uptime monitor on `GET /api/health`; `ERROR_WEBHOOK_URL` set so `captureError` alerts reach a person. | | Open |
| 8 | **CI database secrets** (`CI_DATABASE_URL`, `CI_DIRECT_URL`) so the migration and build gates run instead of being skipped. | | Open |

## P1

| # | Item | Status |
|---|---|---|
| 1 | Enforce the full CSP after watching report-only violations in a browser (the safe subset is already enforced). | Open |
| 2 | Clear the ~70-error lint backlog (mostly unused variables), then make lint blocking in CI. | Open |
| 3 | Decide `FOUR_EYES` for the pilot (on by default; off only with a single admin — record who decided). | Open |
| 4 | Adopt the structured logger (`lib/logger.ts`) in routes; ~120 still use `console.error` (correlation ids are on every request either way). | Open |
| 5 | Notification deep links (`Notification` has no `link`). | Open |
| 6 | Server-generated PDF of the donor impact report (browser print works today). | Open |
| 7 | Decide the fate of unlinked admin pages kept on purpose: Crisis, Initiatives, Opportunities, Proposals, Gap reports (`app/admin/components/hubs.ts` comments). Keep, link, or delete. | Open |
| 8 | One membership model instead of `NGOTeamMember` + `DonorTeamMember` if more org types arrive. | Open |
| 9 | `admin:health` and `eval:fraud-investigator` npm scripts point into the gitignored `scripts/`; fail on a fresh clone. | Open |

## Closed in the admin/platform branch (2026-10-21)

| Item | How |
|---|---|
| ~~Correlation ids lost from every request~~ | Middleware restored (WEEK9 SPEC-1), verified on the running app, shape pinned by a test |
| ~~Cross-site writes to the API~~ | Origin / Sec-Fetch-Site guard in middleware (`lib/csrf.ts`) |
| ~~Contract and costly routes not rate-limited~~ | Every contract write route and 16 AI / upload / messaging routes, pinned by tests |
| ~~Field app GPS blocked by our own Permissions-Policy~~ | `geolocation=(self)` |
| ~~CSP report-only~~ (partly) | Safe subset enforced: `object-src`, `base-uri`, `frame-ancestors` |
| ~~Same admin could propose and approve money~~ | Four-eyes on allocations |
| ~~Failed jobs could not be re-run~~ | Run now on `/admin/ops`; registry checked against real cron folders |
| ~~SLA breaches reached nobody~~ | Daily breach digest to admins |
| ~~No health endpoint, no pilot health view~~ | `/api/health`, `/admin/pilot-health` |
| ~~No runbook, no backup tooling~~ | `docs/RUNBOOK.md`, `tools/db-backup.mjs`, `tools/db-restore.mjs` |
