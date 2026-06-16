---
phase: 5
plan: 1
wave: 1
gap_closure: false
---

# Plan 5.1: Database Schema & Health Score Engine

## Objective
Update the Prisma database schema with corporate donor fields, JSON health score breakdown configurations, and the fraud alert tracking tables. Develop the event-driven NGO Health Score recalculation engine with weight-redistribution and hook it into standard code paths.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/DECISIONS.md
- prisma/schema.prisma
- app/api/ngo/submit-proof/route.ts
- app/api/admin/review-proof/route.ts
- app/api/donations/webhook/route.ts

## Tasks

<task type="auto">
  <name>Update Prisma Database Schema for Phase 5</name>
  <files>
    prisma/schema.prisma
  </files>
  <action>
    Steps:
    1. Modify `User` model in `prisma/schema.prisma`:
       - Add `companyName String?`
       - Add `isCorporate Boolean @default(false)`
       - Add `gstNumber String?`
    2. Modify `NGOProfile` model:
       - Add `healthScoreBreakdown Json?`
       - Add `isSuspended Boolean @default(false)`
    3. Create `FraudAlert` model:
       - `id String @id @default(uuid())`
       - `type String` (e.g. duplicate PAN, low score)
       - `entityId String`
       - `entityType String` (NGO / DONOR / DONATION)
       - `description String`
       - `severity String` (LOW / MEDIUM / HIGH)
       - `resolved Boolean @default(false)`
       - `resolutionNote String?`
       - `createdAt DateTime @default(now())`
    4. Run `npx prisma db push` to push the changes and regenerate the Prisma client.
  </action>
  <verify>
    Verify compilation with `npx tsc --noEmit`.
  </verify>
  <done>
    Database schema compiles, is pushed, and User, NGOProfile, and FraudAlert tables reflect the updates.
  </done>
</task>

<task type="auto">
  <name>Implement NGO Health Score Engine</name>
  <files>
    lib/ngo-health.ts
  </files>
  <action>
    Steps:
    1. Create `lib/ngo-health.ts`:
       - Write `recalculateNGOHealthScore(ngoId: string): Promise<void>`.
       - Fetch the NGO profile, its projects, milestones, proofs, and donations.
       - Use a single transaction `prisma.$transaction` for speed, targeting <500ms execution. Add `console.time("healthScore")` / `console.timeEnd("healthScore")` logs.
       - Implement formulas for the four metrics:
         * Fund Utilization (30%): `(total raised - pending milestone funds) / total raised * 100`.
         * Milestone Completion (30%): `(completed milestones / total milestones) * 100`.
         * Proof Speed (20%): `100 - (average_delay_days * 5)` minimum 0. Delay is 0 if proof is submitted before deadline.
         * Donor Return (20%): `(unique donors with 2+ donations / total unique donors) * 100`.
       - Apply weight redistribution when metrics are skipped (e.g. `total_raised = 0`, `total_milestones = 0`, `total_unique_donors < 5`, or no proofs).
       - Default score to `null` if milestones < 1 or unique donors < 3.
       - Save the calculated score to `healthScore` and the metric breakdown as JSON to `healthScoreBreakdown` on the `NGOProfile`.
  </action>
  <verify>
    Verify compile check.
  </verify>
  <done>
    Health score engine performs all calculations with weight redistribution and saves data in under 500ms.
  </done>
</task>

<task type="auto">
  <name>Hook up Health Score Recalculation Triggers</name>
  <files>
    app/api/donations/webhook/route.ts
    app/api/ngo/submit-proof/route.ts
    app/api/admin/review-proof/route.ts
  </files>
  <action>
    Steps:
    1. Hook `recalculateNGOHealthScore` inside:
       - Razorpay webhook resolution on success.
       - NGO submit-proof route on final status resolving.
       - Admin review API on manual Approve/Reject action.
    2. Add checks in NGO submit-proof endpoint: reject submission if `ngoProfile.isSuspended === true`.
  </action>
  <verify>
    Run `npx tsc --noEmit` to verify code references.
  </verify>
  <done>
    Recalculation engine triggers successfully when donations complete or milestones update status.
  </done>
</task>

## Success Criteria
- [ ] Database updates pushed successfully.
- [ ] Recalculation transaction runs in under 500ms.
- [ ] Suspended NGOs are blocked from submitting proof.
