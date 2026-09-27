import prisma from "@/lib/prisma";
import type { SponsorRequirement } from "@prisma/client";
import { OcrService } from "@/src/agents/requirements-agent/services/ocr/ocr.service";
import { LlmService, LlmUnavailableError } from "@/src/agents/requirements-agent/services/llm/llm.service";
import { SponsorRequirementRepository } from "@/src/agents/requirements-agent/repositories/requirement.repository";
import { commitRequirementChange } from "./commit";
import { withAiProvenance } from "./provenance";
import { RequirementWorkflowError } from "./errors";
import type { ActorRole } from "./status";

const AGENT_NAME = "RequirementsAnalystAgent";

/**
 * Runs the Requirements Analyst Agent on a stored document:
 *   <start status> → PROCESSING → AI_EXTRACTED   (or → FAILED)
 *
 * `startedBy` makes the first transition: SYSTEM for a fresh upload, the
 * donor/admin for a retry or re-run (the state machine decides who may).
 * The agent only extracts — it never approves or validates anything.
 */
export async function runExtraction(params: {
  requirement: SponsorRequirement;
  buffer: Buffer;
  startedBy: { id: string | null; role: ActorRole };
  isRerun: boolean;
}): Promise<SponsorRequirement> {
  const { buffer, startedBy, isRerun } = params;

  let current = await prisma.$transaction((tx) =>
    commitRequirementChange(tx, params.requirement, {
      actorId: startedBy.id,
      actorRole: startedBy.role,
      toStatus: "PROCESSING",
      audit: {
        action: isRerun ? "REQUIREMENT_EXTRACTION_RERUN" : "CSR_PROCESSING_STARTED",
        detail: isRerun ? "Extraction re-run requested." : "Document processing started.",
      },
    })
  );

  let rawText = "";
  try {
    const extracted = await OcrService.extractRawText(buffer, current.fileName, current.mimeType);
    rawText = extracted.text;
    if (!rawText.trim()) {
      throw new RequirementWorkflowError("No text could be read from this document. It may be blank or unreadable.", 422);
    }

    const llmResult = await LlmService.extractStructuredRequirements(rawText);
    const fields = withAiProvenance(llmResult.data as any);

    current = await prisma.$transaction((tx) =>
      commitRequirementChange(tx, current, {
        actorId: null,
        actorRole: "SYSTEM",
        toStatus: "AI_EXTRACTED",
        fields,
        versionNote: isRerun ? "AI re-extraction" : "AI extraction",
        data: { rawText, modelVersion: llmResult.metadata.model, reviewNote: null },
        audit: {
          action: "CSR_EXTRACTION_COMPLETED",
          detail: `Extracted with ${llmResult.metadata.model}${extracted.wasOcrUsed ? " (OCR used)" : ""}.`,
        },
      })
    );

    await SponsorRequirementRepository.logExecution({
      agentName: AGENT_NAME,
      action: "CSR_EXTRACTION",
      entityId: current.id,
      status: "SUCCESS",
      promptHash: llmResult.metadata.promptHash,
      model: llmResult.metadata.model,
      latencyMs: llmResult.metadata.latencyMs,
      promptTokens: llmResult.metadata.promptTokens,
      completionTokens: llmResult.metadata.completionTokens,
      totalTokens: llmResult.metadata.totalTokens,
    });

    return current;
  } catch (err: any) {
    const message = err?.message || String(err);
    try {
      await prisma.$transaction((tx) =>
        commitRequirementChange(tx, current, {
          actorId: null,
          actorRole: "SYSTEM",
          toStatus: "FAILED",
          data: rawText ? { rawText } : undefined,
          audit: { action: "CSR_EXTRACTION_FAILED", detail: message.slice(0, 500) },
        })
      );
      await SponsorRequirementRepository.logExecution({
        agentName: AGENT_NAME,
        action: "CSR_EXTRACTION",
        entityId: current.id,
        status: "FAILED",
        promptHash: "n/a",
        model: current.modelVersion,
        latencyMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        errorMessage: message.slice(0, 1000),
      });
    } catch (logErr) {
      console.error("[extraction] failed to record extraction failure:", logErr);
    }

    if (err instanceof LlmUnavailableError || err instanceof RequirementWorkflowError) throw err;
    throw new RequirementWorkflowError("Document processing failed. You can retry extraction.", 500);
  }
}
