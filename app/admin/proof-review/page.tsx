import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import ProofReviewClient from "./ProofReviewClient";

export const runtime = "nodejs";

export default async function AdminProofReviewPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  // Fetch milestones awaiting manual review (status PROOF_SUBMITTED)
  const pendingMilestones = await prisma.milestone.findMany({
    where: { status: "PROOF_SUBMITTED" },
    include: {
      project: {
        include: {
          ngo: true,
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
      {/* Navbar */}
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xl font-black text-emerald-600 tracking-tight">ImpactBridge</span>
          <span className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-full font-bold">Admin Console</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex gap-4 text-sm font-semibold">
            <a href="/admin/dashboard" className="text-gray-500 hover:text-emerald-600 transition">NGO Verification</a>
            <a href="/admin/proof-review" className="text-emerald-600 hover:text-emerald-700 transition underline decoration-2 underline-offset-4">Proof Review</a>
            <a href="/admin/fraud-alerts" className="text-gray-500 hover:text-emerald-600 transition">Fraud Alerts</a>
            <a href="/admin/fcra-review" className="text-gray-500 hover:text-emerald-600 transition">FCRA Review</a>
          </div>
          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700"></div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Administrator</span>
            <a
              href="/api/auth/signout"
              className="text-xs font-semibold text-gray-500 hover:text-red-500 transition"
            >
              Logout
            </a>
          </div>
        </div>
      </nav>

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
