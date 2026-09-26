import { getServerSession } from "next-auth/next";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ListChecks,
  ShieldCheck,
  FolderKanban,
  ImageIcon,
  FileWarning,
  AlertTriangle,
  ShieldAlert,
  BellOff,
  CalendarClock,
  MessageCircleQuestion,
  HandCoins,
  GitPullRequestArrow,
  CheckCircle2,
  FileText,
} from "lucide-react";
import {
  buildInboxItems,
  countBySeverity,
  countByQueue,
  filterByQueue,
  groupByCategory,
  CATEGORY_HINT,
  isBreached,
  breachedItems,
  isChaseable,
  partitionByChase,
  splitTodayAndOlder,
  FIRST_VISIT_LOOKBACK_MS,
  type IconKey,
  type InboxItem,
  type Severity,
} from "@/lib/today-inbox";
import { slaLabel } from "@/lib/sla";
import { loadInboxSources } from "@/lib/today-sources";
import ChaseCheckbox from "./ChaseCheckbox";
import MarkVisited from "./MarkVisited";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Icons live here, not in lib/today-inbox.ts, so that module stays React-free. */
const ICONS: Record<IconKey, React.ElementType> = {
  ngo: ShieldCheck,
  opportunity: HandCoins,
  project: FolderKanban,
  completed: CheckCircle2,
  proposal: FileText,
  proof: ImageIcon,
  fcra: FileWarning,
  candidate: GitPullRequestArrow,
  risk: ShieldAlert,
  alert: AlertTriangle,
  thread: MessageCircleQuestion,
  quiet: BellOff,
  overdue: CalendarClock,
};

/** One row, identical in the main area and the sidebar. */
function InboxCard({
  item,
  chased = false,
  chasedUntil,
}: {
  item: InboxItem;
  chased?: boolean;
  chasedUntil?: string | null;
}) {
  const Icon = ICONS[item.iconKey];
  const style = SEVERITY_STYLE[item.severity];
  return (
    <Link
      href={item.href}
      className={`flex items-start gap-3 h-full rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 shadow-sm hover:border-emerald-200 dark:hover:border-emerald-900/40 transition ${
        chased ? "opacity-50" : ""
      }`}
    >
      <div className="h-9 w-9 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex items-center justify-center shrink-0">
        <Icon size={17} strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400">{item.queue}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${style.classes}`}>{style.label}</span>
          {/* A broken promise is its own fact, separate from how bad the thing
              is — see isBreached() in lib/today-inbox.ts. */}
          {isBreached(item) && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold border bg-red-600 text-white border-red-600">
              {slaLabel(item.queue, item.age)}
            </span>
          )}
        </div>
        {/* Clamped, not truncated: a fraud alert's whole point is in its
            description, and one clipped line hides which organisation it
            names. */}
        <p className="text-sm font-bold text-gray-900 dark:text-white line-clamp-2">{item.title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{item.subtitle}</p>
        {/* The individual problems behind a grouped row. Without these the
            grouping would have hidden the detail it replaced. */}
        {item.details && item.details.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {item.details.map((detail, i) => (
              <li
                key={i}
                className="text-[11px] text-gray-500 dark:text-gray-400 pl-3 relative line-clamp-1"
              >
                <span className="absolute left-0 text-gray-300 dark:text-gray-600">·</span>
                {detail}
              </li>
            ))}
          </ul>
        )}
        {isChaseable(item) && (
          <ChaseCheckbox itemKey={item.id} chased={chased} chasedUntil={chasedUntil} />
        )}
      </div>
    </Link>
  );
}

/**
 * What this column is not showing today, and the way to it.
 *
 * Today deliberately hides routine work that is neither new nor urgent, but
 * hiding without counting is how a queue quietly loses things.
 */
function OlderItems({ counts }: { counts?: Map<string, number> }) {
  if (!counts || counts.size === 0) return null;
  return (
    <ul className="mt-3 space-y-1">
      {Array.from(counts, ([queue, count]) => (
        <li key={queue}>
          <Link
            href={`/admin/today?queue=${encodeURIComponent(queue)}&all=1`}
            className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline"
          >
            +{count} older in {queue} →
          </Link>
        </li>
      ))}
    </ul>
  );
}

