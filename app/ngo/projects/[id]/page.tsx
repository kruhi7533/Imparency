import React from "react";
import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { fundingPanelProps, resolveContractParty } from "@/lib/contract-payments";
import ContractPaymentsPanel from "@/app/donor/contracts/[id]/ContractPaymentsPanel";
import { CAN_ASSIGN } from "@/lib/field-evidence";
import FieldTasksPanel, { type PanelTask } from "./FieldTasksPanel";

export const dynamic = "force-dynamic";

/**
 * Week 6 NGO project cockpit: one funded project — its approved budget and
 * milestones, the grant contracts behind it, and where the money stands.
 *
 * Owners and team members can open it (FIELD_STAFF read-only for money); the
 * project must belong to the caller's NGO, else 404 rather than a hint that
 * the id exists.
 */
const MILESTONE_BADGE: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  PROOF_SUBMITTED: "bg-amber-100 text-amber-700",
  VERIFIED: "bg-emerald-100 text-emerald-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
};

const inr = (v: { toString(): string } | number) => `₹${Number(v.toString()).toLocaleString("en-IN")}`;

export default async function NgoProjectCockpitPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "NGO") {
    redirect(`/login?callbackUrl=/ngo/projects/${params.id}`);
  }
  const user = { id: session.user.id, role: session.user.role };

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    include: {
      milestones: { orderBy: { sequenceOrder: "asc" } },
      contracts: {
        where: { status: { in: ["ACTIVE", "COMPLETED", "PROPOSED", "UNDER_REVIEW", "DRAFT"] } },
        orderBy: { createdAt: "desc" },
        include: {
          donor: { select: { name: true, companyName: true } },
          milestones: { orderBy: { orderIndex: "asc" } },
          payments: true,
        },
      },
    },
  });
  if (!project || project.isDeleted) notFound();

  // Tenant check: the caller must be on this project's NGO.
  const party = await resolveContractParty(user, { donorId: "", ngoId: project.ngoId });
  if (!party || party.party !== "NGO") notFound();

  // Week 7: field tasks. Owners/admins see and assign all; others see their own.
  const canManage = CAN_ASSIGN.includes(party.teamRole);
  const [ngo, teamMembers, fieldTasks] = await Promise.all([
    prisma.nGOProfile.findUnique({ where: { id: project.ngoId }, select: { user: { select: { id: true, name: true } } } }),
    prisma.nGOTeamMember.findMany({ where: { ngoId: project.ngoId }, select: { role: true, user: { select: { id: true, name: true } } } }),
    prisma.fieldTask.findMany({
      where: { projectId: project.id, status: { not: "CANCELLED" }, ...(canManage ? {} : { assignedToId: user.id }) },
      orderBy: { createdAt: "desc" },
      include: {
        milestone: { select: { title: true } },
        evidence: { orderBy: { syncedAt: "desc" }, include: { feedback: true } },
      },
    }),
  ]);
  const team = [
    ...(ngo ? [{ userId: ngo.user.id, name: ngo.user.name || "Owner", role: "OWNER" }] : []),
    ...teamMembers.map((m) => ({ userId: m.user.id, name: m.user.name || "Team member", role: m.role })),
  ];
  const nameOf = new Map(team.map((m) => [m.userId, m.name]));
  const panelTasks: PanelTask[] = fieldTasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    dueDate: t.dueDate?.toISOString() ?? null,
    assigneeName: nameOf.get(t.assignedToId) ?? "Former member",
    milestoneTitle: t.milestone?.title ?? null,
    evidence: t.evidence.map((e) => ({
      id: e.id,
      status: e.status,
      note: e.note,
      locationStatus: e.locationStatus,
      distanceKm: e.distanceKm,
      // Verdict-aware: re-sending the same photo for the same milestone is not a duplicate warning.
      duplicate: e.duplicateVerdict ? e.duplicateVerdict === "REUSED_IN_PROJECT" || e.duplicateVerdict === "CROSS_PROJECT" : !!e.duplicateOfId,
      capturedAt: e.capturedAt.toISOString(),
      syncedAt: e.syncedAt.toISOString(),
      reviewNote: e.reviewNote,
      consent: e.feedback
        ? {
            feedbackId: e.feedback.id,
            consentToRecord: e.feedback.consentToRecord,
            consentToSharePhoto: e.feedback.consentToSharePhoto,
            withdrawn: !!e.feedback.withdrawnAt,
          }
        : null,
    })),
  }));

  const funded = project.contracts.filter((c) => c.status === "ACTIVE" || c.status === "COMPLETED");
  const awaitingSignature = project.contracts.filter((c) => !funded.includes(c));
  const approvedBudget = funded.reduce((sum, c) => sum + Number(c.totalGrantAmount.toString()), 0);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <Link href="/ngo/dashboard" className="text-xs font-bold text-emerald-600 hover:underline">
            ← Back to NGO Dashboard
          </Link>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{project.title}</h1>
            <span className="px-3 py-0.5 rounded-full text-xs font-extrabold bg-gray-100 text-gray-700">{project.status}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {project.location} · {project.causeCategory}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card label="Project target" value={inr(project.targetAmount)} />
          <Card label="Approved grant budget" value={inr(approvedBudget)} tone="text-emerald-600" />
          <Card label="Funded contracts" value={String(funded.length)} />
        </div>

        {/* Project milestones */}
        <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-3">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Project milestones</h2>
          {project.milestones.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No milestones on this project yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {project.milestones.map((m) => (
                <li key={m.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{m.title}</p>
                    <p className="text-xs text-gray-500">
                      {inr(m.targetAmount)} · due {m.deadline.toLocaleDateString("en-IN")}
                    </p>
                  </div>
                  <span className={`self-start px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${MILESTONE_BADGE[m.status] ?? MILESTONE_BADGE.PENDING}`}>
                    {m.status.replace("_", " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <FieldTasksPanel
          projectId={project.id}
          canManage={canManage}
          team={team}
          milestones={project.milestones.map((m) => ({ id: m.id, title: m.title }))}
          tasks={panelTasks}
        />

        {/* Funded contracts */}
        {funded.length === 0 ? (
          <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Funding</h2>
            <p className="text-xs text-gray-500 mt-1">
              No signed grant contract funds this project yet.
              {awaitingSignature.length > 0 && " A contract is waiting for signatures — see below."}
            </p>
          </section>
        ) : (
          funded.map((c) => (
            <section key={c.id} className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">{c.title}</h2>
                  <p className="text-xs text-gray-500">
                    {c.contractNumber} · funded by {c.donor.companyName || c.donor.name} · {c.status}
                  </p>
                </div>
                <Link href={`/donor/contracts/${c.id}`} className="text-xs font-bold text-emerald-600 hover:underline">
                  Full contract →
                </Link>
              </div>

              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Approved budget & milestones</h3>
                <table className="w-full text-left text-xs">
                  <thead className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                    <tr>
                      <th className="py-2">Milestone</th>
                      <th className="py-2">Due</th>
                      <th className="py-2">Budget</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {c.milestones.map((m) => (
                      <tr key={m.id}>
                        <td className="py-2 font-semibold text-gray-900 dark:text-white">{m.title}</td>
                        <td className="py-2 text-gray-500">{m.dueDate ? m.dueDate.toLocaleDateString("en-IN") : "—"}</td>
                        <td className="py-2 font-bold">{inr(m.allocatedAmount)}</td>
                        <td className="py-2 text-gray-600">{m.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ContractPaymentsPanel {...fundingPanelProps(c, party)} />
            </section>
          ))
        )}

        {awaitingSignature.length > 0 && (
          <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-2">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Contracts awaiting signature</h2>
            {awaitingSignature.map((c) => (
              <Link key={c.id} href={`/donor/contracts/${c.id}`} className="block text-xs text-emerald-600 hover:underline">
                {c.title} ({c.status}) — {inr(c.totalGrantAmount)} →
              </Link>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function Card({ label, value, tone = "text-gray-900 dark:text-white" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-2xl font-extrabold mt-1 ${tone}`}>{value}</p>
    </div>
  );
}
