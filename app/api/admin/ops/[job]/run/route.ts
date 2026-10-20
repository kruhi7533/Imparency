import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { checkRateLimit } from "@/lib/rate-limiter";
import { JOBS } from "@/lib/job-registry";

export const runtime = "nodejs";

/**
 * POST /api/admin/ops/[job]/run — "Run now" from the ops console.
 *
 * Calls the job's real cron route with CRON_SECRET, exactly as the scheduler
 * does, marked `x-job-trigger: MANUAL`. So a manual run goes through the same
 * code, the same JobRun ledger row and the same overlap lock — a run already in
 * flight comes back "skipped", not doubled. Every job is idempotent by design,
 * which is what makes a manual re-run safe.
 *
 * Only registered jobs; never an arbitrary path. Logged as JOB_RUN_MANUALLY.
 */
export async function POST(request: Request, { params }: { params: { job: string } }) {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;
  const rl = await checkRateLimit(request, "admin/ops-run", 10, 60);
  if (rl.isBlocked) return rl.response;

  const def = JOBS.find((j) => j.name === params.job);
  if (!def) return NextResponse.json({ error: "Unknown job." }, { status: 404 });
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured on this server." }, { status: 503 });

  const origin = new URL(request.url).origin;
  let status = 0;
  let body: unknown = null;
  try {
    const res = await fetch(`${origin}/api/cron/${def.name}`, {
      headers: {
        authorization: `Bearer ${secret}`,
        "x-job-trigger": "MANUAL",
        traceparent: request.headers.get("traceparent") ?? "",
      },
      cache: "no-store",
    });
    status = res.status;
    body = await res.json().catch(() => null);
  } catch (err: any) {
    return NextResponse.json({ error: `The job could not be reached: ${err?.message ?? "network error"}` }, { status: 502 });
  }

  await logAdminAction({
    adminId: auth.session.user.id,
    action: "JOB_RUN_MANUALLY",
    entityType: "JOB",
    entityId: def.name,
    newValue: { status },
    request,
  });

  return NextResponse.json({ job: def.name, status, result: body }, { status: status >= 200 && status < 300 ? 200 : 502 });
}
