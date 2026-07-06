import prisma from "@/lib/prisma";
import fs from "fs/promises";
import path from "path";

/**
 * Receipt access + audit service.
 *
 * 80G receipts are legally sensitive documents (they carry the donor's PAN),
 * so every lifecycle event — generation, claim, download — is recorded in the
 * append-only ReceiptEvent table, and every download flows through
 * downloadReceipt() so permission checks and audit events can never be
 * bypassed by a new UI surface (admin panel, donor portal, emailed link).
 */

export type ReceiptEventType =
  | "GENERATED"
  | "CLAIMED"
  | "DOWNLOADED"
  | "REGENERATED"
  | "CANCELLED";

/** Best-effort append to the receipt audit trail — never throws. */
export async function logReceiptEvent(
  receiptId: string,
  event: ReceiptEventType,
  actorId?: string | null,
  metadata?: Record<string, unknown> | null
): Promise<void> {
  try {
    await prisma.receiptEvent.create({
      data: {
        receiptId,
        event,
        actorId: actorId ?? null,
        metadata: (metadata as any) ?? undefined,
      },
    });
  } catch (err) {
    console.error(`[receipt-service] FAILED to log ${event} for receipt ${receiptId}:`, err);
  }
}

export interface DownloadActor {
  userId: string;
  role: string; // "DONOR" | "ADMIN" | "NGO"
}

export type DownloadResult =
  | { ok: true; buffer: Buffer; filename: string; contentType: string }
  | { ok: false; status: number; error: string };

/**
 * Single choke point for receipt downloads:
 * permission check → audit event → file bytes.
 *
 * Permitted: the donor who owns the donation, or any ADMIN.
 */
export async function downloadReceipt(
  receiptId: string,
  actor: DownloadActor
): Promise<DownloadResult> {
  const receipt = await prisma.taxReceipt.findUnique({
    where: { id: receiptId },
    include: { donation: { select: { donorId: true } } },
  });

  if (!receipt) {
    return { ok: false, status: 404, error: "Receipt not found" };
  }

  const isOwner = receipt.donation.donorId === actor.userId;
  const isAdmin = actor.role === "ADMIN";
  if (!isOwner && !isAdmin) {
    return { ok: false, status: 403, error: "You do not have access to this receipt" };
  }

  let buffer: Buffer;
  try {
    if (receipt.pdfUrl.startsWith("/")) {
      // Local storage — file lives under /public
      const filePath = path.join(process.cwd(), "public", receipt.pdfUrl);
      buffer = await fs.readFile(filePath);
    } else {
      // Remote storage (S3/R2/CDN)
      const res = await fetch(receipt.pdfUrl);
      if (!res.ok) {
        return { ok: false, status: 502, error: "Failed to fetch receipt from storage" };
      }
      buffer = Buffer.from(await res.arrayBuffer());
    }
  } catch (err) {
    console.error(`[receipt-service] read failed for receipt ${receiptId}:`, err);
    return { ok: false, status: 500, error: "Failed to read receipt file" };
  }

  await logReceiptEvent(receiptId, "DOWNLOADED", actor.userId, {
    as: isAdmin && !isOwner ? "ADMIN" : "DONOR",
  });

  return {
    ok: true,
    buffer,
    filename: `receipt-${receipt.receiptNumber}.pdf`,
    contentType: "application/pdf",
  };
}
