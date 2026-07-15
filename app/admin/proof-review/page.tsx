import prisma from "@/lib/prisma";
import ProofReviewClient from "./ProofReviewClient";

export const runtime = "nodejs";

export default async function AdminProofReviewPage() {
  // Fetch milestones awaiting manual review (status PROOF_SUBMITTED)
  const pendingMilestones = await prisma.milestone.findMany({
    where: { status: "PROOF_SUBMITTED" },
    include: {
      project: {
        include: {
          ngo: {
            include: {
              user: { select: { email: true } },
            },
          },
        },
      },
      proofs: {
        orderBy: { submittedAt: "desc" },
        include: {
          submittedBy: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Fetch audit trail — all review decisions, newest first
  const auditRecords = await prisma.milestoneReview.findMany({
    orderBy: { reviewedAt: "desc" },
    include: {
      milestone: {
        include: {
          project: {
            include: { ngo: true }
          }
        }
      },
      admin: {
        select: { name: true, email: true }
      }
    }
  });

  // Format the dates and decimals to prevent serialization warnings
  const serializedPending = pendingMilestones.map((m) => ({
    ...m,
    targetAmount: Number(m.targetAmount),
    deadline: m.deadline.toISOString(),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    project: {
      ...m.project,
      targetAmount: Number(m.project.targetAmount),
      raisedAmount: Number(m.project.raisedAmount),
      createdAt: m.project.createdAt.toISOString(),
      updatedAt: m.project.updatedAt.toISOString(),
      ngo: {
        ...m.project.ngo,
        healthScore: m.project.ngo.healthScore != null ? Number(m.project.ngo.healthScore) : null,
        ngoEmail: m.project.ngo.user.email,
      },
    },
    proofs: m.proofs.map((p) => ({
      ...p,
      submittedAt: p.submittedAt.toISOString(),
    })),
  }));

  const serializedAudit = auditRecords.map((r) => ({
    id: r.id,
    action: r.action,
    note: r.note,
    aiScore: r.aiScore,
    reviewedAt: r.reviewedAt.toISOString(),
    admin: r.admin,
    milestone: {
      id: r.milestone.id,
      title: r.milestone.title,
      sequenceOrder: r.milestone.sequenceOrder,
      project: {
        title: r.milestone.project.title,
        ngo: { orgName: r.milestone.project.ngo.orgName }
      }
    }
  }));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Milestone Proof Verification</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Review milestone completion evidence submitted by NGOs, inspect Gemini AI feedback audits, and approve or reject submissions.
          </p>
        </div>

        <ProofReviewClient
          initialPending={serializedPending}
          initialAudit={serializedAudit}
        />
      </main>
    </div>
  );
}
