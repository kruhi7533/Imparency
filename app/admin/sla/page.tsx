import prisma from "@/lib/prisma";
import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import { loadInboxSources } from "@/lib/today-sources";
import { buildInboxItems, breachedItems, breachesByQueue } from "@/lib/today-inbox";
import { declaredTargets, slaLabel, daysOverTarget } from "@/lib/sla";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the platform promised, and where it is failing.
 *
 * Today answers "what should I do now". This answers a different question an
 * admin cannot otherwise ask: which promises are we breaking, by how much, and
 * in which queue. Same items, judged against the targets in lib/sla.ts rather
 * than against recency.
 *
 * Detection and visibility only. Nothing here escalates or notifies — the
 * targets are stated so they can be measured and argued with, not enforced by
 * machinery that does not exist.
 */
export default async function AdminSlaPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/unauthorized");

  let items;
  try {
    items = buildInboxItems(await loadInboxSources(prisma));
  } catch (err: any) {
    if (err?.code === "P2021" || err?.code === "P2022") {
      return <SchemaOutOfSync title="SLA view failed to load" detail={err?.meta?.table || err?.message} />;
    }
    throw err;
  }

  const breached = breachedItems(items);
  const byQueue = breachesByQueue(items);
  const targets = declaredTargets();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Response targets</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
            How long each queue is allowed to keep someone waiting, and what is currently past that.
            These targets are measured, not enforced — nothing here escalates or sends a
            notification, so a breach is surfaced to whoever is looking, not pushed to whoever
            is not.
          </p>
        </div>

        <div className="flex gap-3 flex-wrap">
          <span
            className={`px-3 py-1.5 rounded-full text-sm font-bold border ${
              breached.length > 0
                ? "bg-red-50 text-red-700 border-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/30"
                : "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/30"
            }`}
          >
            {breached.length} past target
          </span>
          <span className="px-3 py-1.5 rounded-full text-sm font-bold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">
            {items.length} open in total
          </span>
        </div>

        {/* Where the breaches are */}
        <section>
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-3">
            Breaches by queue
          </h2>
          {byQueue.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-12 text-center">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Every queue is inside its target. 🎉
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {byQueue.map(({ queue, count, worst }) => (
                <li key={queue}>
                  <Link
                    href={`/admin/today?queue=${encodeURIComponent(queue)}&breached=1`}
                    className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 shadow-sm hover:border-red-200 dark:hover:border-red-900/40 transition"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{queue}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        target {targets.find((t) => t.queue === queue)?.target.days}d · {count} past it
                      </p>
                    </div>
                    <span className="shrink-0 px-2 py-1 rounded-lg text-xs font-bold bg-red-600 text-white">
                      worst {worst}d over
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* The individual breaches, worst first */}
        {breached.length > 0 && (
          <section>
            <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-3">
              Oldest broken promises
            </h2>
            <ul className="space-y-2">
              {breached.slice(0, 20).map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 shadow-sm hover:border-red-200 dark:hover:border-red-900/40 transition"
                  >
                    <div className="min-w-0">
                      <span className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400">
                        {item.queue}
                      </span>
                      <p className="text-sm font-bold text-gray-900 dark:text-white line-clamp-1">
                        {item.title}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                        {item.subtitle}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-bold text-red-600 dark:text-red-400">
                      {slaLabel(item.queue, item.age)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {breached.length > 20 && (
              <p className="mt-2 text-xs text-gray-400 dark:text-gray-600">
                +{breached.length - 20} more past target.
              </p>
            )}
          </section>
        )}

        {/* The promises themselves */}
        <section>
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-3">
            The targets
          </h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-950/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Queue
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Target
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Why
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {targets.map(({ queue, target }) => (
                  <tr key={queue} className="align-top">
                    <td className="px-4 py-3 text-sm font-semibold text-gray-800 dark:text-gray-200 whitespace-nowrap">
                      {queue}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {target.days}d
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {target.rationale}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
