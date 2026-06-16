---
phase: 4
plan: 2
wave: 1
gap_closure: false
---

# Plan 4.2: Milestone Proof Submission & Validation API

## Objective
Implement the server-side API endpoint for NGOs to submit milestone proofs, enforce a combined file size validation limit of 20MB, invoke Gemini AI validation inline, update milestone statuses, and build the proof submission dashboard form.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/phases/4/RESEARCH.md
- .gsd/DECISIONS.md
- prisma/schema.prisma
- lib/storage.ts
- lib/gemini/validate-proof.ts

## Tasks

<task type="auto">
  <name>Create Proof Submission API with Inline Validation</name>
  <files>
    app/api/ngo/submit-proof/route.ts
  </files>
  <action>
    Steps:
    1. Create `app/api/ngo/submit-proof/route.ts` running under the Node.js runtime:
       - Restrict route calls to users with role `NGO` who are verified.
       - Read multipart form data (`await request.formData()`).
       - Extract: `milestoneId`, `description`, and files (array of up to 5 files).
       - Validate: combined file size of all attachments must be <= 20MB. Reject with 400 if invalid.
       - Upload all files using the storage adapter `uploadFile` (folder: `proofs/${milestoneId}`).
       - Fetch the milestone to verify it is associated with the NGO's project.
       - Convert uploaded file buffers into base64 structures.
       - Call `validateMilestoneProof` inline.
       - Save a new `MilestoneProof` database record containing: `description`, `mediaUrls`, `documentUrls` (categorizing images vs PDFs), `aiValidationResult` string, and `aiValidationScore` integer.
       - Determine milestone resolution:
         * If `score >= 70`: set `Milestone.status = COMPLETED` (this will trigger reports/alerts in Plan 4.4).
         * If `score < 70`: set `Milestone.status = PROOF_SUBMITTED` (routing it for manual review).
       - Return result JSON containing score and reasoning.
  </action>
  <verify>
    Ensure endpoint compiles cleanly with `npx tsc --noEmit`.
  </verify>
  <done>
    Proof submission endpoint correctly enforces size constraints, saves proof metadata, triggers AI audit, and resolves status.
  </done>
</task>

<task type="auto">
  <name>Build Milestone Proof Submission Form UI</name>
  <files>
    app/ngo/dashboard/SubmitProofModal.tsx
    app/ngo/dashboard/page.tsx
  </files>
  <action>
    Steps:
    1. Create `app/ngo/dashboard/SubmitProofModal.tsx` (client component):
       - Collect details: written description of work done, and up to 5 attachments (images/PDFs).
       - Enforce client-side file validations (rejecting files exceeding 5MB, and combined payload exceeding 20MB).
       - Render a loading overlay during submission explaining that the Gemini agent is evaluating their evidence.
       - Display AI validation feedback and score in a post-submission modal card.
    2. Update `app/ngo/dashboard/page.tsx` or project detail view:
       - For projects that are active, show the milestones sequence list.
       - Render a "Submit Completion Proof" button next to active milestones, opening the `SubmitProofModal`.
  </action>
  <verify>
    Confirm dashboard pages compile cleanly without TypeScript errors.
  </verify>
  <done>
    NGOs can successfully upload files, view submission status, and see immediate AI scoring feedback on the UI.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] Uploaded payloads are strictly validated against the 20MB combined size cap.
- [ ] Submission UI is locked/disabled during Gemini processing and shows validation overlays.

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in tests
