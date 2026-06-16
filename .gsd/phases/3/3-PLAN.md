---
phase: 3
plan: 3
wave: 1
gap_closure: false
---

# Plan 3.3: Razorpay Webhook Verification & Payment Resolution

## Objective
Build the secure backend webhook listener for Razorpay payment captures, verify HMAC signatures, protect against duplicate payloads, resolve donation statuses, and provide a local mock webhook tester.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/phases/3/RESEARCH.md
- .gsd/DECISIONS.md
- prisma/schema.prisma

## Tasks

<task type="auto">
  <name>Implement Webhook Listener & Status Resolution</name>
  <files>
    app/api/donations/webhook/route.ts
  </files>
  <action>
    Steps:
    1. Create `app/api/donations/webhook/route.ts` with `export const runtime = 'nodejs'`.
    2. Read the raw text of the incoming request body.
    3. Retrieve the webhook secret from `process.env.RAZORPAY_WEBHOOK_SECRET`.
    4. Verify the header signature `x-razorpay-signature` using HMAC SHA256 of the raw body text. If it is invalid, return `400 Bad Request` and log the attempt.
    5. Parse the body. Look for event type `payment.captured` or `order.paid`.
    6. Extract payment ID (`razorpay_payment_id` or from the payload data structure: `payload.payment.entity.id`) and order ID.
    7. Look up the `Donation` by `razorpayOrderId`. If already marked `SUCCESS`, return `200 OK` (idempotency check).
    8. Update the `Donation` status to `SUCCESS` and save the `razorpayPaymentId`.
    9. Recalculate and update the user's `totalDonated` field: `totalDonated = totalDonated + amount`.
    10. Stub the PDF generation and receipt record creation (to be fully completed in Plan 3.4).
  </action>
  <verify>
    Ensure routes compile cleanly with `npx tsc --noEmit`.
  </verify>
  <done>
    Webhook endpoint parses payloads, validates signatures, performs status updates, and handles duplicates correctly.
  </done>
</task>

<task type="auto">
  <name>Build Local Webhook Testing Utility</name>
  <files>
    app/api/test/mock-webhook/route.ts
  </files>
  <action>
    Steps:
    1. Create `app/api/test/mock-webhook/route.ts` running under the Node.js runtime.
    2. Block access in production: `if (process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Not found' }, { status: 404 })`.
    3. Accept a POST request containing `{ donationId, amount }`.
    4. Fetch the `Donation` record by `donationId` to extract the `razorpayOrderId`.
    5. Construct a mock Razorpay payload matching the shape of a real `payment.captured` webhook.
    6. Generate a valid HMAC signature using the local `RAZORPAY_WEBHOOK_SECRET`.
    7. Post the payload and signature header internally to the `/api/donations/webhook` endpoint.
    8. Return the webhook response to the testing user.
  </action>
  <verify>
    Confirm endpoint is disabled in production and compiles correctly.
  </verify>
  <done>
    Mock webhook testing utility executes successfully in development and returns 404 in production.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] Webhook endpoint fails immediately with 400 if signature is missing or incorrect.
- [ ] Mock webhook testing endpoint is completely blocked in production mode.

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in tests
