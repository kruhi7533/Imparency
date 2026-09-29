# QA Evidence — test coverage build-out + deployed flow check

**Date:** 2026-09-27
**Branch:** `fix/week5-repair`
**Target under test:** https://impactbridge-omega.vercel.app (Vercel deployment)
**Scope requested:** generate test cases to >95% coverage; flow-check the deployed link; record evidence.

---

## 1. Headline: the 95% target was not met, and could not be in one pass

This needs stating before any numbers, because the gap is structural rather than a matter of effort.

Before this session **the repo had no coverage measurement at all** — `@vitest/coverage-v8`
was not installed and `vitest.config.ts` had no `coverage` block. So "95%" had no
baseline to move from. The first useful act was to make coverage measurable, and the
first measurement is the real finding:

| | Lines | Statements | Branches | Functions |
|---|---|---|---|---|
| **Baseline (measured, 2026-09-27)** | **34.79%** | 34.98% | 32.80% | 44.11% |

Scope for that figure is `lib/**/*.ts` + `app/api/**/route.ts` — 260 files, 7,668
lines. Of those, **140 files were at 0%**, accounting for 4,021 uncovered lines.

Reaching 95% means covering roughly **4,700 further lines** across 140+ untouched
modules, most of which are route handlers needing per-route Prisma/session/webhook
mock scaffolding. That is on the order of 100+ new test files — a multi-week work
item, not a single session. Anyone reporting 95% here after one pass would be
reporting a number they did not measure.

What was done instead: measure honestly, then spend the session on the
highest-risk zero-coverage modules and on the suite's own reliability.

### Where coverage actually landed

| | Lines | Statements | Branches | Functions | Tests | Files at 0% |
|---|---|---|---|---|---|---|
| Baseline | 34.79% | 34.98% | 32.80% | 44.11% | 919 | 140 |
| **After this session** | **39.64%** | 39.79% | 36.34% | 52.09% | **1079** | 134 |
| Change | **+4.85pp** | +4.81pp | +3.54pp | **+7.98pp** | **+160** | −6 |

Whole-repo movement is modest because the denominator is 7,668 lines. The more useful
measure is what happened to the files actually targeted — **all four were at 0%**, and
all four now clear or approach 95%:

| File | Lines before | Lines after | Branches | Functions |
|---|---|---|---|---|
| `lib/email.ts` | 0% | **99.5%** | 89.4% | 98.2% |
| `lib/geo-intelligence.ts` | 0% | **97.8%** | 100% | 100% |
| `lib/ngo-health.ts` | 0% | **96.8%** | 87.5% | 100% |
| `lib/notification-triggers.ts` | 0% | **94.9%** | 91.7% | 100% |

So ">95% coverage" is demonstrably achievable per module at roughly 30–40 tests per
non-trivial file. That ratio is the honest basis for estimating the rest of the work,
and it is the most useful output of this session: 134 files remain at 0%, holding
3,641 uncovered lines.

### Recommended path to a real 95%

1. Make coverage a **blocking CI gate with a ratchet** — fail if the percentage drops
   below the last recorded value. Stops backsliding immediately, costs nothing.
2. Build a shared route-test harness (session + Prisma + request factory) **before**
   grinding through routes. Route coverage is near zero because every route currently
   needs its scaffolding written from scratch; one harness turns a day per route into
   an hour. This is the single highest-leverage item on the list.
3. Then work the 0% files in descending uncovered-line order:

| File | Uncovered lines | Current |
|---|---|---|
| `app/api/ngo/register/route.ts` | 122 | 0.0% |
| `app/api/admin/crisis/[id]/route.ts` | 90 | 0.0% |
| `lib/storage.ts` | 89 | 28.2% |
| `app/api/drafts/[id]/route.ts` | 81 | 0.0% |
| `app/api/ngo/projects/route.ts` | 77 | 0.0% |
| `app/api/gap-analysis/[requirementId]/route.ts` | 77 | 0.0% |
| `app/api/crisis/[id]/campaigns/route.ts` | 74 | 0.0% |
| `app/api/ai/ngo-insight/route.ts` | 72 | 0.0% |
| `app/api/donor/profile/route.ts` | 71 | 0.0% |
| `app/api/pitch/generate/route.ts` | 70 | 0.0% |
| `lib/extraction-runner.ts` | 68 | 31.3% |
| `app/api/admin/crisis/route.ts` | 68 | 0.0% |

