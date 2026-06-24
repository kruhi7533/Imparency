import fs from "fs/promises";
import path from "path";
import prisma from "@/lib/prisma";
import { screenNgo, ScreeningDocument, ScreeningResult } from "@/lib/gemini/screen-ngo";

/**
 * Loads a stored document URL into a Buffer.
 * - Local uploads ("/uploads/...") are read from the public folder.
 * - Anything else (S3/R2/CDN absolute URLs) is fetched over HTTP.
 * Returns null if the document cannot be loaded.
 */
async function loadDocumentBuffer(
  url: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    if (url.startsWith("/uploads/")) {
      const filePath = path.join(process.cwd(), "public", url);
      const buffer = await fs.readFile(filePath);
      return { buffer, mimeType: guessMime(url) };
    }

    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Failed to fetch screening document (${res.status}): ${url}`);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || guessMime(url);
    return { buffer: Buffer.from(arrayBuffer), mimeType: contentType };
  } catch (err) {
    console.error(`Error loading screening document ${url}:`, err);
    return null;
  }
}

function guessMime(url: string): string {
  const ext = path.extname(url).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/pdf";
}

/**
 * Runs the pre-screening agent for one NGO and stores the result.
 *
 * - Upserts a PENDING record first so the panel can show "in progress".
 * - Loads documents from their stored URLs (NOT from form data).
 * - Calls screenNgo and stores READY (or FAILED on error).
 * - NEVER throws and NEVER changes NGO verification status.
 */
export async function runAndStoreNgoScreening(ngoId: string) {
  // 1. Mark PENDING immediately.
  try {
    await prisma.ngoScreening.upsert({
      where: { ngoId },
      create: {
        ngoId,
        summary: "Pre-screening in progress…",
        extractedFields: {},
        documentChecklist: {},
        consistencyOk: false,
        flags: [],
        recommendation: "NEEDS_REVIEW",
        confidence: 0,
        status: "PENDING",
      },
      update: {
        status: "PENDING",
        summary: "Pre-screening in progress…",
      },
    });
  } catch (err) {
    console.error(`Failed to mark screening PENDING for NGO ${ngoId}:`, err);
    return null;
  }

  // 2. Load NGO + documents.
  try {
    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: ngoId },
    });

    if (!ngo) {
      throw new Error(`NGO profile ${ngoId} not found`);
    }

    const documents: ScreeningDocument[] = [];
    const unreadableFlags: { severity: "LOW" | "MEDIUM" | "HIGH"; issue: string }[] = [];

    // No per-document type field exists, so documents are passed UNLABELED and
    // the agent classifies each by content. We only flag ones we cannot load.
    for (let i = 0; i < (ngo.documents || []).length; i++) {
      const url = ngo.documents[i];
      const loaded = await loadDocumentBuffer(url);
      if (loaded) {
        documents.push({ buffer: loaded.buffer, mimeType: loaded.mimeType });
      } else {
        unreadableFlags.push({
          severity: "MEDIUM",
          issue: `Uploaded document #${i + 1} could not be loaded for screening.`,
        });
      }
    }

    // 3. Run the agent.
    const result: ScreeningResult = await screenNgo(
      {
        name: ngo.orgName,
        pan: ngo.panNumber,
        registrationNo: ngo.registrationNumber,
      },
      documents
    );

    // Merge in any load-failure flags.
    if (unreadableFlags.length > 0) {
      result.flags = [...unreadableFlags, ...result.flags];
    }

    // 4. Store READY.
    const stored = await prisma.ngoScreening.upsert({
      where: { ngoId },
      create: {
        ngoId,
        summary: result.summary,
        extractedFields: result.extractedFields as any,
        documentChecklist: result.documentChecklist as any,
        consistencyOk: result.consistencyOk,
        flags: result.flags as any,
        recommendation: result.recommendation,
        confidence: result.confidence,
        status: "READY",
      },
      update: {
        summary: result.summary,
        extractedFields: result.extractedFields as any,
        documentChecklist: result.documentChecklist as any,
        consistencyOk: result.consistencyOk,
        flags: result.flags as any,
        recommendation: result.recommendation,
        confidence: result.confidence,
        status: "READY",
      },
    });

    return stored;
  } catch (err: any) {
    console.error(`NGO screening failed for ${ngoId}:`, err);
    // 5. Store FAILED — never throw.
    try {
      const failed = await prisma.ngoScreening.upsert({
        where: { ngoId },
        create: {
          ngoId,
          summary: `Pre-screening failed: ${err.message || "unknown error"}. Manual review required.`,
          extractedFields: {},
          documentChecklist: {},
          consistencyOk: false,
          flags: [{ severity: "MEDIUM", issue: "Automated pre-screening could not complete." }],
          recommendation: "NEEDS_REVIEW",
          confidence: 0,
          status: "FAILED",
        },
        update: {
          summary: `Pre-screening failed: ${err.message || "unknown error"}. Manual review required.`,
          status: "FAILED",
        },
      });
      return failed;
    } catch (innerErr) {
      console.error(`Failed to store FAILED screening for ${ngoId}:`, innerErr);
      return null;
    }
  }
}
