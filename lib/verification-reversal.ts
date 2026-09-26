import prisma from "@/lib/prisma";
import { captureError } from "@/lib/observability";
import { logAdminAction } from "@/lib/admin-log";
import { logComplianceEvent } from "@/lib/ngo-compliance";
import type { TriageFinding } from "@/lib/verification-triage";

/**
 * What happens when evidence gathered AFTER approval contradicts the approval.
 *
 * The gap this closes: approval and document review are parallel queues, so an
 * organisation could be approved before anyone read its documents — and once it
 * was through, a later failure changed nothing. Two NGOs sat VERIFIED on
 * evidence that had already failed, one of them with its name, PAN and
 * registration number all disagreeing with its own paperwork. Reviewing the
 * documents afterwards told us who was inside; it did not put them back out.
 *
 * THE BOUNDARY, decided deliberately: this never suspends, rejects, delists, or
 * otherwise acts against an organisation. It re-opens the decision, gives a
 * human 14 days, and shouts louder if that passes. A false positive here costs
 * an admin five minutes, not an NGO its livelihood — and an automated adverse
 * action is a different kind of system than this one has chosen to be.
 */

export const REVERIFICATION_WINDOW_DAYS = 14;

/**
 * Fields whose contradiction means "this may not be the organisation we
 * approved", as opposed to "this organisation's paperwork is incomplete".
 * Used only to describe the severity of a re-decision, never to act on one.
 */
const IDENTITY_FIELDS = new Set(["orgName", "panNumber", "registrationNumber"]);

export type ReversalAction = "NONE" | "REOPEN";

export interface ReversalDecision {
  action: ReversalAction;
  /** Admin-facing sentence. Stored, shown in the queue, and emailed. */
  reason: string;
  /** How loudly to present it. Never how hard to act. */
  severity: "IDENTITY" | "SERIOUS" | "NONE";
}

export interface ReversalInput {
  verificationStatus: string;
  /** False when the NGO has no ExtractedField rows at all. */
  hasEvidence: boolean;
  findings: TriageFinding[];
}

const NO_REVERSAL: ReversalDecision = { action: "NONE", reason: "", severity: "NONE" };

/**
 * Pure: should this approval go back in front of a human?
 *
 * Reads triage's findings and never the raw fields, which is how it inherits
 * two rules without restating them:
 *
 *   - A missing 12A or 80G is not a defect. Triage does not raise one, so this
 *     cannot invent one. Many legitimate NGOs have neither.
 *   - Absence of evidence is not evidence of wrongdoing. An NGO whose documents
 *     yielded nothing readable is re-opened, exactly like one whose documents
 *     contradict each other — because we cannot tell the difference yet, and
 *     pretending we can in either direction is the mistake.
 */
export function decideReversal(input: ReversalInput): ReversalDecision {
  // Only an approval can be un-made. A PENDING organisation is already waiting
  // in the queue with its findings attached; a REJECTED one needs nothing.
  if (input.verificationStatus !== "VERIFIED") return NO_REVERSAL;

  const high = input.findings.filter((f) => f.severity === "HIGH");
  const identityHigh = high.filter((f) => f.fieldKey && IDENTITY_FIELDS.has(f.fieldKey));

  if (identityHigh.length > 0) {
    const fields = identityHigh.map((f) => f.fieldKey).join(", ");
    return {
      action: "REOPEN",
      severity: "IDENTITY",
      reason: `Approved, but the documents now contradict the registration form on ${fields}. This may not be the organisation that was approved — re-decide before it keeps raising funds.`,
    };
  }

  if (high.length > 0) {
    return {
      action: "REOPEN",
      severity: "SERIOUS",
      reason: `Approved, but ${high.length} serious issue(s) have since been found in the documents: ${high
        .map((f) => f.issue)
        .slice(0, 3)
        .join("; ")}`,
    };
  }

  if (!input.hasEvidence) {
    return {
      action: "REOPEN",
      severity: "SERIOUS",
      reason:
        "Approved without any readable document evidence. Nothing was found in the uploaded files, so the approval rests on nothing that can be checked.",
    };
  }

  const medium = input.findings.filter((f) => f.severity === "MEDIUM");
  if (medium.length >= 2) {
    return {
      action: "REOPEN",
      severity: "SERIOUS",
      reason: `Approved, but ${medium.length} issues have since been found in the documents. Individually minor; together worth a second look.`,
    };
  }

  return NO_REVERSAL;
}

/**
 * Record a re-decision against an NGO, once.
 *
 * Never throws — it is called from inside the extraction pipeline, and a
 * failure to flag must not take down the extraction that found the problem.
 * Idempotent on the reason: extraction re-runs constantly, and an NGO must not
 * be re-flagged, re-logged and re-emailed every time it does.
 */