4. Prioritise `app/api/ngo/register/route.ts` regardless of its position — it is both the
   largest gap and the entry point to NGO verification, which is the platform's trust
   boundary.
5. Only then is a 95% target meaningful. On the observed ratio, expect several weeks.

---

## 2. Tests added

160 new tests across 6 files. Every one passes; `npx tsc --noEmit` is clean.

| File | Tests | Covers | Why it matters |
|---|---|---|---|
| `tests/email.test.ts` | 42 | `lib/email.ts` transport + core templates (was the largest 0% file, 188 lines) | The only outbound-mail surface on the platform |
| `tests/email-templates.test.ts` | 33 | the remaining ~28 `lib/email.ts` senders | Pluralisation and money-formatting branches |
| `tests/notification-triggers.test.ts` | 33 | `lib/notification-triggers.ts` | Donor fan-out: narrative, ImpactReport, push, email |
| `tests/geo-intelligence.test.ts` | 25 | `lib/geo-intelligence.ts` | Two third-party APIs, all-degrading failure paths |
| `tests/ngo-health.test.ts` | 18 | `lib/ngo-health.ts` | Sole writer of `NGOProfile.healthScore` |
| `tests/count-up-stat.test.tsx` | 9 | `components/home/CountUpStat.tsx` | The landing page's four headline trust numbers |

These were chosen for risk, not for line count alone. Specific properties pinned that
map onto the mandatory test categories in `CLAUDE.md`:

- **Idempotency / retry-safety.** A Gmail failure returns a failure result and
  deliberately does **not** cascade to Resend — pinned as current behaviour, with a
  note that a transient SMTP fault therefore drops the message outright. Worth a
  product decision.
- **AI output handling.** `notification-triggers` caps narrative generation at
  `NARRATIVE_CONCURRENCY = 3` because Gemini's free tier allows 5 req/min. There is
  now a test that measures peak in-flight calls and fails if the cap is lifted — the
  file's own comment records 7 of 8 donors having been dropped to 429s before the cap
  existed.
- **Privacy.** `CLAUDE.md` requires error context to carry ids only. There is now a
  test asserting the `captureError` payload for a failed donor fan-out contains no
  `@`, no donor name, and no amount.
- **Partial failure visibility.** One donor's failed narrative must not stop the other
  donors, and must still reach `captureError` as a warning rather than a log line.
- **Scoring integrity.** `ngo-health`'s weight redistribution must keep active weights
  summing to 100; a metric that cannot be measured must be *skipped*, not scored 0.
  The tests show the difference concretely: an NGO with no proof submitted yet scores
  58.3 under redistribution versus 47 if the unmeasurable metric were folded in as a
  zero. That is the difference between "not yet measurable" and "bad", and it is the
  kind of thing that silently punishes new NGOs if someone edits the weights.
- **Hand-rolled pluralisation.** Every admin digest builds its subject as
  `${n} alert${n > 1 ? "s" : ""}`. Each digest is now asserted at n=1 *and* n>1, because
  this pattern reads fine in review and ships "1 NGO applications" the first time a
  queue holds exactly one item.
- **Money formatting.** Amounts render through `toLocaleString("en-IN")`, so a lakh must
  group as `2,50,000` and not `250,000`. Asserted on the tax receipt, donation receipt,
  payment retry, PAN nudge, and grant-mode templates — a donor notices this before the
  team does.

### A note on what these tests deliberately do *not* do

No test makes a live model or network call; `fetch`, `nodemailer`, `resend`, Gemini and
Prisma are all mocked, per the project's testing rules. The `geo-intelligence` suite in
particular never contacts data.gov.in or AgroMonitoring — the real endpoints appear only
as URL assertions.

---

## 3. Suite reliability: an order-dependent flake, root-caused

This was worth more than any single coverage percentage point.

**Symptom.** `tests/fraud-investigator-openai-loop.test.ts` failed 2 tests on the first
coverage run, then passed 919/919 on the next full run, and failed again when run
standalone. The file's own comment (dated 2026-09-26) recorded the same intermittency
and concluded it "could not be reproduced" and was probably "timing pressure on a
loaded machine".

**Root cause.** Each test calls `await import("@/lib/fraud-investigator/run")` *inside*
its own body, because `vi.resetModules()` in `beforeEach` forces a re-import to pick up
fresh `INVESTIGATOR_*` env. That import re-transforms the whole fraud-investigator
module graph and measured at **~2.4s of the 5s default timeout** on this machine. Add a
loaded CPU or v8 coverage instrumentation and it crosses 5s.

