---
phase: 1
plan: 1
wave: 1
gap_closure: false
---

# Plan 1.1: Database Schema & Prisma Setup

## Objective
Set up the Prisma ORM configuration, define all 10 relational tables (+ the rate limit log table) in the schema, and configure the prisma client utility helper in `lib/prisma.ts` utilizing the Neon pooled connection.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/phases/1/RESEARCH.md
- .gsd/DECISIONS.md

## Tasks

<task type="auto">
  <name>Initialize Prisma and define Database Schema</name>
  <files>
    prisma/schema.prisma
    lib/prisma.ts
  </files>
  <action>
    Steps:
    1. Initialize Prisma if not already initialized (or create `prisma/schema.prisma` manually).
    2. Configure the schema datasource to use PostgreSQL with direct and pool urls:
       - `url = env("DATABASE_URL")`
       - `directUrl = env("DIRECT_URL")`
    3. Define all 10 project tables in `prisma/schema.prisma`:
       - `User` (id, email, passwordHash, role (Enum DONOR/NGO/ADMIN), name, avatar, googleId, createdAt, updatedAt, panNumber, phone, city, totalDonated (Decimal))
       - `NGOProfile` (id, userId, orgName, registrationNumber, panNumber, address, causeCategories (String[]), verificationStatus (Enum PENDING/VERIFIED/REJECTED), healthScore (Decimal), documents (String[]), description, website, foundedYear, isDeleted, createdAt, updatedAt)
       - `Project` (id, ngoId, title, description, causeCategory, targetAmount (Decimal), raisedAmount (Decimal), status (Enum DRAFT/ACTIVE/COMPLETED/PAUSED), coverImage, location, isDeleted, createdAt, updatedAt)
       - `Milestone` (id, projectId, title, description, targetAmount (Decimal), deadline, status (Enum PENDING/IN_PROGRESS/PROOF_SUBMITTED/VERIFIED/COMPLETED), sequenceOrder, createdAt, updatedAt)
       - `MilestoneProof` (id, milestoneId, submittedById, description, mediaUrls (String[]), documentUrls (String[]), aiValidationResult, aiValidationScore (Int), submittedAt)
       - `Donation` (id, donorId, projectId, amount (Decimal), razorpayOrderId, razorpayPaymentId, status (Enum PENDING/SUCCESS/FAILED/REFUNDED), receiptUrl, createdAt)
       - `ImpactReport` (id, donationId, milestoneId, donorId, aiGeneratedNarrative, sentAt, readAt)
       - `NGOFollower` (donorId, ngoId, followedAt) with compound PK `@@id([donorId, ngoId])`
       - `Notification` (id, userId, type, title, body, read (Boolean), createdAt)
       - `TaxReceipt` (id, donationId, receiptNumber, financialYear, pdfUrl, issuedAt)
       - `RateLimitLog` (id, identifier, route, requestCount, windowStart)
    4. Create `lib/prisma.ts` which exports a single global `prisma` client instance, ensuring we do not create multiple clients in development hot-reloads.
    
    AVOID: Using Float for monetary values. Always use Decimal.
    USE: Prisma enum values exactly matching specifications.
  </action>
  <verify>
    npx prisma validate
  </verify>
  <done>
    Prisma schema validation passes without errors and lib/prisma.ts is correctly exported.
  </done>
</task>

<task type="auto">
  <name>Run Prisma Migrations and Generate Types</name>
  <files>
    package.json
  </files>
  <action>
    Steps:
    1. Ensure `prisma` and `@prisma/client` are installed as dependencies.
    2. Add standard prisma scripts in `package.json`:
       - `"postinstall": "prisma generate"`
    3. Run prisma Client generation.
    4. Run migration command to apply the schema to the database (mock database url in dev if local testing is used, or run against actual Neon DB if credentials are provided).
  </action>
  <verify>
    npx prisma generate
  </verify>
  <done>
    Prisma client generated successfully and schemas are ready for imports.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] Prisma schema successfully defines all tables and relationships.
- [ ] `prisma` validate passes.
- [ ] Database client helper `lib/prisma.ts` is fully typed and exports correctly.

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in tests
