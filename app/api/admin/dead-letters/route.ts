import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { DEAD_LETTER_KINDS, DEAD_LETTER_STATUSES } from "@/lib/dead-letter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/dead-letters?status=OPEN&kind= — ADM-018 operator queue. Ids only. */
export async function GET(request: Request) {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;
  const sp = new URL(request.url).searchParams;
  const status = sp.get("status")?.toUpperCase();
  const kind = sp.get("kind")?.toUpperCase();
  const items = await prisma.deadLetter.findMany({
    where: {
      ...(status && (DEAD_LETTER_STATUSES as string[]).includes(status) ? { status } : {}),
      ...(kind && (DEAD_LETTER_KINDS as string[]).includes(kind) ? { kind } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(500, Math.max(1, Number(sp.get("limit")) || 100)),
  });
  return NextResponse.json({ items });
}