const SEVERITY_STYLE: Record<Severity, { label: string; classes: string }> = {
  high: { label: "Needs attention", classes: "bg-red-50 text-red-700 border-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/30" },
  medium: { label: "Worth a look", classes: "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/30" },
  low: { label: "FYI", classes: "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/30" },
};

/**
 * Unified admin inbox — a read-only aggregation over queues that already
 * exist elsewhere (NGO verification, project/proof/FCRA review, fraud alerts,
 * risk reviews, quiet NGOs, overdue milestones, inquiry threads, opportunity
 * approvals, matching decisions).
 *
 * Items are grouped into three fixed categories (Approvals, Decisions,
 * Blocked / SLA — see `Category` above) so the page reads as an Action Center
 * rather than one undifferentiated list. The category is a view label only;
 * it does not change what state anything is in.
 *
 * INVARIANT: this page must never write anything and must never be the only
 * place an item can be actioned — every card links out to its real queue.
 * That keeps it purely additive: nothing here can break something else.
 */
export default async function TodayInboxPage({
  searchParams,
}: {
  searchParams: { queue?: string; all?: string; breached?: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/unauthorized");

  const now = new Date();

  let sources;
  try {
    sources = await loadInboxSources(prisma);
  } catch (err: any) {
    if (err?.code === 'P2021' || err?.code === 'P2022') {
      return <SchemaOutOfSync title="Today Inbox failed to load" detail={err?.meta?.table || err?.meta?.column || err?.message} />;
    }
    throw err;
  }

  const items = buildInboxItems(sources);

  // Chips count the whole inbox; the columns show only what is selected. A
  // chip whose count changed with the filter would be a filter that hides its
  // own way back.
  const queues = countByQueue(items);
  const activeQueue = queues.some((q) => q.queue === searchParams.queue)
    ? searchParams.queue
    : undefined;
  const visible = filterByQueue(items, activeQueue);

  // Only unexpired chases hide anything. An expired row is left alone — the
  // item simply reappears, which is the point: a nudge is not a resolution.
  const activeChases = await prisma.inboxChase.findMany({
    where: { expiresAt: { gt: now } },
    select: { itemKey: true, expiresAt: true },
  });
  const chaseExpiryByKey = new Map(activeChases.map((c) => [c.itemKey, c.expiresAt]));
  const chasedKeys = new Set(chaseExpiryByKey.keys());

  // "New since you last looked" — see AdminInboxVisit for why this reads
  // previousVisitAt rather than the current visit.
  const visit = await prisma.adminInboxVisit.findUnique({
    where: { adminId: session.user.id },
    select: { previousVisitAt: true },
  });
  const newSince = visit?.previousVisitAt ?? new Date(now.getTime() - FIRST_VISIT_LOOKBACK_MS);

  // `?all=1` drops the Today scoping and shows the full backlog — where the
  // "older items" links point.
  const showAll = searchParams.all === "1";
  // A breach is never "older news" — a broken promise stays on the page until
  // it is answered for, regardless of when the admin last looked.
  const onlyBreached = searchParams.breached === "1";
  const breached = breachedItems(visible);
  const { today, older } = splitTodayAndOlder(visible, newSince);
  const shown = onlyBreached ? breached : showAll ? visible : today;

  // What Today is choosing not to show, counted per column and queue, so work
  // that falls out is visibly waiting rather than silently dropped.
  const olderByCategory = new Map<string, Map<string, number>>();
  if (!showAll && !onlyBreached) {
    for (const i of older) {
      const forCategory = olderByCategory.get(i.category) ?? new Map<string, number>();
      forCategory.set(i.queue, (forCategory.get(i.queue) ?? 0) + 1);
      olderByCategory.set(i.category, forCategory);
    }
  }

  const bySeverity = countBySeverity(shown);
  const byCategory = groupByCategory(shown);
  // CATEGORY_ORDER puts the admin's own work first; the rest is sidebar.
  const [primary, ...secondary] = byCategory;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      {/* Advances the "new since" marker, after this render, in the browser. */}
      <MarkVisited />
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <ListChecks size={24} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Today</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
              {showAll
                ? "Everything still open in this queue, however long it has been waiting."
                : "New since you last looked, plus anything urgent enough not to wait. Older routine work stays in its own queue, counted below."}
            </p>
          </div>
        </div>

        {/* Summary */}
        <div className="flex gap-3 flex-wrap">
          <span className={`px-3 py-1.5 rounded-full text-sm font-bold border ${SEVERITY_STYLE.high.classes}`}>
            {bySeverity.high} needs attention
          </span>
          <span className={`px-3 py-1.5 rounded-full text-sm font-bold border ${SEVERITY_STYLE.medium.classes}`}>
            {bySeverity.medium} worth a look
          </span>
          <span className={`px-3 py-1.5 rounded-full text-sm font-bold border ${SEVERITY_STYLE.low.classes}`}>
            {bySeverity.low} FYI
          </span>
        </div>

        {/* Queue filter — jump straight to one kind of work. */}
        {queues.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            <Link
              href="/admin/today"
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                !activeQueue
                  ? "bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900 dark:border-white"
                  : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              All · {items.length}
            </Link>
            {breached.length > 0 && (
              <Link
                href={onlyBreached ? "/admin/today" : "/admin/today?breached=1"}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                  onlyBreached
                    ? "bg-red-600 text-white border-red-600"
                    : "border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                }`}
              >
                Past target · {breached.length}
              </Link>
            )}
            {(showAll || onlyBreached) && (
              <Link
                href="/admin/today"
                className="px-3 py-1.5 rounded-full text-xs font-bold border border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
              >
                ← Back to today only
              </Link>
            )}
            {queues.map(({ queue, count }) => (
              <Link
                key={queue}
                href={`/admin/today?queue=${encodeURIComponent(queue)}`}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                  activeQueue === queue
                    ? "bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900 dark:border-white"
                    : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {queue} · {count}
              </Link>
            ))}
          </div>
        )}

        {/* The work the admin owes gets the page; the rest gets a sidebar.
            Today is opened to answer "what do I do now", so a category nobody
            is blocked on must not take an equal share of the screen. */}
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-16 text-center">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Nothing waiting on you right now. Every queue is caught up. 🎉
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
            <section className="lg:col-span-3 min-w-0">
              <div className="mb-3 pb-2 border-b border-gray-200 dark:border-gray-800">
                <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-400">
                  {primary.category}{" "}
                  <span className="text-gray-300 dark:text-gray-600">· {primary.items.length}</span>
                </h2>
                <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-600">
                  {CATEGORY_HINT[primary.category]}
                </p>
              </div>
              {primary.items.length === 0 ? (
                <p className="py-6 text-xs text-gray-400 dark:text-gray-600">
                  Nothing new or urgent. You are caught up for today.
                </p>
              ) : (
                <ul className="grid sm:grid-cols-2 gap-2">
                  {primary.items.map((item) => (
                    <li key={item.id}>
                      <InboxCard item={item} />
                    </li>
                  ))}
                </ul>
              )}
              <OlderItems counts={olderByCategory.get(primary.category)} />
            </section>

            <aside className="lg:col-span-1 min-w-0 space-y-6">
              {secondary.map(({ category, items: groupItems }) => (
                <section key={category} className="min-w-0">
                  <div className="mb-3 pb-2 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-400">
                      {category}{" "}
                      <span className="text-gray-300 dark:text-gray-600">· {groupItems.length}</span>
                    </h2>
                    <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-600">
                      {CATEGORY_HINT[category]}
                    </p>
                  </div>
                  {groupItems.length === 0 ? (
                    <p className="py-4 text-xs text-gray-400 dark:text-gray-600">Nothing here.</p>
                  ) : (
                    (() => {
                      // Already-chased items sink to the bottom, dimmed, rather
                      // than disappearing — otherwise a mistaken tick would be
                      // impossible to undo from this page.
                      const { pending, chased } = partitionByChase(groupItems, chasedKeys);
                      return (
                        <ul className="space-y-2">
                          {[...pending, ...chased].map((item) => {
                            const until = chaseExpiryByKey.get(item.id);
                            return (
                              <li key={item.id}>
                                <InboxCard
                                  item={item}
                                  chased={!!until}
                                  chasedUntil={until ? until.toLocaleDateString("en-IN") : null}
                                />
                              </li>
                            );
                          })}
                        </ul>
                      );
                    })()
                  )}
                  <OlderItems counts={olderByCategory.get(category)} />
                </section>
              ))}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
