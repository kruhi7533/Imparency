import prisma from "@/lib/prisma";
import DocumentReviewClient from "./DocumentReviewClient";

export const runtime = "nodejs";

/**
 * The human gate for field-level document extraction.
 *
 * Lists every NGO that has extracted fields, with the agent's per-field value,
 * confidence, and cross-check against what the NGO typed on the registration
 * form. An admin validates or rejects each field here; only VALIDATED fields
 * earn their NGOCompliance flag at approval time (lib/compliance-evidence.ts).
 *
 * Also lists NGOs that uploaded documents but have NO extracted fields at all.
 * Extraction is fire-and-forget from the registration route, so a run that never
 * started (process frozen, deploy mid-flight) leaves zero rows behind. Filtering
 * those out — as this page used to — hid exactly the NGOs that need attention
 * and made the re-run button unreachable for them.
 */
export default async function AdminDocumentReviewPage() {
  const ngos = await prisma.nGOProfile.findMany({
    where: {
      isDeleted: false,
      OR: [
        { extractedFields: { some: {} } },
        // Uploaded something, but extraction produced nothing.
        { documents: { isEmpty: false } },
      ],
    },
    select: {
      id: true,
      orgName: true,
      verificationStatus: true,
      documents: true,
      user: { select: { email: true } },
      documentAnalyses: { orderBy: { documentIndex: "asc" } },
      extractedFields: { orderBy: { fieldKey: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const serialized = ngos.map((ngo) => ({
    id: ngo.id,
    orgName: ngo.orgName,
    email: ngo.user.email,
    verificationStatus: ngo.verificationStatus,
    documents: ngo.documents,
    // False means extraction never produced anything for this NGO — a very
    // different state from "ran and found nothing", and it must not be allowed
    // to read as "all reviewed".
    hasExtraction: ngo.extractedFields.length > 0,
    analyses: ngo.documentAnalyses.map((a) => ({
      id: a.id,
      documentIndex: a.documentIndex,
      documentUrl: a.documentUrl,
      docType: a.docType,
      docTypeConfidence: a.docTypeConfidence,
      readable: a.readable,
      note: a.note,
    })),
    fields: ngo.extractedFields.map((f) => ({
      id: f.id,
      fieldKey: f.fieldKey,
      extractedValue: f.extractedValue,
      submittedValue: f.submittedValue,
      matchesSubmitted: f.matchesSubmitted,
      confidence: f.confidence,
      status: f.status,
      flags: (f.flags as any) || [],
      validatedValue: f.validatedValue,
      validatedAt: f.validatedAt ? f.validatedAt.toISOString() : null,
    })),
  }));

  // Never-run extractions first: they are the ones at risk of being skipped,
  // and they carry no field rows to draw the eye.
  serialized.sort((a, b) => Number(a.hasExtraction) - Number(b.hasExtraction));

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
          Document Review
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 max-w-3xl">
          The agent reads each uploaded document and reports what it found, field by field, with a
          confidence score. Anything it could not read clearly, could not find, or that disagrees
          with the registration form is held for you. A compliance flag is only set once you
          validate the field behind it.
        </p>
      </div>

      <DocumentReviewClient initialNgos={serialized} />
    </main>
  );
}
