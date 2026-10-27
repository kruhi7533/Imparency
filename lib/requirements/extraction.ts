import prisma from "@/lib/prisma";
import { Prisma, type SponsorRequirement } from "@prisma/client";
import { SponsorRequirementRepository } from "@/src/agents/requirements-agent/repositories/requirement.repository";
import { commitRequirementChange } from "./commit";
import { withAiProvenance, RULE_EXTRACTION_AGENT, CLAUDE_EXTRACTION_AGENT } from "./provenance";
import crypto from "crypto";
import { ExtractionError, classifyExtractionFailure, toStoredError, type ExtractionErrorCode } from "./extraction-errors";
import { extractByRules, RULE_EXTRACTOR_VERSION } from "./rule-extractor";
import { checkExtraction } from "./extraction-checks";
import type { ActorRole } from "./status";

const AGENT_NAME = "RequirementsAnalystAgent";

/**
 * The parser and model client are loaded on demand, not at module load: a
 * parser that cannot load in the serverless runtime used to crash the upload
 * route before any handler ran (an empty-body 500). Injectable for tests.
 */
export type ExtractionMethod = "CLAUDE" | "GEMINI" | "RULES";

export interface ExtractionResult {
  data: Record<string, { value: unknown; confidence: number }>;
  /** Which provider produced the fields. RULES = deterministic rule-based extractor. */
  method: ExtractionMethod;
  /** Why the rule path was used (no provider configured, every provider failed, timeout). */
  fallbackReason?: ExtractionErrorCode | "MODEL_TIMEOUT";
  metadata: {
    model: string;
    promptHash: string;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ExtractionDeps {
  readText: (buffer: Buffer, fileName: string, mimeType: string) => Promise<{ text: string; wasOcrUsed: boolean }>;
  extract: (text: string) => Promise<ExtractionResult>;
}

type ModelCall = (text: string) => Promise<Omit<ExtractionResult, "method" | "fallbackReason">>;

/** Model calls that take longer than this fall through to the next provider. */
export const MODEL_TIMEOUT_MS = 25_000;

/** The deterministic extractor as an ExtractionResult. */
export function ruleResult(text: string, fallbackReason: ExtractionResult["fallbackReason"]): ExtractionResult {
  const started = Date.now();
  const { data } = extractByRules(text);
  return {
    data,
    method: "RULES",
    fallbackReason,
    metadata: {
      model: RULE_EXTRACTOR_VERSION,
      promptHash: crypto.createHash("sha256").update(text).digest("hex"),
      latencyMs: Date.now() - started,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
  };
}

/**
 * Provider chain: Claude (ANTHROPIC_API_KEY) → Gemini (GEMINI_API_KEY / MOCK_AI)
 * → rule-based extractor. A provider that is not configured is skipped; one
 * that errors or times out falls through to the next. Same output shape for all.
 */
export async function extractWithFallback(
  text: string,
  providers: { claude?: ModelCall | null; gemini?: ModelCall | null },
  timeoutMs = MODEL_TIMEOUT_MS
): Promise<ExtractionResult> {
  let reason: ExtractionResult["fallbackReason"] = "EXTRACTION_PROVIDER_UNAVAILABLE";
  const chain: Array<[ExtractionMethod, ModelCall | null | undefined]> = [
    ["CLAUDE", providers.claude],
    ["GEMINI", providers.gemini],
  ];
  for (const [method, call] of chain) {
    if (!call) continue;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("model timeout"), { name: "ModelTimeout" })), timeoutMs);
      });
      const result = await Promise.race([call(text), timeout]);
      return { ...result, method };
    } catch (err: any) {
      reason = err?.name === "ModelTimeout" ? "MODEL_TIMEOUT" : classifyExtractionFailure(err).code;
      console.warn(`[extraction] ${method} failed (${reason}); trying the next provider.`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return ruleResult(text, reason);
}

/** Claude over the (contact-redacted) document text, validated against the same schema as Gemini. */
const callClaude: ModelCall = async (text) => {
  const [{ claudeStructured, CLAUDE_MODEL }, { RequirementSchema }, { SYSTEM_PROMPT, wrapDocument }, llm] = await Promise.all([
    import("@/lib/ai/claude"),
    import("@/src/agents/requirements-agent/validators/schema"),
    import("@/src/agents/requirements-agent/prompts"),
    import("@/src/agents/requirements-agent/services/llm/llm.service"),
  ]);
  const { text: redacted, tokens } = llm.redactContactDetails(text);
  const started = Date.now();
  const parsed = await claudeStructured({
    schema: RequirementSchema,
    system: SYSTEM_PROMPT,
    content: [{ type: "text", text: wrapDocument(redacted) }],
    effort: "medium",
  });
  return {
    data: llm.restoreContactDetails(RequirementSchema.parse(parsed), tokens) as any,
    metadata: {
      model: CLAUDE_MODEL,
      promptHash: crypto.createHash("sha256").update(SYSTEM_PROMPT + redacted).digest("hex"),
      latencyMs: Date.now() - started,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
  };
};

const callGemini: ModelCall = async (text) => {
  const { LlmService } = await import("@/src/agents/requirements-agent/services/llm/llm.service");
  return (await LlmService.extractStructuredRequirements(text)) as any;
};

const defaultDeps: ExtractionDeps = {
  async readText(buffer, fileName, mimeType) {
    const isPdf = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      try {
        const { extractPdfText } = await import("@/lib/pdf-text");
        const { text } = await extractPdfText(buffer);
        return { text, wasOcrUsed: false };
      } catch (err: any) {
        // A scan has no text layer: try OCR below (it reports PDF_NO_TEXT itself
        // when OCR is unavailable). Anything else is the PDF's own failure.
        if (err?.name !== "PdfTextError" || err.code !== "PDF_NO_TEXT") throw err;
      }
    }
    let mod: typeof import("@/src/agents/requirements-agent/services/ocr/ocr.service");
    try {
      mod = await import("@/src/agents/requirements-agent/services/ocr/ocr.service");
    } catch (err: any) {
      throw new ExtractionError("DOCUMENT_PARSER_UNAVAILABLE", String(err?.message ?? err));
    }
    return mod.OcrService.extractRawText(buffer, fileName, mimeType);
  },
  async extract(text) {
    const { isClaudeConfigured } = await import("@/lib/ai/claude");
    return extractWithFallback(text, {
      claude: isClaudeConfigured() ? callClaude : null,
      gemini: process.env.GEMINI_API_KEY || process.env.MOCK_AI === "true" ? callGemini : null,
    });
  },
};

/**
 * Runs the Requirements Analyst Agent on a stored document:
 *   <start status> → PROCESSING → AI_EXTRACTED   (or → FAILED)
 *
 * `startedBy` makes the first transition: SYSTEM for a fresh upload, the
 * donor/admin for a retry or re-run (the state machine decides who may).
 * The agent only extracts — it never approves or validates anything.
 *
 * After the model answers, deterministic checks (lib/requirements/extraction-checks.ts)
 * flag conflicting budgets and suspected prompt injection; flagged fields have
 * their confidence capped so they read as "verify", never as certain.
 *
 * Every failure is classified into an ExtractionError (code + message), stored
 * on the requirement as `extractionError`, and re-thrown for the route to return.
 */
export async function runExtraction(params: {
  requirement: SponsorRequirement;
  buffer: Buffer;
  startedBy: { id: string | null; role: ActorRole };
  isRerun: boolean;
  deps?: ExtractionDeps;
}): Promise<SponsorRequirement> {
  const { buffer, startedBy, isRerun } = params;
  const deps = params.deps ?? defaultDeps;

  let current = await prisma.$transaction((tx) =>
    commitRequirementChange(tx, params.requirement, {
      actorId: startedBy.id,
      actorRole: startedBy.role,
      toStatus: "PROCESSING",
      data: { extractionError: Prisma.DbNull },
      audit: {
        action: isRerun ? "REQUIREMENT_EXTRACTION_RERUN" : "CSR_PROCESSING_STARTED",
        detail: isRerun ? "Extraction re-run requested." : "Document processing started.",
      },
    })
  );

  let rawText = "";
  try {
    const extracted = await deps.readText(buffer, current.fileName, current.mimeType);
    rawText = extracted.text;
    if (!rawText.trim()) {
      throw new ExtractionError("PDF_NO_TEXT", "Parser returned no text.");
    }

    const llmResult = await deps.extract(rawText);
    const byRules = llmResult.method === "RULES";
    const checked = checkExtraction(rawText, withAiProvenance(llmResult.data as any, byRules ? "RULES" : "AI_EXTRACTED"));
    const how = byRules
      ? `rule-based extraction (${llmResult.fallbackReason === "EXTRACTION_PROVIDER_UNAVAILABLE" ? "no AI provider configured" : `AI unavailable: ${llmResult.fallbackReason}`})`
      : `${llmResult.method === "CLAUDE" ? "Claude" : "Gemini"} ${llmResult.metadata.model}`;

    current = await prisma.$transaction((tx) =>
      commitRequirementChange(tx, current, {
        actorId: null,
        actorRole: "SYSTEM",
        toStatus: "AI_EXTRACTED",
        fields: checked.fields,
        versionNote: byRules
          ? `Rule-based extraction${isRerun ? " (re-run)" : ""} — please confirm`
          : `${llmResult.method === "CLAUDE" ? "Claude" : "Gemini"} ${isRerun ? "re-extraction" : "extraction"}`,
        data: {
          rawText,
          modelVersion: llmResult.metadata.model,
          extractedByAgent: byRules ? RULE_EXTRACTION_AGENT : llmResult.method === "CLAUDE" ? CLAUDE_EXTRACTION_AGENT : AGENT_NAME,
          reviewNote: null,
          extractionError: Prisma.DbNull,
          extractionFlags: checked.flags.length ? (checked.flags as any) : Prisma.DbNull,
        },
        audit: {
          action: checked.flags.length ? "CSR_EXTRACTION_FLAGGED" : "CSR_EXTRACTION_COMPLETED",
          detail:
            `Extracted with ${how}${extracted.wasOcrUsed ? " (OCR used)" : ""}.` +
            (checked.flags.length ? ` Flagged for human confirmation: ${checked.flags.map((f) => f.code).join(", ")}.` : ""),
          metadata: {
            method: llmResult.method,
            ...(llmResult.fallbackReason ? { fallbackReason: llmResult.fallbackReason } : {}),
            ...(checked.flags.length ? { flags: checked.flags.map((f) => f.code) } : {}),
          },
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
    }).catch((err) => console.error("[extraction] could not log agent execution:", err));

    return current;
  } catch (err: unknown) {
    const failure = classifyExtractionFailure(err);
    if (failure.code === "EXTRACTION_FAILED") console.error("[extraction] unclassified failure:", err);
    try {
      await prisma.$transaction((tx) =>
        commitRequirementChange(tx, current, {
          actorId: null,
          actorRole: "SYSTEM",
          toStatus: "FAILED",
          data: { ...(rawText ? { rawText } : {}), extractionError: toStoredError(failure) as any },
          audit: {
            action: "CSR_EXTRACTION_FAILED",
            detail: `${failure.code}: ${failure.message}`.slice(0, 500),
            metadata: { code: failure.code },
          },
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
        errorMessage: `${failure.code}: ${failure.detail}`.slice(0, 1000),
      });
    } catch (logErr) {
      console.error("[extraction] failed to record extraction failure:", logErr);
    }
    throw failure;
  }
}
