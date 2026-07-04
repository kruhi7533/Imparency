import prisma from "@/lib/prisma";
import InquiriesClient from "./InquiriesClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminInquiriesPage() {
  // Role guard is enforced by middleware (/admin/*) + the thread APIs.
  const threads = await prisma.reviewThread.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  // Resolve subject display names (NGO org names / donor names)
  const ngoIds = threads.filter((t) => t.subjectType === "NGO").map((t) => t.subjectId);
  const donorIds = threads.filter((t) => t.subjectType === "DONOR").map((t) => t.subjectId);
  const [ngos, donors] = await Promise.all([
    ngoIds.length
      ? prisma.nGOProfile.findMany({ where: { id: { in: ngoIds } }, select: { id: true, orgName: true } })
      : [],
    donorIds.length
      ? prisma.user.findMany({ where: { id: { in: donorIds } }, select: { id: true, name: true } })
      : [],
  ]);
  const nameMap = new Map<string, string>([
    ...ngos.map((n) => [n.id, n.orgName] as [string, string]),
    ...donors.map((d) => [d.id, d.name] as [string, string]),
  ]);

  const serialized = threads.map((t) => ({
    id: t.id,
    kind: t.kind,
    subject: t.subject,
    entityType: t.entityType,
    entityId: t.entityId,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    subjectType: t.subjectType,
    subjectName: nameMap.get(t.subjectId) ?? "Unknown",
    messages: t.messages.map((m) => ({
      id: m.id,
      authorRole: m.authorRole,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  }));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          Inquiries &amp; Appeals
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Threaded conversations with NGOs — clarification questions you&apos;ve sent and appeals they&apos;ve raised.
        </p>
        <div className="mt-8">
          <InquiriesClient initialThreads={serialized} />
        </div>
      </div>
    </div>
  );
}
