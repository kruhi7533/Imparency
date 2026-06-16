---
phase: 2
plan: 1
wave: 1
gap_closure: false
---

# Plan 2.1: NGO Onboarding & Admin Verification Dashboard

## Objective
Implement the NGO registration workflow with strict file validation limits, create the Admin verification dashboard supporting approval/rejection notes, and integrate Resend email notifications.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/phases/2/RESEARCH.md
- .gsd/DECISIONS.md
- prisma/schema.prisma
- lib/storage.ts

## Tasks

<task type="auto">
  <name>Implement NGO Registration page and Registration API</name>
  <files>
    app/ngo/register/page.tsx
    app/api/ngo/register/route.ts
    app/ngo/dashboard/page.tsx
  </files>
  <action>
    Steps:
    1. Create `app/ngo/register/page.tsx` collecting org details: orgName, registrationNumber, panNumber, address, website, foundedYear, description, causeCategories, and up to 3 PDF file uploads.
    2. Create `app/api/ngo/register/route.ts`:
       - Restrict to users authenticated with `role === 'NGO'`.
       - Read multipart form data (`await request.formData()`).
       - Validate inputs and file sizes/types: documents must be PDF and <= 10MB each. Max 3 files. Return 400 with details if invalid.
       - Upload files via `uploadFile` (folder: "documents") and store URLs in database `NGOProfile`.
       - Create or update the `NGOProfile` associated with the current `User` with `verificationStatus = PENDING`.
    3. Create `app/ngo/dashboard/page.tsx`:
       - If user's `NGOProfile` is `PENDING`, render an onboarding stepper showing: Submitted (done) → Under Review (active) → Verified (pending).
       - If `NGOProfile` is `REJECTED`, render a warning card with the `adminNote` and a "Resubmit" button directing back to `/ngo/register`.
       - If `NGOProfile` is `VERIFIED`, render the full dashboard (or placeholder links for creating projects).
    
    AVOID: Let files upload before validating sizes/MIMEs. Run validations on file buffers first.
  </action>
  <verify>
    npm run build --no-emit
  </verify>
  <done>
    Onboarding page handles registration uploads securely, and the dashboard correctly reflects PENDING/REJECTED/VERIFIED states.
  </done>
</task>

<task type="auto">
  <name>Build Admin dashboard and Resend Notification System</name>
  <files>
    app/admin/dashboard/page.tsx
    app/api/admin/verify-ngo/route.ts
    lib/email.ts
  </files>
  <action>
    Steps:
    1. Create `app/admin/dashboard/page.tsx`:
       - Restrict path via `middleware.ts` to `ADMIN` role.
       - Fetch all `NGOProfile` records where `verificationStatus === 'PENDING'`.
       - Display list of NGOs, org details, link to uploaded PDF documents, and Approve / Reject buttons opening input modals.
    2. Create `app/api/admin/verify-ngo/route.ts`:
       - Route guard restricts calls to `ADMIN` role.
       - Expect JSON payload: `{ ngoId, action: 'APPROVE' | 'REJECT', adminNote }`.
       - Require custom reason if rejecting. Approve actions use default note "All documents verified successfully" unless edited.
       - Update `NGOProfile` verificationStatus and store `adminNote` in the database.
       - Trigger appropriate notification email to the NGO using `lib/email.ts`.
    3. Create `lib/email.ts`:
       - Setup Resend client using `process.env.RESEND_API_KEY`.
       - Write helper functions to send NGO Approval, NGO Rejection, Project Published Confirmation, and New Project Alert emails.
       - Fallback: if `RESEND_API_KEY` is not present, log email details (To, Subject, Body) to the console.
  </action>
  <verify>
    Ensure admin dashboard and endpoints compile cleanly.
  </verify>
  <done>
    Admin panel list works, approval/rejection updates status and admin notes in database, and emails dispatch or log to console.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] Uploaded documents are strictly checked for PDF type and <= 10MB limits.
- [ ] Admin dashboard can trigger status updates to VERIFIED or REJECTED with notes.
- [ ] Emails dispatch or mock-log to terminal correctly.

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in tests
