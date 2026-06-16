---
phase: 4
plan: 3
wave: 2
gap_closure: false
---

# Plan 4.3: Admin Proof Review Dashboard & Overrides

## Objective
Implement the server-side endpoint for Admins to override AI proof decisions, batch-process impact narrative generations for donors using Promise.allSettled, and build the Admin Proof Review dashboard UI.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/phases/4/RESEARCH.md
- .gsd/DECISIONS.md
- prisma/schema.prisma
- lib/gemini/generate-narrative.ts

## Tasks

<task type="auto">
  <name>Create Admin Review API & Narrative Generation Batch Handler</name>
  <files>
    app/api/admin/review-proof/route.ts
  </files>
  <action>
    Steps:
    1. Create `app/api/admin/review-proof/route.ts` running under the Node.js runtime:
       - Restrict route calls to `ADMIN` role.
       - Parse request payload: `{ milestoneId, action: 'APPROVE' | 'REJECT', rejectionReason }`.
       - If action is `REJECT`, require `rejectionReason` string. Return 400 if missing.
       - Fetch `Milestone` by `milestoneId`.
       - If action is `APPROVE`:
         * Update `Milestone.status = COMPLETED`.
         * Fetch all successful `Donation` records for the parent project.
         * For each donation, calculate the contribution percentage.
         * Parallel batch-generate impact narratives using `Promise.allSettled` to call `generateImpactNarrative` for each donor.
         * Save generated narratives to the `ImpactReport` table.
         * Trigger donor email notifications and FCM push notifications (alerts hooked in Plan 4.4).
       - If action is `REJECT`:
         * Update `Milestone.status = IN_PROGRESS` (allowing the NGO to resubmit).
         * Save rejection details and trigger notification to the NGO (alerts hooked in Plan 4.4).
       - Return success response.
  </action>
  <verify>
    Ensure route compiles cleanly.
  </verify>
  <done>
    Admin override endpoint resolves statuses correctly and safely batch-generates impact narratives.
  </done>
</task>

<task type="auto">
  <name>Build Admin Proof Review Dashboard Page</name>
  <files>
    app/admin/proof-review/page.tsx
  </files>
  <action>
    Steps:
    1. Create `app/admin/proof-review/page.tsx`:
       - Restrict path access to `ADMIN` users via global middleware/guards.
       - Fetch all `Milestone` records where `status === 'PROOF_SUBMITTED'` (including project details, NGO profiles, and proof attachments).
       - Fetch a historical audit list of previously validated milestones (`status === 'COMPLETED'` or previously reviewed) to render in an Audit History tab.
       - Render main layout with two tabs: **Pending Reviews** and **Audit History**.
       - For each pending review: Display NGO name, campaign title, milestone sequence order, written description, clickable links for uploaded proof files (photos/PDFs), the AI validation score, reasoning, flags, and suggestion.
       - Render "Approve Proof" and "Reject Proof" buttons opening confirmation modals. Rejections display textareas requiring the mandatory written reason.
  </action>
  <verify>
    Confirm page compiles cleanly.
  </verify>
  <done>
    Admin dashboard provides full audit details, click previews, and triggers Approve/Reject API actions successfully.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] Admin rejection enforces a non-empty written justification reason.
- [ ] Donor narratives are batch generated in parallel using `Promise.allSettled`.

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in tests
