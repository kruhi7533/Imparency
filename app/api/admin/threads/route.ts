import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";

export const runtime = "nodejs";

/** List review threads (inquiries + appeals) for the admin inbox. */
export async function GET(request: Request) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status"); // OPEN | NGO_RESPONDED | RESOLVED | null = all

    const threads = await prisma.reviewThread.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    // Resolve display names for subjects (NGO org names / donor names)
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

    return NextResponse.json({
      threads: threads.map((t) => ({ ...t, subjectName: nameMap.get(t.subjectId) ?? "Unknown" })),
    });
  } catch (err: any) {
    console.error("Error listing review threads:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
