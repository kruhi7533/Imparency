---
phase: 2
plan: 2
wave: 2
gap_closure: false
---

# Plan 2.2: Project Builder & Milestone sequence UI

## Objective
Build the project creation form with strict image validations, design the sequential milestone builder UI with live progress indicators and hard allocation constraints, and save project/milestone structures in a Prisma database transaction.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/phases/2/RESEARCH.md
- .gsd/DECISIONS.md
- prisma/schema.prisma
- lib/auth-guards.ts
- lib/storage.ts

## Tasks

<task type="auto">
  <name>Create Project Form and Endpoint</name>
  <files>
    app/ngo/projects/new/page.tsx
    app/api/ngo/projects/route.ts
  </files>
  <action>
    Steps:
    1. Create `app/ngo/projects/new/page.tsx` collecting base project details: title, description, causeCategory, targetAmount (₹ prefix), location, and cover image file upload.
    2. Create `app/api/ngo/projects/route.ts`:
       - API guard checks if user is authenticated as `role === 'NGO'` AND their associated `NGOProfile` has `verificationStatus === 'VERIFIED'`. If not verified, reject with 403.
       - Parse multipart form data: validate cover image is <= 2MB and matches JPEG/PNG/WebP MIME type. Reject with 400 if invalid.
       - Upload cover image using `uploadFile` (folder: "covers").
       - Create the `Project` record in the database using a transaction that also handles its child milestones.
  </action>
  <verify>
    npm run build --no-emit
  </verify>
  <done>
    Project creation UI and endpoint are implemented, enforcing cover image sizes and checking verification status.
  </done>
</task>

<task type="auto">
  <name>Implement Sequential Milestone Builder UI and Save Logic</name>
  <files>
    app/ngo/projects/new/page.tsx
    app/api/ngo/projects/route.ts
  </files>
  <action>
    Steps:
    1. Update project creation page to add a sequential milestone builder form section:
       - Displays cards for each milestone containing: Title, Description, Target Amount, Deadline, and Proof Type Required (dropdown: Photo Evidence / Receipt + Photo / Document Upload / Any).
       - Expose "Add Milestone" and "Remove Milestone" buttons.
       - Calculate running sum: display a progress bar that shows allocated vs target total. Highlight in green when it equals 100% exactly, and highlight in red when exceeding.
       - Block the form submission (disable "Publish" button) with an alert message unless the total sums up exactly to the Project target amount.
    2. Update `app/api/ngo/projects/route.ts` to expect a JSON structure/form-data for milestones:
       - Process milestone objects in order.
       - Run a database transaction (`prisma.$transaction`) that creates the `Project` and then creates all `Milestone` records with `sequenceOrder` matching their index (1, 2, 3...) and `status = PENDING`.
  </action>
  <verify>
    Confirm build compile is successful.
  </verify>
  <done>
    Milestone builder validates target totals on the client, and project saving inserts milestones sequentially inside a database transaction.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] Cover image size <= 2MB is enforced at API route.
- [ ] UI prevents form submission unless milestone amounts sum to project target exactly.
- [ ] Milestones are written in sequence with correct foreign keys in a single transaction.

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in tests
