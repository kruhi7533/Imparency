# ImpactBridge — Working Notes for Claude

**Before implementing anything in this repo, read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).** It is a maintained, code-grounded developer knowledge base covering the feature map, dependency/caller graph, execution-path traces (login, NGO registration, donation, payment webhook, milestone submission, admin verification, WhatsApp proof, notifications, etc.), the full Prisma model cheat sheet, the AI/payments/compliance subsystems in depth, a modification guide (where to touch for common changes), hidden conventions, common mistakes, and a deep dive on the most recently active modules (team invites, WhatsApp/field-worker, NGO settings/CRM, pitch deck, donor domain).

Answer architecture questions from that document plus a targeted re-read of the cited files — don't rediscover the codebase from scratch. If something cited there no longer matches the code, treat the doc as stale for that point, re-derive the answer, and update the doc.

## Quick orientation
- Next.js 14 App Router + TypeScript, Tailwind, Prisma 5 (Neon Postgres via driver adapter), NextAuth (Credentials + Google, JWT sessions), Razorpay, Google Gemini, Twilio WhatsApp.
- Pattern: route-colocated "fat handlers" (no repository/service layer beyond `lib/*.ts`), hybrid Server/Client Components, no client-side state library (no Redux/Zustand/React Query — local `useState` + `router.refresh()`).
- Primary author across almost the entire git history: `kruhi7533@gmail.com`.
- This repo also runs its own AI-agent process methodology — see `PROJECT_RULES.md` / `GSD-STYLE.md` / `.gsd/` (SPEC → PLAN → EXECUTE → VERIFY → COMMIT). That governs *process*; `docs/ARCHITECTURE.md` governs *what the code does*.

## Known sharp edges (see `docs/ARCHITECTURE.md` §12 for the full list)
- `DonateModal.tsx` and `create-order/route.ts` have mismatched request/response shapes.
- `lib/rate-limiter.ts` is now wired into ~12 routes (auth signup/forgot-password/reset-password, the admin AI routes, `assistant`, `donor/receipts/claim`) — but **donation/payment routes are still unprotected**, which is the gap that matters most.
- Several files bypass the shared `lib/prisma.ts` singleton with their own `new PrismaClient()` (loses the Neon retry wrapper): WhatsApp worker, drafts routes, pitch/lead route.
- `Notification` rows are written and pushed via FCM but never surfaced in any UI (no notifications route/bell/list).
- ~~`app/donor/dashboard/page.tsx` is a hardcoded stub~~ — fixed; it is now wired to real Prisma data.
- `app/api/ngo/whatsapp-drafts/convert/route.ts` is dead code referencing a schema that no longer exists.
- There **is** now a Vitest suite: `npm test` runs `tests/*.test.ts` (10 files / 89 tests, config in `vitest.config.ts`, `@` alias resolved). Prisma is mocked per-test, so no database is needed. Add tests there rather than writing new `scripts/test-*.ts` harnesses.

## Schema / migrations — read before changing `prisma/schema.prisma`
**This repo uses Prisma Migrate. Do not run `prisma db push`.**
- Add a field/model with `npm run db:migrate` (`prisma migrate dev`) so a migration lands in `prisma/migrations/` and gets committed. A new model needs **both** the schema edit and the migration, or its table will never exist anywhere else.
- `predev` and `build` both run `prisma migrate deploy`, so schema ships with the deploy instead of depending on someone running a command.
- `npm run db:status` shows drift. `db:sync` is an alias for `migrate deploy` (several admin pages print it in their empty states).
- History: the dev database was originally built entirely with `db push` and had no `_prisma_migrations` table, so `migrate deploy` would have failed against it. It was brought in sync and baselined on 2026-07-25 (all three migrations marked applied). Reintroducing `db push` would recreate that drift — don't.