export async function applyReversal(ngoId: string, decision: ReversalDecision): Promise<boolean> {
  if (decision.action === "NONE") return false;

  try {
    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: ngoId },
      select: {
        id: true,
        orgName: true,
        verificationStatus: true,
        reverificationRequiredAt: true,
        reverificationReason: true,
        user: { select: { email: true } },
        compliance: { select: { id: true, panVerified: true, registrationVerified: true, a12Verified: true, eightyGVerified: true } },
      },
    });
    if (!ngo || ngo.verificationStatus !== "VERIFIED") return false;

    // Already flagged for the same thing: nothing new to say, so say nothing.
    if (ngo.reverificationRequiredAt && ngo.reverificationReason === decision.reason) return false;

    const now = new Date();
    const dueAt = new Date(now.getTime() + REVERIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    await prisma.nGOProfile.update({
      where: { id: ngoId },
      data: {
        reverificationRequiredAt: now,
        reverificationReason: decision.reason,
        reverificationDueAt: dueAt,
        // A fresh reason restarts the clock and the escalation.
        reverificationEscalatedAt: null,
      },
    });

    // Shared with the platform-wide sweep — one definition of "backed by
    // evidence", so a flag cannot survive here and be revoked there.
    const { revokeUnbackedFlags } = await import("@/lib/compliance-evidence");
    await revokeUnbackedFlags(ngoId);

    // Actor is the system. logAdminAction takes a nullable admin id precisely
    // so automated decisions are recorded in the same trail humans are, rather
    // than in a parallel one nobody reads.
    await logAdminAction({
      adminId: null,
      action: "NGO_REVERIFICATION_REQUIRED",
      entityType: "NGO",
      entityId: ngoId,
      newValue: { reason: decision.reason, severity: decision.severity, dueAt: dueAt.toISOString() },
    }).catch(() => {});

    if (ngo.compliance?.id) {
      await logComplianceEvent(
        ngo.compliance.id,
        "REVERIFICATION_REQUIRED",
        decision.reason,
        null
      ).catch(() => {});
    }

    await notifyAdminOfReversal(ngo.orgName, ngoId, decision, dueAt);

    // Re-score: an NGO whose approval is in question is not the same risk it
    // was a minute ago, and the Radar should say so without waiting for a sweep.
    const { refreshRiskScore } = await import("@/lib/risk-engine/store");
    await refreshRiskScore("NGO", ngoId);

    return true;
  } catch (err) {
    captureError(err, {
      scope: "lib/verification-reversal",
      operation: "apply_reversal",
      entityType: "NGO",
      entityId: ngoId,
    });
    return false;
  }
}


async function notifyAdminOfReversal(
  orgName: string,
  ngoId: string,
  decision: ReversalDecision,
  dueAt: Date
): Promise<void> {
  try {
    const { sendReverificationRequiredEmail } = await import("@/lib/email");
    const adminEmail = process.env.ADMIN_EMAIL || "inkvuex@gmail.com";
    await sendReverificationRequiredEmail(adminEmail, {
      orgName,
      ngoId,
      reason: decision.reason,
      severity: decision.severity,
      dueAt,
    });
  } catch (err) {
    // The queue entry is the source of truth; the email is a prompt to go look
    // at it. A mail failure must not lose the flag that was already written.
    captureError(
      err,
      { scope: "lib/verification-reversal", operation: "notify_admin", entityType: "NGO", entityId: ngoId },
      "warning"
    );
  }
}

/**
 * Apply the policy to every VERIFIED NGO using evidence that already exists.
 *
 * The hook in the extraction pipeline only fires when extraction RUNS, so an
 * organisation whose evidence failed last month stays silently verified until
 * someone happens to re-run it. This sweep closes that gap without spending a
 * single model call: it reads the findings already stored on the open
 * RiskReview and the extracted-field count, and applies exactly the same pure
 * policy.
 *
 * Runs alongside the risk-score sweep. Idempotent, because applyReversal is.
 */
export async function evaluateVerifiedNgos(): Promise<{ checked: number; flagged: number }> {
  const ngos = await prisma.nGOProfile.findMany({
    where: { verificationStatus: "VERIFIED", isDeleted: false, reverificationRequiredAt: null },
    select: {
      id: true,
      riskReviews: {
        where: { status: "OPEN" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { findings: true },
      },
      _count: { select: { extractedFields: true } },
    },
  });

  let flagged = 0;
  for (const ngo of ngos) {
    const raw = Array.isArray(ngo.riskReviews[0]?.findings) ? (ngo.riskReviews[0]!.findings as any[]) : [];

    // A RiskReview accumulates findings from two writers with different shapes:
    // verification triage ({ fieldKey, severity, issue }) and the fraud
    // investigator ({ severity, finding, evidence, confidence }). Only triage's
    // are document evidence about THIS approval, so only those are read here —
    // an investigator's structural finding is a different conversation and
    // belongs in Risk, not in the verification queue.
    const findings = raw
      .filter((f) => f && typeof f.issue === "string" && typeof f.severity === "string")
      .map((f) => ({
        fieldKey: typeof f.fieldKey === "string" ? f.fieldKey : null,
        severity: f.severity as "LOW" | "MEDIUM" | "HIGH",
        issue: f.issue as string,
      }));

    const decision = decideReversal({
      verificationStatus: "VERIFIED",
      hasEvidence: ngo._count.extractedFields > 0,
      findings,
    });

    if (await applyReversal(ngo.id, decision)) flagged += 1;
  }

  return { checked: ngos.length, flagged };
}

/**
 * Clear the flag once a human has re-decided. Called from the verification
 * route on approve, reject, or an explicit "still fine".
 */
export async function clearReversal(ngoId: string): Promise<void> {
  await prisma.nGOProfile.update({
    where: { id: ngoId },
    data: {
      reverificationRequiredAt: null,
      reverificationReason: null,
      reverificationDueAt: null,
      reverificationEscalatedAt: null,
    },
  });
}
