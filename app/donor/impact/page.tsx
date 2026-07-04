import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import ImpactFeedClient from "./ImpactFeedClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DonorImpactPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "DONOR") redirect("/unauthorized");
  const donorId = session.user.id;

  const subscriptions = await prisma.impactSubscription.findMany({
    where: { donorId },
    orderBy: { createdAt: "desc" },
  });
  const projectIds = subscriptions.map((s) => s.projectId);

  const [projects, events] = await Promise.all([
    projectIds.length
      ? prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, title: true, ngo: { select: { orgName: true } } },
        })
      : [],
    projectIds.length
      ? prisma.projectImpactEvent.findMany({
          where: { projectId: { in: projectIds } },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : [],
  ]);
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  // Read tracking: viewing the feed marks this donor's IN_APP deliveries READ.
  if (events.length > 0) {
    prisma.impactDelivery
      .updateMany({
        where: {
          donorId,
          channel: "IN_APP",
          status: "SENT",
          eventId: { in: events.map((e) => e.id) },
        },
        data: { status: "READ", readAt: new Date() },
      })
      .catch((err) => console.error("Failed to mark impact deliveries read:", err));
  }

  return (
    <ImpactFeedClient
      events={events.map((e) => ({
        id: e.id,
        type: e.type,
        title: e.title,
        body: e.body,
        createdAt: e.createdAt.toISOString(),
        projectTitle: projectMap.get(e.projectId)?.title ?? "Unknown project",
        ngoName: projectMap.get(e.projectId)?.ngo.orgName ?? "",
        mediaUrls: Array.isArray((e.payload as any)?.mediaUrls) ? ((e.payload as any).mediaUrls as string[]) : [],
      }))}
      subscriptions={subscriptions.map((s) => ({
        projectId: s.projectId,
        projectTitle: projectMap.get(s.projectId)?.title ?? "Unknown project",
        channels: s.channels,
        frequency: s.frequency,
        active: s.active,
      }))}
    />
  );
}
