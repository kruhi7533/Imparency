import prisma from "@/lib/prisma";
import CrisisListClient from "./CrisisListClient";

export const runtime = "nodejs";

export default async function AdminCrisisPage() {
  const events = await prisma.crisisEvent.findMany({
    select: {
      id: true, title: true, slug: true, disasterType: true, severity: true,
      status: true, verificationStatus: true, isFeatured: true, isArchived: true,
      coverImage: true, totalRaised: true, totalDonors: true, totalCampaigns: true, totalNgos: true,
      startDate: true, expectedEndDate: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const serialized = events.map((e) => ({
    ...e,
    totalRaised: Number(e.totalRaised),
    startDate: e.startDate.toISOString(),
    expectedEndDate: e.expectedEndDate ? e.expectedEndDate.toISOString() : null,
    createdAt: e.createdAt.toISOString(),
  }));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Emergency Crisis Relief</h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Create and verify disaster-response events. Only verified, active events appear on the public homepage.
            </p>
          </div>
          <a
            href="/admin/crisis/new"
            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-5 rounded-xl text-sm transition shadow-sm"
          >
            + New Crisis Event
          </a>
        </div>

        <CrisisListClient initialEvents={serialized} />
      </main>
    </div>
  );
}
