import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — for an uptime monitor or a load balancer (roadmap row 13).
 *
 * Public by design and says nothing an attacker could use: status, whether the
 * database answered, and how long it took. No version, no hostnames, no error
 * text (that goes to logs). 200 when the app can reach its database, 503 when
 * it cannot — so "the site loads but nothing works" is visible from outside.
 * The admin-only /api/admin/diagnostics is the detailed view.
 */
export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ok", database: "up", dbLatencyMs: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[health] database check failed:", err);
    return NextResponse.json({ status: "degraded", database: "down" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
