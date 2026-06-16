---
phase: 4
plan: 1
wave: 1
gap_closure: false
---

# Plan 4.1: Google Gemini SDK & Prompting Setup

## Objective
Install the `@google/genai` library, configure experimental Next.js external packages, implement proof validation prompting with strict JSON schemas, and implement the personalized impact narrative generator.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/phases/4/RESEARCH.md
- .gsd/DECISIONS.md
- prisma/schema.prisma

## Tasks

<task type="auto">
  <name>Install Gemini SDK and Setup Proof Validation Wrapper</name>
  <files>
    next.config.mjs
    lib/gemini/validate-proof.ts
  </files>
  <action>
    Steps:
    1. Install `@google/genai` npm package.
    2. Update `next.config.mjs` to include `@google/genai` inside `experimental.serverExternalPackages`.
    3. Create `lib/gemini/validate-proof.ts`:
       - Define the validation schema matching `{ score: number, reasoning: string, flags: string[], suggestion?: string }`.
       - Write `validateMilestoneProof(milestone, description, fileBuffers: { buffer: Buffer, mimeType: string }[]): Promise<ValidationResult>`.
       - Format prompt according to specification. Read file buffers as inline base64 data payloads.
       - Enforce structured JSON output using Gemini's `responseSchema`.
       - Mock Mode: If `GEMINI_API_KEY` is missing in development env, return a mock score (e.g. 85 if description contains "successful", 60 if empty, etc.) and logged reason to console.
  </action>
  <verify>
    Verify compilation with `npx tsc --noEmit`.
  </verify>
  <done>
    Gemini SDK is configured, and proof validation function returns structured JSON under mock and API modes.
  </done>
</task>

<task type="auto">
  <name>Implement Impact Narrative Generator & Verification Script</name>
  <files>
    lib/gemini/generate-narrative.ts
    scripts/test-gemini-prompts.ts
  </files>
  <action>
    Steps:
    1. Create `lib/gemini/generate-narrative.ts`:
       - Write `generateImpactNarrative(donor, donation, project, ngo, milestone, proofDescription, nextMilestoneTitle?: string): Promise<string>`.
       - Set prompt according to the warm, heartfelt storytelling style specified.
       - Restrict output length to 3-4 sentences maximum.
       - Reference actual donation amount and percentage contribution.
       - Mock Mode: Fallback to static text generation template if `GEMINI_API_KEY` is missing.
    2. Create `scripts/test-gemini-prompts.ts`:
       - Execute standalone test invoking both `validateMilestoneProof` and `generateImpactNarrative` under mock/sandbox mode to verify inputs and structure.
  </action>
  <verify>
    npx ts-node -r tsconfig-paths/register -O '{"module": "CommonJS", "moduleResolution": "node", "jsx": "react-jsx"}' scripts/test-gemini-prompts.ts
  </verify>
  <done>
    Narrative generator compiles correctly, and the verification script executes both prompt configurations cleanly.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] Proof validation strictly requires JSON format outputs matching schema.
- [ ] Impact narrative generator incorporates contribution percentage and avoids generic templates when API is active.

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in tests
