import { Type } from "@google/genai";

/**
 * The investigator's tools. All read-only except file_finding, which appends
 * evidence to a RiskReview — it cannot suspend, reject, or clear an NGO. Those
 * verbs stay exclusively in app/api/admin/risk/review/route.ts, behind a human.
 *
 * As with the deleted caseworker: the forbidden tools (suspend_ngo, reject_ngo,
 * resolve_alert) are simply absent, not guarded. See registry.ts and
 * tests/fraud-investigator.test.ts.
 */
/**
 * Parameter schema for a tool that genuinely takes no arguments.
 *
 * Deliberately NOT an empty object. Groq's constrained decoding emits malformed
 * `arguments` for zero-property function schemas often enough that it was the
 * single most common way a run died — 400 `tool_use_failed`, observed
 * repeatedly and only ever on the no-argument tools (get_alert_context,
 * check_duplicate_identity, get_document_evidence, get_related_alerts). The
 * failed generation on 2026-08-16 was literally `{"name": "get_related_alerts",
 * "arguments": {"}}`. Giving the model one optional string means there is
 * always something well-formed for it to emit.
 *
 * `reason` is never read by any handler (see READ_TOOLS in tools.ts) and is
 * stripped from the repeat-call signature in run.ts, so a model that varies its
 * reason cannot disguise the same call being made twice.
 */
const NO_ARGS = {
  type: Type.OBJECT,
  properties: {
    reason: { type: Type.STRING, description: "One short phrase: why you are calling this now." },
  },
  required: [] as string[],
};

export const DECLARATIONS = [
  {
    name: "get_alert_context",
    description:
      "The alert that triggered this investigation: its type, description, severity, and when it fired. Call this first.",
    parameters: NO_ARGS,
  },
  {
    name: "get_ngo_profile",
    description:
      "Basic identity for the NGO under investigation: name, PAN, registration number, founding year, verification status, suspension history, account age.",
    parameters: NO_ARGS,
  },
  {
    name: "list_ngo_projects",
    description:
      "Every project this NGO runs: title, status, target and raised amounts, donor count, milestone completion. Use this to see the shape of their activity, not just the one alert.",
    parameters: NO_ARGS,
  },
  {
    name: "list_ngo_team",
    description:
      "This NGO's team members: role and email. The email is what you cross-reference with find_shared_team_members — a shared person across unrelated NGOs is the strongest structural signal available.",
    parameters: NO_ARGS,
  },
  {
    name: "find_shared_team_members",
    description:
      "Given an email seen on this NGO's team, find every OTHER NGO that email is also a team member of. Call this when list_ngo_team gives you an email worth checking, not for every email indiscriminately.",
    parameters: {
      type: Type.OBJECT,
      properties: { email: { type: Type.STRING } },
      required: ["email"],
    },
  },
  {
    name: "check_duplicate_identity",
    description:
      "Whether this NGO's PAN or registration number is already claimed by a different NGO. A hit is one of the few signals serious enough to report on its own.",
    parameters: NO_ARGS,
  },
  {
    name: "get_donor_overlap",
    description:
      "Donors who have funded BOTH this NGO and a second NGO you name, with amounts and dates. Use this once you have a specific other NGO in mind — from team overlap, a duplicate identity hit, or the alert itself — not to scan at random.",
    parameters: {
      type: Type.OBJECT,
      properties: { otherNgoId: { type: Type.STRING } },
      required: ["otherNgoId"],
    },
  },
  {
    name: "get_related_alerts",
    description:
      "Every other fraud alert and risk review already on record for this NGO, resolved or not. Call this to see whether today's alert is a first occurrence or part of a pattern you should already know about.",
    parameters: NO_ARGS,
  },
  {
    name: "get_proof_score_history",
    description:
      "This NGO's AI milestone-proof validation scores over time, oldest first. A steady decline or a cluster of low scores around a specific project is worth noting; a single low score usually is not.",
    parameters: NO_ARGS,
  },
  {
    name: "get_document_evidence",
    description:
      "What this NGO's registration documents were read to say: each document's type, whether it was readable, the organisation name printed on it, and every extracted field with its value, whether it matches the registration form, and whether a human has validated it. Call this when the alert concerns identity or paperwork, or to check whether a structural suspicion (a shared person, a duplicate PAN) is corroborated by what the documents themselves say. If this returns analysed:false, the documents have never been read — that is NOT evidence they are sound, and is not by itself a finding.",
    parameters: NO_ARGS,
  },
  {
    name: "file_finding",
    description:
      "Add one finding to this NGO's case file for a human to review. This does NOT suspend, reject, or resolve anything — it opens or adds to a RiskReview. Cite the specific records that support it.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        severity: {
          type: Type.STRING,
          enum: ["LOW", "MEDIUM", "HIGH"],
          description:
            "How much this matters. HIGH = you would stop this NGO's next payout over it. MEDIUM = worth a human's time. LOW = noticed, but would not act on it alone.",
        },
        finding: {
          type: Type.STRING,
          description:
            "What you found and the specific mechanism by which it could enable fraud. State only what your tool results actually showed. If you are inferring something you did not directly observe, say so with words like 'suggests' or 'is consistent with' — do not assert it as established fact.",
        },
        evidence: {
          type: Type.STRING,
          description: "The specific records that support this — names, dates, amounts, ids.",
        },
        confidence: {
          type: Type.STRING,
          enum: ["POSSIBLE", "LIKELY", "CONFIRMED"],
          description:
            "How certain you are THAT SOMETHING IS WRONG — not how certain you are of the raw facts. " +
            "The facts came from tools, so they are always certain; the question is what they prove. " +
            "CONFIRMED = the wrongdoing itself is established by the tool results alone, with no innocent " +
            "explanation remaining (e.g. the same PAN is registered to two organisations — that IS a duplicate " +
            "identity, not evidence of one). " +
            "LIKELY = the facts strongly point to wrongdoing and an innocent explanation is a stretch, but you " +
            "are still inferring intent or a connection you cannot see. " +
            "POSSIBLE = consistent with wrongdoing, but an ordinary explanation fits the same facts just as well. " +
            "Two NGOs sharing a finance officer and some donors is POSSIBLE or LIKELY — genuinely related " +
            "charities share staff and supporters all the time. It is not CONFIRMED fraud just because you " +
            "definitely observed the sharing. Overstating is worse than understating: an admin who finds one " +
            "CONFIRMED finding was really a suspicion will stop trusting every finding you file.",
        },
      },
      required: ["severity", "finding", "evidence", "confidence"],
    },
  },
  {
    name: "close_investigation",
    description:
      "End the investigation. Call this once you have filed everything worth filing, or once you have checked the reasonable lines of inquiry and found nothing that clears the bar in rule 2.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: {
          type: Type.STRING,
          description: "One paragraph a human can read without re-running your work.",
        },
        clean: {
          type: Type.BOOLEAN,
          description: "True if you found nothing worth a human's attention.",
        },
      },
      required: ["summary", "clean"],
    },
  },
];

export const TERMINAL_TOOLS = new Set(["close_investigation"]);
