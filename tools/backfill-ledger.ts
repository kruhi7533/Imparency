/**
 * One-off: give the ledger the history that predates it.
 *
 * The ledger starts empty, so every donation confirmed before it existed
 * shows up as a MISSING_LEDGER_ENTRY finding and every donor total reads as
 * drifted. That is the reconciler being right, but it buries any real finding
 * under a wall of historical noise.
 *
 * This writes one DONATION_CAPTURED entry per already-SUCCESS donation, from
 * the donation row itself. Two things are deliberately NOT pretended:
 *
 *   - `occurredAt` is the donation's `updatedAt` (when it was marked SUCCESS),
 *     not a capture time we observed. Flagged in metadata as approximate.
 *   - `metadata.source` is "backfill", never "razorpay_webhook", so a
 *     reconstructed entry can always be told apart from an observed one.
 *
 * Idempotent twice over: it skips donations that already have an entry, and
 * reuses the webhook's own key shape (`DONATION_CAPTURED:<paymentId>`) so a
 * late webhook for a backfilled payment loses on the unique index instead of
 * writing a second entry for one payment.
 *
 * Lives in tools/ rather than scripts/ because scripts/ is gitignored, and a
 * command that writes money records should be reviewable.
 *
 *   npm run backfill:ledger          # dry run, writes nothing
 *   npm run backfill:ledger -- --apply
 *
 * NOT an admin route on purpose: this is a migration of history, run once by
 * a person who understands what it fabricates, not a button anyone can press.
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");

async function main() {
  const donations = await prisma.donation.findMany({
    where: { status: "SUCCESS" },
    select: {
      id: true,
      amount: true,
      donorId: true,
      projectId: true,
      razorpayPaymentId: true,
      createdAt: true,
      updatedAt: true,
      project: { select: { ngoId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const existing = await prisma.ledgerEntry.findMany({
    where: { donationId: { in: donations.map((d) => d.id) } },
    select: { donationId: true },
  });
  const covered = new Set(existing.map((e) => e.donationId));

  const todo = donations.filter((d) => !covered.has(d.id));

  const rows = todo.map((d) => ({
    entryType: "DONATION_CAPTURED" as const,
    direction: "CREDIT" as const,
    amount: new Prisma.Decimal(d.amount.toString()),
    projectId: d.projectId,
    ngoId: d.project.ngoId,
    donorId: d.donorId,
    donationId: d.id,
    externalRef: d.razorpayPaymentId,
    // Same key the webhook would have used when a payment id exists, so the
    // two can never both land. Without one there is nothing provider-side to
    // key on, so the donation id carries a distinct prefix.
    idempotencyKey: d.razorpayPaymentId
      ? `DONATION_CAPTURED:${d.razorpayPaymentId}`
      : `DONATION_CAPTURED:backfill:${d.id}`,
    occurredAt: d.updatedAt,
    metadata: {
      source: "backfill",
      occurredAtApproximate: true,
      occurredAtBasis: "donation.updatedAt",
      hadPaymentId: Boolean(d.razorpayPaymentId),
      backfilledAt: new Date().toISOString(),
    } as Prisma.InputJsonValue,
  }));

  const total = rows.reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0));
  const withoutPaymentId = rows.filter((r) => !r.externalRef).length;

  console.log(`SUCCESS donations:        ${donations.length}`);
  console.log(`already in the ledger:    ${covered.size}`);
  console.log(`to backfill:              ${rows.length}  (${total.toFixed(2)} INR)`);
  console.log(`  of those, no payment id: ${withoutPaymentId}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to write these entries.");
    return;
  }

  if (rows.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  // skipDuplicates covers the third case: a webhook landing between the read
  // above and this write.
  const { count } = await prisma.ledgerEntry.createMany({ data: rows, skipDuplicates: true });
  console.log(`\nWrote ${count} ledger entries.`);
  console.log("Run reconciliation from /admin/finance to close the findings these answer.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
