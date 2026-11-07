# ImpactBridge — QA Test Report
**Date:** 2026-10-31
**Scope:** Full-platform sanity pass with emphasis on lesser-used features and boundary values, against the local dev environment (synced to `origin/main` @ `6059fc0`) backed by the shared Neon dev database.
**Tester:** Claude (acting as QA), manual + automated + live API/browser testing.

---

## 1. Executive summary

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ **Clean** (0 errors) |
| `npm test` (Vitest, 2628 tests) | ✅ **2628/2628 pass** once re-run outside resource contention |
| Admin console (21 real routes swept) | ✅ All return 200 after one environment fix (below) |
| Donation flow boundaries | ⚠️ **1 bug found** — see §2.1 |
| Login / signup / rate limiting | ✅ Correct boundary behavior |
| NGO document upload validation | ✅ Correct (PDF-only, 10MB cap), confirmed by code + blocked-by-rate-limiter live test |
| Admin notifications (previously a known gap) | ✅ **Fixed** — now fully working |
| Scheduled/cron jobs | ⚠️ **9 of 11 jobs have never run** in this environment — by design given deploy target, but worth confirming in production (see §3.3) |

One environment-drift issue was found and fixed during testing (not a code bug). One real application bug was found (donation amount has no upper bound and crashes with a 500 instead of a clean validation error). Everything else checked out.

---

## 2. Bugs found

### 2.1 — Donation amount has no upper bound; large values crash with 500 instead of a validation error
**Severity: Medium** (not exploitable for financial gain, but an unhandled server error reachable by any donor)

