/**
 * Seed one SUBMITTED outcome claim so /admin/impact-review has something real
 * to judge.
 *
 *   npx tsx -r dotenv/config tools/seed-week8-demo.ts            # dry run
 *   npx tsx -r dotenv/config tools/seed-week8-demo.ts -- --apply
 *
 * Follows the same two house rules as tools/../scripts/seed-week7-demo.ts:
 *
 * 1. It REFUSES rather than fabricates. No invented NGO, project, metric or
 *    proof — it uses real rows or stops. A demo standing on fabricated
 *    prerequisites proves nothing about the platform.
 * 2. The TRIAGE VERDICT IS NOT WRITTEN BY HAND. It is computed by the real
 *    lib/outcome-triage.ts over the real citation, and only printed. If the
 *    judgement logic is wrong, this seed reports the wrong verdict — which is
 *    the correct outcome, because a hand-written verdict would be evidence of
 *    a check that never ran.
 *
 * Everything it creates is tagged [DEMO] in the `method` text. On a
 * transparency platform, a seeded number indistinguishable from a reported one
 * is its own small version of the problem the product exists to solve.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const TAG = "[DEMO]";

async function main() {
  console.log(APPLY ? "APPLYING\n" : "DRY RUN — nothing will be written. Pass --apply.\n");

  // ---- prerequisites, or refuse -------------------------------------------
  const metric = await prisma.metricDefinition.findFirst({
    where: { status: "ACTIVE", requiredEvidence: { has: "MILESTONE_PROOF" } },
    select: { code: true, name: true, unit: true, status: true, requiredEvidence: true },
  });
  if (!metric) {
    console.error(
      "REFUSING: no ACTIVE metric requiring MILESTONE_PROOF exists. Run tools/seed-metric-registry.ts first."
    );
    process.exitCode = 1;
    return;
  }

  const proof = await prisma.milestoneProof.findFirst({
    orderBy: { submittedAt: "desc" },
    select: {
      id: true,
      submittedAt: true,
      milestone: {
        select: {
          id: true,
          title: true,
          projectId: true,
          project: { select: { id: true, title: true, ngoId: true, ngo: { select: { orgName: true } } } },
          reviews: { where: { action: "APPROVED" }, select: { id: true }, take: 1 },
        },
      },
    },
  });
  if (!proof) {
    console.error("REFUSING: no milestone proof exists. Nothing could be cited as evidence.");
    process.exitCode = 1;
    return;
  }

  const project = proof.milestone.project;
  const proofApproved = proof.milestone.reviews.length > 0;

  console.log(`Organisation : ${project.ngo.orgName}`);
  console.log(`Project      : ${project.title}`);
  console.log(`Metric       : ${metric.code} — "${metric.name}" (${metric.unit})`);
  console.log(`Citing proof : ${proof.id} on "${proof.milestone.title}"`);
  console.log(`             : milestone review APPROVED? ${proofApproved ? "yes" : "NO"}`);
  console.log();

  const existing = await prisma.outcomeClaim.findFirst({
    where: { projectId: project.id, metricCode: metric.code, method: { startsWith: TAG } },
    select: { id: true, status: true },
  });
  if (existing) {
    console.log(`Claim : already seeded (${existing.id}, ${existing.status}) — skipping.`);
  }

  const claimId = existing?.id;

  if (!existing && APPLY) {
    const created = await prisma.outcomeClaim.create({
      data: {
        ngoId: project.ngoId,
        projectId: project.id,
        milestoneId: proof.milestone.id,
        metricCode: metric.code,
        value: "40",
        unit: metric.unit,
        periodStart: new Date("2026-09-01"),
        periodEnd: new Date("2026-09-30"),
        method: `${TAG} Seeded claim. Attendance registers from each centre, de-duplicated by name.`,
        status: "SUBMITTED",
        submittedAt: new Date(),
        citations: { create: [{ kind: "MILESTONE_PROOF", proofId: proof.id }] },
      },
      select: { id: true },
    });
    console.log(`Claim : created ${created.id} (SUBMITTED, 40 ${metric.unit}, citing 1 proof)`);
  } else if (!existing) {
    console.log(`Claim : would create one for 40 ${metric.unit} citing proof ${proof.id}`);
  }

  // ---- the verdict, through the REAL triage --------------------------------
  const { triageOutcomeClaim } = await import("../lib/outcome-triage");
  const { resolveCitations, evidenceAlreadyCounted } = await import("../lib/outcome-evidence");

  const citations = claimId
    ? await prisma.outcomeClaimEvidence.findMany({
        where: { claimId },
        select: { id: true, kind: true, proofId: true, evidenceId: true, feedbackId: true },
      })
    : [{ id: "(unsaved)", kind: "MILESTONE_PROOF" as const, proofId: proof.id, evidenceId: null, feedbackId: null }];

  const triage = triageOutcomeClaim({
    claim: {
      id: claimId ?? "(unsaved)",
      value: "40",
      unit: metric.unit,
      periodStart: new Date("2026-09-01"),
      periodEnd: new Date("2026-09-30"),
    },
    metric,
    citations: await resolveCitations(citations),
    evidenceCitedByApprovedClaims: await evidenceAlreadyCounted(metric.code, claimId ?? "(unsaved)"),
  });

  console.log(`\nTriage verdict : ${triage.verdict}`);
  for (const f of triage.findings) console.log(`   [${f.severity}] ${f.code} — ${f.message}`);
  if (triage.findings.length === 0) console.log("   (no findings — every check passed)");

  console.log(
    `\n${APPLY ? "Done" : "Dry run complete"}. Check /admin/impact-review — the claim should read "${
      triage.verdict === "BLOCKED"
        ? "Cannot be approved"
        : triage.verdict === "NEEDS_REVIEW"
          ? "Needs your judgement"
          : "Evidence checks passed"
    }".`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
