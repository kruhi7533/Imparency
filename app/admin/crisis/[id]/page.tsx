import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import CrisisDetailClient from "./CrisisDetailClient";

export const runtime = "nodejs";

export default async function AdminCrisisDetailPage({ params }: { params: { id: string } }) {
  const event = await prisma.crisisEvent.findUnique({
    where: { id: params.id },
    include: {
      createdBy: { select: { name: true, email: true } },
      participants: { include: { ngo: { select: { id: true, orgName: true } } } },
      _count: { select: { initiatives: true, donations: true, updates: true } },
    },
  });

  if (!event) notFound();

  const serialized = {
    ...event,
    totalRaised: Number(event.totalRaised),
    latitude: event.latitude,
    longitude: event.longitude,
    startDate: event.startDate.toISOString(),
    expectedEndDate: event.expectedEndDate ? event.expectedEndDate.toISOString() : null,
    verifiedAt: event.verifiedAt ? event.verifiedAt.toISOString() : null,
    closedAt: event.closedAt ? event.closedAt.toISOString() : null,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    participants: event.participants.map((p) => ({
      id: p.id,
      ngoId: p.ngo.id,
      orgName: p.ngo.orgName,
      joinedAt: p.joinedAt.toISOString(),
    })),
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <a href="/admin/crisis" className="text-xs text-gray-400 hover:text-emerald-600 font-semibold">← Back to Crisis Events</a>
        <CrisisDetailClient event={serialized as any} />
      </main>
    </div>
  );
}
