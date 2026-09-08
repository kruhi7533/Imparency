import prisma from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import { RULES, isRuleKind } from "@/lib/matching/rules";
import type { CriterionResult, CriterionSpec } from "@/lib/matching/types";
import { STRANDED_AFTER_MS } from "@/lib/matching/runner";
import CandidateDecision from "./CandidateDecision";
import RequeueButton from "./RequeueButton";
import NotifyButton from "./NotifyButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One matching run.
 *
 * This is the page the whole week exists for: it must show, without the reader
 * having to trust anything, that the engine allowed one organisation and
 * rejected another, and exactly why in each case.
 *
 * Three deliberate choices:
 *  - Passes are rendered, not only failures. A verdict with no visible
 *    reasoning is a verdict nobody should act on — the same argument
 *    buildAssurances makes in lib/verification-triage.ts.
 *  - "Could not be evaluated" is its own section between eligible and rejected,
 *    never folded into rejection. Not knowing is not the same as failing.
 *  - The criteria shown come from the run's snapshot, not the live opportunity,
 *    so the stated reasons always match the rules they were produced by.
 */

const OUTCOME_STYLE: Record<string, { mark: string; className: string }> = {
  PASS: { mark: "✓", className: "text-emerald-600 dark:text-emerald-400" },
  FAIL: { mark: "✗", className: "text-red-600 dark:text-red-400" },
  UNKNOWN: { mark: "?", className: "text-amber-600 dark:text-amber-400" },
};

const DECISION_BADGE: Record<string, string> = {
  SHORTLISTED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  DISMISSED: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

function minutesSince(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / 60000);
}

