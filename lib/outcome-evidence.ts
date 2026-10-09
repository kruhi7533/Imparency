import prisma from "@/lib/prisma";
import type { ResolvedCitation } from "@/lib/outcome-triage";

/**
 * Gathers the facts lib/outcome-triage.ts needs to judge a claim.
 *
 * Same split as lib/evidence-duplicates.ts and lib/proof-fingerprint.ts: the
 * queries live here, the decision table lives in the pure module. The triage
 * must not take a database, or the ten findings could only be tested through
 * fixtures and a mock.
 *
 * Evidence reaches the platform through three tables, and "approved" means a
 * different thing in each:
 *
 *  - MilestoneProof — approval is a MilestoneReview row with action
 *    "APPROVED". The proof row itself has no status column, so its existence
 *    is NOT approval. A proof sitting in PROOF_SUBMITTED is exactly the thing
 *    EVIDENCE_NOT_APPROVED exists to catch.
 *  - FieldEvidence — its own status enum.
 *  - BeneficiaryFeedback — has no approval of its own; it inherits from the
 *    FieldEvidence row it is attached to, because what a reviewer approved was
 *    the capture. Feedback with no linked evidence counts as unapproved rather
 *    than as approved-by-default: nobody looked at it.
 */

/** One citation row as stored, before its target is resolved. */
interface CitationRow {
  id: string;
  kind: ResolvedCitation["kind"];
  proofId: string | null;
  evidenceId: string | null;
  feedbackId: string | null;
}

/**
 * Resolves a claim's citations into the flat shape the triage reads.
 *
 * Three batched queries, never one per citation: a claim with twenty citations
 * must not become twenty round trips to Singapore (see the latency note in
 * docs/ARCHITECTURE.md — each one costs ~340ms).
 */
