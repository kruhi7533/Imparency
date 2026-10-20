import prisma from "@/lib/prisma";
import { mergeActivity } from "@/lib/ngo-activity";

/**
 * The platform trail (roadmap row 16, "security/audit verify"): every
 * append-only record the platform keeps OUTSIDE the admin decision log, in one
 * searchable timeline for an admin or auditor.
 *
 * /admin/audit covers AdminActionLog — decisions admins made. Most of what
 * matters in a pilot is decided by donors and NGOs: a contract signed, a
 * payment confirmed, a requirement validated, a PAN verified. Those live in
 * ContractAuditLog, RequirementAuditLog, ComplianceAuditLog and DonorEvent,
 * which until now could only be read one record at a time.
 *
 * Donor-event VALUES (PAN, category declarations) are never selected — the
 * event type and source are the audit fact; the value is identity data.
 */

export const TRAIL_SOURCES = ["contract", "requirement", "compliance", "donor"] as const;
export type TrailSource = (typeof TRAIL_SOURCES)[number];

export interface TrailItem {
  at: Date;
  source: TrailSource;
  action: string;
  actorRole: string;
  actorId: string | null;
  subjectId: string;
  detail: string | null;
  href: string | null;
}

export interface TrailQuery {
  sources: TrailSource[];
  from: Date;
  to: Date;
  action?: string;
  limit?: number;
}

export function parseTrailQuery(params: { source?: string; from?: string; to?: string; action?: string }, now: Date = new Date()): TrailQuery {
  const sources = TRAIL_SOURCES.includes(params.source as TrailSource) ? [params.source as TrailSource] : [...TRAIL_SOURCES];
  const to = params.to && !Number.isNaN(Date.parse(params.to)) ? new Date(`${params.to}T23:59:59.999Z`) : now;
  const from = params.from && !Number.isNaN(Date.parse(params.from)) ? new Date(params.from) : new Date(to.getTime() - 7 * 86_400_000);
  return { sources, from, to, action: params.action?.trim() || undefined, limit: 300 };
}

export async function loadPlatformTrail(q: TrailQuery): Promise<TrailItem[]> {
  const take = q.limit ?? 300;
  const createdAt = { gte: q.from, lte: q.to };
  const act = q.action ? { contains: q.action, mode: "insensitive" as const } : undefined;
  const want = (s: TrailSource) => q.sources.includes(s);

  const [contracts, requirements, compliance, donors] = await Promise.all([
    want("contract")
      ? prisma.contractAuditLog.findMany({
          where: { createdAt, ...(act ? { action: act } : {}) },
          orderBy: { createdAt: "desc" },
          take,
          select: { createdAt: true, action: true, actorRole: true, actorId: true, contractId: true, detail: true },
        })
      : [],
    want("requirement")
      ? prisma.requirementAuditLog.findMany({
          where: { createdAt, ...(act ? { action: act } : {}) },
          orderBy: { createdAt: "desc" },
          take,
          select: { createdAt: true, action: true, actorRole: true, actorId: true, requirementId: true, detail: true, fromStatus: true, toStatus: true },
        })
      : [],
    want("compliance")
      ? prisma.complianceAuditLog.findMany({
          where: { createdAt, ...(act ? { event: act } : {}) },
          orderBy: { createdAt: "desc" },
          take,
          select: { createdAt: true, event: true, actorId: true, detail: true, compliance: { select: { ngoId: true } } },
        })
      : [],
    want("donor")
      ? prisma.donorEvent.findMany({
          where: { createdAt, ...(act ? { eventType: act } : {}) },
          orderBy: { createdAt: "desc" },
          take,
          select: { createdAt: true, eventType: true, source: true, initiatedBy: true, donorId: true },
        })
      : [],
  ]);

  return mergeActivity<TrailItem>(
    [
      contracts.map((c) => ({ at: c.createdAt, source: "contract" as const, action: c.action, actorRole: c.actorRole, actorId: c.actorId, subjectId: c.contractId, detail: c.detail, href: `/admin/contracts/${c.contractId}` })),
      requirements.map((r) => ({
        at: r.createdAt,
        source: "requirement" as const,
        action: r.action,
        actorRole: r.actorRole,
        actorId: r.actorId,
        subjectId: r.requirementId,
        detail: r.fromStatus && r.toStatus && r.fromStatus !== r.toStatus ? `${r.fromStatus} → ${r.toStatus}${r.detail ? ` · ${r.detail}` : ""}` : r.detail,
        href: `/admin/requirements/${r.requirementId}`,
      })),
      compliance.map((c) => ({ at: c.createdAt, source: "compliance" as const, action: c.event, actorRole: c.actorId ? "ADMIN" : "SYSTEM", actorId: c.actorId, subjectId: c.compliance.ngoId, detail: c.detail, href: `/admin/ngos/${c.compliance.ngoId}` })),
      donors.map((d) => ({ at: d.createdAt, source: "donor" as const, action: d.eventType, actorRole: d.source, actorId: d.initiatedBy, subjectId: d.donorId, detail: null, href: `/admin/donors/${d.donorId}` })),
    ],
    take
  );
}
