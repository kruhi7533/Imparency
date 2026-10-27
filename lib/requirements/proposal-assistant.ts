import { GoogleGenAI } from "@google/genai";
import { normalizeFields, REQUIREMENT_FIELDS, REQUIREMENT_FIELD_KEYS } from "./provenance";
import { loadRequirementForActor, type Actor } from "./access";
import { listResponses, type ResponseItem } from "./queries";
import { RequirementWorkflowError } from "./errors";
import { callAi } from "@/lib/ai/telemetry";

/**
 * Grounded assistant for a donor reviewing NGO proposals on one requirement.
 *
 * Grounded means: the model sees ONLY a numbered fact sheet built from this
 * requirement and its proposals (current and superseded versions), must cite a
 * source id ([S1], [S2]…) for every claim, and must say plainly when the answer
 * is not in the proposals. The server then checks the citations — any [S#]
 * that does not exist is removed and reported, and an answer with no valid
 * citation is flagged as ungrounded rather than presented as fact.
 *
 * It advises; it never decides. Nothing here changes a proposal's status.
 * No API key → a deterministic summary of the same facts, so the panel still works.
 */

export interface Source {
  id: string;
  label: string;
  text: string;
}

export const QUESTION_MIN = 3;
export const QUESTION_MAX = 500;
export const NOT_FOUND = "The proposals do not say.";

const inr = (n: number | null | undefined) => (n === null || n === undefined ? "not stated" : `₹${n.toLocaleString("en-IN")}`);

function milestoneText(m: unknown): string {
  if (!Array.isArray(m) || m.length === 0) return "none listed";
  return m
    .map((x: any, i: number) => `${i + 1}. ${x.title}${x.amount ? ` (${inr(Number(x.amount))})` : ""}${x.durationMonths ? `, ${x.durationMonths} months` : ""}`)
    .join("; ");
}