export async function resolveCitations(citations: CitationRow[]): Promise<ResolvedCitation[]> {
  const proofIds = citations.map((c) => c.proofId).filter((v): v is string => !!v);
  const evidenceIds = citations.map((c) => c.evidenceId).filter((v): v is string => !!v);
  const feedbackIds = citations.map((c) => c.feedbackId).filter((v): v is string => !!v);

  const [proofs, evidence, feedback] = await Promise.all([
    proofIds.length
      ? prisma.milestoneProof.findMany({
          where: { id: { in: proofIds } },
          select: {
            id: true,
            submittedAt: true,
            milestone: {
              select: { reviews: { where: { action: "APPROVED" }, select: { id: true }, take: 1 } },
            },
          },
        })
      : Promise.resolve([]),
    evidenceIds.length
      ? prisma.fieldEvidence.findMany({
          where: { id: { in: evidenceIds } },
          select: {
            id: true,
            status: true,
            capturedAt: true,
            duplicateVerdict: true,
          },
        })
      : Promise.resolve([]),
    feedbackIds.length
      ? prisma.beneficiaryFeedback.findMany({
          where: { id: { in: feedbackIds } },
          select: {
            id: true,
            capturedAt: true,
            consentToRecord: true,
            withdrawnAt: true,
            evidence: { select: { status: true, duplicateVerdict: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const proofById = new Map(proofs.map((p) => [p.id, p]));
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const feedbackById = new Map(feedback.map((f) => [f.id, f]));

  const resolved: ResolvedCitation[] = [];

  for (const c of citations) {
    if (c.proofId) {
      const p = proofById.get(c.proofId);
      resolved.push({
        citationId: c.id,
        kind: c.kind,
        evidenceRef: c.proofId,
        // A citation whose target has vanished is not approved. The FK is ON
        // DELETE CASCADE so this should be unreachable, but defaulting a
        // missing row to "approved" would turn a dangling citation into a
        // silently inflated total.
        approved: !!p && p.milestone.reviews.length > 0,
        // MilestoneProof carries contentHashes, not a stored verdict — the
        // verdict is computed at submission time and lives on FieldEvidence.
        // Null here means "no stored verdict", which the triage treats as
        // unknown, never as clean.
        duplicateVerdict: null,
        capturedAt: p?.submittedAt ?? null,
      });
      continue;
    }

    if (c.evidenceId) {
      const e = evidenceById.get(c.evidenceId);
      resolved.push({
        citationId: c.id,
        kind: c.kind,
        evidenceRef: c.evidenceId,
        approved: e?.status === "APPROVED",
        duplicateVerdict: e?.duplicateVerdict ?? null,
        capturedAt: e?.capturedAt ?? null,
      });
      continue;
    }

    if (c.feedbackId) {
      const f = feedbackById.get(c.feedbackId);
      resolved.push({
        citationId: c.id,
        kind: c.kind,
        evidenceRef: c.feedbackId,
        // Inherited from the capture a reviewer actually approved. No linked
        // evidence means nobody reviewed it.
        approved: f?.evidence?.status === "APPROVED",
        duplicateVerdict: f?.evidence?.duplicateVerdict ?? null,
        capturedAt: f?.capturedAt ?? null,
        consentToRecord: f?.consentToRecord ?? false,
        consentWithdrawn: !!f?.withdrawnAt,
      });
      continue;
    }

    // A citation naming no target at all. Impossible through the API, but it
    // must read as unapproved rather than be dropped from the list — dropping
    // it would make a malformed claim look cleaner than it is.
    resolved.push({
      citationId: c.id,
      kind: c.kind,
      evidenceRef: `(unresolved citation ${c.id})`,
      approved: false,
      duplicateVerdict: null,
      capturedAt: null,
    });
  }

  return resolved;
}

/**
 * Evidence refs already counted by an APPROVED claim on the same metric,
 * excluding the claim being judged.
 *
 * Scoped to the metric on purpose. One photograph can legitimately evidence
 * both "meals provided" and "sessions held" — two different facts about one
 * event. The same photograph evidencing "meals provided" twice is one meal
 * counted twice. Widening this to all metrics would flag the honest case and
 * teach admins to dismiss the finding.
 *
 * Only APPROVED claims are counted: evidence cited by a draft, a rejected or a
 * withdrawn claim is free to be cited again, because nothing was ever reported
 * from it.
 */
export async function evidenceAlreadyCounted(
  metricCode: string,
  excludeClaimId: string
): Promise<Set<string>> {
  const rows = await prisma.outcomeClaimEvidence.findMany({
    where: {
      claimId: { not: excludeClaimId },
      claim: { metricCode, status: "APPROVED" },
    },
    select: { proofId: true, evidenceId: true, feedbackId: true },
  });

  const refs = new Set<string>();
  for (const r of rows) {
    if (r.proofId) refs.add(r.proofId);
    if (r.evidenceId) refs.add(r.evidenceId);
    if (r.feedbackId) refs.add(r.feedbackId);
  }
  return refs;
}

export interface DoubleCountIncident {
  metricCode: string;
  evidenceRef: string;
  /** Every APPROVED claim counting this evidence on this metric. Always >= 2. */
  claimIds: string[];
}

/**
 * metricCode -> evidenceRef -> the APPROVED claims citing it.
 *
 * One query that answers the double-counting question for the WHOLE portfolio,
 * so a dashboard does not have to ask it per claim.
 *
 * This exists because the obvious implementation of /admin/impact-quality is
 * unshippable: calling `evidenceAlreadyCounted` once per claim is two round
 * trips each, and at ~340ms to Singapore (docs/ARCHITECTURE.md) a 300-claim
 * portfolio would spend three minutes on a page load. Built once here, the
 * per-claim sets below are derived in memory for free.
 */
export async function approvedCitationIndex(): Promise<Map<string, Map<string, Set<string>>>> {
  const rows = await prisma.outcomeClaimEvidence.findMany({
    where: { claim: { status: "APPROVED" } },
    select: {
      claimId: true,
      proofId: true,
      evidenceId: true,
      feedbackId: true,
      claim: { select: { metricCode: true } },
    },
  });

  const index = new Map<string, Map<string, Set<string>>>();
  for (const r of rows) {
    const ref = r.proofId ?? r.evidenceId ?? r.feedbackId;
    if (!ref) continue;
    let byRef = index.get(r.claim.metricCode);
    if (!byRef) {
      byRef = new Map<string, Set<string>>();
      index.set(r.claim.metricCode, byRef);
    }
    const existing = byRef.get(ref);
    if (existing) existing.add(r.claimId);
    else byRef.set(ref, new Set([r.claimId]));
  }
  return index;
}

/**
 * The `evidenceCitedByApprovedClaims` set for one claim, read out of the index.
 *
 * Semantically identical to `evidenceAlreadyCounted` — same metric scope, same
 * APPROVED-only rule, same self-exclusion — but with no query. The two must
 * stay in step; tests/impact-quality.test.ts pins that they agree.
 */
export function alreadyCountedFrom(
  index: Map<string, Map<string, Set<string>>>,
  metricCode: string,
  excludeClaimId: string
): Set<string> {
  const byRef = index.get(metricCode);
  if (!byRef) return new Set<string>();

  const refs = new Set<string>();
  for (const [ref, claimIds] of Array.from(byRef.entries())) {
    // Another approved claim, not this one, already counts this evidence.
    if (Array.from(claimIds).some((id) => id !== excludeClaimId)) refs.add(ref);
  }
  return refs;
}

/**
 * Evidence counted by more than one APPROVED claim on the SAME metric — the
 * double-counting incidents, portfolio-wide, for /admin/impact-quality.
 *
 * These exist by design rather than by bug. DOUBLE_COUNTED is a HIGH finding,
 * not a BLOCK, so an admin *can* approve over it — sometimes correctly, since
 * one capture may genuinely document two separate distributions. Every row here
 * is therefore a human override, which is what a defect dashboard should show:
 * not "the system failed" but "a person decided this twice, and here are both
 * claims".
 *
 * Scoped to the metric for the reason written up in `evidenceAlreadyCounted`:
 * one photograph evidencing both "meals provided" and "sessions held" is two
 * facts about one event, not a double count.
 *
 * Pure, over the index — `limit` caps only what is rendered, never what is
 * counted, so the headline figure cannot be quietly truncated.
 */
export function incidentsFromIndex(
  index: Map<string, Map<string, Set<string>>>,
  limit = 50
): DoubleCountIncident[] {
  const incidents: DoubleCountIncident[] = [];
  for (const [metricCode, byRef] of Array.from(index.entries())) {
    for (const [evidenceRef, claimIds] of Array.from(byRef.entries())) {
      if (claimIds.size < 2) continue;
      incidents.push({ metricCode, evidenceRef, claimIds: Array.from(claimIds) });
    }
  }

  return incidents
    .sort(
      (a, b) =>
        b.claimIds.length - a.claimIds.length ||
        a.metricCode.localeCompare(b.metricCode) ||
        a.evidenceRef.localeCompare(b.evidenceRef)
    )
    .slice(0, limit);
}

/** The two steps above together, for a caller that needs nothing else. */
export async function findDoubleCountIncidents(limit = 50): Promise<DoubleCountIncident[]> {
  return incidentsFromIndex(await approvedCitationIndex(), limit);
}
