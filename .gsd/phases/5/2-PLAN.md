---
phase: 5
plan: 2
wave: 1
gap_closure: false
---

# Plan 5.2: Fraud Alerts Engine & Admin Fraud Panel

## Objective
Implement helper utilities to evaluate platform activity for potential fraud, trigger LOW/MEDIUM/HIGH severity alerts, implement automatic proof submission suspension for suspicious NGOs, and build the Admin Fraud Alerts review interface.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/DECISIONS.md
- prisma/schema.prisma
- app/api/ngo/register/route.ts
- app/api/ngo/submit-proof/route.ts
- app/api/donations/webhook/route.ts

## Tasks

<task type="auto">
  <name>Implement Fraud Alert Rules & NGO Auto-Suspension</name>
  <files>
    lib/fraud-alerts.ts
  </files>
  <action>
    Steps:
    1. Create `lib/fraud-alerts.ts`:
       - Write `createFraudAlert(type, entityId, entityType, description, severity): Promise<void>` saving records in the `FraudAlert` table.
       - Implement specific triggers:
         * HIGH: Duplicate PAN registration attempt, Gemini proof score < 40, or same NGO receives 2 consecutive Gemini scores < 40 (which updates `NGOProfile.isSuspended = true` and auto-suspends them).
         * MEDIUM: Exceeded deadline >30 days with no proof, NGO raised funds but zero milestone activity for 60+ days, and donor >5 donations in <10 minutes.
         * LOW: Average proof delay >14 days across 3+ milestones.
  </action>
  <verify>
    Ensure compilation passes.
  </verify>
  <done>
    Fraud alert utility correctly handles alerts and NGO auto-suspension logic.
  </done>
</task>

<task type="auto">
  <name>Hook up Fraud Alert Triggers</name>
  <files>
    app/api/ngo/register/route.ts
    app/api/ngo/submit-proof/route.ts
    app/api/donations/webhook/route.ts
  </files>
  <action>
    Steps:
    1. Hook duplicate PAN check in NGO registration route, triggering a HIGH fraud alert if matched.
    2. Hook Gemini score check in submit-proof route. If score < 40, trigger HIGH alert. If it's the second consecutive score < 40, update `NGOProfile.isSuspended = true`.
    3. Hook payment rate limit check in webhook route: if a single user completes >5 donations in <10 minutes, trigger MEDIUM alert.
  </action>
  <verify>
    Verify compilation with `npx tsc --noEmit`.
  </verify>
  <done>
    All inline triggers are hooked into registration, proof submission, and donation webhooks.
  </done>
</task>

<task type="auto">
  <name>Build Admin Fraud Dashboard & Resolve API</name>
  <files>
    app/admin/fraud-alerts/page.tsx
    app/api/admin/resolve-alert/route.ts
  </files>
  <action>
    Steps:
    1. Create `app/api/admin/resolve-alert/route.ts` (ADMIN restricted):
       - Receives `{ alertId, resolutionNote }`.
       - Returns 400 if `resolutionNote` is empty.
       - Marks `resolved = true` and saves `resolutionNote`.
    2. Create `app/admin/fraud-alerts/page.tsx` (ADMIN restricted):
       - Fetch all unresolved `FraudAlert` records sorted by severity (HIGH -> MEDIUM -> LOW).
       - Render a clean table showing details: Severity (with colored badges), Type, Description, Date, and Entity.
       - Add a "Resolve Alert" action button opening a modal that collects the mandatory written resolution note and calls the resolve API.
  </action>
  <verify>
    Confirm page compiles cleanly.
  </verify>
  <done>
    Admin Fraud Panel lists all unresolved alerts and supports resolving them with audit notes.
  </done>
</task>

## Success Criteria
- [ ] High-severity alerts trigger auto-suspension.
- [ ] Rejections/resolutions require administrator notes.
- [ ] Unresolved alerts are sorted correctly.
