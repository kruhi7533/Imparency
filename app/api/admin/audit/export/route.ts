import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { buildAuditWhere } from "@/lib/audit-filters";

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

const HEADER = "When,Actor,Action,Entity Type,Entity ID,Note,Old Value,New Value";

/** RFC-4180 quoting: wrap every field, double any embedded quote. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `"${String(text).replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const { authorized, response } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;

  const sp = new URL(req.url).searchParams;
  const where = buildAuditWhere({
    action: sp.get("action") ?? undefined,
    entityType: sp.get("entityType") ?? undefined,
    actor: sp.get("actor") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });

  // One row over the cap, so truncation is detectable without a second count.
  const logs = await prisma.adminActionLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS + 1,
    include: { admin: { select: { name: true, email: true } } },
  });

  const truncated = logs.length > MAX_ROWS;
  const rows = (truncated ? logs.slice(0, MAX_ROWS) : logs).map((log) =>
    [
      cell(log.createdAt.toISOString()),
      cell(log.admin ? log.admin.name || log.admin.email : "Platform"),
      cell(log.action),
      cell(log.entityType),
      cell(log.entityId),
      cell(log.note),
      cell(log.oldValue),
      cell(log.newValue),
    ].join(",")
  );

  if (truncated) {
    rows.push(
      [cell(`Truncated at ${MAX_ROWS} rows — narrow the filters for the rest.`), "", "", "", "", "", "", ""].join(",")
    );
  }

  const csv = [HEADER, ...rows].join("\n");
  const filename = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
