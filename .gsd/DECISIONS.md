# DECISIONS.md — Architecture Decision Records

> **Purpose**: Log significant technical decisions and their rationale.

## Decisions

### [DECISION-001] AI Validation Workflow
**Date**: 2026-06-16
**Status**: Accepted

#### Context
NGOs submit proof of milestone completion. Gemini API evaluates these proofs. We need to decide how to handle low scores and what to show donors.

#### Decision
Milestones with Gemini validation scores < 70 will be flagged and routed to the Admin dashboard for manual review/override, blocking them from completion. NGOs and admins will see the AI validation scores and feedback. Donors will see a generic "Under Review" status without raw scores.

#### Rationale
Donors should not be exposed to raw, confusing AI scores to protect user experience and avoid unnecessary panic. NGOs need to know the feedback to improve proof quality. Admins must retain ultimate authority for exceptions.

#### Consequences
- Admin dashboard must include a "Flagged Milestone Reviews" component.
- The database schema for `Milestone` status must support a `PROOF_SUBMITTED`/`UNDER_REVIEW` state.

---

### [DECISION-002] Donor Wallet Implementation
**Date**: 2026-06-16
**Status**: Accepted

#### Context
How should donor funds be tracked and spent in the app?

#### Decision
Implement an "Impact Ledger" (donation history dashboard) rather than a prepaid virtual wallet balance. Every payment goes directly to the project via Razorpay in real time.

#### Rationale
Avoids complex virtual currency management, escrow legal liabilities, and unnecessary regulatory overhead. Simplifies transaction flows and aligns directly with tax 80G benefit claims.

#### Consequences
- No need to maintain a virtual currency table.
- Direct alignment of payments to specific projects.

---

### [DECISION-003] File Storage System
**Date**: 2026-06-16
**Status**: Accepted

#### Context
How should proof media/documents and registrations be stored?

#### Decision
Create a storage adapter interface that falls back to the local filesystem (`/public/uploads/`) during development and switches to Cloudflare R2 or AWS S3 in production based on environment variables (`STORAGE_PROVIDER`).

#### Rationale
Simplifies local development by avoiding the need for immediate cloud resource provisioning, while maintaining production readiness.

#### Consequences
- Needs clean abstraction inside a service class/utility.

---

### [DECISION-004] 80G PDF Generation
**Date**: 2026-06-16
**Status**: Accepted

#### Context
We need to generate tax receipts as downloadable PDFs.

#### Decision
Use `@react-pdf/renderer` within Next.js API Routes.

#### Rationale
Lightweight, serverless-friendly, and fits easily inside Vercel's 50MB function size limit (unlike Puppeteer/headless browsers).

#### Consequences
- High-quality layout code required using React PDF elements.

---

## Phase 1 Decisions

**Date:** 2026-06-16

### Scope & Database
- **Schema & Relations:** We will implement all 10 schema tables (`User`, `NGOProfile`, `Project`, `Milestone`, `MilestoneProof`, `Donation`, `ImpactReport`, `NGOFollower`, `Notification`, `TaxReceipt`) in this phase.
- **Donor Model:** Donors do not have a separate profile table; they are `User` records with `role: DONOR`. We will add `pan_number` (optional, String), `phone` (optional, String), `city` (optional, String), and `total_donated` (Decimal, default 0) to `User` to avoid queries.
- **Timestamps:** Every table uses `DateTime @default(now())` for creation and `updatedAt @updatedAt` for modifications.
- **Money representation:** All monetary fields use `Decimal` with precision 10 and scale 2 to avoid float errors.
- **Soft Deletes:** `Project` and `NGOProfile` support soft deletion via `isDeleted Boolean @default(false)`. Hard deletes are avoided.
- **Neon Pools:** Use the Neon pooled connection string for API route database calls (serverless environment friendly) and direct connection strings for migrations.

### Auth & Route Protection
- **JWT & Session Enrichment:** NextAuth.js JWT and Session objects are enriched with `id`, `role`, and `ngoProfileId` (which is null for donors and admins) to prevent redundant database fetches.
- **Hashing:** Password hashing uses `bcryptjs`.
- **Global & Route Protection:** Approach A: Global middleware in `middleware.ts` intercepts `/ngo/*`, `/admin/*`, `/donor/*` according to session roles. API routes utilize a reusable `withRole(role)` guard wrapper in `lib/auth-guards.ts` as a second defensive layer.

### File Storage Utility
- **Local/S3 Adapter:** Built in `lib/storage.ts`. Local storage (`/public/uploads/`) is utilized in development (`STORAGE_PROVIDER=local`) and S3/R2 client is initialized for production.
- **UUID Filenames:** Uploaded files are renamed using UUID v4 to avoid naming collisions (e.g. `{uuid}.{ext}`). A `deleteFile(url)` helper is exposed to clean up obsolete uploads.

### Rate Limiting
- **PostgreSQL Rate Limiter:** Custom database-backed rate-limiting using a `RateLimitLog` table (`id`, `identifier` (IP/email), `route`, `request_count`, `window_start`). Applied to `/api/auth/login`, `/api/auth/register`, and `/api/auth/forgot-password`. Logs are checked against a window limit (e.g. 5 hits / 15m for login) and old logs pruned automatically.

---

## Phase 2 Decisions

**Date:** 2026-06-16

