import type { FieldEvidenceStatus, ImpactStoryStatus, ImpactStoryVariant, StoryConsentScope } from "@prisma/client";

/**
 * Impact stories (ADM-015 / DON-014 / AI-007 / AI-008).
 *
 * The rule this module exists for: beneficiary material that lacks the right
 * consent purpose is removed BEFORE anything is sent to a model. The filter is
 * deterministic and pure (`selectStoryMaterial`), so it is tested on fixtures
 * and cannot be talked out of its decision by a prompt.
 *
 *   - Withdrawn consent excludes everything captured under it.
 *   - A quote needs consent to record AND a story-consent scope that covers
 *     the audience: DONOR stories accept DONOR_ONLY or PUBLIC, PUBLIC stories
 *     accept only PUBLIC. Consent to record is not consent to publish.
 *   - Feedback inherits approval from its field evidence; unlinked or
 *     unapproved material is excluded (nobody has looked at it).
 *   - Photos: DONOR uses the same rule as isShareableWithDonor; PUBLIC also
 *     needs a PUBLIC story consent when the photo shows people.
 *   - No names ever: the pseudonymous beneficiaryRef is never passed on, and
 *     phone numbers / emails are scrubbed from quotes.
 *
 * Pure module — no prisma, no model client — so it is safe to import anywhere.
 */

export interface StoryCandidate {
  feedbackId: string | null;
  evidenceId: string | null;
  consentToRecord: boolean;
  consentToSharePhoto: boolean;
  storyConsent: StoryConsentScope;
  withdrawnAt: Date | null;
  feedbackText: string | null;
  rating: number | null;
  evidenceStatus: FieldEvidenceStatus | null;
  containsPeople: boolean;
  /** Never forwarded. Present only so tests can prove it is dropped. */
  beneficiaryRef?: string | null;
}

export interface StoryQuote {
  feedbackId: string;
  text: string;
  rating: number | null;
}

export interface StoryMaterial {
  quotes: StoryQuote[];
  photoEvidenceIds: string[];
  usedFeedbackIds: string[];
  excluded: { ref: string; reason: string }[];
}

function scopeCovers(scope: StoryConsentScope, variant: ImpactStoryVariant): boolean {
  if (variant === "PUBLIC") return scope === "PUBLIC";
  return scope === "PUBLIC" || scope === "DONOR_ONLY";
}

/** Strips contact details from free text. Names cannot be detected reliably, which is why quotes also need explicit story consent. */
export function scrubQuote(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[removed]")
    .replace(/(\+?\d[\d\s-]{7,}\d)/g, "[removed]")
    .trim()
    .slice(0, 500);
}

export function selectStoryMaterial(variant: ImpactStoryVariant, candidates: StoryCandidate[]): StoryMaterial {
  const out: StoryMaterial = { quotes: [], photoEvidenceIds: [], usedFeedbackIds: [], excluded: [] };
  for (const c of candidates) {
    const ref = c.feedbackId ?? c.evidenceId ?? "unknown";
    if (c.withdrawnAt) {
      out.excluded.push({ ref, reason: "CONSENT_WITHDRAWN" });
      continue;
    }
    const approved = c.evidenceStatus === "APPROVED";

    // Quote
    if (c.feedbackId && c.feedbackText && c.feedbackText.trim()) {
      if (!approved) out.excluded.push({ ref, reason: "NOT_APPROVED" });
      else if (!c.consentToRecord) out.excluded.push({ ref, reason: "NO_CONSENT_TO_RECORD" });
      else if (!scopeCovers(c.storyConsent, variant)) out.excluded.push({ ref, reason: "NO_STORY_CONSENT_FOR_AUDIENCE" });
      else {
        out.quotes.push({ feedbackId: c.feedbackId, text: scrubQuote(c.feedbackText), rating: c.rating });
        out.usedFeedbackIds.push(c.feedbackId);
      }
    }

    // Photo
    if (c.evidenceId) {
      if (!approved) {
        if (!c.feedbackId) out.excluded.push({ ref, reason: "NOT_APPROVED" });
        continue;
      }
      let ok: boolean;
      if (!c.containsPeople) ok = true;
      else if (!c.feedbackId) ok = false;
      else if (variant === "DONOR") ok = c.consentToSharePhoto;
      else ok = c.consentToSharePhoto && c.storyConsent === "PUBLIC";
      if (ok) {
        out.photoEvidenceIds.push(c.evidenceId);
        if (c.feedbackId && !out.usedFeedbackIds.includes(c.feedbackId)) out.usedFeedbackIds.push(c.feedbackId);
      } else out.excluded.push({ ref: c.evidenceId, reason: "NO_PHOTO_CONSENT_FOR_AUDIENCE" });
    }
  }
  return out;
}

export interface StoryFigure {
  metricName: string;
  value: string;
  unit: string;
}

export interface StoryContext {
  variant: ImpactStoryVariant;
  projectTitle: string;
  orgName: string;
  location: string | null;
  /** Only verified figures (claimDisplay kind "verified"). */
  figures: StoryFigure[];
  material: StoryMaterial;
}

