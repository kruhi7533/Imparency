import prisma from "@/lib/prisma";
import ProofReviewClient from "./ProofReviewClient";
import { findEvidenceCandidates, verdictsForQueuedProofs } from "@/lib/evidence-duplicates";
import type { DuplicateResult } from "@/lib/proof-fingerprint";

export const runtime = "nodejs";

/**
 * How much decision history this page carries.
 *
 * The audit query used to be unbounded: every MilestoneReview ever written,
 * with four levels of include, on every page load — a query with no ceiling
 * that gets slower for the rest of the platform's life. The Today page already
 * took this lesson (project completions are windowed to 30 days).
 *
 * The window is SURFACED in the UI rather than applied silently. An audit
 * trail that quietly stops short is worse than no audit trail, because a
 * reviewer who scrolls to the bottom and sees nothing concludes nothing
 * happened. The complete, filterable, exportable history lives at
 * `/admin/audit`, which is where the page points.
 */
const AUDIT_WINDOW_DAYS = 90;
const AUDIT_PAGE_SIZE = 100;

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

  // Recent review decisions, newest first — see AUDIT_WINDOW_DAYS above.
  const auditWindowStart = new Date(Date.now() - AUDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const auditRecords = await prisma.milestoneReview.findMany({
    where: { reviewedAt: { gte: auditWindowStart } },
    // One more than the page size, so the client can tell "exactly 100
    // decisions happened" from "there are more than these 100" without a
    // second count query.
    take: AUDIT_PAGE_SIZE + 1,
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

  // Duplicate verdicts for every queued proof (SPEC-2.3): one batched lookup
  // over both evidence tables, classified per proof. Best-effort — if it
  // fails, the queue still renders and every proof reads "not fingerprinted"
  // rather than clean.
  let verdicts: Record<string, DuplicateResult> = {};
  try {
    const queued = pendingMilestones.flatMap((m) =>
      m.proofs.map((p) => ({
        id: p.id,
        milestoneId: m.id,
        projectId: m.projectId,
        ngoId: m.project.ngoId,
        contentHashes: p.contentHashes ?? [],
      })),
    );
    const candidates = await findEvidenceCandidates(queued.flatMap((q) => q.contentHashes));
    verdicts = verdictsForQueuedProofs(queued, candidates);
  } catch (err) {
    console.error("[admin/proof-review] duplicate verdicts unavailable:", err);
  }

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
    proofs: m.proofs.map((p) => {
      const v = verdicts[p.id];
      const first = v?.matches[0];
      return {
        ...p,
        submittedAt: p.submittedAt.toISOString(),
        duplicate: v
          ? {
              verdict: v.verdict,
              ref: first
                ? `${first.source === "FIELD_EVIDENCE" ? "field evidence" : "proof"} for "${first.milestoneTitle}"`
                : null,
              others: Math.max(0, v.matches.length - 1),
            }
          : null,
      };
    }),
  }));

  // The extra row fetched above is the "there is more" signal, not a row to
  // render — drop it before serialising.
  const auditTruncated = auditRecords.length > AUDIT_PAGE_SIZE;
  const serializedAudit = auditRecords.slice(0, AUDIT_PAGE_SIZE).map((r) => ({
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
          auditWindowDays={AUDIT_WINDOW_DAYS}
          auditTruncated={auditTruncated}
        />
      </main>
    </div>
  );
}
