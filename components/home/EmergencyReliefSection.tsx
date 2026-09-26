import prisma from "@/lib/prisma";
import Link from "next/link";
import CrisisCard from "@/components/crisis/CrisisCard";

async function loadActiveCrisisEvents() {
  return prisma.crisisEvent.findMany({
    where: { status: "ACTIVE", verificationStatus: "VERIFIED", isArchived: false },
    select: {
      id: true, title: true, slug: true, disasterType: true, severity: true,
      affectedLocation: true, coverImage: true, status: true, isFeatured: true,
      totalRaised: true, totalDonors: true, totalNgos: true, totalCampaigns: true,
      expectedEndDate: true,
    },
    orderBy: [{ isFeatured: "desc" }, { startDate: "desc" }],
    take: 4,
  });
}

export default async function EmergencyReliefSection() {
  let events: Awaited<ReturnType<typeof loadActiveCrisisEvents>> = [];
  try {
    events = await loadActiveCrisisEvents();
  } catch (err) {
    // This section sits on the homepage — a DB hiccup here must never take
    // down the whole page (mirrors the nav-badge guard in admin/layout.tsx).
    console.error("[EmergencyReliefSection] failed to load active crises:", err);
    return null;
  }

  // Only active, verified events should ever appear here — if there are none
  // right now, the section simply doesn't render (no empty-state clutter on
  // the homepage for something that isn't currently happening).
  if (events.length === 0) return null;

  const serialized = events.map((e) => ({
    ...e,
    totalRaised: Number(e.totalRaised),
    expectedEndDate: e.expectedEndDate ? e.expectedEndDate.toISOString() : null,
  }));

  const [featured, ...rest] = serialized;

  return (
    <section id="emergency-relief" className="border-y border-red-900/40 bg-gradient-to-b from-red-950/25 via-gray-950 to-gray-950 py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-10">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 bg-red-600 text-white text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> Emergency Relief
            </span>
          </div>
          {rest.length > 0 && (
            <Link href="/crisis" className="text-red-300 hover:text-red-200 font-bold text-sm flex items-center gap-1">
              See all active crises <span>→</span>
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <CrisisCard event={featured} large />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-6">
            {rest.slice(0, 2).map((e, i) => (
              <CrisisCard key={e.id} event={e} index={i + 1} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