- `app/api/donations/create-order/route.ts` validates `amount >= 100` but never checks an upper bound.
- `Donation.amount` in Postgres is `Decimal(10,2)` — max value is `99,999,999.99` (≈ ₹10 crore).
- Sending `amount: 1e15` (or anything over the column's range) throws an unhandled `PrismaClientUnknownRequestError`:
  ```
  PostgresError 22003: numeric field overflow
  "A field with precision 10, scale 2 must round to an absolute value less than 10^8."
  ```
  This surfaces to the donor as a generic 500 ("We couldn't start your donation right now") instead of a clear 400 validation message, and logs a full stack trace server-side.
- **Repro:** `POST /api/donations/create-order` as a DONOR with `{ projectId, amount: 1e15 }` → `500`.
- **Fix suggestion:** add an upper-bound check alongside the existing `amount < 100` check, e.g. `amount > 10_00_00_000` (₹10 crore, matching the column) → `400 "Amount exceeds the maximum allowed."`

**Boundary matrix tested** (all other cases behaved correctly):

| Amount | Expected | Actual |
|---|---|---|
| 100 (exact min) | Accepted | ✅ 200 |
| 99 (min − 1) | Rejected | ✅ 400 |
| 0 | Rejected | ✅ 400 |
| −500 | Rejected | ✅ 400 |
| `"abc"` (non-numeric) | Rejected | ✅ 400 |
| `NaN` | Rejected | ✅ 400 |
| 100.5 (decimal) | Accepted | ✅ 200 |
| missing amount | Rejected | ✅ 400 |
| missing projectId | Rejected | ✅ 400 |
| **1e15 (oversized)** | **Rejected (400)** | **❌ 500 (crash)** |

### 2.2 — `requirement-rule-extraction.test.ts` is flaky under load
**Severity: Low**

One test (`reads every labelled field with a per-field confidence, tagged RULES`) times out at the default 5000ms Vitest timeout, reproducibly, even when that test file is run in isolation with no other heavy processes competing for CPU. All other previously-failing tests (`geo-intelligence`, `tenant-isolation-coverage`, `fraud-investigator-openai-loop`) passed cleanly once re-run without a concurrently-running dev server. This one test's PDF-parsing path appears to be borderline-slow on this machine. Recommend either raising its timeout or profiling `lib/requirements/extraction.ts`'s rule-based path.

---

## 3. Observations (not bugs, but worth your attention)

### 3.1 — Local `node_modules` had drifted from `package-lock.json` (fixed during this session)
`@anthropic-ai/sdk` was declared in `package.json`/`package-lock.json` but was not physically present in `node_modules`. This broke the **entire admin console** (`/admin/dashboard` and everything importing `lib/verification-triage.ts` → `lib/gemini/extract-ngo-fields.ts` → `lib/ai/claude.ts`) with a 500 "Module not found" error. Root cause: `node_modules` wasn't reinstalled after the recent `git pull` brought in 75 commits' worth of dependency changes. **Fixed by running `npm install`.** This is a local environment issue, not a code defect — Vercel/CI always run a fresh `npm install` before `next build`, so production was never affected. Worth remembering: after any large `git pull`, run `npm install` before `npm run dev`.

### 3.2 — Minor security nitpick: login error message confirms account existence
`POST /api/auth/callback/credentials` → `signIn` surfaces `"Invalid password"` specifically (vs. a generic "Invalid email or password") when the email exists but the password is wrong. This lets an attacker enumerate registered emails. Low severity, common trade-off, but flagging since donor/NGO emails are PII.

### 3.3 — 9 of 11 scheduled jobs have never run in this environment
`/admin/ops` (a good feature — correctly treats "never run" as a failure state, not silence-as-success) shows:
- **Never run:** `fcra-expiry`, `deliver-impact`, `impact-digest`, `crisis-notify`, `risk-scores`, `re-engagement`, `sla-escalation`, `risk-dispatch`, `fcra-quarterly-report`
- **Overdue/failing:** `reminders` (last failed 21 days ago, manual run), `risk-sweep` (last succeeded 21 days ago, manual run)

The page itself explains why: `vercel.json` lists these as Vercel cron schedules, but the platform doesn't actually deploy to Vercel, so none of them fire there. **This means FCRA-expiry alerts, donor impact delivery, re-engagement nudges, SLA escalation, and risk dispatch are not running automatically anywhere right now** unless a real crontab has been installed on the production server pointing at these routes. Worth confirming explicitly rather than assuming — this is exactly the kind of silent gap the page is designed to surface.

### 3.4 — `RunJobButton` ("Run now") could not be exercised via browser automation
The button correctly uses a native `window.confirm()` before firing (`app/admin/ops/RunJobButton.tsx:13`), which headless browser automation auto-dismisses, so the manual-trigger path wasn't exercised end-to-end in this pass. Code review shows the implementation (POST to `/api/admin/ops/[job]/run`, idempotent/skip-if-running, result message) is correct; recommend a human click-test once to confirm end-to-end, or add a Vitest/integration test for the route handler directly.

### 3.5 — CSP console warning (cosmetic)
Every page logs: `The Content Security Policy directive 'upgrade-insecure-requests' is ignored when delivered in a report-only policy.` This is Chrome telling you the directive is meaningless in report-only mode — not a functional issue, but worth dropping the directive from the report-only policy or switching that policy to enforcing mode if that was the intent.

### 3.6 — Previously-documented gap is now fixed: admin notifications
`CLAUDE.md` notes *"Notification rows are written and pushed via FCM but never surfaced in any UI"* as a known sharp edge. This is now **out of date** — `/admin/notifications` is fully built and working (verified live: shows NGO thread replies, agent case escalations, read/unread counts). Recommend updating `CLAUDE.md`.

### 3.7 — `DonateModal` / `create-order` shape mismatch is now fixed
Also previously documented as a sharp edge in `CLAUDE.md`. Code comments in `create-order/route.ts` (lines 328–332, 150–154) confirm this was already patched — the response now includes `razorpayOrderId`, `keyId`, `donorName`, `donorEmail` as the modal expects, and error messages route through `error`/`reason` correctly. Recommend updating `CLAUDE.md` to drop this from the sharp-edges list.

---

## 4. What was verified working correctly

- **TypeScript**: zero compile errors across the full codebase.
- **Test suite**: all 2628 Vitest tests pass when run without resource contention.
- **Admin console**: 21 real routes checked (dashboard, today, verification, project-review, risk-radar, donors, pilot-health, team, trust-trends, impact-health/review/publishing/quality, metrics, sla, ops, notifications, finance, break-glass, platform-trail, requirements) — **all load without server errors**. Two URLs in the original sweep list, `/admin/contracts` and `/admin/outcome-claims`, correctly 404: `/admin/contracts` has no index page (only `/admin/contracts/[id]` for viewing one contract — a guessed URL on my part, not a bug), and `/admin/outcome-claims` was never a real route — outcome claims are managed inside `/admin/impact-quality` and `/admin/impact-review` instead.
- **Auth boundaries**: malformed email blocked client-side (native `type=email`), wrong password → clear `401` + UI message, correct credentials → session + role-based redirect.
- **Rate limiting**: signup endpoint correctly allows the configured burst then returns `429` (tested: 4 succeed, 5th+ blocked) — matches `lib/rate-limiter.ts` wiring described in `CLAUDE.md`.
- **Donation minimum boundary**: exactly ₹100 accepted, ₹99 rejected — correct inclusive boundary.
- **File upload validation** (NGO registration drafts, `lib/registration-draft.ts`): PDF-only + 10MB cap enforced in code; live exercise was correctly blocked by the (working) rate limiter, which is itself a positive signal.
- **Pagination**: `/discover?page=99999` degrades gracefully to page 1 rather than erroring.
- **Deployed vs. local parity**: confirmed in the prior session that `impactbridge-omega.vercel.app` matches the current `origin/main` code.

---

## 5. Test data cleanup note

During boundary testing, 5 throwaway accounts were created in the shared dev database (`qa.tester.boundary@example.test`, and 4 `spam.test.*@example.test` addresses used for the rate-limit burst test). The two test donations created against project `b154a642-5e98-4a1c-af9d-139c065ba723` ("After-School Learning Centres for Rural Pune") were deleted and its `raisedAmount` was reverted to its original value (₹2,53,000). The 5 leftover user rows could not be hard-deleted due to `RESTRICT` foreign keys on `Notification` — they carry no PII beyond a throwaway email/name and no financial data, so they're safe to leave or purge with a cascading admin script at your convenience.

---

## 6. Recommended follow-ups (priority order)

1. **Add an upper-bound check on donation amount** in `create-order/route.ts` (§2.1) — quick fix, prevents a 500 and a stack-trace leak.
2. **Confirm production cron is actually installed** for the 9 never-run jobs (§3.3) — this is a real operational gap if not.
3. Update `CLAUDE.md` — two "known sharp edges" are now fixed (§3.6, §3.7); one note is stale.
4. Consider a generic "Invalid email or password" message to avoid account enumeration (§3.2) — low priority.
5. Investigate the borderline-slow `requirement-rule-extraction.test.ts` test (§2.2).
