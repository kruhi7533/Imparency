# ImpactBridge — operations runbook

For whoever is on call for the pilot. Each section is a procedure: what to
check, what to run, what "done" looks like. Engineering background is in
[`ARCHITECTURE.md`](ARCHITECTURE.md); deployment configuration in
[`DEPLOYMENT.md`](DEPLOYMENT.md).

> **Open decision — where does production run?** `DEPLOYMENT.md` says Vercel
> (and `vercel.json` lists crons). `lib/job-registry.ts` says the platform runs
> on its own server and that `vercel.json` never fired anything; it generates a
> crontab instead. The team must confirm which is true before the pilot. Steps
> below give both where they differ.

---

## 1. Is it up?

| Check | How | Healthy |
|---|---|---|
| App + database | `curl -s https://<host>/api/health` | `200 {"status":"ok","database":"up"}` (503 = database unreachable) |
| Scheduled jobs | `/admin/ops` | Every job "healthy"; none "never run" or "overdue" |
| Queues past target | `/admin/sla` (and the daily breach digest in admin notifications) | Nothing red, or each red item has an owner |
| Detailed diagnostics | `/admin/ops` → diagnostics, or `GET /api/admin/diagnostics` (admin) | Connection and retry counters normal |

Point an uptime monitor at `/api/health` (every 1–5 minutes, alert on two
consecutive failures).

## 2. Something is broken — first five minutes

1. Get the **correlation id**: every response carries `x-correlation-id`
   (browser dev tools → Network → response headers). Ask the reporter for it.
2. Search the logs for that id. Errors from `captureError` carry it, ids only.
3. Check `/api/health` and `/admin/ops`. A failed job shows its error and its
   own correlation id.
4. If a job failed and is safe to repeat (all registered jobs are idempotent),
   **Run now** from `/admin/ops`. It is logged as `JOB_RUN_MANUALLY`.
5. Write down what you saw and did in the incident log (§9) before fixing.

## 3. Backup

Primary: the database provider's point-in-time restore (Neon keeps history on
every branch — confirm the retention window on the plan in use and write it
here: **____ days**).

Before anything risky (a migration, a bulk data fix), also take a logical dump:

```bash
node -r dotenv/config tools/db-backup.mjs        # → backups/imparency-<timestamp>.dump
```

Needs `pg_dump` 16+ and `DIRECT_URL` (non-pooled). Backups contain personal
data: they stay in `backups/` (gitignored), on an encrypted disk, and are
deleted when no longer needed.

## 4. Restore

**Never restore over production without a second person agreeing.**

1. Restore into a scratch target first — a Neon branch is the easiest:
   ```bash
   node -r dotenv/config tools/db-restore.mjs --file backups/<x>.dump --target "<scratch URL>"
   ```
   It refuses a target equal to `DATABASE_URL` / `DIRECT_URL`, and prints row
   counts for the key tables. Compare them with the source.
2. To recover a few rows, copy them from the scratch database rather than
   restoring the whole thing over live.
3. To roll the whole database back, prefer the provider's point-in-time
   restore to a new branch, then repoint `DATABASE_URL`/`DIRECT_URL` and
   redeploy.

### Restore drill — not yet done

Run this once before the pilot and record the evidence here:

| Date | Backup file | Target | Counts matched? | By |
|---|---|---|---|---|
| | | | | |

(Not run during development: the PostgreSQL client tools were not installed on
the machine that wrote these scripts.)

## 5. Deploy and roll back

- Deploy only from `main` with green CI (`tsc` + `npm test`).
- **Roll back code:** redeploy the previous build (Vercel → Deployments →
  previous → Promote; or on a server, check out the previous tag and rebuild).
- **Roll back the database:** migrations are forward-only and additive by
  policy (`CLAUDE.md`). Do not "down-migrate". If a migration must be undone,
  write a new migration that reverses it, or restore (§4).
- **P0 before the pilot — the build script.** `package.json` `build` still runs
  `prisma db push --accept-data-loss`, which pushes the schema with data loss
  approved against whatever `DATABASE_URL` it is given. Fix, in order:
  1. Back up production (§3).
  2. Baseline it: `npx prisma migrate resolve --applied <name>` for every
     migration already reflected in its schema (compute with
     `npx prisma migrate diff --from-url "$DIRECT_URL" --to-schema-datamodel prisma/schema.prisma --script`
     — it must contain no DROP before you proceed).
  3. Change `build` to `prisma generate && prisma migrate deploy && next build`.
  This is not done in code yet because step 2 needs production access.

## 6. Secrets

| Secret | Rotate how | Effect |
|---|---|---|
| `NEXTAUTH_SECRET` | Set new value, redeploy | Everyone is signed out |
| `CRON_SECRET` | Set new value, redeploy, update the scheduler (crontab or Vercel) | Jobs 401 until the scheduler has the new value — check `/admin/ops` |
| `RAZORPAY_*` / webhook secret | Rotate in the Razorpay dashboard, then here | Webhooks fail signature until both sides match |
| `ERROR_WEBHOOK_URL` | Replace | Error alerts go to the new destination |

## 7. Settings that change behaviour

| Variable | Default | Meaning |
|---|---|---|
| `FOUR_EYES` | on | The admin who proposes an allocation cannot approve it. `off` only for a single-admin pilot — record who decided and when |
| `ALLOWED_ORIGINS` | empty | Extra origins allowed to POST to the API (cross-site writes are refused) |
| `CRON_SECRET` | — | Required; without it no job runs and "Run now" refuses |

## 8. Admin access

- Admins are `User.role = ADMIN`. Create one with `scripts/create-admin.ts`
  (local) — never by editing the database by hand.
- Remove access by changing the role; their audit history stays.
- Every admin decision is in `/admin/audit` (filter, export CSV).

## 9. Incident log

| When | Correlation id | What happened | Impact | Fix | Follow-up |
|---|---|---|---|---|---|
| | | | | | |
