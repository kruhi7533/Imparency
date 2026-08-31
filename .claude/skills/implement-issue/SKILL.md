---
name: implement-issue
description: Implement a tracked issue in this repo end to end - read the issue, inspect the real code, plan, make the smallest correct change, add tests, run checks, and summarise. Use whenever work starts from a GitHub issue or a scoped feature request, instead of editing straight from the prompt.
---

# Implement an issue

Prompt-and-pray coding is the failure mode this exists to prevent. Do not skip
a step because the change "looks small". Steps 2 and 4 are the ones that
actually save time.

## 1. Read the issue

Restate in one or two sentences: what changes, for whom, and what "done" means.
If the issue has no acceptance criteria, write them and say so in the summary.

Check scope before writing code:
- Is this P0/P1 for the pilot? See the build/defer priority table. If it lands
  in P2/P3 (advanced ML fraud, FCRA money movement, ERP, multilingual,
  blockchain, autonomous outreach), stop and flag it rather than building it.

## 2. Inspect before planning

Read [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) plus a targeted
re-read of the files it cites. Do not rediscover the codebase from scratch, and
do not trust the doc over the code - if they disagree, the code wins and the
doc gets fixed in this same change.

Find the existing pattern before inventing one. Nearly every P0 on the roadmap
has a proven template already in the repo:
- Structured AI extraction with human review -> `lib/gemini/extract-ngo-fields.ts`
  + `lib/extraction-runner.ts` (one model call, per-field confidence,
  `resolveField()` ratchet that can only push a field DOWN to NEEDS_REVIEW).
- Deterministic rules with no model call -> `lib/verification-triage.ts`.
- Tenant-scoped mutation -> ownership check as in
  `app/api/ngo/projects/[id]/route.ts` (`project.ngoId !== profile.id` -> 403).
- Sensitive admin mutation -> `logAdminAction()` from `lib/admin-log.ts`.

## 3. Plan

Write the plan as a short list of file-level changes before editing. Name every
file you will touch and what happens in it. If the plan has more than ~6 files,
the issue is too big - split it and say so.

## 4. Smallest correct change

Change only what the acceptance criteria require. Resist drive-by refactors,
renames, and reformatting - they hide the real diff from review. If you spot
unrelated problems, note them for the summary instead of fixing them here.

Match the surrounding code: this repo uses route-colocated fat handlers, no
service layer beyond `lib/*.ts`, local `useState` + `router.refresh()`, and no
client state library.

Schema changes: `npm run db:migrate` so a migration lands in
`prisma/migrations/` and gets committed. **Never `prisma db push`** - it
recreates drift the repo was baselined to remove. A new model needs both the
schema edit and the migration.

Use the `lib/prisma.ts` singleton. Instantiating `new PrismaClient()` loses the
Neon retry wrapper.

## 5. Tests

Add tests to `tests/*.test.ts` (Vitest, `npm test`, Prisma mocked per test, `@`
alias resolved). Do not create new `scripts/test-*.ts` harnesses.

Cover the behaviour the issue describes and at least one failure path. For the
areas this project treats as safety-critical, the test is not optional:
- Tenant isolation: org A must get 403 on org B's row.
- Approval gates: no sensitive transition without its required human gate.
- Idempotency: replaying a webhook or job must not double-apply.
- AI output: schema conformance, missing fields, hard rules, and hallucination
  on a fixed fixture - never a live model call in a test.

## 6. Checks

Run both, and paste real output in the summary:

```bash
npx tsc --noEmit && npm test
```

CI runs the same two as blocking gates plus a non-blocking lint. If either
fails, fix it here - do not hand a red branch to review.

## 7. Summary

Report: what changed and why, files touched, tests added, check output, what
you deliberately did NOT do, and anything a reviewer should look at hardest.
State failures plainly. If part of the issue is unfinished, say which part and
why - scaling scope down is the issue owner's call, not yours.
