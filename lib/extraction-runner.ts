import prisma from "@/lib/prisma";
import { loadDocumentBuffer } from "@/lib/document-loader";
import { captureError } from "@/lib/observability";
import {
  triageVerification,
  applyTriage,
  hasDuplicateIdentity,
  type DocumentIdentity,
} from "@/lib/verification-triage";
import {
  extractNgoFields,
  EXTRACTION_FIELD_KEYS,
  ExtractionDocument,
  ExtractedFieldResult,
  FieldExtractionResult,
} from "@/lib/gemini/extract-ngo-fields";

/**
 * Runs the field-extraction agent for one NGO and stores the result.
 *
 * Contract: NEVER throws, NEVER changes NGO verification status, and always
 * leaves the DB in a readable state so the admin panel can render something.
 *
 * This is the single document-analysis pass. After it stores the per-field
 * evidence it triages the result (lib/verification-triage.ts): a clean profile
 * is left for normal admin approval, a defective one opens a RiskReview.
 *
 * The model's self-reported confidence is advisory only. This module owns the
 * decision of what counts as reviewed, via deterministic checks that form a
 * one-way ratchet: they can only ever push a field DOWN into NEEDS_REVIEW.
 */

/**
 * Below this, a field is mandatory human review. Deliberately a code constant
 * and not a prompt instruction: a model will happily self-report 0.9 on a value
 * it inferred, so the threshold must be enforced where the model cannot reach.
 */
export const CONFIDENCE_THRESHOLD = 0.75;

// Format checks run in code, not the LLM (same rules as the private regexes in
// the extraction guardrails). A value that fails these is wrong regardless of
// how confident the model was about reading it.
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const REG_NO_REGEX = /^[A-Za-z0-9\/\-]{5,}$/;

export interface FieldFlag {
  severity: "LOW" | "MEDIUM" | "HIGH";
  issue: string;
}

type FieldStatus = "EXTRACTED" | "NEEDS_REVIEW";

interface ResolvedField {
  fieldKey: string;
  extractedValue: string | null;
  submittedValue: string | null;
  matchesSubmitted: boolean | null;
  confidence: number;
  status: FieldStatus;
  flags: FieldFlag[];
  sourceDocumentIndex: number | null;
}

