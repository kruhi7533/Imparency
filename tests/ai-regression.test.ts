import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * AI regression set (roadmap row 13, "AI regression"). Golden fixtures in
 * tests/fixtures/ai/*.json record model outputs — good ones and every bad
 * shape we have seen or can foresee — and what the platform must do with
 * each. No model is called: this pins the guards that stand between a model
 * and a donor. When a model or prompt change produces a new failure, add the
 * output as a case here first. See docs/AI-EVALS.md.
 */

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { RequirementSchema } from "@/src/agents/requirements-agent/validators/schema";
import { checkGrounding } from "@/lib/requirements/proposal-assistant";
import { guardOutcomeExtraction } from "@/lib/gemini/extract-outcomes";

const load = (name: string) => JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "ai", name), "utf8"));

describe("requirement extraction schema (golden set)", () => {
  const fx = load("requirement-extraction.json");
  const byName = new Map<string, any>(fx.cases.filter((c: any) => c.output).map((c: any) => [c.name, c.output]));
  for (const c of fx.cases) {
    it(`${c.expect}: ${c.name}`, () => {
      let output = c.output;
      if (!output) {
        output = structuredClone(byName.get(c.base));
        for (const k of c.dropKeys ?? []) delete output[k];
        Object.assign(output, c.patch ?? {});
      }
      expect(RequirementSchema.safeParse(output).success).toBe(c.expect === "valid");
    });
  }
});

describe("proposal assistant grounding (golden set)", () => {
  const fx = load("proposal-assistant.json");
  const sources = fx.sources.map((id: string) => ({ id, label: id, text: "" }));
  for (const c of fx.cases) {
    it(`${c.grounded ? "grounded" : "ungrounded"}: ${c.name}`, () => {
      const r = checkGrounding(c.answer, sources);
      expect(r.grounded).toBe(c.grounded);
      expect(r.invalidCitations).toEqual(c.invalid);
      for (const bad of c.invalid) expect(r.answer).not.toContain(`[${bad}]`);
    });
  }
});

describe("outcome extraction guard (golden set)", () => {
  const fx = load("outcome-extraction.json");
  for (const c of fx.cases) {
    it(c.name, () => {
      const result = guardOutcomeExtraction(c.output, fx.metrics, fx.sources);
      // Every requested metric is answered exactly once, in order.
      expect(result.map((r) => r.metricCode)).toEqual(fx.metrics.map((m: any) => m.code));
      for (const r of result) {
        const want: string = c.expect[r.metricCode];
        if (want.startsWith("EXTRACTED")) {
          expect(r.status).toBe("EXTRACTED");
          expect(r.status === "EXTRACTED" && r.value).toBe(want.split(":")[1]);
        } else {
          expect(r.status).toBe("INSUFFICIENT_DATA");
        }
      }
    });
  }
});
