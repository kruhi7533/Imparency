---
phase: 3
plan: 1
wave: 1
gap_closure: false
---

# Plan 3.1: Database Migration, Financial Utilities & Order API

## Objective
Update the User schema to support saving the billing address, generate database migrations, implement financial utilities, and build the Razorpay order creation and status check API endpoints.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/phases/3/RESEARCH.md
- .gsd/DECISIONS.md
- prisma/schema.prisma

## Tasks

<task type="auto">
  <name>Database Migration for Billing Address & Utilities</name>
  <files>
    prisma/schema.prisma
    lib/finance-utils.ts
  </files>
  <action>
    Steps:
    1. Open `prisma/schema.prisma`. Add `billingAddress String?` to the `User` model.
    2. Run `npx prisma migrate dev --name add_user_billing_address` to update the database schema and regenerate the Prisma client.
    3. Create `lib/finance-utils.ts`:
       - Implement `getIndianFinancialYear(date: Date): string` returning strings like "2026-27".
       - Implement `amountToWords(amount: number): string` following the Indian numbering system (units, tens, hundreds, thousands, lakhs, crores, ending with "Rupees Only").
    4. Create `scripts/test-finance-utils.ts` to test these functions against edge cases.
  </action>
  <verify>
    npx ts-node scripts/test-finance-utils.ts
  </verify>
  <done>
    Database migration successfully runs, and financial utilities pass all tests.
  </done>
</task>

<task type="auto">
  <name>Implement Create Order and Status Check APIs</name>
  <files>
    app/api/donations/create-order/route.ts
    app/api/donations/[donationId]/status/route.ts
  </files>
  <action>
    Steps:
    1. Create `app/api/donations/create-order/route.ts`:
       - Protect route via session role validation (require `DONOR` role).
       - Parse payload: `{ projectId, amount, name, panNumber, billingAddress }`.
       - If the user session doesn't already have these fields populated, and they are provided in the payload, save them to the `User` record. If any of the three are still missing (in the DB or the payload), return 400.
       - Fetch the target `Project` to verify it is `ACTIVE`.
       - Create a `Donation` record in Prisma with status `PENDING`.
       - Instantiate Razorpay Node SDK (handling mock mode when keys are absent). Create Razorpay order via `razorpay.orders.create` for `amount * 100` paise in `INR` currency.
       - Update the `Donation` record with the returned `razorpayOrderId` and save.
       - Return the updated details to the client.
    2. Create `app/api/donations/[donationId]/status/route.ts`:
       - Guard access to the authenticated user who initiated the donation.
       - Fetch the `Donation` status and return it.
  </action>
  <verify>
    Ensure routes compile cleanly with `npx tsc --noEmit`.
  </verify>
  <done>
    API endpoints compile, create pending database records, and query status.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] Database schema is updated with `billingAddress` on `User` model.
- [ ] Financial utilities handle lakhs/crores formatting correctly.
- [ ] Create order endpoint validates billing fields and saves them to user model.

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in tests