/** Loose comparison: casing/spacing/punctuation differences are not mismatches. */
export function normaliseForCompare(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Exported so the cross-document name check in lib/verification-triage.ts uses
 * exactly these tolerances. Two definitions of "same name" would eventually
 * disagree, and the disagreement would show up as a phantom fraud finding.
 */
export function namesMatch(a: string, b: string): boolean {
  const na = a.toUpperCase().replace(/\s+/g, " ").trim();
  const nb = b.toUpperCase().replace(/\s+/g, " ").trim();
  if (na === nb) return true;
  // Tolerate one side carrying a suffix the other omits ("… Foundation (Regd.)").
  return na.startsWith(nb) || nb.startsWith(na);
}

/**
 * Pure: turn one agent field result + the NGO's submitted value into a stored
 * field row. Exported for tests — this is where the guardrails actually live.
 */
export function resolveField(
  result: ExtractedFieldResult,
  submittedValue: string | null
): ResolvedField {
  const flags: FieldFlag[] = [];
  let confidence = result.value === null ? 0 : result.confidence;
  let status: FieldStatus = confidence >= CONFIDENCE_THRESHOLD ? "EXTRACTED" : "NEEDS_REVIEW";

  if (result.value === null) {
    flags.push({
      severity: "MEDIUM",
      issue: "Not found in any uploaded document. Confirm the document is missing before approving.",
    });
    return {
      fieldKey: result.fieldKey,
      extractedValue: null,
      submittedValue,
      matchesSubmitted: null,
      confidence: 0,
      status: "NEEDS_REVIEW",
      flags,
      sourceDocumentIndex: null,
    };
  }

  if (status === "NEEDS_REVIEW") {
    flags.push({
      severity: "LOW",
      issue: `Read with ${(confidence * 100).toFixed(0)}% confidence, below the ${(
        CONFIDENCE_THRESHOLD * 100
      ).toFixed(0)}% threshold.`,
    });
  }

  // Deterministic format checks — ground truth over model confidence.
  if (result.fieldKey === "panNumber" && !PAN_REGEX.test(normaliseForCompare(result.value))) {
    flags.push({
      severity: "HIGH",
      issue: "Extracted value is not a valid PAN format (AAAAA0000A).",
    });
    confidence = Math.min(confidence, 0.3);
    status = "NEEDS_REVIEW";
  }

  if (
    result.fieldKey === "registrationNumber" &&
    !REG_NO_REGEX.test(result.value.trim())
  ) {
    flags.push({
      severity: "HIGH",
      issue: "Extracted value does not look like a registration number.",
    });
    confidence = Math.min(confidence, 0.3);
    status = "NEEDS_REVIEW";
  }

  // Cross-check against what the NGO typed on the form.
  let matchesSubmitted: boolean | null = null;
  if (submittedValue && submittedValue.trim()) {
    matchesSubmitted =
      result.fieldKey === "orgName"
        ? namesMatch(result.value, submittedValue)
        : normaliseForCompare(result.value) === normaliseForCompare(submittedValue);

    if (!matchesSubmitted) {
      flags.push({
        severity: "HIGH",
        issue: `Document says "${result.value}" but the registration form says "${submittedValue}".`,
      });
      status = "NEEDS_REVIEW";
    }
  }

  return {
    fieldKey: result.fieldKey,
    extractedValue: result.value,
    submittedValue,
    matchesSubmitted,
    confidence,
    status,
    flags,
    sourceDocumentIndex: result.sourceDocumentIndex,
  };
}

/**
 * Triage the stored result and route it. Split out so runAndStoreNgoExtraction
 * stays readable, and kept non-throwing so a triage failure can never break a
 * registration that otherwise succeeded.
 */
async function runTriage(
  ngoId: string,
  ngo: { panNumber: string; registrationNumber: string },
  stored: { fieldKey: string; extractedValue: string | null; status: string; matchesSubmitted: boolean | null; flags: any }[],
  docLoadNotes: (string | null)[],
  documents: DocumentIdentity[]
): Promise<void> {
  try {
    const duplicateIdentity = await hasDuplicateIdentity(
      ngoId,
      ngo.panNumber,
      ngo.registrationNumber
    );

    const result = triageVerification(
      stored.map((f) => ({
        fieldKey: f.fieldKey,
        extractedValue: f.extractedValue,
        status: f.status,
        matchesSubmitted: f.matchesSubmitted,
        flags: Array.isArray(f.flags) ? (f.flags as any[]) : [],
      })),
      {
        duplicateIdentity,
        unreadableDocuments: docLoadNotes.filter(Boolean).length,
        documents,
      }
    );

    await applyTriage(ngoId, result);
    console.log(`[extraction-runner] ${ngoId} triage: ${result.verdict} — ${result.summary}`);

    // If this NGO is already VERIFIED, the findings we just produced may
    // contradict the approval a human already made. Put the decision back in
    // front of them — approval and document review are otherwise parallel
    // queues, and a failure found after approval used to change nothing at all.
    //
    // Hooked here, at the one call site that already runs triage, so no future
    // caller has to remember it.
    const { decideReversal, applyReversal } = await import("@/lib/verification-reversal");
    const current = await prisma.nGOProfile.findUnique({
      where: { id: ngoId },
      select: { verificationStatus: true },
    });
    if (current) {
      const decision = decideReversal({
        verificationStatus: current.verificationStatus,
        hasEvidence: stored.length > 0,
        findings: result.findings,
      });
      const flagged = await applyReversal(ngoId, decision);
      if (flagged) {
        console.log(`[extraction-runner] ${ngoId} re-verification required — ${decision.severity}`);
      }
    }
  } catch (err) {
    captureError(err, {
      scope: "lib/extraction-runner",
      operation: "triage",
      entityType: "NGO",
      entityId: ngoId,
    });
  }
}

/**
 * Runs extraction for one NGO and persists per-document + per-field rows.
 * Returns the stored fields, or null if the run could not even start.
 */
export async function runAndStoreNgoExtraction(ngoId: string) {
  let ngo;
  try {
    ngo = await prisma.nGOProfile.findUnique({
      where: { id: ngoId },
      select: {
        id: true,
        orgName: true,
        panNumber: true,
        registrationNumber: true,
        documents: true,
      },
    });
  } catch (err) {
    console.error(`[extraction-runner] failed to load NGO ${ngoId}:`, err);
    return null;
  }

  if (!ngo) {
    console.error(`[extraction-runner] NGO profile ${ngoId} not found`);
    return null;
  }

  const submitted: Record<string, string | null> = {
    orgName: ngo.orgName,
    panNumber: ngo.panNumber,
    registrationNumber: ngo.registrationNumber,
    a12Number: null, // not collected on the registration form
    eightyGNumber: null,
  };

  try {
    // 1. Load documents. An unloadable upload is a flag, not a failure.
    //
    // Unloadable files are OMITTED from the model payload rather than sent as a
    // zero-byte placeholder. The placeholder used to make Gemini reject the
    // whole request with 400 "The document has no pages" — which threw, skipped
    // triage entirely, and left the NGO reading as clean. One bad upload must
    // never take down the analysis of the good ones.
    const docs: ExtractionDocument[] = [];
    const docLoadNotes: (string | null)[] = [];
    const urls = ngo.documents || [];
    /** Position in the model payload → position in NGOProfile.documents[]. */
    const realIndexOf: number[] = [];

    for (let i = 0; i < urls.length; i++) {
      const loaded = await loadDocumentBuffer(urls[i]);
      if (loaded && loaded.buffer.length > 0) {
        realIndexOf.push(i);
        docs.push({ buffer: loaded.buffer, mimeType: loaded.mimeType });
        docLoadNotes.push(null);
      } else {
        docLoadNotes.push("Document could not be loaded from storage.");
      }
    }

    // Nothing readable at all — record why, then let triage route it. Calling
    // the model with an empty payload would only buy a different error.
    if (docs.length === 0 && urls.length > 0) {
      throw new Error("None of the uploaded documents could be loaded from storage.");
    }

    // 2. Run the single analysis pass.
    const result: FieldExtractionResult = await extractNgoFields(
      {
        orgName: ngo.orgName,
        panNumber: ngo.panNumber,
        registrationNumber: ngo.registrationNumber,
      },
      docs
    );

    // 3. Persist document classifications, mapping the model's payload
    //    positions back onto the real document indexes.
    const analysisIdByIndex = new Map<number, string>();
    for (const doc of result.documents) {
      const realIndex = realIndexOf[doc.documentIndex];
      if (realIndex === undefined) continue;

      const stored = await prisma.ngoDocumentAnalysis.upsert({
        where: { ngoId_documentIndex: { ngoId, documentIndex: realIndex } },
        create: {
          ngoId,
          documentIndex: realIndex,
          documentUrl: urls[realIndex] ?? "",
          docType: doc.docType,
          docTypeConfidence: doc.docTypeConfidence,
          readable: doc.readable,
          note: doc.note,
          orgNameOnDocument: doc.orgNameOnDocument,
        },
        update: {
          documentUrl: urls[realIndex] ?? "",
          docType: doc.docType,
          docTypeConfidence: doc.docTypeConfidence,
          readable: doc.readable,
          note: doc.note,
          orgNameOnDocument: doc.orgNameOnDocument,
        },
      });
      analysisIdByIndex.set(realIndex, stored.id);
    }

    // Record the ones that never reached the model, so an admin can see WHY a
    // document produced nothing rather than assuming it was fine.
    for (let i = 0; i < urls.length; i++) {
      if (docLoadNotes[i] === null) continue;
      await prisma.ngoDocumentAnalysis.upsert({
        where: { ngoId_documentIndex: { ngoId, documentIndex: i } },
        create: {
          ngoId,
          documentIndex: i,
          documentUrl: urls[i] ?? "",
          docType: "UNKNOWN",
          docTypeConfidence: 0,
          readable: false,
          note: docLoadNotes[i],
        },
        update: {
          documentUrl: urls[i] ?? "",
          readable: false,
          note: docLoadNotes[i],
        },
      });
    }

    // 4. Persist fields, preserving admin decisions that are still about the
    //    same value (a re-run must not silently discard human validation, but a
    //    changed value makes the old validation stale).
    const existing = await prisma.extractedField.findMany({ where: { ngoId } });
    const existingByKey = new Map(existing.map((f) => [f.fieldKey, f]));

    const stored = [];
    for (const fieldResult of result.fields) {
      const resolved = resolveField(fieldResult, submitted[fieldResult.fieldKey] ?? null);
      const prior = existingByKey.get(resolved.fieldKey);
      const valueUnchanged =
        prior && (prior.extractedValue ?? null) === (resolved.extractedValue ?? null);
      const priorDecisionStands =
        valueUnchanged && (prior.status === "VALIDATED" || prior.status === "REJECTED");

      // sourceDocumentIndex is a position in the model payload, not in
      // NGOProfile.documents[] — remap before it is stored or displayed.
      const realSourceIndex =
        resolved.sourceDocumentIndex !== null
          ? realIndexOf[resolved.sourceDocumentIndex] ?? null
          : null;
      const analysisId =
        realSourceIndex !== null ? analysisIdByIndex.get(realSourceIndex) ?? null : null;

      const row = await prisma.extractedField.upsert({
        where: { ngoId_fieldKey: { ngoId, fieldKey: resolved.fieldKey } },
        create: {
          ngoId,
          analysisId,
          fieldKey: resolved.fieldKey,
          extractedValue: resolved.extractedValue,
          submittedValue: resolved.submittedValue,
          matchesSubmitted: resolved.matchesSubmitted,
          confidence: resolved.confidence,
          status: resolved.status,
          flags: resolved.flags as any,
        },
        update: {
          analysisId,
          extractedValue: resolved.extractedValue,
          submittedValue: resolved.submittedValue,
          matchesSubmitted: resolved.matchesSubmitted,
          confidence: resolved.confidence,
          flags: resolved.flags as any,
          ...(priorDecisionStands
            ? {}
            : {
                status: resolved.status,
                validatedValue: null,
                validatedById: null,
                validatedAt: null,
              }),
        },
      });
      stored.push(row);
    }

    // 5. Triage. This is the whole decision: clean NGOs are left alone, defective
    //    ones go to Risk & Compliance with their reasons attached. No model call
    //    — it reads the rows just written and applies auditable rules.
    await runTriage(
      ngoId,
      ngo,
      stored,
      docLoadNotes,
      // Each document's own account of whose it is, remapped onto real indexes.
      result.documents.map((d) => ({
        documentIndex: realIndexOf[d.documentIndex] ?? d.documentIndex,
        docType: d.docType,
        orgNameOnDocument: d.orgNameOnDocument,
      }))
    );

    return stored;
  } catch (err: any) {
    // 5. Store a readable failure state — never throw. Every field is marked
    //    NEEDS_REVIEW so a failed run can never make approval easier.
    console.error(`[extraction-runner] extraction failed for NGO ${ngoId}:`, err);
    try {
      for (const fieldKey of EXTRACTION_FIELD_KEYS) {
        await prisma.extractedField.upsert({
          where: { ngoId_fieldKey: { ngoId, fieldKey } },
          create: {
            ngoId,
            fieldKey,
            extractedValue: null,
            submittedValue: submitted[fieldKey] ?? null,
            confidence: 0,
            status: "NEEDS_REVIEW",
            flags: [
              {
                severity: "MEDIUM",
                issue: `Automated extraction could not complete: ${err.message || "unknown error"}. Enter this field manually.`,
              },
            ] as any,
          },
          update: {},
        });
      }

      // A failed run must reach a human, not vanish. Without this the run threw
      // before triage, no RiskReview was opened, and the console read the NGO
      // as clean — a failure that made approval EASIER, which is exactly what
      // this module's contract forbids.
      await applyTriage(ngoId, {
        verdict: "NEEDS_RISK_REVIEW",
        riskLevel: "MEDIUM",
        findings: [
          {
            fieldKey: null,
            severity: "MEDIUM",
            issue: `Automated document analysis could not complete: ${err.message || "unknown error"}. No field evidence exists for this organisation.`,
          },
        ],
        summary: "Document analysis failed — sent to Risk & Compliance.",
        assurances: [],
        // Nothing to tell the NGO: this is our failure, not theirs, and the
        // documents may be perfectly fine.
        ngoFacingIssues: [],
      });
    } catch (innerErr) {
      console.error(`[extraction-runner] failed to store failure state for ${ngoId}:`, innerErr);
    }
    return null;
  }
}
