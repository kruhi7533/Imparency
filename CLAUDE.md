# ImpactBridge — Working Notes for Claude

**Before implementing anything in this repo, read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).** It is a maintained, code-grounded developer knowledge base covering the feature map, dependency/caller graph, execution-path traces (login, NGO registration, donation, payment webhook, milestone submission, admin verification, WhatsApp proof, notifications, etc.), the full Prisma model cheat sheet, the AI/payments/compliance subsystems in depth, a modification guide (where to touch for common changes), hidden conventions, common mistakes, and a deep dive on the most recently active modules (team invites, WhatsApp/field-worker, NGO settings/CRM, pitch deck, donor domain).

Answer architecture questions from that document plus a targeted re-read of the cited files — don't rediscover the codebase from scratch. If something cited there no longer matches the code, treat the doc as stale for that point, re-derive the answer, and update the doc.

## Quick orientation
- Next.js 14 App Router + TypeScript, Tailwind, Prisma 5 (Neon Postgres via driver adapter), NextAuth (Credentials + Google, JWT sessions), Razorpay, Google Gemini, Twilio WhatsApp.
- Pattern: route-colocated "fat handlers" (no repository/service layer beyond `lib/*.ts`), hybrid Server/Client Components, no client-side state library (no Redux/Zustand/React Query — local `useState` + `router.refresh()`).
- Primary author across almost the entire git history: `kruhi7533@gmail.com`.
- Process lives in `.claude/skills/`: **`implement-issue`** (read issue → inspect → plan → smallest change → tests → checks → summary) and **`review-pr`** (correctness, security, architecture, tests). Use them rather than editing straight from the prompt. That governs *process*; `docs/ARCHITECTURE.md` governs *what the code does*. (The older GSD methodology — `PROJECT_RULES.md`, `.gsd/` — was removed in `a9849f7`; those files no longer exist.)

## Known sharp edges (see `docs/ARCHITECTURE.md` §12 for the full list)
- `DonateModal.tsx` and `create-order/route.ts` have mismatched request/response shapes.
- `lib/rate-limiter.ts` is now wired into ~12 routes (auth signup/forgot-password/reset-password, the admin AI routes, `assistant`, `donor/receipts/claim`) — but **donation/payment routes are still unprotected**, which is the gap that matters most.
- Several files bypass the shared `lib/prisma.ts` singleton with their own `new PrismaClient()` (loses the Neon retry wrapper): WhatsApp worker, drafts routes, pitch/lead route.
- `Notification` rows are written and pushed via FCM but never surfaced in any UI (no notifications route/bell/list).
- ~~`app/donor/dashboard/page.tsx` is a hardcoded stub~~ — fixed; it is now wired to real Prisma data.
- ~~`app/api/ngo/whatsapp-drafts/convert/route.ts` is dead code~~ — deleted; it was unreferenced by any UI, bypassed the `lib/prisma.ts` singleton, and updated a `milestoneId` without an ownership check. The live draft routes are `app/api/drafts/*`.
- There **is** now a Vitest suite: `npm test` runs `tests/*.test.ts` (77 files / 905 tests as of 2026-09-26, config in `vitest.config.ts`, `@` alias resolved). Prisma is mocked per-test, so no database is needed. Add tests there rather than writing new `scripts/test-*.ts` harnesses.
- **A green test suite does not mean the pages load.** Anything a `"use client"` component imports is compiled for the browser, and webpack does not polyfill the `node:` scheme — one Node builtin in that import closure makes the route fail to build and serve a 500. Week 7 shipped exactly this (`duplicateLabel` in `lib/proof-fingerprint.ts`, which imported `node:crypto`) and `/admin/proof-review` was dead while 1668 tests passed, because vitest runs in Node. `tests/client-bundle-safety.test.ts` now guards it; server-only helpers belong in their own module (`lib/proof-hash.ts`). **Open the page in a browser before calling a change done.**
- CSR/RFP workflow (upload → admin validation → matching → NGO brief → selection → contract) is documented in `docs/ARCHITECTURE.md` §13.7. Requirement status changes go only through `lib/requirements/commit.ts`; CSR files live in private storage and are served only by `GET /api/requirements/[id]/file`.
 Donors can also create a requirement from the structured form on `/donor/requirements` (no document, starts in `DONOR_REVIEW`).

