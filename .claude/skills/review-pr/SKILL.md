---
name: review-pr
description: Structured peer review of a pull request or working diff in this repo - correctness, security, architecture, and tests, with the project's known failure modes checked explicitly. Use when reviewing a PR, a branch diff, or changes before merge.
---

# Review a pull request

Review the diff against what the issue asked for, not against what you would
have built. Rank findings by severity and be specific: file, line, and the
concrete input or state that breaks. A review with no findings is a valid
result - say so rather than inventing nits.

## Scope the review first

```bash
git diff main...HEAD --stat
```

Read the issue or PR description for acceptance criteria. If there are none,
that is the first finding.

Note ownership: admin/platform is Intern 1's domain. Flag problems in NGO or
donor code, but do not rewrite another owner's area inside this PR.

## 1. Correctness

- Does it actually satisfy every acceptance criterion, or only the easy ones?
- Trace the unhappy paths: null/absent rows, empty result sets, duplicate
  submissions, concurrent writes, and partial failures.
- Money and dates: `Decimal` fields must not round-trip through float. Financial
  year and expiry boundaries are off-by-one magnets.
- Any `catch` that swallows an error must call `captureError()`
  (`lib/observability.ts`), not just `console.error`.

## 2. Security

Check these explicitly - they are this repo's recurring gaps:

- **Tenant isolation.** Every route touching an org-owned row must verify
  ownership, not just role. `verifySessionRole("NGO")` proves *a* role; it does
  not prove *this* org owns the record. The required shape is the explicit
  check in `app/api/ngo/projects/[id]/route.ts` (`project.ngoId !== profile.id`
  -> 403). A missing ownership check is a blocking finding.
- **Authorization on admin routes.** `verifySessionRole("ADMIN")` on the handler,
  not only the page layout - the API is reachable directly.
- **Audit trail.** Sensitive admin mutations call `logAdminAction()` with
  old/new snapshots of *only* the touched fields, never full entity dumps.
- **Rate limiting.** `lib/rate-limiter.ts` covers auth and the admin AI routes.
  Donation and payment routes are still unprotected - do not add new unprotected
  money-adjacent endpoints.
- **PII.** No names, emails, or amounts in logs, `captureError` context, or URL
  query strings.
- **Injection and upload safety** on any new file or free-text input path.

## 3. Architecture

- Does it follow the existing pattern, or invent a parallel one? Route-colocated
  fat handlers, `lib/*.ts` for shared logic, no service layer, no client state
  library.
- `lib/prisma.ts` singleton only. `new PrismaClient()` loses the Neon retry
  wrapper - flag it.
- Schema changes must ship with a committed migration in `prisma/migrations/`.
  A schema edit with no migration means the table will never exist anywhere
  else. `prisma db push` must not appear.
- AI changes: one model call per pass with structured output and a human review
  gate. Multiple overlapping passes over the same input were deliberately
  removed once; do not let them back in.
- N+1 queries, and `await` inside an array literal passed to `Promise.all`
  (it serialises what looks parallel - this has been a measured regression here
  twice).

## 4. Tests

- Is there a test for the behaviour, and for at least one failure path?
- Tests belong in `tests/*.test.ts`, not new `scripts/test-*.ts` harnesses.
- No live model or network calls - AI behaviour is pinned with fixtures.
- Safety-critical areas need their specific test: tenant isolation (cross-org
  403), approval state machines (no transition skips its human gate),
  idempotency (replay does not double-apply).
- Did the author run `npx tsc --noEmit && npm test`? Green CI is required to
  merge; do not approve a red branch.

## Output

Group findings as **Blocking**, **Should fix**, and **Optional**. For each:
file:line, the defect in one sentence, and a concrete failure scenario. End with
an explicit verdict - approve, approve with comments, or request changes.
