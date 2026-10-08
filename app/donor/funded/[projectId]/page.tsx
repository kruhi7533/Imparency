import React from "react";
import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { fundingSummary } from "@/lib/contract-payments";
import { DONOR_VISIBLE_EVIDENCE_WHERE } from "@/lib/field-evidence";
import ProjectUpdatesToggle from "./ProjectUpdatesToggle";

export const dynamic = "force-dynamic";

/**
 * Week 7 donor view of a funded project: milestone progress, the donor's own
 * contract funding, and ONLY approved + consented field evidence.
 *
 * Access: the donor must fund this project through an ACTIVE or COMPLETED
 * contract. Anyone else gets 404. The evidence list uses
 * DONOR_VISIBLE_EVIDENCE_WHERE — the same rule the photo route enforces — so
 * the page can never list a photo the photo route would then refuse.
 */
const MILESTONE_STYLE: Record<string, { cls: string; label: string }> = {
  PENDING: { cls: "bg-gray-100 text-gray-600", label: "Not started" },
  IN_PROGRESS: { cls: "bg-blue-100 text-blue-700", label: "In progress" },
  PROOF_SUBMITTED: { cls: "bg-amber-100 text-amber-700", label: "Under verification" },
  VERIFIED: { cls: "bg-emerald-100 text-emerald-700", label: "Verified" },
  COMPLETED: { cls: "bg-emerald-100 text-emerald-700", label: "Completed" },
};
const DONE = new Set(["VERIFIED", "COMPLETED"]);
const inr = (v: { toString(): string } | number) => `₹${Number(v.toString()).toLocaleString("en-IN")}`;

export default async function DonorFundedProjectPage({ params }: { params: { projectId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "DONOR") redirect(`/login?callbackUrl=/donor/funded/${params.projectId}`);
  const donorId = session.user.id;

  const contracts = await prisma.contract.findMany({
    where: { donorId, projectId: params.projectId, status: { in: ["ACTIVE", "COMPLETED"] } },
    orderBy: { createdAt: "asc" },
    include: { milestones: { orderBy: { orderIndex: "asc" } }, payments: true },
  });
  if (contracts.length === 0) notFound();

  const [project, evidence, prefs] = await Promise.all([
    prisma.project.findUnique({
      where: { id: params.projectId },
      include: {
        ngo: { select: { orgName: true } },
        milestones: { orderBy: { sequenceOrder: "asc" } },
      },
    }),
    prisma.fieldEvidence.findMany({
      where: { projectId: params.projectId, ...DONOR_VISIBLE_EVIDENCE_WHERE },
      orderBy: { reviewedAt: "desc" },
      take: 60,
      select: {
        id: true,
        note: true,
        capturedAt: true,
        reviewedAt: true,
        locationStatus: true,
        task: { select: { title: true, milestone: { select: { title: true } } } },
      },
    }),
    prisma.user.findUnique({ where: { id: donorId }, select: { projectUpdatesOptOut: true } }),
  ]);
  if (!project) notFound();

  const done = project.milestones.filter((m) => DONE.has(m.status)).length;
  const pct = project.milestones.length ? Math.round((done / project.milestones.length) * 100) : 0;

  // Updates: verified milestones and approved evidence, newest first.
  const updates = [
    ...project.milestones
      .filter((m) => DONE.has(m.status))
      .map((m) => ({ at: m.updatedAt, text: `Milestone verified: ${m.title}` })),
    ...evidence
      .filter((e) => e.reviewedAt)
      .map((e) => ({ at: e.reviewedAt!, text: `Verified field update: ${e.task.title}` })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 10);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <Link href="/donor/contracts" className="text-xs font-bold text-emerald-600 hover:underline">
            ← Back to contracts
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{project.title}</h1>
          <p className="text-sm text-gray-500">
            {project.ngo.orgName} · {project.location}
          </p>
          <div className="mt-2">
            <ProjectUpdatesToggle initialOn={!prefs?.projectUpdatesOptOut} />
          </div>
        </div>

        {/* Milestone progress */}
        <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Milestone progress</h2>
            <span className="text-sm font-bold text-emerald-600">
              {done} of {project.milestones.length} verified
            </span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
          <ol className="space-y-2">
            {project.milestones.map((m, i) => {
              const style = MILESTONE_STYLE[m.status] ?? MILESTONE_STYLE.PENDING;
              return (
                <li key={m.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-sm">
                  <span className="text-gray-800 dark:text-gray-200">
                    <span className="text-gray-400 mr-2">{i + 1}.</span>
                    {m.title}
                    <span className="text-xs text-gray-400 ml-2">due {m.deadline.toLocaleDateString("en-IN")}</span>
                  </span>
                  <span className={`self-start px-2.5 py-0.5 rounded-full text-[11px] font-bold ${style.cls}`}>{style.label}</span>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Your funding */}
        {contracts.map((c) => {
          const s = fundingSummary(c, c.milestones, c.payments);
          return (
            <section key={c.id} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <h2 className="text-base font-bold text-gray-900 dark:text-white">Your grant · {c.contractNumber}</h2>
                <Link href={`/donor/contracts/${c.id}`} className="text-xs font-bold text-emerald-600 hover:underline">
                  Contract & payments →
                </Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400 font-bold">Committed</p>
                  <p className="font-extrabold">{inr(s.committed)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-bold">Reconciled</p>
                  <p className="font-extrabold text-emerald-600">{inr(s.reconciled)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-bold">Awaiting NGO confirmation</p>
                  <p className="font-extrabold text-amber-600">{inr(s.pending)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-bold">Contract milestones released</p>
                  <p className="font-extrabold">
                    {c.milestones.filter((m) => m.status === "DISBURSED").length} / {c.milestones.length}
                  </p>
                </div>
              </div>
            </section>
          );
        })}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Verified evidence */}
          <section className="lg:col-span-2 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-3">
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">Verified field evidence</h2>
              <p className="text-xs text-gray-500">
                Only photos approved by a reviewer — and, where people are shown, shared with their consent.
              </p>
            </div>
            {evidence.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No verified evidence yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {evidence.map((e) => (
                  <figure key={e.id} className="rounded-xl overflow-hidden border border-gray-100 dark:border-gray-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/field/evidence/${e.id}/photo`} alt={e.task.title} className="w-full h-48 object-cover" loading="lazy" />
                    <figcaption className="p-3 text-xs space-y-1">
                      <p className="font-bold text-gray-900 dark:text-white">{e.task.title}</p>
                      {e.task.milestone && <p className="text-emerald-700">{e.task.milestone.title}</p>}
                      {e.note && <p className="text-gray-600 dark:text-gray-300">{e.note}</p>}
                      <p className="text-gray-400">
                        Captured {e.capturedAt.toLocaleDateString("en-IN")}
                        {e.locationStatus === "MATCH" ? " · location verified" : ""}
                      </p>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>

          {/* Updates */}
          <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-3">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Latest updates</h2>
            <p className="text-xs text-gray-500">You are also notified in the app when these happen.</p>
            {updates.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No updates yet.</p>
            ) : (
              <ul className="space-y-2">
                {updates.map((u, i) => (
                  <li key={i} className="text-xs">
                    <p className="text-gray-800 dark:text-gray-200">{u.text}</p>
                    <p className="text-gray-400">{u.at.toLocaleDateString("en-IN")}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
