# Week 9 blueprint — "Release Candidate 1"

**Dates:** Oct 19–23 2026. **Plan deliverables (Intern 1 — Admin/Platform):**
security suite · observability · backup/restore.

**Standards this week is judged against** (`engineering-standards-and-dod`):

- *W9+ Intern 1:* OpenTelemetry + error tracking, correlation IDs, structured
  logs across API/job/AI/integration.
- Pilot Gate items this week must move: **tenant/role negative tests 100% pass**
  · **AI failure retry + failed-job visibility works (ops console)** ·
  **backup/restore tested (restore evidence)** · monitoring + rollback runbook
  active.

Playwright E2E on cross-portal journeys is **Interns 2 & 3's** item in the same
standards doc, not this track. `docs/ACCEPTANCE-MATRIX.md` mentions "the Week 9
Playwright E2E suite" without naming an owner, which is where the confusion
comes from; that note should be amended to say whose it is.

---

## 1. The idea the week hangs on

Weeks 1–8 built behaviour. Every one of them asked "does the platform do the
right thing?" Week 9 asks a different question, and it is the one that decides
whether a pilot is survivable:

> **When this breaks at 3am, can someone who did not build it find out, and get
> the data back?**

Everything below follows from that. It is not a feature week — there is no new
user-facing capability in it — and the deliverables only look unglamorous until
the first incident, at which point they are the only thing that matters.

The repo already has the right instinct in one place, and it is the model for
the week. `lib/observability.ts` exists precisely because this codebase
deliberately swallows secondary failures so they cannot break primary actions —
an audit-log write must not fail an NGO approval. That is correct, and it means
those failures are **invisible by construction**. `captureError` is the seam
where they become noticeable. Week 9 extends that one good seam into three:
failures are *attributable* (SPEC-1), scheduled work is *visibly alive*
(SPEC-2), and the database is *provably recoverable* (SPEC-4), with the security
negative tests the gate demands (SPEC-3).

---

## 2. Where the week actually stands (code-grounded, 2026-10-09)

### 2.1 Observability — one good seam, nothing around it

`lib/observability.ts` (154 lines) is genuinely well-built: `captureError` never
throws, never awaits network I/O on the request path, emits single-line JSON to
stderr behind a `[capture]` prefix so one log filter can alert on it, and has a
fire-and-forget `ERROR_WEBHOOK_URL` hook for a collector. `captureAsync` wraps
the "do this but don't break the caller" shape. Its privacy rule is already the
right one: **ids only, never names, emails or amounts.**

What does not exist, verified by grep across `lib/` and `app/`:

| Thing | Hits |
|---|---|
| `opentelemetry` | **0** |
| `@sentry` | **0** |
| `correlationId` / `requestId` / `traceId` | **0** |

So a single user action that touches an API route, a Prisma query, a Gemini call
and a Twilio send produces log lines that **cannot be tied to each other**.
There is no way to answer "what else happened during the request that failed",
which is the first question of every real investigation.

`captureError` is also inconsistently adopted. `app/api/media-proxy/route.ts`
and the cron routes use bare `console.error`, so their failures never get the
structured shape or the collector hook.

### 2.2 Scheduled work — nine jobs, no evidence any of them runs

There are **9 cron routes** under `app/api/cron/`: `crisis-notify`,
`deliver-impact`, `fcra-expiry`, `fcra-quarterly-report`, `impact-digest`,
`reminders`, `risk-dispatch`, `risk-scores`, `risk-sweep`.

The good news: authentication is consistent and correct. Every one reads
`x-cron-secret` or `Authorization: Bearer` and compares against `CRON_SECRET`.

The bad news is structural. **There is no job-run ledger.** `grep '^model'`
over `prisma/schema.prisma` (86 models) finds `MatchingJob`,
`ReconciliationRun` and `WebhookEvent` — three bespoke, per-feature run records
— and nothing generic. No table says "job X started at T, took Yms, processed Z
rows, succeeded". Which means:

- nobody can tell that a job stopped firing;
- a job that fails every night fails silently forever;
- the Pilot Gate's "failed-job visibility (ops console)" has nothing to render.

And there is corroborating evidence that at least one job is not running.
Counted on the dev database today:

