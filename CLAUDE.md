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
- `lib/rate-limiter.ts` exists but is only wired into `verify-phase1` — donation/auth/AI routes are unprotected.
- Several files bypass the shared `lib/prisma.ts` singleton with their own `new PrismaClient()` (loses the Neon retry wrapper): WhatsApp worker, drafts routes, pitch/lead route.
- `Notification` rows are written and pushed via FCM but never surfaced in any UI (no notifications route/bell/list).
- `app/donor/dashboard/page.tsx` is currently a hardcoded stub, not wired to real data.
- `app/api/ngo/whatsapp-drafts/convert/route.ts` is dead code referencing a schema that no longer exists.
- No automated test suite (Jest/Vitest/Playwright) — only manually-run `scripts/test-*.ts` harnesses.
