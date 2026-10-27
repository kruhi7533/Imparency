import type { ImpactStoryVariant } from "@prisma/client";
import prisma from "@/lib/prisma";
import { loadDonorProjectOutcomes } from "@/lib/outcome-cockpit";
import { OUTCOME_UNIT_LABEL } from "@/lib/outcome-format";
import { z } from "zod";
import { claudeStructured, isClaudeConfigured } from "@/lib/ai/claude";
import {
  buildStoryPrompt,
  selectStoryMaterial,
  templateStory,
  validateStoryOutput,
  withdrawalStoryUpdate,
  type StoryCandidate,
  type StoryContext,
} from "@/lib/impact-stories";

/**
 * Server side of impact stories: gather candidates, filter by consent (pure,
 * lib/impact-stories.ts), call the model, persist a DRAFT. Also the consent-
 * withdrawal propagation into stories.
 */

/** Candidate beneficiary material for a project: field evidence + its feedback. */
export async function loadStoryCandidates(projectId: string, ngoId: string): Promise<StoryCandidate[]> {
  const evidence = await prisma.fieldEvidence.findMany({
    where: { projectId, ngoId },
    orderBy: { capturedAt: "desc" },
    take: 200,
    select: {
      id: true,
      status: true,
      containsPeople: true,
      feedback: {
        select: {
          id: true,
          consentToRecord: true,
          consentToSharePhoto: true,
          storyConsent: true,
          withdrawnAt: true,
          feedbackText: true,
          rating: true,
        },
      },
    },
  });
  return evidence.map((e) => ({
    feedbackId: e.feedback?.id ?? null,
    evidenceId: e.id,
    consentToRecord: e.feedback?.consentToRecord ?? false,
    consentToSharePhoto: e.feedback?.consentToSharePhoto ?? false,
    storyConsent: e.feedback?.storyConsent ?? "NONE",
    withdrawnAt: e.feedback?.withdrawnAt ?? null,
    feedbackText: e.feedback?.feedbackText ?? null,
    rating: e.feedback?.rating ?? null,
    evidenceStatus: e.status,
    containsPeople: e.containsPeople,
  }));
}

export type StoryProviderName = "CLAUDE" | "GEMINI";

/** One AI provider: whether it is configured, and the call (returns raw JSON-ish output). */
export interface StoryProvider {
  name: StoryProviderName;
  available: () => boolean;
  call: (prompt: string) => Promise<unknown>;
}

const STORY_SYSTEM =
  "You write short, factual impact stories for a donation-transparency platform. Use only the facts given. Never name or describe an identifiable person. Never invent numbers, quotes, places or people.";

export const claudeStoryProvider: StoryProvider = {
  name: "CLAUDE",
  available: () => isClaudeConfigured(),
  call: (prompt) =>
    claudeStructured({
      schema: z.object({ title: z.string(), body: z.string() }),
      content: [{ type: "text", text: prompt }],
      system: STORY_SYSTEM,
      effort: "low",
      maxTokens: 2000,
    }),
};