| Table | Count |
|---|---|
| `ProjectImpactEvent` | 6 |
| `ImpactSubscription` | 3 |
| **`ImpactDelivery`** | **0** |
| **`WebhookEvent`** | **0** |

Six impact events and three subscriptions, and zero deliveries. The same
"stalls at delivery" finding `docs/QA-E2E-2026-10-05.md` reported four days ago
is still true. An empty `WebhookEvent` likewise means the Razorpay webhook has
never recorded a delivery here.

Careful with that inference, because it cuts both ways: this is the **dev**
database, and crons were never pointed at it, so these zeros do not prove
production is broken. **That is exactly the finding.** Nobody can tell from
either side, because no run ledger exists. "We cannot distinguish 'never
scheduled' from 'scheduled and failing'" is the defect, not the zero itself.

### 2.3 The schedule source of truth is a file that does nothing

`vercel.json` declares all 9 cron schedules. **The platform does not deploy to
Vercel** — it runs on a real server on its own domain (confirmed 2026-08-11,
reconfirmed 2026-08-31). On a real server those entries never fire.

Three artifacts still assert otherwise and must not be trusted:

- `vercel.json` — nine schedules that do nothing.
- `next.config.mjs` — "Safe here because the app is only ever served over TLS
  (Vercel)", on the HSTS `preload` header.
- `docs/DEPLOYMENT.md` — opens with **"Target platform: Vercel"** and is
  written entirely around serverless: env vars in the Vercel dashboard,
  Hobby-plan cron limits, `waitUntil()` for background work. Its §1.1–1.6
  config content (Cloudinary, OAuth, Twilio, Razorpay, `CRON_SECRET`) is still
  accurate and worth keeping; the framing is not.

This is not a documentation nit. A schedule nobody can read is a schedule
nobody can verify, and it is why §2.2 cannot be resolved by inspection.

### 2.4 Security — a good perimeter with two specific holes

Better than expected. `next.config.mjs` ships HSTS (2 years, `includeSubDomains`,
`preload`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, a tight `Permissions-Policy`,
`poweredByHeader: false`, and a carefully grouped CSP. `middleware.ts` enforces
role guards on `/admin/*`, `/donor/*`, `/ngo/dashboard/*`, `/ngo/projects/*`.
Rate limiting is now wired into **31** API route files (CLAUDE.md still says
"~12" — stale, worth correcting).

Two real defects and two gaps:

**(a) `app/api/media-proxy/route.ts` is an open redirect.** Confirmed by
reading it:

```ts
if (!targetUrl.startsWith('https://api.twilio.com/')) {
  // Just redirect if it's not Twilio (like unsplash)
  return NextResponse.redirect(targetUrl);
}
```

Any authenticated user can send `?url=https://evil.example/...` and the
application will 302 them there, lending our domain's credibility to the
destination. The Twilio prefix check itself is sound — the trailing slash
defeats `https://api.twilio.com.evil.com/` — so this is purely the fallback
branch. Two lesser problems in the same handler: the Twilio response is
returned with `Cache-Control: public, max-age=86400` even though it was fetched
with credentials and is private beneficiary media, and `response.arrayBuffer()`
is unbounded, so the route will buffer whatever size Twilio returns.

**(b) The CSP is `Content-Security-Policy-Report-Only` with nowhere to report
to.** The header's own comment says to "watch the browser console (and any
report collector you point `report-uri` at) until violations are quiet, then
rename the header" — but **no `report-uri` or `report-to` directive is set**, so
the only channel is a human watching devtools. The plan to flip it has no data
source. Worse, the browser is already telling us the policy is partly inert: I
saw this in the console on `/admin/impact-quality` during Week 8 verification —

> The Content-Security-Policy directive 'upgrade-insecure-requests' is ignored
> when delivered in a report-only policy.

So one directive in the list does nothing at all today, and the mode means none
of the rest block anything either.

**(c) `middleware.ts` does not cover `/api/*`.** By design — API routes
self-gate, and CLAUDE.md is explicit that admin routes must call
`verifySessionRole("ADMIN")` themselves. The gap is that **nothing enforces that
they did.** Isolation is enforced per route by hand, so a route that forgets its
ownership check has no safety net. A route-guard audit on 2026-08-31 found zero
gaps under `app/api/admin`, but that was a point-in-time grep, not a test.

