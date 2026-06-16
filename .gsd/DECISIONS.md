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

*Last updated: 2026-06-16*
