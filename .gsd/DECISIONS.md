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

*Last updated: 2026-06-16*
