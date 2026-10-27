import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { deadLetterSource } from "@/lib/dead-letter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/dead-letters/[id] — inspect one entry and its source row (ids/statuses only). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;
  const item = await prisma.deadLetter.findUnique({ where: { id: params.id } });
  if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const source = await deadLetterSource(item.kind, item.sourceId);
  return NextResponse.json({ item, source });
}
