import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import ProjectReviewClient from "./ProjectReviewClient";

export const runtime = "nodejs";

export default async function AdminProjectReviewPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  // Projects awaiting admin approval before they go live to donors.
  const pendingProjects = await prisma.project.findMany({
    where: { status: "PENDING_APPROVAL", isDeleted: false },
    include: {
      ngo: {
        include: { user: { select: { email: true } } },
      },
      milestones: { orderBy: { sequenceOrder: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Audit trail — all project review decisions, newest first.
  const auditRecords = await prisma.projectReview.findMany({
    orderBy: { reviewedAt: "desc" },
    take: 50,
    include: {
      project: { select: { title: true, ngo: { select: { orgName: true } } } },
      admin: { select: { name: true, email: true } },
    },
  });

  const serializedPending = pendingProjects.map((p) => {
    let aiScreening: {
      score: number;
      recommendation: "APPROVE" | "REVIEW" | "REJECT";
      reasoning: string;
      flags: string[];
    } | null = null;
    if (p.aiScreeningResult) {
      try {
        aiScreening = JSON.parse(p.aiScreeningResult);
      } catch {
        aiScreening = null;
      }
    }

    return {
    id: p.id,
    title: p.title,
    description: p.description,
    causeCategory: p.causeCategory,
    location: p.location,
    coverImage: p.coverImage,
    targetAmount: Number(p.targetAmount),
    problemStatement: p.problem_statement,
    expectedOutcome: p.expected_outcome,
    aiScreening,
    createdAt: p.createdAt.toISOString(),
    ngo: {
      id: p.ngo.id,
      orgName: p.ngo.orgName,
      email: p.ngo.user.email,
      healthScore: p.ngo.healthScore != null ? Number(p.ngo.healthScore) : null,
    },
    milestones: p.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      targetAmount: Number(m.targetAmount),
      deadline: m.deadline.toISOString(),
      sequenceOrder: m.sequenceOrder,
    })),
    };
  });

  const serializedAudit = auditRecords.map((r) => ({
    id: r.id,
    action: r.action,
    note: r.note,
    reviewedAt: r.reviewedAt.toISOString(),
    admin: r.admin,
    project: { title: r.project.title, orgName: r.project.ngo.orgName },
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
            <a href="/admin/project-review" className="text-emerald-600 hover:text-emerald-700 transition underline decoration-2 underline-offset-4">Project Review</a>
            <a href="/admin/proof-review" className="text-gray-500 hover:text-emerald-600 transition">Proof Review</a>
            <a href="/admin/risk-compliance" className="text-gray-500 hover:text-emerald-600 transition">Risk &amp; Compliance</a>
            <a href="/admin/fcra-review" className="text-gray-500 hover:text-emerald-600 transition">FCRA Review</a>
          </div>
          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700"></div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Administrator</span>
            <form method="POST" action="/api/auth/signout">
              <button type="submit" className="text-xs font-semibold text-gray-500 hover:text-red-500 transition">
                Logout
              </button>
            </form>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Project Approval</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Review projects submitted by verified NGOs. Approve to publish them to the donor discovery feed, or reject to return them to the NGO as a draft with a note.
          </p>
        </div>

        <ProjectReviewClient
          initialPending={serializedPending}
          initialAudit={serializedAudit}
        />
      </main>
    </div>
  );
}