export default async function MatchingJobPage({
  params,
}: {
  params: { id: string; jobId: string };
}) {
  let job;
  try {
    job = await prisma.matchingJob.findUnique({
      where: { id: params.jobId },
      select: {
        id: true,
        opportunityId: true,
        status: true,
        criteriaSnapshot: true,
        triggeredById: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        evaluatedCount: true,
        eligibleCount: true,
        ineligibleCount: true,
        unknownCount: true,
        errorMessage: true,
        opportunity: { select: { title: true, funderName: true } },
        candidates: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            ngoId: true,
            verdict: true,
            reasons: true,
            decision: true,
            decidedAt: true,
            decisionNote: true,
            ngo: {
              select: { orgName: true, verificationStatus: true, isSuspended: true },
            },
          },
        },
      },
    });
  } catch (err: any) {
    return <SchemaOutOfSync title="Matching run failed to load" detail={err?.message ?? String(err)} />;
  }

  if (!job || job.opportunityId !== params.id) notFound();

  // Which shortlisted organisations have actually been told. A shortlist that
  // never left the console is the failure mode this whole notification path
  // exists to prevent, so it must be visible on the row, not just in a log.
  const notifiedNgoIds = new Set(
    (
      await prisma.reviewThread.findMany({
        where: {
          subjectType: "NGO",
          entityType: "OPPORTUNITY",
          entityId: job.opportunityId,
          subjectId: { in: job.candidates.map((c) => c.ngoId) },
        },
        select: { subjectId: true },
      })
    ).map((t) => t.subjectId)
  );

  const snapshot = (Array.isArray(job.criteriaSnapshot) ? job.criteriaSnapshot : []) as unknown as CriterionSpec[];

  const eligible = job.candidates.filter((c) => c.verdict === "ELIGIBLE");
  const unknown = job.candidates.filter((c) => c.verdict === "UNKNOWN");
  const ineligible = job.candidates.filter((c) => c.verdict === "INELIGIBLE");

  const stranded =
    job.status === "RUNNING" && job.startedAt !== null && Date.now() - job.startedAt.getTime() > STRANDED_AFTER_MS;

  const sections: { title: string; note: string; rows: typeof job.candidates; tone: string }[] = [
    {
      title: `Eligible (${eligible.length})`,
      note: "Meets every required criterion this opportunity declares.",
      rows: eligible,
      tone: "border-emerald-200 dark:border-emerald-900",
    },
    {
      title: `Could not be evaluated (${unknown.length})`,
      note: "Something the criteria depend on is missing or has never been checked. This is not a rejection.",
      rows: unknown,
      tone: "border-amber-200 dark:border-amber-900",
    },
    {
      title: `Not eligible (${ineligible.length})`,
      note: "Fails at least one required criterion. Not a judgement about the organisation, only about this opportunity.",
      rows: ineligible,
      tone: "border-gray-200 dark:border-gray-800",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          href={`/admin/opportunities/${params.id}`}
          className="text-xs font-semibold text-gray-500 hover:text-emerald-600"
        >
          ← {job.opportunity.title}
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Matching run</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 tabular-nums">
              {job.evaluatedCount} evaluated · {job.eligibleCount} eligible · {job.ineligibleCount} not
              eligible · {job.unknownCount} could not be evaluated
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-600">
              Started {job.startedAt ? job.startedAt.toISOString().replace("T", " ").slice(0, 19) : "—"}
              {job.finishedAt && job.startedAt
                ? ` · took ${Math.max(1, Math.round((job.finishedAt.getTime() - job.startedAt.getTime()) / 1000))}s`
                : ""}
            </p>
          </div>
          <span
            className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
              job.status === "COMPLETED"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                : job.status === "FAILED"
                  ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
            }`}
          >
            {job.status}
          </span>
        </div>

        {job.status === "FAILED" && job.errorMessage && (
          <div className="mt-5 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 p-4">
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">This run did not finish.</p>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">{job.errorMessage}</p>
            <div className="mt-3">
              <RequeueButton jobId={job.id} label="Run again" />
            </div>
          </div>
        )}

        {stranded && (
          <div className="mt-5 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-4">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">
              Running for {minutesSince(job.startedAt!)} minutes.
            </p>
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
              A run this long has almost certainly been interrupted. Requeueing is safe — results
              upsert, and any shortlisting you have already done is preserved.
            </p>
            <div className="mt-3">
              <RequeueButton jobId={job.id} label="Requeue" />
            </div>
          </div>
        )}

        {job.status === "COMPLETED" && (
          <div className="mt-5">
            <RequeueButton jobId={job.id} label="Re-run this job" />
          </div>
        )}

        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Criteria this run evaluated
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
            Frozen when the run started, so these always match the reasons below — even if the
            opportunity has been edited since.
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
            Only verified, unsuspended organisations are considered at all. One that is still
            pending will not appear here — it belongs in{" "}
            <Link href="/admin/verification" className="text-emerald-600 hover:underline">
              Verification
            </Link>{" "}
            until it is approved.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {snapshot.map((c, i) => (
              <span
                key={`${c.kind}-${i}`}
                className="rounded-full border border-gray-200 dark:border-gray-700 px-3 py-1 text-xs font-semibold text-gray-600 dark:text-gray-300"
              >
                {isRuleKind(c.kind) ? RULES[c.kind].label : c.kind}
                {c.value ? `: ${c.value}` : ""}
                {c.values?.length ? `: ${c.values.join(", ")}` : ""}
                {!c.required ? " (preferred)" : ""}
              </span>
            ))}
            {snapshot.length === 0 && (
              <span className="text-sm text-gray-500 dark:text-gray-400">No criteria were recorded for this run.</span>
            )}
          </div>
        </section>

        {sections.map((section) => (
          <section key={section.title} className="mt-10">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {section.title}
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">{section.note}</p>

            <div className="mt-3 space-y-3">
              {section.rows.map((c) => {
                const reasons = (Array.isArray(c.reasons) ? c.reasons : []) as unknown as CriterionResult[];
                return (
                  <div
                    key={c.id}
                    className={`rounded-xl border ${section.tone} bg-white dark:bg-gray-900 p-4`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <Link
                        href={`/admin/ngos/${c.ngoId}`}
                        className="text-sm font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                      >
                        {c.ngo.orgName}
                      </Link>
                      {c.decision !== "PROPOSED" && (
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${DECISION_BADGE[c.decision] ?? ""}`}>
                          {c.decision}
                        </span>
                      )}
                    </div>

                    {(c.ngo.verificationStatus !== "VERIFIED" || c.ngo.isSuspended) && (
                      // Only verified organisations are matched, so this can
                      // only be a candidate decided earlier whose standing has
                      // since changed — or one decided before that rule existed.
                      // Its decision is kept (a person made it) but it must not
                      // sit on a funder's shortlist unremarked.
                      <p className="mt-2 rounded-lg bg-red-50 dark:bg-red-950/20 px-3 py-2 text-xs font-semibold text-red-700 dark:text-red-400">
                        This organisation is{" "}
                        {c.ngo.isSuspended ? "suspended" : c.ngo.verificationStatus.toLowerCase()} and
                        would not be matched today. It cannot receive funding in this state — review
                        it in Verification, or dismiss it from this shortlist.
                      </p>
                    )}

                    <ul className="mt-3 space-y-1.5">
                      {reasons.map((r, i) => {
                        const style = OUTCOME_STYLE[r.outcome] ?? OUTCOME_STYLE.UNKNOWN;
                        return (
                          <li key={`${r.code}-${i}`} className="flex gap-2 text-sm">
                            <span className={`font-bold ${style.className}`}>{style.mark}</span>
                            <span className="text-gray-700 dark:text-gray-300">
                              <span className="font-semibold">{r.label}</span>
                              {!r.required && (
                                <span className="text-gray-400 dark:text-gray-600"> (preferred)</span>
                              )}
                              {" — "}
                              {r.detail}
                            </span>
                          </li>
                        );
                      })}
                      {reasons.length === 0 && (
                        <li className="text-sm text-gray-500 dark:text-gray-400">
                          No criteria were evaluated for this organisation.
                        </li>
                      )}
                    </ul>

                    {c.decision === "PROPOSED" ? (
                      <CandidateDecision candidateId={c.id} verdict={c.verdict} />
                    ) : (
                      <div className="mt-3">
                        <p className="text-xs text-gray-500 dark:text-gray-500">
                          Decided {c.decidedAt ? c.decidedAt.toISOString().slice(0, 10) : ""}
                          {c.decisionNote ? ` — ${c.decisionNote}` : ""}
                        </p>
                        {c.decision === "SHORTLISTED" &&
                          (notifiedNgoIds.has(c.ngoId) ? (
                            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                              Organisation notified — it can reply on the inquiry thread.
                            </p>
                          ) : (
                            <NotifyButton candidateId={c.id} />
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {section.rows.length === 0 && (
                <p className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-600">
                  None.
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
