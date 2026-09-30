-- Two findings that only become possible once real payments flow.
--
-- PAYMENT_AMOUNT_MISMATCH: the webhook recorded the amount the donation was
-- created for and never looked at what the provider actually captured, so a
-- capture for a different amount produced a ledger and a counter that agreed
-- with each other and disagreed with the money. Nothing downstream could
-- detect it, because every other check compares our records against our own
-- records.
--
-- REFUND_AFTER_RECEIPT: an 80G receipt for money that was given back is a
-- document a donor may already have filed. It needs a human, not a status
-- change.
--
-- ADD VALUE IF NOT EXISTS is re-runnable; Postgres 12+ allows it inside the
-- transaction Prisma wraps each migration in, and Neon is well past that.

ALTER TYPE "FinanceExceptionType" ADD VALUE IF NOT EXISTS 'PAYMENT_AMOUNT_MISMATCH';
ALTER TYPE "FinanceExceptionType" ADD VALUE IF NOT EXISTS 'REFUND_AFTER_RECEIPT';