export function buildStoryPrompt(ctx: StoryContext): string {
  const audience =
    ctx.variant === "PUBLIC"
      ? "the general public (website / social). Keep it general; do not mention the funder."
      : "the funder of this project. You may thank them for their support.";
  const figures = ctx.figures.length
    ? ctx.figures.map((f) => `- ${f.metricName}: ${f.value} ${f.unit}`).join("\n")
    : "(none verified — do not state any numbers)";
  const quotes = ctx.material.quotes.length
    ? ctx.material.quotes.map((q, i) => `${i + 1}. "${q.text}"`).join("\n")
    : "(none — do not invent quotes)";
  return `Write a short impact story (120-200 words) for ${audience}
Project: ${ctx.projectTitle}
Organisation: ${ctx.orgName}${ctx.location ? `\nLocation: ${ctx.location}` : ""}

VERIFIED FIGURES (use only these numbers, exactly as given):
${figures}

BENEFICIARY QUOTES (consented; anonymous — attribute only as "a participant"):
${quotes}

Hard rules: never name or describe an identifiable person; never invent numbers, quotes, places or people; no medical or legal claims.
Return JSON {"title": string, "body": string}.`;
}

/** Numbers the story may contain: those in the figures and quotes we supplied. */
export function allowedNumbers(ctx: StoryContext): Set<string> {
  const s = new Set<string>();
  const add = (text: string) => (text.match(/\d+(?:[.,]\d+)*/g) ?? []).forEach((n) => s.add(n.replace(/,/g, "")));
  ctx.figures.forEach((f) => add(f.value));
  ctx.material.quotes.forEach((q) => add(q.text));
  add(ctx.projectTitle);
  return s;
}

/**
 * Schema + hard rules on model output. A number the model was not given is a
 * hallucinated figure — the failure the whole impact module exists to stop —
 * so the output is refused rather than stored.
 */
export function validateStoryOutput(
  raw: unknown,
  ctx: StoryContext,
): { ok: true; title: string; body: string } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "MODEL_OUTPUT_NOT_OBJECT" };
  const { title, body } = raw as Record<string, unknown>;
  if (typeof title !== "string" || !title.trim()) return { ok: false, error: "MODEL_OUTPUT_MISSING_TITLE" };
  if (typeof body !== "string" || body.trim().length < 40) return { ok: false, error: "MODEL_OUTPUT_MISSING_BODY" };
  const allowed = allowedNumbers(ctx);
  const used = (`${title} ${body}`.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));
  const invented = used.filter((n) => !allowed.has(n));
  if (invented.length) return { ok: false, error: "MODEL_OUTPUT_UNSUPPORTED_NUMBER" };
  return { ok: true, title: title.trim().slice(0, 200), body: body.trim().slice(0, 4000) };
}

export const TEMPLATE_LABEL = "Template draft — review before publishing";

/** Deterministic, clearly-labelled fallback. Uses the same filtered material. */
export function templateStory(ctx: StoryContext): { title: string; body: string } {
  const parts: string[] = [];
  parts.push(`[${TEMPLATE_LABEL}. Not AI-generated.]`);
  parts.push(
    ctx.variant === "DONOR"
      ? `Thanks to your support, ${ctx.orgName} continues its work on "${ctx.projectTitle}"${ctx.location ? ` in ${ctx.location}` : ""}.`
      : `${ctx.orgName} is working on "${ctx.projectTitle}"${ctx.location ? ` in ${ctx.location}` : ""}.`,
  );
  if (ctx.figures.length) {
    parts.push("Verified results so far: " + ctx.figures.map((f) => `${f.value} ${f.unit} (${f.metricName})`).join("; ") + ".");
  } else {
    parts.push("No results have completed impact review yet.");
  }
  if (ctx.material.quotes[0]) parts.push(`As one participant put it: "${ctx.material.quotes[0].text}"`);
  return { title: `${ctx.projectTitle} — impact update`, body: parts.join("\n\n") };
}

// ─── Story lifecycle ─────────────────────────────────────────────────────────

export type StoryAction = "SUBMIT" | "PUBLISH" | "REJECT";

export function storyTransition(
  action: unknown,
  current: ImpactStoryStatus,
  actor: "NGO" | "ADMIN",
): { ok: true; to: ImpactStoryStatus } | { ok: false; status: number; error: string } {
  if (action === "SUBMIT") {
    if (actor !== "NGO") return { ok: false, status: 403, error: "Only the organisation submits its story." };
    if (current !== "DRAFT") return { ok: false, status: 409, error: `Cannot submit a ${current} story.` };
    return { ok: true, to: "IN_REVIEW" };
  }
  if (action === "PUBLISH" || action === "REJECT") {
    if (actor !== "ADMIN") return { ok: false, status: 403, error: "Only an admin can publish or reject a story." };
    if (current !== "IN_REVIEW") return { ok: false, status: 409, error: `Cannot ${String(action).toLowerCase()} a ${current} story.` };
    return { ok: true, to: action === "PUBLISH" ? "PUBLISHED" : "REJECTED" };
  }
  return { ok: false, status: 400, error: "Unknown action" };
}

/** What consent withdrawal does to a story that used the withdrawn material. */
export function withdrawalStoryUpdate() {
  return {
    status: "NEEDS_REGENERATION" as const,
    publishedAt: null,
    regenerationReason: "A beneficiary withdrew consent for material this story used. It has been unpublished; regenerate it.",
  };
}
