import prisma from "@/lib/prisma";
import { mergeActivity } from "@/lib/ngo-activity";

/**
 * A donor's own activity history (roadmap row 5, "donor audit"): their CSR
 * requirements, contracts and payments, donations and account verification,
 * in one timeline. A read model over logs that already exist.
 *
 * Same rules as the NGO view (lib/ngo-activity.ts):
 * - Requirement-log detail is shown only for actions whose detail was written
 *   FOR the donor (a rejection reason, a correction request) — the same text
 *   the requirement page already shows them. Other details stay internal.
 * - Donor-event values (PAN, category declarations) are never shown, only
 *   what happened; the values are identity data.
 * - Admin risk insights and other internal admin actions are not read at all.
 * - Platform staff appear as "Platform reviewer".
 */

export type DonorActivityKind = "REQUIREMENT" | "CONTRACT" | "DONATION" | "ACCOUNT";

export interface DonorActivityItem {
  at: Date;
  kind: DonorActivityKind;
  title: string;
  detail: string | null;
  actor: string;
  href: string | null;
}

/** Requirement actions whose `detail` is addressed to the donor. */
export const DONOR_FACING_REQUIREMENT_DETAIL = new Set(["REQUIREMENT_REJECTED", "REQUIREMENT_CORRECTION_REQUESTED"]);

/** Account events shown to the donor, with their wording. Values are never shown. */
export const DONOR_VISIBLE_EVENTS: Record<string, string> = {
  CATEGORY_DECLARED: "Donor category declared",
  PAN_SUBMITTED: "PAN submitted",
  PAN_VERIFIED: "PAN verified",
  PAN_VERIFICATION_FAILED: "PAN could not be verified",
  PAN_CLEARED: "PAN removed",
  PAN_MANUALLY_VERIFIED: "PAN verified by a reviewer",
  PAN_MANUALLY_REJECTED: "PAN rejected by a reviewer",
  CSR_ORG_SUBMITTED: "Organisation submitted for verification",
  CSR_ORG_VERIFIED: "Organisation verified",
  CSR_ORG_REJECTED: "Organisation verification rejected",
  CSR_ORG_REOPENED: "Organisation details changed — verification reopened",
};

const REVIEWER = "Platform reviewer";
const humanise = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const inr = (v: { toString(): string }) => `₹${Number(v.toString()).toLocaleString("en-IN")}`;

export async function loadDonorActivity(donorId: string, limit = 200): Promise<DonorActivityItem[]> {
  const [reqLogs, contractLogs, donations, events] = await Promise.all([
    prisma.requirementAuditLog.findMany({
      where: { requirement: { sponsorId: donorId } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        action: true,
        actorId: true,
        actorRole: true,
        fromStatus: true,
        toStatus: true,
        detail: true,
        createdAt: true,
        requirementId: true,
        requirement: { select: { fileName: true } },
      },
    }),
    prisma.contractAuditLog.findMany({
      where: { contract: { donorId } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        action: true,
        actorId: true,
        actorRole: true,
        detail: true,
        createdAt: true,
        contractId: true,
        contract: { select: { title: true, ngo: { select: { orgName: true } } } },
      },
    }),
    prisma.donation.findMany({
      where: { donorId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, amount: true, status: true, createdAt: true, project: { select: { title: true } } },
    }),
    prisma.donorEvent.findMany({
      where: { donorId, eventType: { in: Object.keys(DONOR_VISIBLE_EVENTS) } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { eventType: true, source: true, createdAt: true },
    }),
  ]);

  const actorFor = (actorId: string | null, role: string, ngoName?: string) =>
    actorId === donorId ? "You" : role === "ADMIN" ? REVIEWER : role === "NGO" ? ngoName ?? "The NGO" : role === "SYSTEM" ? "Platform" : humanise(role);

  return mergeActivity<DonorActivityItem>(
    [
      reqLogs.map((l) => ({
        at: l.createdAt,
        kind: "REQUIREMENT" as const,
        title: `${humanise(l.action)} — ${l.requirement.fileName || "CSR requirement"}`,
        detail: DONOR_FACING_REQUIREMENT_DETAIL.has(l.action)
          ? l.detail
          : l.fromStatus && l.toStatus && l.fromStatus !== l.toStatus
          ? `${humanise(l.fromStatus)} → ${humanise(l.toStatus)}`
          : null,
        actor: actorFor(l.actorId, l.actorRole),
        href: `/donor/requirements/${l.requirementId}`,
      })),
      contractLogs.map((l) => ({
        at: l.createdAt,
        kind: "CONTRACT" as const,
        title: `${humanise(l.action)} — ${l.contract.title}`,
        detail: l.detail,
        actor: actorFor(l.actorId, l.actorRole, l.contract.ngo.orgName),
        href: `/donor/contracts/${l.contractId}`,
      })),
      donations.map((d) => ({
        at: d.createdAt,
        kind: "DONATION" as const,
        title: `Donation of ${inr(d.amount)} — ${d.project.title}`,
        detail: d.status === "SUCCESS" ? "Payment received" : d.status === "FAILED" ? "Payment failed" : humanise(d.status),
        actor: "You",
        href: d.status === "SUCCESS" ? null : `/donor/donations`,
      })),
      events.map((e) => ({
        at: e.createdAt,
        kind: "ACCOUNT" as const,
        title: DONOR_VISIBLE_EVENTS[e.eventType],
        detail: null,
        actor: e.source === "ADMIN" ? REVIEWER : e.source === "USER" ? "You" : "Platform",
        href: "/donor/profile",
      })),
    ],
    limit
  );
}