### Onboarding & Verification Workflow
- **Onboarding States:** The NGO Profile dashboard will show a stepper matching three distinct states based on `verificationStatus`:
  1. `PENDING`: Timeline displays Submitted → Under Review → Verified. Full project options are disabled.
  2. `REJECTED`: Dashboard blocks actions, shows the `adminNote` reason for rejection, and provides a "Resubmit Documents" button which resets status back to `PENDING`.
  3. `VERIFIED`: Grants full dashboard capabilities.
- **Admin Note Requirement:** Admins must supply a written `adminNote` when performing approvals/rejections. For approval, a default "All documents verified successfully" note is provided and remains editable. Rejections require a custom explanation. This note is saved to the `NGOProfile` database record.
- **Access Control:** Middleware and API guards block project publishing/creation for pending/rejected NGOs.

### File Uploads & Validation
- **MIME & Size Limits:** Checked directly in API Route Handlers using `request.formData()` before uploading:
  - NGO docs: Max 10MB per file, max 3 files (PDF only).
  - Project cover image: Max 2MB, exactly 1 file (JPEG/PNG/WebP).
  - Milestone proof: Max 5MB per file, max 5 files (JPEG/PNG/WebP/PDF).
- Invalid uploads are rejected with 400 Bad Request.

### Resend Email Integration
- **Fallback Log:** If `RESEND_API_KEY` is missing in development, log the email's to/subject/body elements directly to the console instead of throwing errors.
- **Email Types:**
  - NGO Onboarding Approval (dashboard redirect link)
  - NGO Onboarding Rejection (admin notes, resubmission instructions)
  - Project Published Confirmation (NGO confirmation)
  - New Project Published Alert (sent to all followers of the NGO)

### Milestone Builder UI
- **Allocation Rule:** The sum of all milestone target amounts must equal exactly the project target. The UI shows a live running total (e.g. "₹45,000 of ₹50,000 allocated") with a progress bar. The "Publish" action is locked until allocation reaches 100%.
- **Sequential numbered builder:** NGO builds ordered milestones in sequence. Cards collect Title, Description, Target Amount, Deadline, and Proof Type Required (dropdown: Photo Evidence / Receipt + Photo / Document Upload / Any).

### Discovery & Public Profile Design
- **Typography:** **Inter** is the primary font family for ImpactBridge.
- **`/discover` Layout:** Top cause category pill filters, left desktop sidebar with filters (checkboxes, location search, sorting by Health Score, Newest, Most Funded, and Most Active), 3x grid display showing NGO health scores (green 80+, yellow 50-79, red < 50), active project count, and follow buttons. Supports infinite scroll pagination.
- **`/ngo/[id]` Layout:** Banner header, prominent health score stats, Follow button, cause tags, location. Tabs show Active Projects / Completed Projects / Impact Story / About. Metric bars breakdown: fund utilization, milestone completion, proof speed, and donor return.
- **Micro-animations:** Hover card lift (`translateY(-2px)` + shadow), smooth tab toggles, skeleton layouts on load, and Health Score numerical count-up on mount (150-200ms duration).

## Phase 3 Decisions

**Date:** 2026-06-17

### Scope
- **Donor Details for 80G:** Before initiating Razorpay checkout, the UI will verify that the donor's profile includes **Full Name**, **PAN Number** (validated with regex `/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/`), and **Full Billing Address** (street, city, state, pincode). If any are missing, a pre-donation modal will collect and save them directly to the `User` record.
- **Client Checkout & Polling:** The client loads Razorpay's Standard Checkout script. On success callback, the user is redirected to a pending page `/donor/donations/[donationId]/pending` that polls `/api/donations/[donationId]/status` every 3 seconds (up to 10 times) until the status is resolved to `SUCCESS` or `FAILED`.
- **Webhook-Driven Resolution:** Webhooks with verified signatures are the single source of truth for updating donation status to `SUCCESS` and triggering receipt generation.

### Approach
- **Generate & Archive on Webhook:** Upon receiving a verified Razorpay `payment.captured` or `order.paid` webhook, the platform will:
  1. Verify the signature with HMAC SHA256.
  2. Guard against duplicate webhook delivery using the payment ID.
  3. Compute the Indian Financial Year (using `getIndianFinancialYear`).
  4. Generate a unique receipt number: `IB-FY{shortYear}-{paddedSequence}` based on counting existing receipts in the DB.
  5. Generate the PDF server-side via `@react-pdf/renderer`.
  6. Store the PDF using the file storage adapter to path `receipts/{donationId}/{receiptNumber}.pdf`.
  7. Record the `TaxReceipt` entry in the database.
  8. Dispatch a confirmation email via Resend with the PDF attached/linked.
  9. Increment `User.totalDonated` with the donation amount.

### Dependencies & Configuration
- **Libraries:** Install `razorpay` and `@react-pdf/renderer`.
- **Bundler Settings:** Configure `serverExternalPackages: ['@react-pdf/renderer']` in Next.js configuration to bypass edge-runtime restrictions, and enforce `export const runtime = 'nodejs'` on all PDF generation API routes.

### Mock Testing
- **Local Webhook Endpoint:** Build a mock endpoint `/api/test/mock-webhook` to emulate and test webhook execution in local development. Disable this endpoint in production using `NODE_ENV` checks.

---

*Last updated: 2026-06-17*
