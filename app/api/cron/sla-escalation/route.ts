import { NextResponse } from "next/server";
import crypto from "crypto";
import { runJob } from "@/lib/job-runner";
import { runSlaEscalation } from "@/lib/sla-escalation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Daily: tell every admin, once, which queues are past their response target (lib/sla-escalation.ts). */
export async function GET(req: Request) {
  const secret = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace("Bearer ", "");
  const expected = process.env.CRON_SECRET;
  const isAuthorized =
    !!expected &&
    !!secret &&
    secret.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected));
  if (!isAuthorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const outcome = await runJob("sla-escalation", { req }, async (job) => {
    const result = await runSlaEscalation();
    job.recordItems(result.notified);
    return NextResponse.json({ ok: true, ...result });
  });
  if (outcome.skipped) return NextResponse.json({ ok: true, skipped: true, reason: outcome.reason });
  return outcome.value;
}
