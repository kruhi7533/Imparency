/**
 * Filter construction for the audit trail, shared by the page and the CSV
 * export so an export can never silently disagree with the table it was
 * exported from.
 */

export const AUDIT_ENTITY_TYPES = [
  "NGO",
  "DONOR",
  "PROJECT",
  "MILESTONE",
  "FRAUD_ALERT",
  "RISK_REVIEW",
  "FCRA",
  "THREAD",
  "SYSTEM",
  "SETTING",
  "CRISIS_EVENT",
  "RELIEF_INITIATIVE",
  "AGENT_CASE",
  "OPPORTUNITY",
  "MATCHING_JOB",
  "MATCH_CANDIDATE",
] as const;

export interface AuditFilters {
  action?: string;
  entityType?: string;
  actor?: string;
  from?: string;
  to?: string;
}

/** Normalised filter values — what the form actually holds after trimming. */
export function readAuditFilters(params: AuditFilters) {
  return {
    action: params.action?.trim() || "",
    entityType: params.entityType?.trim() || "",
    actor: params.actor?.trim() || "",
    from: params.from?.trim() || "",
    to: params.to?.trim() || "",
  };
}

export function buildAuditWhere(params: AuditFilters): Record<string, any> {
  const { action, entityType, actor, from, to } = readAuditFilters(params);

  const where: Record<string, any> = {};
  if (action) where.action = { contains: action, mode: "insensitive" as const };
  if (entityType) where.entityType = entityType;
  if (from || to) {
    where.createdAt = {};
    // `to` is a date with no time, so an inclusive end-of-day keeps "to today"
    // from excluding everything logged today.
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59.999Z`);
  }
  if (actor) {
    where.admin = {
      OR: [
        { name: { contains: actor, mode: "insensitive" as const } },
        { email: { contains: actor, mode: "insensitive" as const } },
      ],
    };
  }
  return where;
}

/** Querystring carrying the active filters, for links that must preserve them. */
export function auditFilterQuery(params: AuditFilters): URLSearchParams {
  const { action, entityType, actor, from, to } = readAuditFilters(params);
  const qs = new URLSearchParams();
  if (action) qs.set("action", action);
  if (entityType) qs.set("entityType", entityType);
  if (actor) qs.set("actor", actor);
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  return qs;
}