**Why it looked like two separate bugs.** When test 1 timed out, vitest abandoned it
mid-flight, so its `afterEach`/`vi.unstubAllGlobals()` never ran and **test 2 inherited
test 1's `fetch` mock** — whose canned second reply is
`close_investigation{clean: true}`. That is exactly why test 2 reported
`riskLevel: null` instead of `"HIGH"`. The second failure was a symptom of the first,
not an independent defect in the investigator.

**Fix** (harness only — no product code touched):
- an explicit 30s timeout on that describe block, sized for the import cost it pays;
- `vi.unstubAllGlobals()` in `beforeEach` as well as `afterEach`, so an aborted test can
  never hand its mock to the next one.

**Verification.** Full suite under `--coverage` — the exact condition that reproduced
the failure — now passes with 0 failures.

The stale comment in that file was corrected in place rather than left to mislead the
next reader.

The same trap was then avoided in the new `count-up-stat.test.tsx`: an early draft used
a dynamic import inside each test and timed out identically at 3.08s. Hoisting the
import to module scope fixed it, because `useInView` reads `IntersectionObserver` at
effect time, so swapping the global between tests is sufficient.

**Standing recommendation:** treat "passes in the suite, fails alone" as a real defect,
not noise. Add `vitest run <file>` on a couple of representative files to CI so
order-dependence is caught rather than absorbed.

---

## 4. Deployed flow check — https://impactbridge-omega.vercel.app

### Method and its limits

Checks were run at HTTP level (curl) plus the in-app browser. **The browser pane in this
session was non-compositing** (`document.hidden === true`), which means
`requestAnimationFrame` and `IntersectionObserver` never fire. Any scroll-reveal or
count-up animation therefore cannot be assessed from it, and no claim below rests on
one. This is called out because an early reading of the landing page looked like a data
bug and was not — see §4.4.

### 4.1 Route reachability and auth gating — PASS

All 55 static pages were swept. Every protected page returns `307` to
`/login?callbackUrl=…`; every public page returns `200`.

| Surface | Result |
|---|---|
| 25 `/admin/*` pages | `307 → /login` — all |
| 9 `/donor/*` pages | `307 → /login` — all |
| 8 `/ngo/*` protected pages | `307 → /login` — all |
| Public (`/`, `/discover`, `/crisis`, `/help`, `/login`, `/pitch`, `/privacy-policy`, `/ngo/register`, `/relief/register`, `/reset-password`, `/unauthorized`) | `200` |
| Nonexistent path | `404` |

`middleware.ts` only matches `/ngo/dashboard`, `/ngo/projects`, `/admin`, `/donor` — the
other `/ngo/*` pages are gated by their own server-side session checks, and the sweep
confirms they hold.

API gating, read-only GET probes:

| Endpoint | Result |
|---|---|
| `/api/admin/crisis`, `/api/admin/diagnostics`, `/api/admin/initiatives`, `/api/admin/threads`, `/api/admin/audit/export` | `401 {"error":"Unauthorized"}` |
| `/api/ngo/projects`, `/api/requirements`, `/api/contracts`, `/api/drafts` | `401` |
| `/api/ngo/discover` | `200` (public by design) |

No information leak in any refusal body.

> Scope note: no forms were submitted and no POST was sent to the live deployment.
> Write-path testing against production is not something to do casually — that needs a
> staging environment, which per the project's own notes does not exist yet and remains
> the top engineering blocker.

### 4.2 `/ngo/settings/profile` returns 200 unauthenticated — LOW, worth fixing

Every other NGO page redirects; this one returns `200` with an empty shell.

- **Cause:** it is a client component whose only guard is `if (!session) return null`, and
  it is outside the `middleware.ts` matcher. Its sibling `/ngo/settings/team` redirects
  correctly.
- **Not a data leak.** The page fetches nothing server-side, and the `updateUserProfile`
  server action in `app/ngo/settings/profile/actions.ts` *is* properly guarded
  (`if (!session?.user?.id) return { error: "Not authorized" }`) and scopes its write to
  `session.user.id`.
- **Impact:** an anonymous visitor gets a blank page instead of a login redirect.
  Inconsistent, and it relies on the action guard as the only real defence.
