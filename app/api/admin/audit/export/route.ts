import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { buildAuditWhere, readAuditFilters } from "@/lib/audit-filters";
import { AUDIT_CSV_HEADER, GENESIS_HASH, auditCsvLine, chainHeadCsvLine, csvCell } from "@/lib/audit-chain";
import { logAdminAction } from "@/lib/admin-log";

export const runtime = "nodejs";

/**
 * ADMIN-only. The audit trail as CSV, honouring the same filters the page did.
 *
 * The page paginates; an export deliberately does not — an auditor asking for
 * "every rejection in March" wants all of them, not the first fifty. The row
 * cap exists only so an unfiltered export of a large log cannot hang the
 * request, and a truncated export says so in its last row rather than quietly
 * handing back a partial file that looks complete.
 */
const MAX_ROWS = 5000;

/**
 * Hash-chain columns (ADM-017). Every column the chain hashes is exported, the
 * JSON columns exactly as Postgres renders them, plus a final "#chain-head"
 * line, so POST /api/admin/audit/verify-export (or anyone with
 * lib/audit-chain.ts) can detect an edited, deleted or reordered row.
 */
export async function GET(req: Request) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;

  const sp = new URL(req.url).searchParams;
  const filters = {
    action: sp.get("action") ?? undefined,
    entityType: sp.get("entityType") ?? undefined,
    actor: sp.get("actor") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  };
  const where = buildAuditWhere(filters);
  const filtered = Object.values(readAuditFilters(filters)).some((v) => v !== "");

  // The head is read FIRST and the rows bounded by it, so a row appended while
  // the export runs cannot make the file look like it lost its newest rows.
  const head = await prisma.auditChainHead.findUnique({ where: { id: 1 } });
  const headSeq = head?.seq ?? 0;
  const headHash = head?.hash ?? GENESIS_HASH;

  // One row over the cap, so truncation is detectable without a second count.
  const logs = await prisma.adminActionLog.findMany({
    where: { AND: [where, { seq: { lte: headSeq } }] },
    orderBy: { seq: "desc" },
    take: MAX_ROWS + 1,
    include: { admin: { select: { name: true, email: true } } },
  });

  const truncated = logs.length > MAX_ROWS;
  const kept = truncated ? logs.slice(0, MAX_ROWS) : logs;

  // JSON columns as Postgres' own text, which is what the chain hashed.
  const jsonText = new Map<string, { oldValue: string | null; newValue: string | null; metadata: string | null }>();
  const ids = kept.map((l) => l.id);
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const rows = await prisma.$queryRaw<Array<{ id: string; oldValue: string | null; newValue: string | null; metadata: string | null }>>`
      SELECT "id", "oldValue"::text AS "oldValue", "newValue"::text AS "newValue", "metadata"::text AS "metadata"
      FROM "AdminActionLog" WHERE "id" = ANY(${chunk})`;
    for (const r of rows) jsonText.set(r.id, r);
  }

  const rows = kept.map((log) => {
    const j = jsonText.get(log.id);
    return auditCsvLine({
      seq: log.seq ?? 0,
      prevHash: log.prevHash ?? "",
      hash: log.hash ?? "",
      id: log.id,
      adminId: log.adminId,
      actorLabel: log.admin ? log.admin.name || log.admin.email : "Platform",
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      note: log.note,
      oldValueJson: j ? j.oldValue : log.oldValue == null ? null : JSON.stringify(log.oldValue),
      newValueJson: j ? j.newValue : log.newValue == null ? null : JSON.stringify(log.newValue),
      metadataJson: j ? j.metadata : log.metadata == null ? null : JSON.stringify(log.metadata),
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      schemaVersion: log.schemaVersion,
      createdAt: log.createdAt.toISOString(),
    });
  });

  if (truncated) {
    rows.push([csvCell(`#truncated: Truncated at ${MAX_ROWS} rows — narrow the filters for the rest.`)].join(","));
  }
  rows.push(
    chainHeadCsvLine({
      headSeq,
      headHash,
      rows: kept.length,
      filtered,
      truncated,
      filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)),
      exportedAt: new Date().toISOString(),
    })
  );

  const csv = [AUDIT_CSV_HEADER.join(","), ...rows].join("\n");
  const filename = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;

  // Taking a copy of the audit trail is itself an audited action. Recorded
  // after the rows are known so the log states how much left and whether the
  // cap bit — an export that was silently truncated must not read later as a
  // complete one. The filters go in metadata, never the rows: the log must not
  // become a second copy of the data it is describing.
  const exportedRows = kept.length;
  await logAdminAction({
    adminId: session.user.id,
    action: "AUDIT_TRAIL_EXPORTED",
    entityType: "SYSTEM",
    entityId: "audit-trail",
    note: `Exported ${exportedRows} audit ${exportedRows === 1 ? "row" : "rows"} as CSV`,
    metadata: {
      rowCount: exportedRows,
      truncated,
      headSeq,
      filters: Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== undefined)
      ),
    },
    request: req,
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
