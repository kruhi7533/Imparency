import prisma from "@/lib/prisma";
import Link from "next/link";
import AutoSubmitSelect from "@/app/admin/components/AutoSubmitSelect";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import { slaTargetFor } from "@/lib/sla";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The grievance queue.
 *
 * Complaints filed against organisations on the platform. Defaults to OPEN,
 * because an unread complaint is the only state on this page where the person
 * waiting has no other way in.
 *
 * The list shows SUBJECT LINES ONLY. The complaint body is loaded on the
 * detail page and nowhere else — a queue that renders every complaint in full
 * puts the most sensitive text in the product on a screen somebody might have
 * open in a meeting.
 */

const STATUSES = ["OPEN", "TRIAGED", "INVESTIGATING", "RESOLVED", "DISMISSED"] as const;

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/30",
  TRIAGED: "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/30",
  INVESTIGATING: "bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-900/30",
  RESOLVED: "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/30",
  DISMISSED: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
};

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: "bg-red-600 text-white",
  HIGH: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  MEDIUM: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  LOW: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

function daysSince(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export default async function AdminGrievancesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string };
}) {
  const q = searchParams.q?.trim() || "";
  // Defaults to OPEN rather than everything: the page exists to clear unread
  // complaints, and "all" buries twenty closed ones above the new one.
  const status = searchParams.status ?? "OPEN";

  const where: any = {};
  if (status) where.status = status;
  if (q) {
    where.OR = [
      { subject: { contains: q, mode: "insensitive" as const } },
      { ngo: { orgName: { contains: q, mode: "insensitive" as const } } },
    ];
  }

  let grievances;
  let openCount = 0;
  try {
    [grievances, openCount] = await Promise.all([
      prisma.grievance.findMany({
        where,
        orderBy: [{ createdAt: "asc" }],
        take: 100,
        // NOTE: `body` is not selected. See the header comment.
        select: {
          id: true,
          subject: true,
          category: true,
          status: true,
          severity: true,
          createdAt: true,
          ngo: { select: { id: true, orgName: true } },
          project: { select: { title: true } },
        },
      }),
      prisma.grievance.count({ where: { status: "OPEN" } }),
    ]);
  } catch (err: any) {
    return <SchemaOutOfSync title="Grievances failed to load" detail={err?.message ?? String(err)} />;
  }

  const target = slaTargetFor("Grievances");

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Grievances</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
          Complaints filed against organisations on the platform. Only admins can see these — the
          organisation reported never can, and neither can its team members.
        </p>

        <div className="mt-4 rounded-xl border border-amber-100 dark:border-amber-900/30 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            <span className="font-bold">Filing requires an account.</span> The platform has no
            beneficiary logins, so this channel currently reaches donors and NGO staff — not the
            people a funded project serves. Anonymous intake is not built.
            {target ? ` Response target: ${target.days} days. Nothing escalates automatically.` : ""}
          </p>
        </div>

        <form className="mt-6 flex flex-wrap gap-3" method="GET">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search summary or organisation…"
            className="flex-1 min-w-[260px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <AutoSubmitSelect
            name="status"
            defaultValue={status}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </AutoSubmitSelect>
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Search
          </button>
        </form>

        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          {grievances.length} shown · {openCount} unread across all organisations
        </p>

        <div className="mt-3 space-y-2">
          {grievances.map((g) => {
            const age = daysSince(g.createdAt);
            const pastTarget = target ? age > target.days : false;
            return (
              <Link
                key={g.id}
                href={`/admin/grievances/${g.id}`}
                className="block rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 shadow-sm hover:border-emerald-200 dark:hover:border-emerald-900/40 transition"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_STYLE[g.status]}`}
                      >
                        {g.status.replace(/_/g, " ")}
                      </span>
                      {g.severity ? (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${SEVERITY_STYLE[g.severity]}`}
                        >
                          {g.severity}
                        </span>
                      ) : (
                        // Not a warning colour: "nobody has judged this yet" is
                        // a state, not a verdict.
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                          not triaged
                        </span>
                      )}
                      <span className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400">
                        {g.category.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-bold text-gray-900 dark:text-white">{g.subject}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      about {g.ngo.orgName}
                      {g.project ? ` · ${g.project.title}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={`text-xs font-bold ${
                        pastTarget ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {age === 0 ? "today" : `${age}d old`}
                    </p>
                    {pastTarget && (
                      <p className="text-[11px] text-red-500 dark:text-red-400">past target</p>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}

          {grievances.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-16 text-center">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {status === "OPEN" ? "No unread complaints." : "No grievances match this view."}
              </p>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-600">
                {status === "OPEN"
                  ? "An empty queue here means nothing has been filed, not that nothing is wrong."
                  : "Try a different status."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
