import prisma from "@/lib/prisma";
import {
  HeartPulse,
  Megaphone,
  UsersRound,
  Send,
  MailOpen,
  Clock,
  AlertCircle,
  Inbox,
  BellOff,
  CalendarClock,
  CheckCircle2,
  PartyPopper,
} from "lucide-react";
import NgoAgentActions from "./NgoAgentActions";
import AskNgoBox from "@/app/admin/components/AskNgoBox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmt = (d: Date) =>
  d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Tone = "good" | "warn" | "bad" | "neutral";

const TONE_STYLES: Record<Tone, { text: string; bg: string; ring: string }> = {
  good: { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30", ring: "ring-emerald-200 dark:ring-emerald-900/40" },
  warn: { text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30", ring: "ring-amber-200 dark:ring-amber-900/40" },
  bad: { text: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30", ring: "ring-red-200 dark:ring-red-900/40" },
  neutral: { text: "text-gray-900 dark:text-white", bg: "bg-gray-50 dark:bg-gray-800/50", ring: "ring-gray-200 dark:ring-gray-800" },
};

function StatCard({
  icon: Icon,
  label,
  helper,
  value,
  tone = "neutral",
}: {
  icon: React.ElementType;
  label: string;
  helper: string;
  value: string | number;
  tone?: Tone;
}) {
  const style = TONE_STYLES[tone];
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${style.bg} ${style.text}`}>
          <Icon size={20} strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-gray-500 dark:text-gray-400 leading-tight">{label}</p>
          <p className={`text-2xl font-extrabold leading-tight ${style.text}`}>{value}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-gray-400 dark:text-gray-500 leading-relaxed">{helper}</p>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex items-center justify-center shrink-0">
          <Icon size={18} strokeWidth={2.2} />
        </div>
        <div>
          <h2 className="text-sm font-extrabold text-gray-900 dark:text-white">{title}</h2>
          <p className="mt-0.5 text-xs text-gray-400 leading-relaxed max-w-2xl">{subtitle}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/30 rounded-xl px-4 py-3">
      <PartyPopper size={16} />
      {text}
    </div>
  );
}

/**
 * Impact delivery health — "can we prove every donor was shown every verified
 * impact?" All numbers are live queries over the append-only outbox.
 */
export default async function ImpactHealthPage() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [statusCounts, eventCount, subCount, failedRows, silentNgos, overdueMilestoneRows] = await Promise.all([
    prisma.impactDelivery.groupBy({ by: ["status"], _count: true }),
    prisma.projectImpactEvent.count(),
    prisma.impactSubscription.count({ where: { active: true } }),
    prisma.impactDelivery.findMany({
      where: { status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { event: { select: { title: true, projectId: true } } },
    }),
    // NGOs with an ACTIVE project but no impact event in 30 days — silence is
    // itself a signal donors notice.
    prisma.nGOProfile.findMany({
      where: {
        verificationStatus: "VERIFIED",
        isSuspended: false,
        projects: {
          some: {
            status: "ACTIVE",
            id: { notIn: (
              await prisma.projectImpactEvent.findMany({
                where: { createdAt: { gte: thirtyDaysAgo } },
                select: { projectId: true },
                distinct: ["projectId"],
              })
            ).map((e) => e.projectId) },
          },
        },
      },
      select: { id: true, orgName: true },
      take: 25,
    }),
    // Milestones whose deadline passed with no proof ever submitted — the
    // same check the daily reminder cron runs, surfaced here for visibility.
    prisma.milestone.findMany({
      where: { status: { in: ["PENDING", "IN_PROGRESS"] }, deadline: { lt: new Date() } },
      orderBy: { deadline: "asc" },
      take: 25,
      include: { project: { select: { title: true, ngo: { select: { id: true, orgName: true } } } } },
    }),
  ]);

  // Group overdue milestones by NGO for one card per NGO
  const overdueByNgo = new Map<string, { ngoId: string; orgName: string; items: { title: string; projectTitle: string; daysOverdue: number }[] }>();
  for (const m of overdueMilestoneRows) {
    const ngo = m.project.ngo;
    if (!overdueByNgo.has(ngo.id)) overdueByNgo.set(ngo.id, { ngoId: ngo.id, orgName: ngo.orgName, items: [] });
    overdueByNgo.get(ngo.id)!.items.push({
      title: m.title,
      projectTitle: m.project.title,
      daysOverdue: Math.floor((Date.now() - m.deadline.getTime()) / (1000 * 60 * 60 * 24)),
    });
  }
  const overdueNgoList = Array.from(overdueByNgo.values());

  const counts: Record<string, number> = { PENDING: 0, SENT: 0, FAILED: 0, READ: 0 };
  for (const c of statusCounts) counts[c.status] = c._count;
  const total = counts.PENDING + counts.SENT + counts.FAILED + counts.READ;
  const delivered = counts.SENT + counts.READ;
  const deliveryRate = total > 0 ? Math.round((delivered / total) * 100) : 100;
  const readRate = delivered > 0 ? Math.round((counts.READ / delivered) * 100) : 0;

  // One-glance headline — the thing a non-technical admin should see FIRST,
  // before any individual number.
  const allGood = counts.FAILED === 0 && deliveryRate >= 95;
  const headline = allGood
    ? { tone: "good" as Tone, icon: CheckCircle2, text: "Donors are being kept in the loop. No action needed right now." }
    : counts.FAILED > 0
      ? { tone: "bad" as Tone, icon: AlertCircle, text: `${counts.FAILED} update${counts.FAILED === 1 ? "" : "s"} failed to reach a donor — see "Updates that could not be sent" below.` }
      : { tone: "warn" as Tone, icon: AlertCircle, text: "Some updates are taking longer than expected to reach donors." };
  const headlineStyle = TONE_STYLES[headline.tone];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <HeartPulse size={24} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Impact Delivery Health</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
              Are donors hearing about the good work their money is doing? This page follows every
              project update from the moment it happens to the moment a donor actually sees it.
            </p>
          </div>
        </div>

        {/* Headline banner — the at-a-glance answer */}
        <div className={`flex items-center gap-3 rounded-2xl px-5 py-4 ring-1 ${headlineStyle.bg} ${headlineStyle.ring}`}>
          <headline.icon size={22} className={headlineStyle.text} strokeWidth={2.2} />
          <p className={`text-sm font-bold ${headlineStyle.text}`}>{headline.text}</p>
        </div>

        {/* Reach */}
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wider text-gray-400 mb-3">Reach</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatCard
              icon={Megaphone}
              label="Project updates posted"
              helper="Verified progress shared by NGOs — proof submissions and completed milestones."
              value={eventCount}
            />
            <StatCard
              icon={UsersRound}
              label="Donors following projects"
              helper="Everyone currently subscribed to receive updates on a project they funded."
              value={subCount}
            />
          </div>
        </div>

        {/* Delivery health */}
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wider text-gray-400 mb-3">Delivery Health</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={Send}
              label="Updates delivered"
              helper="Successfully sent to the donor's inbox or notifications."
              value={`${deliveryRate}%`}
              tone={deliveryRate >= 95 ? "good" : deliveryRate >= 80 ? "warn" : "bad"}
            />
            <StatCard
              icon={MailOpen}
              label="Opened by donors"
              helper="Of what was delivered, how much donors actually looked at."
              value={`${readRate}%`}
              tone={readRate >= 40 ? "good" : "neutral"}
            />
            <StatCard
              icon={Clock}
              label="Waiting to send"
              helper="Queued up and going out shortly — no action needed unless this keeps growing."
              value={counts.PENDING}
              tone={counts.PENDING > 100 ? "warn" : "neutral"}
            />
            <StatCard
              icon={AlertCircle}
              label="Could not send"
              helper="Failed even after retries. These need a look — see below."
              value={counts.FAILED}
              tone={counts.FAILED > 0 ? "bad" : "good"}
            />
          </div>
        </div>

        {/* Failed deliveries */}
        <SectionCard
          icon={Inbox}
          title="Updates that could not be sent"
          subtitle="These donors were supposed to get an update, but sending failed even after several tries — usually a wrong email address or the email service being temporarily down. Fix the cause and it will be retried automatically."
        >
          {failedRows.length === 0 ? (
            <EmptyState text="Nothing failed. Every update reached its donor." />
          ) : (
            <ul className="space-y-2">
              {failedRows.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-red-100 dark:border-red-900/30 bg-red-50/50 dark:bg-red-950/10 px-4 py-3"
                >
                  <span className="text-sm font-bold text-gray-900 dark:text-white">{f.event.title}</span>
                  <span className="text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                    {f.channel === "IN_APP" ? "In-app" : "Email"}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400">
                    Tried {f.attempts}×
                  </span>
                  <span className="text-xs text-gray-400 ml-auto whitespace-nowrap">{fmt(f.createdAt)}</span>
                  <span className="w-full text-xs text-red-500 dark:text-red-400 truncate">{f.lastError ?? "No error details recorded"}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Overdue milestones */}
        <SectionCard
          icon={CalendarClock}
          title="Overdue Milestones"
          subtitle="These NGOs set their own deadline for a milestone and it has passed with no proof submitted at all. Donors who supported these projects are still waiting to see it delivered."
        >
          {overdueNgoList.length === 0 ? (
            <EmptyState text="No milestone deadlines have been missed." />
          ) : (
            <ul className="space-y-2">
              {overdueNgoList.map((n) => (
                <li
                  key={n.ngoId}
                  className="flex flex-wrap items-start gap-3 rounded-xl border border-red-100 dark:border-red-900/30 bg-red-50/50 dark:bg-red-950/10 px-4 py-3"
                >
                  <div className="w-full flex flex-wrap items-center gap-3">
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{n.orgName}</span>
                    <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                      {n.items.length} milestone{n.items.length === 1 ? "" : "s"} overdue
                      {" — "}
                      {n.items.map((i) => `"${i.title}" (${i.daysOverdue}d)`).join(", ")}
                    </span>
                  </div>
                  <NgoAgentActions ngoId={n.ngoId} reason="OVERDUE_MILESTONE" />
                  <AskNgoBox
                    ngoId={n.ngoId}
                    ngoName={n.orgName}
                    subject="Overdue milestone follow-up"
                  />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Quiet NGOs */}
        <SectionCard
          icon={BellOff}
          title="Quiet NGOs"
          subtitle="These NGOs are running funded projects but haven't shared any progress in over a month. Donors who hear nothing start to worry — a friendly reminder to post an update goes a long way."
        >
          {silentNgos.length === 0 ? (
            <EmptyState text="Every NGO with a running project has shared news recently." />
          ) : (
            <ul className="space-y-2">
              {silentNgos.map((n) => (
                <li
                  key={n.id}
                  className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-100 dark:border-amber-900/30 bg-amber-50/50 dark:bg-amber-950/10 px-4 py-3"
                >
                  <div className="w-full flex flex-wrap items-center gap-3">
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{n.orgName}</span>
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                      No update in 30+ days — worth a reminder
                    </span>
                  </div>
                  <NgoAgentActions ngoId={n.id} reason="QUIET" />
                  <AskNgoBox
                    ngoId={n.id}
                    ngoName={n.orgName}
                    subject="Progress update inquiry"
                  />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