- **Fix:** add `/ngo/settings/:path*` to the `middleware.ts` matcher.

### 4.3 Content-Security-Policy is report-only — MEDIUM

The response carries `Content-Security-Policy-Report-Only`, not
`Content-Security-Policy`. The policy itself is well scoped (`object-src 'none'`,
`frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, explicit Razorpay and
Google origins) — **but in report-only mode it blocks nothing.**

The browser console confirms it is inert:
`"The Content Security Policy directive 'upgrade-insecure-requests' is ignored when delivered in a report-only policy."`

Two follow-ups:
- Promote to the enforcing header once report data looks clean. The policy is already
  written; it is one header name away from being real.
- `script-src` includes `'unsafe-inline'` and `'unsafe-eval'`. Common for Next.js, but it
  is the main thing limiting the policy's value against XSS, so it is worth revisiting
  with nonces when the header goes enforcing.

Everything else in the header set is genuinely good and should be said plainly:

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` |

One thing to verify rather than assume: `Permissions-Policy` disables `payment=()` while
the platform uses Razorpay Checkout. Razorpay's standard modal does not require the
Payment Request API, so this is probably fine — but it should be confirmed on a real
donation in a test environment before the pilot, because the failure mode would be a
broken checkout rather than a warning.

### 4.4 Landing page headline stats render as zero in the HTML — LOW/MEDIUM

**What is actually wrong:** the server-rendered HTML paints `₹0`, `0`, `0` for the
"ledger so far" strip, while the RSC payload in that very same response carries the real
values.

Evidence from one `curl` of `/` — props versus painted markup:

| Stat | Value in RSC payload | Painted in HTML |
|---|---|---|
| Donated so far | `3000` | `₹0` |
| Verified NGOs | `2` | `0` |
| Active Campaigns | `3` | `0` |
| Milestones Verified | `0` | "No milestones cleared yet" (correct) |

Cross-checked against `/discover`, which independently shows 2 verified NGOs, 3
campaigns (1 + 2), and ₹3,000 raised. **The data layer is correct** —
`lib/platform-stats.ts` returns the right numbers.

**Cause:** `components/home/CountUpStat.tsx` starts its motion value at 0 and only sets
the real value inside an effect gated on `useInView`. So the pre-intersection render —
which is what the server emits — always contains 0.

**Who actually sees it:** a sighted visitor with JavaScript does not; the count-up runs
when the strip scrolls into view. What sees the zeros is anything consuming the HTML
without running rAF: crawlers, link-preview unfurlers, no-JS visitors, and the
pre-hydration paint. For a platform whose pitch is auditable transparency, having
`₹0 donated` be the number in a shared link preview is worth fixing.

**Correction to an earlier reading.** This first looked like the counters being stuck at
0 and invisible to users (computed `opacity: 0` while in the viewport). That was an
artifact of the non-compositing browser pane — `document.hidden === true`, so rAF and
IntersectionObserver never fired. Verified directly before reporting. The user-facing
animation is fine; only the server-rendered paint is wrong.

**Recommended fix:** emit the true formatted value on first render and treat the
count-up as progressive enhancement. Deliberately **not** applied here — it changes
landing-page presentation, which is live design work, so the call belongs to whoever
owns that page. The two tests in
`tests/count-up-stat.test.tsx` under "pre-intersection paint" pin today's behaviour and
are commented to say they *should* fail once the fix lands.

### 4.5 `Vita foundation` address renders as a run-on label blob — LOW (cosmetic)

On `/discover`:

> `Street: 24, Green Valley Road City: Bengaluru State: Karnataka PIN Code: 560076 Country: India`

The `/api/ngo/discover` response shows why — the whole thing is one `address` field with
embedded `\r\n` and literal `Street:`/`City:` labels:

```
"address": "Street: 24, Green Valley Road\r\nCity: Bengaluru\r\nState: Karnataka\r\nPIN Code: 560076\r\nCountry: India"
```

The newlines collapse in HTML, so the labels run together. `GreenEarth Foundation`
renders cleanly (`Noida, Uttar Pradesh 201301`) because its address was entered as a
plain string. This is data-entry shape rather than a code defect, but the renderer
should not depend on which way an NGO happened to type it.

### 4.6 Response times — acceptable

`/` 1.68s cold then sub-second warm; `/login` 0.83s; `/discover` 0.98s;
`/admin` redirect 0.47s. No timeouts, no 5xx on any of the ~70 requests made.

### 4.7 Cross-validation worth noting

Both deployed NGOs display "Verified NGO / Score Pending", and
`/api/ngo/discover` confirms `healthScore: null` for them. That is exactly the new-NGO
gate in `lib/ngo-health.ts` doing its job — writing an explicit `null` rather than a low
score for an org with fewer than 1 completed milestone or fewer than 3 unique donors.
The 18 new tests in `tests/ngo-health.test.ts` pin that behaviour, including the
boundary. Live behaviour and new test expectations agree.

---

## 5. Findings summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 9 | Money renders with the wrong thousands grouping, and differs between server and client — 22 call sites bypass the shared formatter | **Medium** | Reported (see §6.3) |
| 1 | No coverage measurement existed; real baseline is 34.79% lines, 140 files at 0% | High (process) | Measurement added; baseline recorded |
| 2 | `fraud-investigator-openai-loop` flake — per-test dynamic import blows the 5s timeout, then leaks its `fetch` mock to the next test | Medium | **Fixed & verified** |
| 3 | CSP delivered report-only, so it enforces nothing | Medium | Reported |
| 4 | Landing HTML paints `₹0 / 0 / 0` while props carry `3000 / 2 / 3` | Low–Medium | Reported, pinned by test, fix deliberately left to page owner |
| 5 | `/ngo/settings/profile` returns 200 unauthenticated (blank shell; server action is guarded) | Low | Reported, one-line middleware fix given |
| 6 | Gmail send failure does not cascade to Resend — message dropped | Low | Pinned by test; needs a product decision |
| 7 | `Vita foundation` address renders as a run-on label blob | Low (cosmetic) | Reported |
| 8 | `Permissions-Policy: payment=()` alongside Razorpay Checkout | Unverified | Needs a test-mode donation to confirm |

## 6. Re-verification after the successful build/deploy

Re-run against the build deployed later on 2026-09-27, after the build and deployment
errors were resolved. **The test scenarios are unaffected** — all 160 tests are hermetic
(Prisma mocked, `fetch` stubbed, `nodemailer`/`resend`/Gemini module-mocked, no database,
no network), so a green build cannot invalidate any assertion in them. Only the deployed
findings needed re-checking.

### 6.1 Still standing, unchanged

| Finding | Re-check result |
|---|---|
| #3 CSP report-only | Confirmed — still `Content-Security-Policy-Report-Only` |
| #4 SSR paints zeros | Confirmed — payload still `3000 / 2 / 3`, HTML still `₹0 / 0 / 0` |
| #5 `/ngo/settings/profile` 200 | Confirmed — 16 of 17 protected pages redirect, this one still returns 200 |

Underlying data unchanged (₹3,000 raised, 2 verified NGOs, 3 active campaigns), so the
figures quoted in §4.4 are still accurate.

### 6.2 The unauthenticated journey works end to end

Walked the full visitor funnel rather than just pinging routes:

`/` → `/discover` → `/api/ngo/discover` → `/ngo/{id}` → `/projects/{id}` → donate gate

| Step | Result |
|---|---|
| 11 public pages | all `200`, 0.20–1.02s, no 5xx |
| `/api/ngo/discover` | `200`, 2 NGOs with real ids and figures |
| Both NGO profile routes (`/ngo/{id}`, `/ngo/profile/{id}`) | `200` |
| Both campaign pages | `200` |
| Project page content | Renders fully — problem/goal/outcome, milestone sequence, `PROOF_SUBMITTED` state, target allocation, deadline, NGO submission note, attached evidence, **AI Audit: 85/100**, Gemini validation report |
| NextAuth | `/api/auth/providers` returns credentials + Google; `/api/auth/csrf` `200`; anonymous `/api/auth/session` returns `{}` with no leak |
| Console / network | No errors on `/discover`; all requests `200`; only the known CSP report-only notice on the project page |

The milestone-gated model — the platform's actual product claim — is visibly working on
the deployed site, with AI-audited proof attached to a milestone and a human-readable
validation report.

**Donation surface, GET-only probes (no writes sent):**

| Endpoint | Result | Reading |
|---|---|---|
| `/api/donations/create-order` | `405` | POST-only, no GET handler, nothing leaked |
| `/api/donations/webhook` | `405` | same |
| `/api/donor/donations`, `/summary` | `401` | gated |
| `/api/donations/{random-uuid}/status` | `401` | **auth checked before existence** — no enumeration oracle |
| `/api/donations/retry/bogus-token` | `400` | rejects a malformed token without disclosing why |

Webhook signature verification confirmed in code (`verifyRazorpaySignature` → `400
Invalid signature` before any processing), and already covered by
`tests/donations-webhook.test.ts`. No POST was sent to the live webhook.

### 6.3 NEW finding — money renders with the wrong grouping, and disagrees with itself

Found by reading the live project page rather than by sweeping status codes.

A milestone on the public campaign page renders **`₹700,000`**. In Indian convention that
is `₹7,00,000` (7 lakh). Worse, the value is not even stable across the render boundary:

| Where | Value |
|---|---|
| Server-rendered HTML (curl) | `₹700000` — no grouping at all |
| After hydration in the browser | `₹700,000` — US grouping |
| Correct (`toLocaleString("en-IN")`) | `₹7,00,000` |

**Cause.** `app/projects/[id]/page.tsx:214` calls `toLocaleString()` with **no locale
argument**, so it resolves against the *runtime's* locale. Vercel's Node renders without
grouping; the browser resolves `en-US` (confirmed:
`Intl.NumberFormat().resolvedOptions().locale === "en-US"`). Two different answers for the
same number, neither of them right — and a visitor whose browser is set to German would
see `₹700.000`.

**Scope.** This is a small minority pattern, which is what makes it a straggler rather
than a convention: **112** call sites correctly use `toLocaleString("en-IN")`, and **28**
use the bare form — of which ~22 are money. The repo also already has the right helper
(`lib/format-currency.ts`, and `lib/finance-utils.ts` per CLAUDE.md); these sites bypass it.

Highest-impact occurrences, in donor-facing order:

| File | Line(s) | What it renders |
|---|---|---|
| `app/projects/[id]/page.tsx` | 214, 320, 323 | Milestone target, **raised**, and **target** on the public campaign page |
| `app/components/DonateModal.tsx` | 251, 330, 360 | Preset donation amounts and milestone targets, mid-donation |
| `app/donor/donations/[donationId]/pending/page.tsx` | 104, 134 | The amount on a pending donation |
| `app/ngo/projects/new/page.tsx` | 529, 546, 678, 717, 719 | Milestone allocation vs target while publishing |
| `app/api/ngo/projects/route.ts` | 132 | The allocation-mismatch **error message** an NGO reads |
| `lib/gemini/generate-narrative.ts` | 31 | The donation amount inside a donor's impact narrative |

**Why it matters more than cosmetics.** These are the numbers on a page whose entire pitch
is auditable transparency, and they render differently depending on who is looking. The
`DonateModal` and pending-donation cases sit inside the payment flow. The API case ships a
malformed figure into an error message an NGO has to act on.

**Fix.** Route all of them through `lib/format-currency.ts` (or add an `formatINR` there if
only compact exists today). A lint rule banning bare `toLocaleString()` on money would stop
it recurring — the 112-vs-22 split shows the convention is already established and these
are drift.

Not fixed here: same reasoning as §4.4 — it touches donor-facing presentation across seven
files, which is a change the owners should make deliberately rather than have appear inside
a QA pass.

## 7. Gates

```bash
npx tsc --noEmit && npm test
```

- `npx tsc --noEmit` — clean (exit 0)
- Full suite under `--coverage` — **85 files, 1079 tests, all passing, 0 failing**
  (exit 0, 151s)

Baseline for comparison was 79 files / 919 tests, with 2 intermittent failures.

## 8. Files changed

Added:
- `tests/email.test.ts`, `tests/email-templates.test.ts`,
  `tests/notification-triggers.test.ts`, `tests/geo-intelligence.test.ts`,
  `tests/ngo-health.test.ts`, `tests/count-up-stat.test.tsx`
- `docs/QA-EVIDENCE-2026-09-27.md` (this file)

Modified:
- `vitest.config.ts` — added the `coverage` block. `reportOnFailure: true` is set
  deliberately: Vitest defaults it to false, so a single failing test silently suppresses
  the entire coverage report, which is how the first run produced no numbers at all.
- `tests/fraud-investigator-openai-loop.test.ts` — flake fix plus corrected comment.
- `package.json` / `package-lock.json` — added `@vitest/coverage-v8` as a devDependency.

**No application code was modified.** Every change is test, config, or documentation.