/** Numbered fact sheet: the requirement, then each NGO's current proposal, then its earlier versions. */
export function buildSources(extractedFields: unknown, responses: ResponseItem[]): Source[] {
  const fields = normalizeFields(extractedFields);
  const sources: Source[] = [];
  const reqLines = REQUIREMENT_FIELD_KEYS.filter((k) => !k.startsWith("contact") && fields[k].value !== null).map((k) => {
    const v = fields[k].value;
    return `${REQUIREMENT_FIELDS[k].label}: ${Array.isArray(v) ? v.join(", ") : String(v)}`;
  });
  sources.push({ id: "S1", label: "Your requirement", text: reqLines.join("\n") || "No details recorded." });

  for (const r of responses) {
    sources.push({
      id: `S${sources.length + 1}`,
      label: `${r.ngo.orgName} — proposal V${r.version} (current)`,
      text: [
        `Organisation: ${r.ngo.orgName}; project: ${r.project.title}`,
        `Status: ${r.status}${r.revisionRounds ? `; revision rounds: ${r.revisionRounds}` : ""}`,
        `Proposed budget: ${inr(r.proposedBudget)}; duration: ${r.proposedDurationMonths ? `${r.proposedDurationMonths} months` : "not stated"}`,
        `Health score: ${r.ngo.healthScore === null ? "not computed" : `${Math.round(r.ngo.healthScore)}/100`}`,
        `Implementation plan: ${r.implementationPlan ?? "not provided"}`,
        `Expected outcomes: ${r.expectedOutcomes ?? "not provided"}`,
        `Milestones: ${milestoneText(r.milestones)}`,
        `Compliance: ${r.complianceNotes ?? "not provided"}`,
        r.status === "CHANGES_REQUESTED" && r.changeRequestNote ? `Your pending change request: ${r.changeRequestNote}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    for (const v of r.revisions) {
      sources.push({
        id: `S${sources.length + 1}`,
        label: `${r.ngo.orgName} — proposal V${v.version} (superseded)`,
        text: [
          `Proposed budget: ${inr(v.proposedBudget)}; duration: ${v.proposedDurationMonths ? `${v.proposedDurationMonths} months` : "not stated"}`,
          `Implementation plan: ${v.implementationPlan ?? "not provided"}`,
          `Milestones: ${milestoneText(v.milestones)}`,
          v.supersededBecause ? `Replaced after your change request: ${v.supersededBecause}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
    }
  }
  return sources;
}

export function buildPrompt(question: string, sources: Source[]): string {
  return `You help a CSR donor review NGO proposals. Answer the donor's question using ONLY the numbered sources below.

RULES
- Every factual sentence must end with the id of the source it comes from, in square brackets, e.g. [S2]. Use several when comparing, e.g. [S2][S3].
- Use only the source ids listed. Never invent a source, a number, an NGO, or a fact.
- If the sources do not contain the answer, reply exactly: "${NOT_FOUND}" and, if useful, say what IS known with its citation.
- Do not recommend which NGO to choose; you may compare facts. The donor decides.
- Plain text, at most 150 words. No markdown headings.

SOURCES
${sources.map((s) => `[${s.id}] ${s.label}\n${s.text}`).join("\n\n")}

QUESTION
${question}`;
}

/**
 * Checks an answer against the sources it was allowed to use. Unknown citations
 * are removed (and reported) rather than shown as if they pointed somewhere.
 */
export function checkGrounding(answer: string, sources: Source[]) {
  const valid = new Set(sources.map((s) => s.id));
  const invalidCitations: string[] = [];
  const cleaned = answer
    .replace(/\[(S\d+)\]/g, (m, id: string) => {
      if (valid.has(id)) return m;
      invalidCitations.push(id);
      return "";
    })
    .replace(/[ \t]+([.,;])/g, "$1")
    .trim();
  const citations = Array.from(new Set(Array.from(cleaned.matchAll(/\[(S\d+)\]/g)).map((m) => m[1])));
  const saysNotFound = cleaned.startsWith(NOT_FOUND);
  return {
    answer: cleaned,
    citations,
    invalidCitations: Array.from(new Set(invalidCitations)),
    grounded: citations.length > 0 || saysNotFound,
  };
}

/** Used when no model is configured: the facts themselves, cited, with no interpretation. */
export function fallbackAnswer(sources: Source[]): string {
  const proposals = sources.filter((s) => s.label.endsWith("(current)"));
  if (proposals.length === 0) return `${NOT_FOUND} No NGO has submitted a proposal yet. [S1]`;
  const lines = proposals.map((s) => {
    const budget = /Proposed budget: ([^;]+)/.exec(s.text)?.[1] ?? "not stated";
    const status = /Status: ([A-Z_]+)/.exec(s.text)?.[1] ?? "";
    return `${s.label.replace(" (current)", "")}: budget ${budget}, ${status.replace(/_/g, " ").toLowerCase()} [${s.id}]`;
  });
  return `The AI assistant is not configured, so here are the proposal facts it would answer from:\n${lines.join("\n")}`;
}

export type Generate = (prompt: string) => Promise<string | null>;

const geminiGenerate: Generate = async (prompt) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const ai = new GoogleGenAI({ apiKey });
  const response = await callAi({ site: "proposal-assistant", model: "gemini-3.5-flash-lite", promptVersion: "v1" }, () => ai.models.generateContent({ model: "gemini-3.5-flash-lite", contents: [prompt] }));
  return response.text?.trim() || null;
};

/** Provider order: Claude (ANTHROPIC_API_KEY) → Gemini → null (deterministic, labelled fallback). */
const defaultGenerate: Generate = async (prompt) => {
  try {
    const { isClaudeConfigured, claudeStructured } = await import("@/lib/ai/claude");
    if (isClaudeConfigured()) {
      const { z } = await import("zod");
      const out = await claudeStructured({ schema: z.object({ answer: z.string() }), content: [{ type: "text", text: prompt }], effort: "low" });
      if (out.answer.trim()) return out.answer.trim();
    }
  } catch (err) {
    console.error("[proposal-assistant] Claude failed — trying Gemini:", (err as Error)?.message);
  }
  return geminiGenerate(prompt);
};

/** Owner or admin asks a question about the proposals on their requirement. */
export async function answerProposalQuestion(args: {
  requirementId: string;
  actor: Actor;
  question: unknown;
  generate?: Generate;
}) {
  const question = typeof args.question === "string" ? args.question.trim() : "";
  if (question.length < QUESTION_MIN || question.length > QUESTION_MAX) {
    throw new RequirementWorkflowError(`Ask a question of ${QUESTION_MIN}–${QUESTION_MAX} characters.`, 400);
  }
  const req = await loadRequirementForActor(args.requirementId, args.actor);
  const responses = await listResponses(args.requirementId);
  const sources = buildSources(req.extractedFields, responses);
  const meta = sources.map(({ id, label }) => ({ id, label }));

  let raw: string | null = null;
  try {
    raw = await (args.generate ?? defaultGenerate)(buildPrompt(question, sources));
  } catch (err) {
    console.error("[proposal-assistant] model call failed:", err);
  }
  if (!raw) {
    const answer = fallbackAnswer(sources);
    return {
      answer,
      citations: checkGrounding(answer, sources).citations,
      invalidCitations: [],
      grounded: true,
      usedModel: false,
      // Structured, so a client can tell "no provider" from a model answer.
      code: "AI_PROVIDER_UNAVAILABLE" as const,
      sources: meta,
    };
  }
  return { ...checkGrounding(raw, sources), usedModel: true, sources: meta };
}
