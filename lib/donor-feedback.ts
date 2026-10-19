import type { DonorFeedbackSignal } from "@prisma/client";
import prisma from "@/lib/prisma";

/**
 * Donor feedback on project updates (roadmap row 12, "feedback signal").
 *
 * Who may give it: a donor who funds the project (signed contract or a
 * successful donation) or follows it in the impact feed. Anyone else's
 * feedback would be noise the NGO cannot act on.
 *
 * What the NGO sees: counts and notes, never who wrote them. Donations can be
 * anonymous, and a note is more candid when it is not attributed.
 */

export const NOTE_MAX = 500;
export const SIGNALS: DonorFeedbackSignal[] = ["HELPFUL", "NEED_MORE_DETAIL"];

export type FeedbackInput = { projectId: string; eventKey: string; signal: DonorFeedbackSignal; note: string | null };

export function parseFeedback(body: any): { ok: true; value: FeedbackInput } | { ok: false; error: string } {
  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) return { ok: false, error: "projectId is required." };
  const signal = body?.signal;
  if (!SIGNALS.includes(signal)) return { ok: false, error: "signal must be HELPFUL or NEED_MORE_DETAIL." };
  const eventKey = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (note.length > NOTE_MAX) return { ok: false, error: `Keep the note under ${NOTE_MAX} characters.` };
  return { ok: true, value: { projectId, eventKey, signal, note: note || null } };
}

export async function donorFollowsOrFunds(donorId: string, projectId: string): Promise<boolean> {
  const [contract, donation, subscription] = await Promise.all([
    prisma.contract.findFirst({ where: { donorId, projectId, status: { in: ["ACTIVE", "COMPLETED"] } }, select: { id: true } }),
    prisma.donation.findFirst({ where: { donorId, projectId, status: "SUCCESS" }, select: { id: true } }),
    prisma.impactSubscription.findFirst({ where: { donorId, projectId, active: true }, select: { id: true } }),
  ]);
  return !!(contract || donation || subscription);
}

/** What the NGO (and admin) see: counts and recent notes, no donor identity. */
export async function summariseFeedback(projectId: string) {
  const [grouped, notes] = await Promise.all([
    prisma.donorUpdateFeedback.groupBy({ by: ["signal"], where: { projectId }, _count: { _all: true } }),
    prisma.donorUpdateFeedback.findMany({
      where: { projectId, note: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { signal: true, note: true, updatedAt: true },
    }),
  ]);
  const count = (s: DonorFeedbackSignal) => grouped.find((g) => g.signal === s)?._count._all ?? 0;
  return {
    helpful: count("HELPFUL"),
    needMoreDetail: count("NEED_MORE_DETAIL"),
    notes: notes.map((n) => ({ signal: n.signal, note: n.note!, at: n.updatedAt.toISOString() })),
  };
}
