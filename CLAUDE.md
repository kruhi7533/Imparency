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
- `app/api/ngo/whatsapp-drafts/convert/route.ts` is dead code referencing a schema that no longer exists.
- There **is** now a Vitest suite: `npm test` runs `tests/*.test.ts` (25 files / 264 tests as of 2026-08-31, config in `vitest.config.ts`, `@` alias resolved). Prisma is mocked per-test, so no database is needed. Add tests there rather than writing new `scripts/test-*.ts` harnesses.

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
- `predev` and `build` both run `prisma migrate deploy`, so schema ships with the deploy instead of depending on someone running a command.
- `npm run db:status` shows drift. `db:sync` is an alias for `migrate deploy` (several admin pages print it in their empty states).
- History: the dev database was originally built entirely with `db push` and had no `_prisma_migrations` table, so `migrate deploy` would have failed against it. It was brought in sync and baselined on 2026-07-25 (all three migrations marked applied). Reintroducing `db push` would recreate that drift — don't.


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

Not built yet, and P0 for the pilot: a finance ledger, reconciliation, unmatched-payment exceptions, and allocation approval. Admin currently sees only four aggregate sums on the dashboard. Fund disbursement/payout is deliberately the last module — don't build it until asked.

## Privacy
- Audit and error context carry **ids only** — never names, emails, or donation amounts. `logAdminAction()` takes snapshots of only the fields an action touched, because the log outlives PII retention on the main tables. `captureError()` context (`lib/observability.ts`) follows the same rule.
- Never put personal data in URL query strings.
- Consent is recorded in `ConsentLog` / `ConsentAudit` against a `ConsentPurpose` and a policy version. Beneficiary-scoped consent is a P0 that does **not** exist yet — today's purposes are donor-side only.
- Documents are private by default; serve them through the app, not a public URL.

## Tests and PR rules
`npm test` runs Vitest over `tests/*.test.ts` (Prisma mocked per test, `@` alias resolved, no database needed). Add tests there — not new `scripts/test-*.ts` harnesses. Never make a live model or network call in a test; pin AI behaviour with fixtures.

Four kinds of test are treated as mandatory, not optional:
1. **Tenant isolation** — org A gets 403 on org B's row.
2. **Approval state machines** — no sensitive transition without its required human gate.
3. **Idempotency/retry** — replaying a webhook or job does not double-apply.
4. **AI output** — schema conformance, missing fields, hard rules, hallucination, on fixed fixtures.

Before opening a PR:

```bash
npx tsc --noEmit && npm test
```

CI (`.github/workflows/ci.yml`) runs both as blocking gates plus a non-blocking lint (~40-error backlog; clear it, then make lint blocking too). Rules: work on a branch, PR into `main`, green checks required, no force-push to `main`. Review with the `review-pr` skill.
