import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ai-telemetry?site=&outcome=&limit= — AI-009. Recent model
 * calls recorded by lib/ai/telemetry.ts: site, model, prompt version, latency,
 * tokens, cost estimate, outcome. Metadata only — no prompt or response text.
 */
export async function GET(request: Request) {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;

  const sp = new URL(request.url).searchParams;
  const site = sp.get("site")?.trim() || undefined;
  const outcomeRaw = sp.get("outcome")?.trim().toUpperCase();
  const outcome = outcomeRaw && ["OK", "ERROR", "TIMEOUT"].includes(outcomeRaw) ? outcomeRaw : undefined;
  const limit = Math.min(500, Math.max(1, Number(sp.get("limit")) || 100));

  const runs = await prisma.aiCallLog.findMany({
    where: { ...(site ? { site } : {}), ...(outcome ? { outcome } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json({
    runs: runs.map((r) => ({ ...r, costUsd: r.costUsd === null ? null : r.costUsd.toString() })),
  });
}