## Impact: governed metrics, not free text
`ImpactReport.sdgTags` / `irisMetrics` are ungoverned `String[]`. Week 8 adds the layer that makes a reported number checkable — see `docs/WEEK8-BLUEPRINT.md`:
- `MetricDefinition` (`lib/metric-registry.ts`) is the registry, keyed by a published `code`. **A metric cannot be ACTIVE with an empty `requiredEvidence`** — without an evidence rule no claim against it could ever fail a check, which would be a permanent hole in the one rule the module exists to enforce. Seeded idempotently by `tools/seed-metric-registry.ts`.
- `OutcomeClaim` + `OutcomeClaimEvidence` hold the number and its citations. `value` is `Decimal` — an impact figure quoted to a funder gets the same treatment as money.
- `lib/outcome-workflow.ts` is the state machine. **APPROVED is not editable, only withdrawable** — a figure already shown to a funder must not change silently. `NEEDS_EVIDENCE` is a *return*, not a rejection, because the common case is a citation that proof review has not approved yet. Every adverse decision needs a note. Transitions are compare-and-swap (409 on a race) and the action guard uses `hasOwnProperty`, never `in`.
- **The approval gate lives in `app/api/admin/outcome-claims/[id]/route.ts`, not the UI:** a `BLOCKED` triage verdict is refused with 422 whatever the client sends, and the triage is re-run at decision time rather than trusted from page load. A `NEEDS_REVIEW` claim *can* be approved — those findings are questions, and the override is recorded in the audit log as verdict + finding codes.
- `lib/outcome-triage.ts` judges a claim. **No model call**, like `lib/verification-triage.ts`: arithmetic and set membership only. `DOUBLE_COUNTED` is the headline — Week 7 stopped the same photo being reused as evidence, this stops the same evidence being counted twice as impact.
- `CLEAN` must never mean "nothing was examined", and a failed claim must render as "unverified" — never as `0`, which reads to a donor as "achieved nothing".
- `/admin/metrics` is the registry; `/admin/impact-health` is unrelated (donor-update *delivery*), despite the name.
- `/admin/impact-quality` (`lib/impact-quality.ts`) is the defect dashboard: how much of what the platform reports is actually **backed**. Two calls worth not re-litigating. **The portfolio headline is count-based, not a value sum** — adding meals served to people trained gives a figure in no unit and the bigger metric swamps the ratio, so value shares are per-metric only. **APPROVED claims are re-triaged rather than trusted**, because consent can be withdrawn after approval; an approved claim that now triages `BLOCKED` is a retraction candidate, the same idea as the nightly badge sweep in `lib/compliance-evidence.ts`.
- `claimDisplay()` is the read contract for anything rendering a number to a donor: approved-and-still-backed renders the figure, **everything else renders "unverified"** — never `0`, never omitted. The donor-side surface still has to consume it.

## NGO verification: ONE pass, then triage
Registration used to fire three overlapping AI passes over the same three PDFs — `verifyNGODocuments` (awaited, so it blocked the response), `runAndStoreNgoScreening`, and `runAndStoreNgoExtraction`. They disagreed about what the files were and only extraction's answer ever reached a human. All three are now one:

1. `lib/gemini/extract-ngo-fields.ts` — **the only** AI pass over registration documents. One `generateContent` call, per-field values + confidence.
2. `lib/extraction-runner.ts` — stores `ExtractedField` rows through `resolveField()` (confidence threshold, format regexes, form cross-check; a one-way ratchet that can only push a field DOWN to `NEEDS_REVIEW`).
3. `lib/verification-triage.ts` — **no model call.** Deterministic rules decide the verdict: clean profiles are left for normal admin approval; defective ones open a `RiskReview` (plus a `FraudAlert` for HIGH findings) and surface in Risk & Compliance.

Rules worth not breaking:
- **A missing 12A or 80G is not a defect.** Many legitimate NGOs have neither; flagging them would flood the risk queue and make it worthless. Absence just means that compliance flag is never earned.
- **No evidence must never read as "safe."** An NGO with zero `ExtractedField` rows renders as "Not analysed" in red, not as clean.
- Only a human PATCH to `app/api/admin/ngo-fields/[fieldId]` makes a field `VALIDATED`, and only a `VALIDATED` field earns its `NGOCompliance` flag (`lib/compliance-evidence.ts`). Unchanged.

**Closed (2026-08-12):** the cross-document name gap. Per-field extraction still reports one winning value, but each document's own name is now stored separately on `NgoDocumentAnalysis.orgNameOnDocument`, and `findNameDisagreement` (`lib/verification-triage.ts`) compares the documents against *each other* — so an 80G naming a different entity than the registration certificate is a HIGH finding, not a SAFE verdict. `scripts/seed-verification-case.tsx` is the case it catches; `tests/verification-triage.test.ts` pins the false-positive boundaries (suffixes, casing, unnamed documents).

