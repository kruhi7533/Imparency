import prisma from "@/lib/prisma";
import { triageVerification } from "@/lib/verification-triage";

/**
 * The verification queue: organisations awaiting a decision.
 *
 * Lifted out of the dashboard page, where it lived at the bottom under four
 * rows of donation metrics and two leaderboards — roughly a full screen of
 * scrolling before an admin reached the thing they came to do. Deciding on an
 * organisation is the console's primary job; it should not be the last section
 * of a page about money.
 */

const IDENTITY_FIELDS = new Set(["orgName", "panNumber", "registrationNumber"]);

export async function loadVerificationQueue() {
  const ngos = await prisma.nGOProfile.findMany({
    // Two populations, one queue:
    //   PENDING  — the ordinary first decision.
    //   VERIFIED with reverificationRequiredAt — approved, but the evidence
    //             behind that approval has since failed.
    where: {
      OR: [
        { verificationStatus: "PENDING" },
        { verificationStatus: "VERIFIED", reverificationRequiredAt: { not: null } },
      ],
    },
    select: {
      id: true,
      orgName: true,
      verificationStatus: true,
      reverificationRequiredAt: true,
      reverificationReason: true,
      reverificationDueAt: true,
      registrationNumber: true,
      panNumber: true,
      address: true,
      causeCategories: true,
      website: true,
      foundedYear: true,
      documents: true,
      createdAt: true,
      user: { select: { email: true } },
      extractedFields: {
        orderBy: { fieldKey: "asc" },
        select: {
          fieldKey: true,
          extractedValue: true,
          submittedValue: true,
          matchesSubmitted: true,
          confidence: true,
          status: true,
          flags: true,
        },
      },
      documentAnalyses: {
        orderBy: { documentIndex: "asc" },
        select: { documentIndex: true, docType: true, orgNameOnDocument: true },
      },
      riskReviews: {
        where: { status: "OPEN" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, riskLevel: true, findings: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows = ngos.map((ngo: any) => {
    const extractedFields = (ngo.extractedFields ?? []).map((f: any) => ({
      ...f,
      flags: Array.isArray(f.flags) ? f.flags : [],
    }));

    const assurances =
      extractedFields.length > 0
        ? triageVerification(extractedFields, {
            duplicateIdentity: !!ngo.riskReviews?.[0],
            unreadableDocuments: 0,
            documents: ngo.documentAnalyses ?? [],
          }).assurances
        : [];

    const findings = Array.isArray(ngo.riskReviews?.[0]?.findings)
      ? (ngo.riskReviews[0].findings as any[])
      : [];

    return {
      ...ngo,
      reverificationRequiredAt: ngo.reverificationRequiredAt?.toISOString() ?? null,
      reverificationDueAt: ngo.reverificationDueAt?.toISOString() ?? null,
      extractedFields,
      assurances,

      // ─── The front gate ────────────────────────────────────────────────
      // Computed here rather than in the client so the queue and the API
      // agree on what "approvable" means. The route enforces the same three
      // conditions; this is what lets the UI explain them before a click
      // rather than after.

      /** Nothing was ever uploaded. There is no evidence to approve on. */
      hasDocuments: (ngo.documents ?? []).length > 0,
      /** Documents exist but have never been read. */
      hasExtraction: extractedFields.length > 0,
      /**
       * A document disagrees with the registration form about WHO this is.
       * Not the same class of problem as a missing 80G, and deliberately not
       * clearable by typing a note — the way out is to correct or validate the
       * field in Document Review, not to write a sentence about it.
       */
      hasIdentityContradiction: findings.some(
        (f) => f?.severity === "HIGH" && typeof f?.fieldKey === "string" && IDENTITY_FIELDS.has(f.fieldKey)
      ),

      openRiskReview: ngo.riskReviews?.[0]
        ? {
            id: ngo.riskReviews[0].id,
            riskLevel: ngo.riskReviews[0].riskLevel,
            findings,
          }
        : null,
    };
  });

  // Re-decisions first: an approval whose evidence has failed outranks an
  // application nobody has looked at yet, because the failed one is already
  // live, already listed, and already able to raise money.
  rows.sort((a: any, b: any) => (a.reverificationRequiredAt ? 0 : 1) - (b.reverificationRequiredAt ? 0 : 1));

  return rows;
}
