import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import NgoInquiriesClient from "./NgoInquiriesClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NgoInquiriesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "NGO") redirect("/unauthorized");

  const profile = await prisma.nGOProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, orgName: true, isSuspended: true, suspensionReason: true },
  });
  const ngoId = profile?.id ?? (session.user as any).ngoProfileId ?? null;
  if (!ngoId) redirect("/ngo/register");

  const [threads, donorInquiries] = await Promise.all([
    prisma.reviewThread.findMany({
      where: { subjectType: "NGO", subjectId: ngoId },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { messages: { orderBy: { createdAt: "asc" } } },
    }),
    prisma.donorInquiry.findMany({
      where: { ngoId },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        donor: { select: { name: true, email: true, totalDonated: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    }),
  ]);

  const serialized = threads.map((t) => ({
    id: t.id,
    kind: t.kind,
    subject: t.subject,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    messages: t.messages.map((m) => ({
      id: m.id,
      authorRole: m.authorRole,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  }));

  const serializedDonorInquiries = donorInquiries.map((t) => ({
    id: t.id,
    donorName: t.donor.name || "Anonymous",
    donorEmail: t.donor.email,
    donorTotalDonated: Number(t.donor.totalDonated),
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    messages: t.messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      senderRole: m.senderRole as "DONOR" | "NGO",
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  }));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Inquiries &amp; Appeals</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Questions from the admin team and direct inquiries from your donors.
        </p>

        {profile?.isSuspended && (
          <div className="mt-6 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-5 py-4">
            <p className="text-sm font-bold text-red-700 dark:text-red-300">Your NGO is currently suspended.</p>
            {profile.suspensionReason && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">Reason: {profile.suspensionReason}</p>
            )}
            <p className="mt-1 text-xs text-red-500 dark:text-red-400">
              If you believe this is a mistake, open an appeal below — it goes directly to the reviewing team.
            </p>
          </div>
        )}

        <div className="mt-8">
          <NgoInquiriesClient 
            initialThreads={serialized} 
            initialDonorInquiries={serializedDonorInquiries}
          />
        </div>
      </div>
    </div>
  );
}
