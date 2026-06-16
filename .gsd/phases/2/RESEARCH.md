# Research: Phase 2 — NGO Profiles, Onboarding & Projects

> **Phase**: 2
> **Status**: Completed

This document outlines the UI structure, API routes, and validation parameters for Phase 2 of ImpactBridge.

## 1. File Upload Handling (`request.formData()`)
- **API Handler**: We will parse file uploads directly in Next.js API Routes.
- **Validation Constraints**:
  - **NGO Registration PDF files**: Max 10MB per file, up to 3 files, `application/pdf` MIME type only.
  - **Project cover images**: Max 2MB, exactly 1 file, `image/jpeg`, `image/png`, or `image/webp` MIME type only.
  - **Milestone proof uploads**: Max 5MB per file, up to 5 files, PDF or JPEG/PNG/WebP only.
- **Implementation Pattern**:
  ```typescript
  const formData = await request.formData();
  const file = formData.get("file") as File;
  if (file.size > LIMIT) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
  }
  ```

## 2. Onboarding Stepper & Access Controls
- **Onboarding States**:
  - `PENDING`: Timeline showing Submitted (checked) -> Under Review (active) -> Verified (empty). Dashboard page presents this stepper and disables action buttons.
  - `REJECTED`: Dashboard displays a warning card with the admin rejection note, plus a "Resubmit Documents" button redirecting back to `/ngo/register`.
  - `VERIFIED`: Stepper hides, full dashboard features display.
- **Middleware & Guards**:
  - Matcher `/ngo/projects/*` checks `ngoProfile.verificationStatus`. If not `VERIFIED`, blocks navigation and redirects to onboarding status page.
  - The API guard helper double-checks profile verification status for project creation.

## 3. Admin Dashboard & Resend Notification Flows
- **UI page**: `/admin/dashboard`
  - Fetches `NGOProfile` records where `verificationStatus = PENDING`.
  - Renders document download buttons and Approve/Reject modal windows.
  - Mandatory text inputs for `adminNote`.
- **API endpoint**: `/api/admin/verify-ngo`
  - Body collects: `ngoId`, `action` ("APPROVE" | "REJECT"), `adminNote`.
  - Updates `NGOProfile` status and saves `adminNote` in the database.
  - Sends email via Resend client.
- **Resend Console Fallback**:
  ```typescript
  if (!process.env.RESEND_API_KEY) {
    console.log("--- RESEND MOCK EMAIL SENT ---");
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body:\n${body}`);
    console.log("------------------------------");
  } else {
    // Send email using new Resend(process.env.RESEND_API_KEY)
  }
  ```

## 4. Milestone Builder hard validations
- **UI Progress Engine**:
  - A client-side state variable tracks an array of milestones: `[{ title: "", description: "", targetAmount: 0, deadline: "", proofType: "" }]`.
  - Calculates running target sum: `milestones.reduce((sum, m) => sum + m.targetAmount, 0)`.
  - Shows progress indicator: `(sum / projectTarget) * 100`.
  - Turns green when sum equals project target exactly. Turns red and disables the "Publish Project" button if sum !== projectTarget.
- **Sequence Numbering**: Milestones are stored with `sequenceOrder` incrementing starting from 1.

## 5. UI Theme & Micro-animations (Inter Font)
- **Primary Font**: Inter (imported from `next/font/google`).
- **Discovery Card List**: Grid with 3 columns (desktop) / 2 columns (tablet) / 1 column (mobile). Uses `framer-motion` or standard CSS transition classes for:
  - Lift animation on card hover: `hover:-translate-y-0.5 hover:shadow-md transition-all duration-150 ease-in-out`.
  - Category filter pills horizontally scrollable on mobile.
- **Public Profile page**: Prominently shows followers and color-coded Health Score. Individual metric progress bars animate up on load.
