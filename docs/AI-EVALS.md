# AI in ImpactBridge — what each model does, and how it is checked

For engineers changing a prompt, a model, or a guard. Every AI feature here
follows the same shape: **the model proposes, deterministic code decides, a
human approves anything a donor sees.** No test calls a live model.

## Inventory

| Feature | Code | Model output used for | Guard (no model) | Human gate |
|---|---|---|---|---|
| NGO registration extraction | `lib/gemini/extract-ngo-fields.ts` | Field values + confidence | `resolveField` (threshold, formats, form cross-check), `verification-triage` | Admin validates each field |
| CSR requirement extraction | `src/agents/requirements-agent/*`, `lib/requirements/extraction.ts` | Requirement fields + confidence | `RequirementSchema` (zod), provenance | Donor corrects; admin validates |
| Proposal assistant | `lib/requirements/proposal-assistant.ts` | An answer citing sources `[S1]` | `checkGrounding` (invented citations stripped; uncited → fallback) | Donor reads; it decides nothing |
| Milestone proof scoring | `lib/gemini/validate-proof.ts` | Score + reasoning | Score is advisory; never auto-approves | Admin proof review |
| Outcome extraction | `lib/gemini/extract-outcomes.ts` | Suggested figures + verbatim quote | `guardOutcomeExtraction` (quote in source, value in quote, confidence, known metrics) | NGO saves draft; admin approves claim |
| Outcome triage | `lib/outcome-triage.ts` | — (no model) | Arithmetic and set rules | Admin decides |

## The regression set

`tests/ai-regression.test.ts` runs golden fixtures from `tests/fixtures/ai/`:

- `requirement-extraction.json` — schema must accept good output and refuse
  missing fields, formatted numbers, percentage confidences, wrong types.
- `proposal-assistant.json` — invented sources stripped, uncited opinion
  refused, honest "not found" allowed.
- `outcome-extraction.json` — hallucinated quotes, inflated values, unknown
  sources, low confidence, unrequested metrics, malformed output all become
  `INSUFFICIENT_DATA`; every requested metric is answered exactly once.

Feature-level tests sit beside these: `extraction-guardrails`,
`outcome-extraction`, `proposal-assistant`, `requirements-agent`.

## Changing a prompt or model

1. Capture real outputs from the new prompt/model on a handful of real
   (anonymised) inputs.
2. Add every output that should have been refused — and one that should pass —
   to the matching fixture file **before** changing the guard.
3. Run `npx vitest run tests/ai-regression.test.ts`. A red case is either a
   guard to tighten or a fixture expectation to argue about in review.
4. Never relax a guard to make a model pass. Lower recall (more
   "insufficient data") is acceptable; a figure a donor sees that no evidence
   supports is not.

## Rules that are not negotiable

- No model output reaches a donor without a human approval in between.
- "No evidence" never reads as "fine" — unknown is reported as unknown.
- Beneficiary feedback text and consent-gated photos are never sent to a model.
- Tests never call a live model; pin behaviour with fixtures.