## Schema / migrations — read before changing `prisma/schema.prisma`
**This repo uses Prisma Migrate. Do not run `prisma db push`.**
- Add a field/model with `npm run db:migrate` (`prisma migrate dev`) so a migration lands in `prisma/migrations/` and gets committed. A new model needs **both** the schema edit and the migration, or its table will never exist anywhere else.
- `predev` runs `prisma migrate deploy`. **`build` does NOT.** It runs `prisma db push --accept-data-loss` (commit `4a942fc`) until production is baselined, so every Vercel deploy pushes the schema with data loss approved against whatever `DATABASE_URL` it is given. Treat that as an open P0 before the pilot. Baseline production, then move `build` back to `migrate deploy`.
- `npm run db:status` shows drift. `db:sync` is an alias for `migrate deploy` (several admin pages print it in their empty states).
- History: the dev database was originally built entirely with `db push` and had no `_prisma_migrations` table, so `migrate deploy` would have failed against it. It was brought in sync and baselined on 2026-07-25 (all three migrations marked applied). Reintroducing `db push` would recreate that drift — don't.
- **The Neon dev DB is shared with other branches** and contains tables this schema doesn't know (e.g. crisis/relief). `prisma migrate diff` against it proposes *dropping* them, and `prisma migrate dev` currently fails at the shadow database on `20260905120000_reconcile_sponsor_requirement_drift`. Write additive migrations by hand (see `20260915100000_csr_governance_workflow`) and apply with `npx prisma migrate deploy`.

## Tenancy and RBAC
The tenant is `NGOProfile`. `NGOTeamMember` + `TeamRole` (OWNER / ADMIN / FINANCE / FIELD_STAFF) give an org sub-users; `Role` (DONOR / NGO / ADMIN) is the platform-level role.

**Role is not ownership.** `verifySessionRole("NGO")` in `lib/auth-guards.ts` proves the caller is *an* NGO, never that they own the row being touched. Every route reaching an org-owned record must also check ownership explicitly — the reference shape is `app/api/ngo/projects/[id]/route.ts`:

```ts
if (project.ngoId !== profile.id) return 403;
```

Isolation is currently enforced per route by hand, so a route that forgets the check has no safety net. Adding one without it is a security bug, not a style issue.

Admin pages are gated in `app/admin/layout.tsx` (session → `/login`, non-ADMIN → `/unauthorized`), but the API is directly reachable — admin routes must call `verifySessionRole("ADMIN")` themselves.

## Finance
Amounts are Prisma `Decimal` — never round-trip them through `float`. Shared helpers live in `lib/finance-utils.ts` and `lib/format-currency.ts`.

Payment truth comes from the Razorpay webhook (`app/api/donations/webhook/route.ts` → `lib/razorpay-webhook.ts`), not from the client. Webhook and cron handlers must be **idempotent**: replaying a delivery must not double-apply. Existing idempotent paths to copy: the donations webhook, `app/api/donor/receipts/claim`, and the risk crons.

Built in Week 6: the append-only ledger (`lib/ledger.ts`), reconciliation (`lib/reconciliation.ts`), finance exceptions, allocation approval (`lib/allocation.ts`) and contract payments (`lib/contract-payments.ts`). Fund disbursement/payout is deliberately the last module — don't build it until asked.

## Privacy
- Audit and error context carry **ids only** — never names, emails, or donation amounts. `logAdminAction()` takes snapshots of only the fields an action touched, because the log outlives PII retention on the main tables. `captureError()` context (`lib/observability.ts`) follows the same rule.
- Never put personal data in URL query strings.
- Consent is recorded in `ConsentLog` / `ConsentAudit` against a `ConsentPurpose` and a policy version (donor-side). Beneficiary consent lives on `BeneficiaryFeedback` (per purpose, Week 7). `isShareableWithDonor` / `DONOR_VISIBLE_EVIDENCE_WHERE` in `lib/field-evidence.ts` are the only gate for donor visibility. Withdrawal goes through `POST /api/field/feedback/[id]/withdraw`.
- Documents are private by default; serve them through the app, not a public URL.

## Tests and PR rules
`npm test` runs Vitest over `tests/*.test.ts` (Prisma mocked per test, `@` alias resolved, no database needed). Add tests there — not new `scripts/test-*.ts` harnesses. Never make a live model or network call in a test; pin AI behaviour with fixtures.

These kinds of test are treated as mandatory, not optional:
1. **Tenant isolation** — org A gets 403 on org B's row.
2. **Approval state machines** — no sensitive transition without its required human gate.
3. **Idempotency/retry** — replaying a webhook or job does not double-apply.
4. **AI output** — schema conformance, missing fields, hard rules, hallucination, on fixed fixtures.
5. **Admin audit coverage** — every route under `app/api/admin` must call `logAdminAction` or be named in the `EXEMPT` list in `tests/admin-audit-coverage.test.ts` with a reason. The test fails the build either way, so adding a route means making that call deliberately. Audit payloads carry ids only; `tests/admin-audit-gaps.test.ts` asserts no `@` and no fixture names reach the log.
6. **Weekly acceptance** — `tests/weekly-acceptance.test.ts` pins every past week's Friday demo (routes + handlers, pages, behavioural tests not skipped). Moving a pinned feature means editing that manifest in the same PR. See `docs/ACCEPTANCE-MATRIX.md`.

Before opening a PR:

```bash
npx tsc --noEmit && npm test
```

CI (`.github/workflows/ci.yml`) runs both as blocking gates plus a non-blocking lint (~40-error backlog; clear it, then make lint blocking too). Rules: work on a branch, PR into `main`, green checks required, no force-push to `main`. Review with the `review-pr` skill.
