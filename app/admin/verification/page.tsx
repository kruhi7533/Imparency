import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import AdminClient from "@/app/admin/dashboard/AdminClient";
import { loadVerificationQueue } from "@/lib/verification-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Approvals — the console's primary surface.
 *
 * Previously the last section of /admin/dashboard, beneath four rows of
 * donation metrics and two leaderboards. An admin who came to decide on an
 * organisation had to scroll past a page about money to reach it, which is the
 * wrong way round: the metrics are something you look at occasionally, and this
 * is something you do every day.
 *
 * The dashboard keeps the metrics and now lives under Insight, where a summary
 * of how the platform is doing actually belongs.
 */
export default async function AdminVerificationPage() {
  let queue;
  try {
    queue = await loadVerificationQueue();
  } catch (err: any) {
    return <SchemaOutOfSync title="Verification queue failed to load" detail={err?.message ?? String(err)} />;
  }

  const reDecisions = queue.filter((n: any) => n.reverificationRequiredAt).length;
  const blocked = queue.filter((n: any) => !n.hasDocuments || !n.hasExtraction).length;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Approvals</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-2xl">
            Every organisation awaiting a decision. Approval requires evidence — an application with no documents, or
            documents nobody has read, cannot be approved until that is fixed.
          </p>
        </div>

        <div className="flex items-center gap-6">
          <div>
            <div className="text-2xl font-black tabular-nums text-gray-900 dark:text-white">{queue.length}</div>
            <div className="text-[11px] uppercase tracking-wide font-bold text-gray-400 dark:text-gray-600">
              Awaiting you
            </div>
          </div>
          {reDecisions > 0 && (
            <div>
              <div className="text-2xl font-black tabular-nums text-red-600 dark:text-red-400">{reDecisions}</div>
              <div className="text-[11px] uppercase tracking-wide font-bold text-red-500/70">Re-decisions</div>
            </div>
          )}
          {blocked > 0 && (
            <div>
              <div className="text-2xl font-black tabular-nums text-amber-600 dark:text-amber-400">{blocked}</div>
              <div className="text-[11px] uppercase tracking-wide font-bold text-amber-500/70">Missing evidence</div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6">
        <AdminClient initialPendingNGOs={queue as any} />
      </div>
    </main>
  );
}
