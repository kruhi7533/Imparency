import prisma from "@/lib/prisma";
import Link from "next/link";
import AutoSubmitSelect from "@/app/admin/components/AutoSubmitSelect";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import {
  AUDIT_ENTITY_TYPES,
  auditFilterQuery,
  buildAuditWhere,
  readAuditFilters,
} from "@/lib/audit-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Global admin audit trail — every `AdminActionLog` row, across every entity,
 * searchable and filterable in one place.
 *
 * This does not write anything and does not introduce a second audit
 * mechanism: it is a read-only view over the same `logAdminAction()` calls
 * that already back the per-entity histories on the NGO and donor pages
 * (app/admin/ngos/[id]/page.tsx, app/admin/donors/[id]/page.tsx). Those pages
 * keep working unchanged; this is the cross-entity complement they never had.
 */

const PAGE_SIZE = 50;

/** Best-effort approve/reject coloring, purely cosmetic — not a source of truth. */
function decisionStyle(action: string): string {
  if (/REJECTED|DISMISSED|SUSPENDED|FAILED|FLAGGED/.test(action)) {
    return "bg-red-50 text-red-700 border-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/30";
  }
  if (/APPROVED|OPENED|SHORTLISTED|VERIFIED|CLEARED|RESOLVED|FEATURED/.test(action)) {
    return "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/30";
  }
  return "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700";
}

/** Entity types with an existing detail page this trail can link out to. */
function entityHref(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "NGO":
    case "FCRA":
      return `/admin/ngos/${entityId}`;
    case "DONOR":
      return `/admin/donors/${entityId}`;
    case "OPPORTUNITY":
      return `/admin/opportunities/${entityId}`;
    default:
      return null;
  }
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: {
    action?: string;
    entityType?: string;
    actor?: string;
    from?: string;
    to?: string;
    page?: string;
  };
}) {
  const { action, entityType, actor, from, to } = readAuditFilters(searchParams);
  const page = Math.max(1, Number(searchParams.page) || 1);

  const where = buildAuditWhere(searchParams);

  let logs;
  let total: number;
  try {
    [logs, total] = await Promise.all([
      prisma.adminActionLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { admin: { select: { name: true, email: true } } },
      }),
      prisma.adminActionLog.count({ where }),
    ]);
  } catch (err: any) {
    return <SchemaOutOfSync title="Audit trail failed to load" detail={err?.message ?? String(err)} />;
  }

  const hasFilters = !!(action || entityType || actor || from || to);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (overrides: Record<string, string | number>) => {
    const params = auditFilterQuery(searchParams);
    Object.entries(overrides).forEach(([k, v]) => params.set(k, String(v)));
    return `/admin/audit?${params.toString()}`;
  };
  const exportHref = `/api/admin/audit/export?${auditFilterQuery(searchParams).toString()}`;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Audit trail</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
          Every recorded admin decision, across every entity — who did it, what changed, and why.
          Read-only: this is the same {`AdminActionLog`} rows the NGO and donor pages already show
          scoped to one entity, gathered here so you can search across all of them.
        </p>

        <form className="mt-6 flex flex-wrap gap-3" method="GET">
          <input
            type="text"
            name="action"
            defaultValue={action}
            placeholder="Search action (e.g. REJECTED)…"
            className="flex-1 min-w-[220px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <input
            type="text"
            name="actor"
            defaultValue={actor}
            placeholder="Actor name or email…"
            className="flex-1 min-w-[200px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <AutoSubmitSelect
            name="entityType"
            defaultValue={entityType}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
          >
            <option value="">All entity types</option>
            {AUDIT_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </AutoSubmitSelect>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
          />
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
          />
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Search
          </button>
          {hasFilters && (
            <Link
              href="/admin/audit"
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Clear
            </Link>
          )}
        </form>

        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {total} entr{total === 1 ? "y" : "ies"} · page {page} of {totalPages}
          </p>
          {total > 0 && (
            <a
              href={exportHref}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Export CSV{hasFilters ? " (filtered)" : ""}
            </a>
          )}
        </div>

        <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-gray-950/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">When</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Actor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Action</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Entity</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Change</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {logs.map((log) => {
                const href = entityHref(log.entityType, log.entityId);
                return (
                  <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 align-top">
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {log.createdAt.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {log.admin ? (log.admin.name || log.admin.email) : (
                        <span className="italic text-gray-400 dark:text-gray-600">Platform</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${decisionStyle(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                      <div className="font-semibold text-gray-800 dark:text-gray-200">{log.entityType}</div>
                      {href ? (
                        <Link href={href} className="text-emerald-600 hover:underline dark:text-emerald-400">
                          {log.entityId}
                        </Link>
                      ) : (
                        <span className="break-all">{log.entityId}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-gray-500 dark:text-gray-400 max-w-xs">
                      {log.oldValue || log.newValue ? (
                        <code className="block whitespace-pre-wrap break-all">
                          {JSON.stringify(log.oldValue)} → {JSON.stringify(log.newValue)}
                        </code>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 max-w-xs">
                      {log.note || <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                  </tr>
                );
              })}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                    No audit entries match this view.{" "}
                    {hasFilters && (
                      <Link href="/admin/audit" className="text-emerald-600 hover:underline">
                        Clear filters
                      </Link>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <Link
              href={qs({ page: Math.max(1, page - 1) })}
              aria-disabled={page <= 1}
              className={`rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 ${
                page <= 1
                  ? "pointer-events-none text-gray-300 dark:text-gray-700"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              ← Newer
            </Link>
            <Link
              href={qs({ page: Math.min(totalPages, page + 1) })}
              aria-disabled={page >= totalPages}
              className={`rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 ${
                page >= totalPages
                  ? "pointer-events-none text-gray-300 dark:text-gray-700"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              Older →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
