import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
  Type: { OBJECT: "OBJECT", STRING: "STRING", NUMBER: "NUMBER", ARRAY: "ARRAY" },
}));

import { LlmService, LlmUnavailableError } from "@/src/agents/requirements-agent/services/llm/llm.service";

const f = (value: unknown) => ({ value, confidence: 0.9 });
const VALID_EXTRACTION = {
  sector: f("Education"),
  state: f("Assam"),
  district: f("Kamrup"),
  budgetMin: f(5000000),
  budgetMax: f(10000000),
  currency: f("INR"),
  durationMonths: f(24),
  expectedBeneficiaries: f(1000),
  primaryKPIs: f(["Learning outcomes"]),
  secondaryKPIs: f(["Attendance"]),
  reportingCadence: f("Quarterly"),
  timeline: f("24 months"),
  requiredDocuments: f(["80G Certificate"]),
  contactPerson: f("A Person"),
  contactEmail: f("csr@example.org"),
  contactPhone: f("+911234567890"),
  specialConstraints: f("None"),
  summary: f("Education programme in rural Assam."),
};

const ok = () => ({ text: JSON.stringify(VALID_EXTRACTION), usageMetadata: {}, responseId: "r1" });
const overloaded = () =>
  Object.assign(
    new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'),
    { status: 503 }
  );

describe("LlmService.extractStructuredRequirements — overload handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("MOCK_AI", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to the next model when the primary is overloaded", async () => {
    generateContent.mockImplementation(async ({ model }: { model: string }) => {
      if (model === "gemini-3.6-flash") throw overloaded();
      return ok();
    });

    const result = await LlmService.extractStructuredRequirements("CSR text", 1);

    expect(result.metadata.model).toBe("gemini-3.5-flash-lite");
    expect(result.data.state.value).toBe("Assam");
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual([
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
    ]);
  });

  it("throws a readable LlmUnavailableError when every model is overloaded", async () => {
    generateContent.mockRejectedValue(overloaded());

    const err = await LlmService.extractStructuredRequirements("CSR text", 1).catch((e) => e);

    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect(err.message).toMatch(/temporarily overloaded/);
    expect(err.message).not.toMatch(/\{"error"/); // no raw provider JSON shown to users
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("does not switch models for non-capacity errors", async () => {
    generateContent.mockRejectedValue(Object.assign(new Error("Invalid argument"), { status: 400 }));

    const err = await LlmService.extractStructuredRequirements("CSR text", 1).catch((e) => e);

    expect(err).not.toBeInstanceOf(LlmUnavailableError);
    expect(err.message).toMatch(/Failed to extract structured requirements after 1 attempts/);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