**(d) CLAUDE.md's "donation/payment routes are still unprotected" is STALE.**
Checked directly rather than inherited: `donations/create-order`,
`donations/retry/[token]` and `donations/[donationId]/status` all reference the
rate limiter today. The one donation route without it is
`donations/webhook` — and that is **correct and must stay that way**. Rate
limiting a payment provider's webhook drops its legitimate retries, which is
how a captured payment ends up never applied; the webhook's protection is
signature verification plus idempotency, not a request cap. So this item is
mostly closed, and CLAUDE.md needs the correction more than the code does.

### 2.5 Backup/restore — nothing, and a prerequisite nobody has cleared

There is no backup procedure, no restore procedure, no runbook. That is the
easy half to state.

The hard half is that **a restore is only as good as your ability to describe
the schema you are restoring**, and production's schema provenance is currently
unknown:

- production was **never baselined.** The last measurement on record is "24 of
  33 migrations unrecorded" in its `_prisma_migrations`; `prisma/migrations/`
  now holds **45**, so that figure is stale and the real gap is larger. The
  first task of SPEC-4 is to *measure* it against production rather than assume
  a number — which is the whole problem in miniature: nobody currently knows
  what schema production is running;
- `package.json`'s `build` runs `prisma db push --accept-data-loss && next
  build`, so **every deploy pushes the schema with data loss pre-approved**
  against whatever `DATABASE_URL` it is handed;
- CLAUDE.md already flags that as an open P0 before the pilot.

So "take a dump and put it back" is not the deliverable. The deliverable is:
production has a known schema version, a backup that captures it, and a restore
that has actually been performed and verified. In that order — baselining is a
*prerequisite* of a meaningful restore, not a separate chore.

---

## 3. The shape of the week

| Spec | Deliverable | Size | Depends on |
|---|---|---|---|
| SPEC-1 — Correlation IDs + structured logging + error tracking | Mon–Tue | M | — |
| SPEC-2 — Job run ledger + `/admin/ops` console | Tue–Wed | L | SPEC-1 |
| SPEC-3 — Security suite (close the two holes, prove the guards) | Wed–Thu | M | — |
| SPEC-4 — Backup & restore, with executed restore evidence | Thu–Fri | M | — |

SPEC-3 and SPEC-4 are independent of SPEC-1/2 and can be reordered if a day
runs short. SPEC-2 is the one with a migration, so it should not slip to Friday.

---

## SPEC-1 — Correlation IDs, structured logs, error tracking

**The claim to make true:** every log line produced while serving one request
carries the same id, and that id is visible to the person debugging.

### Shape

- `lib/request-context.ts` — an `AsyncLocalStorage<RequestContext>` holding
  `{ correlationId, route, userId? }`. Node runtime only.
- `lib/logger.ts` — `log.info/warn/error(event, fields)`, emitting single-line
  JSON with the correlation id merged in automatically. Same privacy rule as
  `captureError`: **ids, counts, enum values and booleans only.**
- `middleware.ts` generates or forwards the id and sets it on the request and
  the response, so a user reporting a problem can quote the id off a response
  header.
- `captureError` gains the correlation id automatically, so all ~existing call
  sites improve without being touched — the module's docstring already promises
  exactly this kind of change ("every call site stays exactly as it is").
- Adoption pass: replace bare `console.error` in `media-proxy` and the 9 cron
  routes with `captureError`/`log`.

### Decisions worth not re-litigating

- **W3C `traceparent` is the wire format, even without a tracing backend.**
  Generate and propagate a real `traceparent` rather than inventing an
  `x-correlation-id`, so adopting an OTel SDK later is configuration rather
  than a migration of every log line and header.
- **The OpenTelemetry SDK is deliberately NOT installed this week.** This
  departs from the standards doc, so the reasoning is recorded rather than
  quietly skipped: OTel without a collector (Tempo/Jaeger/a vendor) is a
  dependency, an exporter and a config surface that produce nothing readable.
  The useful 80% — a correlation id threaded through API, job, AI and
  integration paths, in OTel's own wire format — lands this week and is what
  actually shortens an investigation. Installing the SDK is a half-day once a
  collector exists, and it is logged as debt in §6. **Flag this to the plan
  owner rather than assuming the substitution is accepted.**
- **`AsyncLocalStorage` must not reach the client bundle.** It is
  `node:async_hooks`, and this is precisely the trap that killed
  `/admin/proof-review` in Week 7: webpack does not polyfill the `node:`
  scheme, so one such import inside a `"use client"` import closure makes the
  route fail to build and serve a 500 while the whole test suite stays green.
  `lib/request-context.ts` is server-only and must never be imported by a
  client component. `tests/client-bundle-safety.test.ts` already walks every
  `"use client"` file and follows `@/lib` imports transitively — it will catch
  a mistake here, and that is the guard to rely on.
- **Logging must never become the thing that breaks a request.** Same two
  guarantees `captureError` already makes: never throw, never await network
  I/O on the request path.

---

## SPEC-2 — Job run ledger and the ops console

**The claim to make true:** a scheduled job that stops running becomes visible
without anyone thinking to check.

This is the week's headline, because it is the one defect in §2 that is
currently *unknowable* rather than merely unfixed.

```prisma
enum JobRunStatus { RUNNING SUCCEEDED FAILED SKIPPED }