export const geminiStoryProvider: StoryProvider = {
  name: "GEMINI",
  available: () => !!process.env.GEMINI_API_KEY?.trim(),
  call: async (prompt) => {
    const { GoogleGenAI, Type } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const res = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: `${STORY_SYSTEM}\n\n${prompt}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { title: { type: Type.STRING }, body: { type: Type.STRING } },
          required: ["title", "body"],
        },
      },
    });
    return JSON.parse(res.text ?? "null");
  },
};

/** Provider order: Claude (if ANTHROPIC_API_KEY) → Gemini (if GEMINI_API_KEY) → template. */
export const DEFAULT_STORY_PROVIDERS: StoryProvider[] = [claudeStoryProvider, geminiStoryProvider];

export type GenerateResult =
  | { ok: true; storyId: string; generator: "CLAUDE" | "GEMINI" | "TEMPLATE"; excludedCount: number; fallbackReason: string | null }
  | { ok: false; status: number; code: string; error: string };

/**
 * Runs providers in order, falling through on ANY error or on output that
 * fails validateStoryOutput (e.g. an unsupported number). Returns null when no
 * provider produced a valid draft, with the reason for the last fall-through.
 */
export async function runStoryProviders(
  providers: StoryProvider[],
  ctx: StoryContext,
): Promise<{ story: { title: string; body: string }; provider: StoryProviderName } | { story: null; reason: string }> {
  const prompt = buildStoryPrompt(ctx);
  let reason = "AI_PROVIDER_UNAVAILABLE";
  for (const p of providers) {
    if (!p.available()) continue;
    try {
      const v = validateStoryOutput(await p.call(prompt), ctx);
      if (v.ok) return { story: { title: v.title, body: v.body }, provider: p.name };
      reason = v.error;
      console.warn(`[impact-story] ${p.name} draft rejected: ${v.error}`);
    } catch (err) {
      reason = "AI_CALL_FAILED";
      console.error(`[impact-story] ${p.name} call failed:`, err instanceof Error ? err.message : err);
    }
  }
  return { story: null, reason };
}

export async function generateStory(args: {
  ngoId: string;
  projectId: string;
  contractId: string | null;
  variant: ImpactStoryVariant;
  userId: string;
  providers?: StoryProvider[];
}): Promise<GenerateResult> {
  const project = await prisma.project.findUnique({
    where: { id: args.projectId },
    select: { id: true, ngoId: true, title: true, location: true, ngo: { select: { orgName: true } } },
  });
  if (!project || project.ngoId !== args.ngoId) return { ok: false, status: 404, code: "NOT_FOUND", error: "Project not found" };

  // Consent filtering happens HERE, before any prompt exists.
  const material = selectStoryMaterial(args.variant, await loadStoryCandidates(project.id, args.ngoId));
  const outcomes = await loadDonorProjectOutcomes(project.id);
  const figures = outcomes.rows
    .filter((r) => r.display.kind === "verified")
    .map((r) => ({
      metricName: r.metricName,
      value: (r.display as { value: string }).value,
      unit: OUTCOME_UNIT_LABEL[r.unit] ?? String(r.unit).toLowerCase(),
    }));
  const ctx: StoryContext = {
    variant: args.variant,
    projectTitle: project.title,
    orgName: project.ngo.orgName,
    location: project.location || null,
    figures,
    material,
  };

  // Providers run only on the consent-filtered context above. With no key,
  // any provider error, or a draft that breaks a hard rule, it falls through
  // to the deterministic template — built from the same filtered material and
  // verified figures, stored as generator TEMPLATE and labelled in the UI.
  // Whichever wrote it, it is a DRAFT an admin must review before publication.
  const run = await runStoryProviders(args.providers ?? DEFAULT_STORY_PROVIDERS, ctx);
  const generator: "CLAUDE" | "GEMINI" | "TEMPLATE" = run.story ? run.provider : "TEMPLATE";
  const story = run.story ?? templateStory(ctx);
  const fallbackReason = run.story ? null : run.reason;

  const created = await prisma.impactStory.create({
    data: {
      ngoId: args.ngoId,
      projectId: project.id,
      contractId: args.contractId,
      variant: args.variant,
      generator,
      title: story.title,
      body: story.body,
      sourceFeedbackIds: material.usedFeedbackIds,
      sourceEvidenceIds: material.photoEvidenceIds,
      excludedCount: material.excluded.length,
      createdById: args.userId,
    },
    select: { id: true },
  });
  return { ok: true, storyId: created.id, generator, excludedCount: material.excluded.length, fallbackReason };
}

/**
 * NEG-003: a withdrawal reaches every story that used the material. Published
 * ones are unpublished; drafts and in-review ones are flagged too, so nothing
 * built on withdrawn consent can be published later. Returns the count.
 */
export async function propagateWithdrawalToStories(feedbackId: string, evidenceId: string | null): Promise<number> {
  const { count } = await prisma.impactStory.updateMany({
    where: {
      status: { in: ["DRAFT", "IN_REVIEW", "PUBLISHED"] },
      OR: [
        { sourceFeedbackIds: { has: feedbackId } },
        ...(evidenceId ? [{ sourceEvidenceIds: { has: evidenceId } }] : []),
      ],
    },
    data: withdrawalStoryUpdate(),
  });
  return count;
}

export function serializeStory(s: any) {
  return {
    id: s.id,
    projectId: s.projectId,
    contractId: s.contractId,
    variant: s.variant,
    status: s.status,
    generator: s.generator,
    title: s.title,
    body: s.body,
    excludedCount: s.excludedCount,
    photoEvidenceIds: s.sourceEvidenceIds,
    reviewNote: s.reviewNote ?? null,
    regenerationReason: s.regenerationReason ?? null,
    publishedAt: s.publishedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}
