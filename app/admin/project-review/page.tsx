import prisma from "@/lib/prisma";
import ProjectReviewClient from "./ProjectReviewClient";

export const runtime = "nodejs";

export default async function AdminProjectReviewPage() {
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