model JobRun {
  id        String @id @default(uuid())
  /// Registry key, e.g. "deliver-impact". Not free text — see lib/job-registry.
  job       String
  status    JobRunStatus @default(RUNNING)
  startedAt DateTime @default(now())
  finishedAt DateTime?
  durationMs Int?
  /// What the run actually did, so "ran successfully, processed nothing" is
  /// distinguishable from "ran successfully and did the work".
  itemsProcessed Int?
  /// How it was invoked: CRON, MANUAL, BACKFILL.
  trigger   String
  /// Ties the run to every log line it emitted (SPEC-1).
  correlationId String?
  /// Error class and message only. No stack in the database — stacks carry
  /// file paths and occasionally payload fragments; they belong in logs.
  errorName String?
  errorMessage String?

  @@index([job, startedAt])
  @@index([status, startedAt])
}
```

- `lib/job-registry.ts` — the declared set of jobs and their **expected
  cadence**, in code. This replaces `vercel.json` as the source of truth and is
  what makes staleness computable. A generator emits the crontab lines for the
  real server from it, so the schedule and the expectation cannot drift.
- `lib/job-runner.ts` — `runJob(name, trigger, fn)`. Opens a `JobRun`, runs the
  body, closes it with status/duration/count, converts a throw into `FAILED`
  plus `captureError`, and **never lets a ledger-write failure fail the job**
  (the codebase's own rule, applied to the thing that watches the codebase).
- Wrap all 9 cron routes. Each keeps its existing `CRON_SECRET` check — a
  rejected call must not create a `JobRun` row, or an attacker could flood the
  ledger.
- `/admin/ops` — one row per registered job: last run, status, duration,
  items, and **time since last success against the declared cadence.**

### Decisions worth not re-litigating

- **A job that has never run renders "never run" in red, not as healthy.**
  This is the same rule as "no evidence must never read as safe" in NGO
  verification and "`CLEAN` must never mean nothing was examined" in Week 8.
  An ops console whose empty state is green is worse than no console, because
  it actively asserts something false. On today's data `deliver-impact` must
  come out red.
- **Staleness is computed from the declared cadence, not from a fixed
  threshold.** `fcra-quarterly-report` runs on 1 Jan/Apr/Jul/Oct; a
  "no run in 2 days" rule would scream at it eleven months a year, and an
  alert that fires on the healthy case trains people to ignore the type — the
  reasoning already written down for "a missing 12A is not a defect".
- **Concurrency is guarded in the database, not by assuming one process.**
  The real server can run replicas, so `runJob` takes a DB-level lock and
  records `SKIPPED` when a run is already in flight. `SKIPPED` is a normal
  outcome, not a failure.
- **`itemsProcessed: 0` is not a failure either.** A nightly job with nothing
  to do is healthy. Conflating the two is how a real alert gets buried.

---

## SPEC-3 — The security suite

**The claim to make true:** the guards the platform relies on are asserted by
tests rather than by a past grep, and the two known holes are shut.

### The two holes

1. **`media-proxy` open redirect.** Remove the arbitrary-redirect branch
   outright. A proxy either serves an allowlisted origin or returns 400; it
   never forwards a user to a URL they supplied. Add a response size cap, and
   change `Cache-Control` to `private` — credentialed beneficiary media must
   not sit in a shared cache. Whether any caller still needs the non-Twilio
   case ("like unsplash") has to be checked before deleting it; if one does, it
   needs its own allowlist entry, not a wildcard.
2. **Make the CSP real.** Add `report-to` (with `report-uri` as the fallback
   older browsers still honour) pointing at a new
   `POST /api/security/csp-report` that records violations, so the report-only
   period finally produces the data it was supposed to. Then flip to enforcing
   once quiet. `upgrade-insecure-requests` should move or be dropped, since the
   browser ignores it in report-only mode and its presence implies protection
   that is not there. The report endpoint must be rate limited and must store
   **no PII** — a CSP report contains URLs.

### The negative tests the Pilot Gate demands

Pilot Gate: *"tenant/role negative tests 100% pass"*. Today `tests/tenant-isolation.test.ts`
covers a sample. The gap is coverage, and the fix is the pattern this repo has
already proved twice — a test that enumerates the filesystem and fails on
anything unaccounted for:

- **`tests/route-guard-coverage.test.ts`** — walk every `route.ts` under
  `app/api`, and require each to either call `verifySessionRole` / an explicit
  ownership comparison, or appear in a `PUBLIC` list **with a stated reason**.
  Directly modelled on `tests/admin-audit-coverage.test.ts`, which already
  fails the build for an admin route missing `logAdminAction`. That test works
  because it makes the omission *loud and deliberate*, and the same mechanism
  is what turns §2.4(c)'s point-in-time audit into a standing guarantee.
  Known-public-by-design today: `discover`, `[id]/follow`,
  `[id]/fcra-status`, `[id]/inquiry`, `user-follows`.
- **Assert the donation rate limits that already exist**, rather than add them
  (§2.4(d)) — reusing the shape of `tests/login-rate-limit.test.ts`. Include a
  test pinning that the **webhook is deliberately exempt**, so a future
  well-meaning change cannot "fix" it and start dropping provider retries. An
  intentional exemption with no test is indistinguishable from an oversight.
- Extend tenant isolation to assert org A gets 403 on org B's row for **every**
  org-owned route the guard test enumerates, not a sample of them.

### Decision worth not re-litigating

- **The guard test's `PUBLIC` list requires a reason string, not just a path.**
  An exemption list that accepts bare paths becomes a dumping ground within a
  month; one that demands a sentence makes each entry an argument someone has
  to be willing to make in review. This is exactly why
  `tests/admin-audit-coverage.test.ts`'s `EXEMPT` list works.

---

## SPEC-4 — Backup and restore, with evidence

**The claim to make true:** production's schema version is known, its data is
backed up, and a restore has actually been done — not documented as possible.

Ordered, because each step is a prerequisite of the next:

1. **Baseline production.** Mark the 24 unrecorded migrations as applied so
   `_prisma_migrations` describes reality, then **move `build` off `prisma db
   push --accept-data-loss` and back to `prisma migrate deploy`.** Until this
   lands, every deploy can silently reshape the production schema, and no
   backup has a known shape. This is the P0 CLAUDE.md already names.
2. **Backups.** Neon's branch/PITR capability for fast rollback, plus a logical
   `pg_dump` to offsite object storage for the case where the Neon project
   itself is the problem. A backup that lives only inside the thing it is
   backing up is not a backup.
3. **A restore that was performed.** Restore into a scratch Neon branch and
   verify, with the output committed as evidence:
   - `prisma migrate status` clean against the restored branch;
   - table count equals `grep -c '^model ' prisma/schema.prisma` + 1 — the
     check `engineering-standards-and-dod` already established as *the only*
     proof the CI database gate really ran, reused here for the same reason: a
     skipped step reports success;
   - row-count spot checks on the tables that carry money and consent.
4. **`docs/RUNBOOK.md`** — restore, rollback, rotate `CRON_SECRET`, what to do
   when a job goes red in `/admin/ops`. Short and executable.
5. **Rewrite `docs/DEPLOYMENT.md`'s framing** for the real server, keeping its
   accurate §1.1–1.6 config content, and delete or clearly mark `vercel.json`
   as inert. SPEC-2's generated crontab is what replaces it.

### Decisions worth not re-litigating

- **Restore evidence is the deliverable, not the procedure.** The Pilot Gate
  says "backup/restore tested (restore evidence)". An untested restore
  procedure is a belief, and the failure mode is discovering it is wrong on the
  one day it matters.
- **Never restore into production as the test.** The scratch branch is the
  point; a verification step that can destroy the thing it verifies will not get
  run.
- **Baselining comes before dumping.** Reversing them produces a backup whose
  schema nobody can reconstruct, which is the expensive kind of useless.

---

## 4. Day plan

| Day | Work |
|---|---|
| Mon Oct 19 | SPEC-1: `request-context`, `logger`, middleware id, `captureError` integration, `console.error` adoption pass, tests. |
| Tue Oct 20 | SPEC-1 finish; SPEC-2 schema + hand-written additive migration + `job-registry` + `job-runner` + wrap all 9 crons. |
| Wed Oct 21 | SPEC-2 `/admin/ops` + staleness + nav; SPEC-3 starts: media-proxy fix, CSP report endpoint. |
| Thu Oct 22 | SPEC-3 `route-guard-coverage` + payment rate limits + isolation expansion; SPEC-4 baseline production. |
| Fri Oct 23 | SPEC-4 backup scripts + executed restore + evidence + runbook; `tsc` + full suite; browser walkthrough; acceptance row; PR. |

## 5. Tests (CLAUDE.md's six mandatory kinds, mapped)

1. **Tenant isolation** — expanded to every org-owned route enumerated by the
   new guard test, not a sample.
2. **Approval state machines** — none added this week; unchanged.
3. **Idempotency/retry** — `runJob` replay: a second concurrent run records
   `SKIPPED` and does not double-process. This is the "AI failure retry +
   failed-job visibility" Pilot Gate item.
4. **AI output** — n/a; no new model call. SPEC-1's AI-path correlation is
   asserted instead (a Gemini failure logs with the request's id).
5. **Admin audit coverage** — `/api/security/csp-report` is public by design
   and goes in the `PUBLIC` list with a reason; any new admin route under
   `/admin/ops` must call `logAdminAction`.
6. **Weekly acceptance** — W9 row, added **only once all four specs are
   genuinely done**. Week 8's row was deliberately withheld until SPEC-4
   landed, for the reason the matrix exists; same discipline here.

New files: `tests/request-context.test.ts`, `tests/job-runner.test.ts`,
`tests/route-guard-coverage.test.ts`, `tests/media-proxy.test.ts`.

**And the Week 7 lesson applies to `/admin/ops`:** a green suite does not mean
the page loads. Open it in a browser before calling it done.

## 6. Known debt carried into / out of Week 9 (explicitly)

- **The OpenTelemetry SDK is not installed** (SPEC-1 decision). Correlation
  lands in W3C format; the exporter waits for a collector. Needs the plan
  owner's agreement, since the standards doc names OTel directly.
- **No staging environment.** Still the highest-priority infrastructure item,
  and every issue's DoD requires "staging deployed and reproducible", so it
  blocks sign-off on everything including this week.
- **Branch protection is blocked, not skipped** — the user is a Collaborator,
  not the owner, so required reviews cannot be enforced without the repo owner
  acting.
- **CI lint is `continue-on-error`** with a ~40-error backlog; the DoD wants it
  green before the pilot gate.
- **`docs/ACCEPTANCE-MATRIX.md` attributes the Playwright suite to "Week 9"
  without an owner**, which is what made this week's scope ambiguous. Amend it
  to name Interns 2 & 3.
- Carried from Week 8: the **donor read path does not consume
  `claimDisplay()`** yet, and there is no per-claim admin page for the
  double-count table to link to.
- Carried from Week 7: `Allocation` has no `projectId`, so admin-track
  committed money still reaches no evidence obligation.

## 7. Build status

| Spec | State |
|---|---|
| **SPEC-1 correlation + logging** | **Built.** `lib/correlation.ts` (isomorphic: W3C traceparent generate/parse/derive, header names, the resolver seam), `lib/request-context.ts` (AsyncLocalStorage, `withRequestContext`/`withRouteContext`, `setContextUser`, `outboundTraceHeaders`), `lib/logger.ts` (single-line JSON, `logDuration`), `captureError` stamps the id, `middleware.ts` mints/continues it per page request, 6 cron routes moved off `console.error`, `app/api/media-proxy/route.ts` as the worked route example. `tests/request-context.test.ts` (26) + `tests/logger.test.ts` (14). |
| **SPEC-2 job ledger + ops console** | **Built.** `JobRun` + `JobRunStatus` with hand-written additive migration `20261019090000_job_run_ledger` (**applied**), `lib/job-registry.ts` (nine jobs, per-job cadence/grace/runtime budget, `jobHealth`, `renderCrontab`), `lib/job-runner.ts` (`runJob`, ledger row per attempt, correlation id, concurrency back-off, `countOf`), all **nine** cron routes wrapped, `/admin/ops` + nav entry, `tests/job-runner.test.ts` (24). |
| **SPEC-3 security suite** | Not started. |
| **SPEC-4 backup/restore** | Not started. |

`tsc --noEmit` exit 0 and the full suite green at **122 files / 1870 tests**
(exit codes captured directly — reading them off a `| tail` pipe reports
`tail`'s status, which is how a failing run looked green earlier in Week 8).

### SPEC-1, verified in the browser rather than asserted

Signed in as ADMIN against the dev server, reading real response headers:

- every page response carries `x-correlation-id` (32 hex) and a matching
  `traceparent`; two requests get different ids;
- an inbound `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01` is
  **continued** — same trace id out, with a fresh span id, because we are a
  new hop;
- `/admin/impact-quality` still renders and auth still works, which is the
  thing a middleware change can quietly destroy.

### Found while building

**1. The Week 7 bundle guard had a hole exactly where this spec needed it.**
`tests/client-bundle-safety.test.ts` existed to stop a Node builtin reaching
the browser bundle, and its `NODE_BUILTINS` list had **no entry for
`async_hooks`** — the one builtin SPEC-1 introduces. It would have missed a
second instance of the bug it was written for. The list is now exhaustive,
and the fix was verified the same way Week 7's was: by reintroducing the bug.
A temporary `"use client"` component importing `lib/request-context.ts`
fails with `TempClient.tsx -> lib/request-context.ts imports
"node:async_hooks"`. The temp file was removed.

**2. Writing the test found an infinite loop in this spec's own code.** The
first id generator was `while (id === ZERO) id = randomHex(n)`. With a
stubbed, broken or exhausted entropy source returning zeros that spins
forever, on the path of every request. Replaced with a deterministic
one-nibble repair; the test pins it by stubbing `getRandomValues` to
zero-fill, so a reintroduced loop shows up as a timeout.

**3. An anonymous request cannot be stamped, and this was measured, not
assumed.** `withAuth`'s `authorized` callback runs *before* the middleware
body, so a session-less request is redirected to `/login` without ever
reaching the id code — confirmed with curl (307, no `x-correlation-id`).
An authenticated wrong-role bounce to `/unauthorized` *is* stamped, because
the trace is derived before the role guards. Covering the anonymous case
means hand-rolling the `withAuth` wrapper, i.e. editing the authentication
path, for a request that has nothing to correlate with. Logged rather than
done.

### SPEC-2, verified against the real database and in the browser

`runJob` was exercised directly against the dev database, not only through
mocks:

- a successful run recorded `SUCCEEDED`, `durationMs: 187`, `itemsProcessed: 3`;
- a deliberate failure recorded `FAILED` with `errorName`, then **rethrew**, so
  the route keeps its 500;
- the `[capture]` line for that failure carries correlation id
  `303a44d3…`, **the same id stored on the FAILED row** — SPEC-1 and SPEC-2
  joined up, which is the whole point of doing them in this order.

`/admin/ops` returns HTTP 200 with real content and renders the finding this
week predicted: **seven jobs, including `deliver-impact`, show NEVER RUN in
red**. That is the defect §2.2 argued was unknowable, now visible on a page.
`reminders` shows FAILING with its error and correlation id; `risk-sweep`
shows HEALTHY at 187ms / 3 items.

Two things found by building it:

**1. A display bug on a page about precision.** `Math.round(graceHours / 24)
|| 1` rendered a 12-hour grace as "1d grace" — a false statement on the one
page whose job is being exact about when something should have happened.
Replaced with `humanHours()`; it now reads `1d+12h grace` and `92d+7d grace`.

**2. A vitest hoisting trap.** Adding a static import of the module under
test made `vi.mock`'s factory run before a plain `const prismaMock` was
initialised, and the file failed to collect with no tests at all rather than
with a failure. `vi.hoisted()` is the fix.

### SPEC-2 decisions worth not re-litigating

- **The concurrency guard is a back-off, not a lock.** Both contenders insert
  and the later one marks itself `SKIPPED`; earliest `startedAt` wins, id
  breaks a tie. A partial unique index on `(job) WHERE status = 'RUNNING'`
  would be stricter, but Prisma cannot express a partial index, so the
  database would carry an object `schema.prisma` does not declare — and CI's
  "check schema and migrations agree" gate would fail on exactly that. That
  gate caught four real defects this week; working around it for a guard the
  jobs do not strictly need (every one is already replay-safe) is a poor
  trade.
- **The existing `rateLimit` duplicate-invocation lock stays outside
  `runJob`.** A call that lock absorbs never ran, so it must not leave a
  ledger row implying it did.
- **Every default in the new migration matches `schema.prisma` exactly.** The
  four-column mismatch that broke CI this week came from migrations adding
  convenience defaults the models never declared; the migration file says so
  in a comment so the next hand-written one does not repeat it.
### SPEC-1 scope boundaries, deliberate

- **The nine cron routes get their context in SPEC-2, not here.** `runJob`
  has to open the context so the job's trace and its `JobRun` row share one
  id; wrapping them now and rewrapping them next would be churn. SPEC-1
  converted their `console.error` calls (durable either way) and proved the
  route-level seam on `media-proxy`.
- **`media-proxy`'s open redirect is untouched.** It is SPEC-3's fix;
  landing a security change inside the observability spec would make both
  harder to review. The defect is documented in the file itself so it cannot
  be mistaken for an endorsement of the code.
- **No OpenTelemetry SDK**, per the §SPEC-1 decision — still needs the plan
  owner's agreement, since the standards doc names OTel for this track.

Verified before this was written (so the §2 claims are not inherited):
`lib/observability.ts` read in full; zero grep hits for opentelemetry/sentry/
correlationId/requestId/traceId across `lib/` and `app/`; 9 cron routes listed
and their `CRON_SECRET` checks read; 9 schedules counted in `vercel.json`; 86
models in `prisma/schema.prisma` with no generic run ledger; live dev-database
counts for `WebhookEvent` (0), `ImpactDelivery` (0), `ProjectImpactEvent` (6),
`ImpactSubscription` (3), `ReconciliationRun` (4), `MatchingJob` (13),
`AdminActionLog` (133); `middleware.ts`, `next.config.mjs` and
`app/api/media-proxy/route.ts` read in full; 31 API route files referencing the
rate limiter; 45 folders in `prisma/migrations/`; `docs/DEPLOYMENT.md` §intro
read.

Two claims inherited from CLAUDE.md and memory were checked and turned out
**stale**, and are corrected above rather than repeated: donation routes *are*
rate limited now (§2.4(d)), and the "24 of 33" production migration gap is
measured against a repo that now has 45 (§2.5). Both are the documented
procedure in CLAUDE.md — "if something cited there no longer matches the code,
treat the doc as stale for that point, re-derive the answer, and update the
doc" — and CLAUDE.md's own rate-limiter line should be fixed in the SPEC-3 PR.

One incidental confirmation of §2.1 worth recording, because it happened while
writing this: the throwaway script used for those counts wrapped a query in
`.catch(() => null)`, and `ReconciliationRun.findFirst({ orderBy: { createdAt }})`
failed silently because that model has no `createdAt` column — reporting "none"
for a table with four rows. A swallowed error produced a confidently wrong
number in the space of one afternoon. That is the failure mode this week exists
to make visible.
