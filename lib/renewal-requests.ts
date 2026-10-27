import { Prisma, TeamRole, type RenewalRequestKind, type RenewalRequestStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { checkDonorAction } from "@/lib/donor-team";

/**
 * Donor re-engagement from a stored report (DON-016 / NGO-020 / E2E-007).
 *
 * After reading a PUBLISHED contract impact report a donor can ask to RENEW
 * the grant or ask about the organisation's NEXT_OPPORTUNITY. The NGO sees
 * the request and ACCEPTs or DECLINEs it with a response.
 *
 * Idempotent per (report, kind): the unique key turns a double click or a
 * retried request into a replay of the existing request, never a second one.
 */

export const RENEWAL_KINDS: RenewalRequestKind[] = ["RENEWAL", "NEXT_OPPORTUNITY"];

export function isRenewalKind(v: unknown): v is RenewalRequestKind {
  return typeof v === "string" && (RENEWAL_KINDS as string[]).includes(v);
}

/** Responding commits the organisation to a conversation about money: owners and admins. */
export const CAN_RESPOND: TeamRole[] = [TeamRole.OWNER, TeamRole.ADMIN];

export function parseProposedAmount(v: unknown): { ok: true; value: Prisma.Decimal | null } | { ok: false; error: string } {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return { ok: false, error: "proposedAmount must be a positive amount with at most 2 decimals" };
  const d = new Prisma.Decimal(s);
  if (d.lte(0)) return { ok: false, error: "proposedAmount must be positive" };
  return { ok: true, value: d };
}

export type RenewalResult =
  | { status: "created" | "exists"; request: { id: string; kind: RenewalRequestKind; status: RenewalRequestStatus } }
  | { status: "not_found" }
  | { status: "forbidden"; error: string }
  | { status: "not_published" }
  | { status: "invalid"; error: string };

/**
 * Create (or replay) a donor's renewal / next-opportunity request on a stored
 * report. Returns `not_found` for any report that is not this donor
 * account's, so a guessed id discloses nothing.
 */
export async function requestRenewal(args: {
  reportId: string;
  userId: string;
  kind: RenewalRequestKind;
  message?: unknown;
  proposedAmount?: unknown;
}): Promise<RenewalResult> {
  const report = await prisma.contractImpactReport.findUnique({
    where: { id: args.reportId },
    select: { id: true, donorId: true, ngoId: true, contractId: true, status: true, title: true },
  });
  if (!report) return { status: "not_found" };
  const access = await checkDonorAction(args.userId, report.donorId, "decide");
  if (!access.ok) {
    return access.reason === "not_party"
      ? { status: "not_found" }
      : { status: "forbidden", error: "Your role on this organisation cannot request a renewal. Ask an owner, admin or approver." };
  }
  if (report.status !== "PUBLISHED") return { status: "not_published" };

  const amount = parseProposedAmount(args.proposedAmount);
  if (!amount.ok) return { status: "invalid", error: amount.error };
  const message = typeof args.message === "string" ? args.message.trim().slice(0, 2000) || null : null;

  const existing = await prisma.renewalRequest.findUnique({
    where: { reportId_kind: { reportId: report.id, kind: args.kind } },
    select: { id: true, kind: true, status: true },
  });
  if (existing) return { status: "exists", request: existing };

  try {
    const created = await prisma.renewalRequest.create({
      data: {
        reportId: report.id,
        contractId: report.contractId,
        ngoId: report.ngoId,
        donorId: report.donorId,
        kind: args.kind,
        message,
        proposedAmount: amount.value,
        requestedById: args.userId,
      },
      select: { id: true, kind: true, status: true },
    });
    try {
      const ngo = await prisma.nGOProfile.findUnique({ where: { id: report.ngoId }, select: { userId: true } });
      if (ngo) {
        await prisma.notification.create({
          data: {
            userId: ngo.userId,
            type: "RENEWAL_REQUESTED",
            title: args.kind === "RENEWAL" ? "Your funder wants to renew" : "Your funder asked about your next opportunity",
            body: `On report "${report.title}". Open Reporting to respond.`,
          },
        });
      }
    } catch (err) {
      console.error("[renewal-requests] notify failed for", created.id, err);
    }
    return { status: "created", request: created };
  } catch (err: any) {
    // Lost a race with a concurrent identical request: same outcome.
    if (err?.code === "P2002") {
      const again = await prisma.renewalRequest.findUnique({
        where: { reportId_kind: { reportId: report.id, kind: args.kind } },
        select: { id: true, kind: true, status: true },
      });
      if (again) return { status: "exists", request: again };
    }
    throw err;
  }
}

export type RenewalResponseAction = "ACCEPT" | "DECLINE";

export function checkRenewalResponse(
  current: RenewalRequestStatus,
  action: unknown,
  response: unknown,
): { ok: true; to: RenewalRequestStatus; response: string | null } | { ok: false; status: number; error: string } {
  if (action !== "ACCEPT" && action !== "DECLINE") return { ok: false, status: 400, error: "action must be ACCEPT or DECLINE" };
  if (current !== "OPEN") return { ok: false, status: 409, error: `This request was already ${current.toLowerCase()}.` };
  const text = typeof response === "string" ? response.trim().slice(0, 2000) : "";
  if (action === "DECLINE" && !text) return { ok: false, status: 400, error: "Tell the funder why when declining." };
  return { ok: true, to: action === "ACCEPT" ? "ACCEPTED" : "DECLINED", response: text || null };
}
