import prisma from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";
import GrievanceActions from "./GrievanceActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One grievance, in full.
 *
 * This is the only screen in the platform that renders a complaint's body, and
 * the only one that names the reporter. Both are deliberate: an admin cannot
 * judge a complaint they cannot read, and cannot weigh it without knowing
 * whether it came from a donor, the organisation's own staff, or someone with
 * a pattern of filing. Neither reaches any other surface.
 */

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/30",
  TRIAGED: "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/30",
  INVESTIGATING: "bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-900/30",
  RESOLVED: "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/30",
  DISMISSED: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
};

export default async function AdminGrievanceDetailPage({ params }: { params: { id: string } }) {
  const grievance = await prisma.grievance.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      subject: true,
      body: true,
      category: true,
      status: true,
      severity: true,
      createdAt: true,
      triagedAt: true,
      resolvedAt: true,
      resolutionNote: true,
      ngo: { select: { id: true, orgName: true, verificationStatus: true } },
      project: { select: { id: true, title: true } },
      reporter: { select: { id: true, name: true, role: true } },
      triagedBy: { select: { name: true } },
      resolvedBy: { select: { name: true } },
    },
  });

  if (!grievance) notFound();

  // Other complaints about the same organisation. One complaint is an
  // incident; four about one organisation is a pattern, and an admin judging
  // this one in isolation would not see it.
  const siblings = await prisma.grievance.count({
    where: { ngoId: grievance.ngo.id, id: { not: grievance.id } },
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          href="/admin/grievances"
          className="text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          ← Grievances
        </Link>

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_STYLE[grievance.status]}`}
          >
            {grievance.status.replace(/_/g, " ")}
          </span>
          {grievance.severity ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {grievance.severity}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              not triaged
            </span>
          )}
          <span className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400">
            {grievance.category.replace(/_/g, " ")}
          </span>
        </div>

        <h1 className="mt-2 text-2xl font-extrabold text-gray-900 dark:text-white">
          {grievance.subject}
        </h1>

        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          About{" "}
          <Link
            href={`/admin/ngos/${grievance.ngo.id}`}
            className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
          >
            {grievance.ngo.orgName}
          </Link>{" "}
          ({grievance.ngo.verificationStatus.toLowerCase()})
          {grievance.project ? ` · ${grievance.project.title}` : ""}
        </p>

        {siblings > 0 && (
          <div className="mt-4 rounded-xl border border-amber-100 dark:border-amber-900/30 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3">
            <p className="text-xs text-amber-800 dark:text-amber-300">
              <span className="font-bold">
                {siblings} other complaint{siblings > 1 ? "s" : ""}
              </span>{" "}
              {siblings > 1 ? "have" : "has"} been filed against this organisation.{" "}
              <Link
                href={`/admin/grievances?q=${encodeURIComponent(grievance.ngo.orgName)}&status=`}
                className="font-semibold underline"
              >
                See all
              </Link>
            </p>
          </div>
        )}

        <div className="mt-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            What was reported
          </h2>
          <p className="mt-2 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
            {grievance.body}
          </p>
          <p className="mt-4 text-[11px] text-gray-400 dark:text-gray-600">
            Filed by {grievance.reporter.name || "an account holder"} ({grievance.reporter.role.toLowerCase()}) on{" "}
            {grievance.createdAt.toLocaleString("en-IN")}
          </p>
        </div>

        <div className="mt-4 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            What happens next
          </h2>
          <div className="mt-3">
            <GrievanceActions grievanceId={grievance.id} status={grievance.status} />
          </div>
        </div>

        {(grievance.triagedAt || grievance.resolvedAt) && (
          <div className="mt-4 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
            <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Handling record
            </h2>
            <ul className="mt-2 space-y-2 text-sm text-gray-700 dark:text-gray-300">
              {grievance.triagedAt && (
                <li>
                  Triaged as <span className="font-semibold">{grievance.severity}</span> by{" "}
                  {grievance.triagedBy?.name || "an admin"} on{" "}
                  {grievance.triagedAt.toLocaleString("en-IN")}
                </li>
              )}
              {grievance.resolvedAt && (
                <li>
                  {grievance.status === "DISMISSED" ? "Dismissed" : "Resolved"} by{" "}
                  {grievance.resolvedBy?.name || "an admin"} on{" "}
                  {grievance.resolvedAt.toLocaleString("en-IN")}
                </li>
              )}
            </ul>
            {grievance.resolutionNote && (
              <p className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {grievance.resolutionNote}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
