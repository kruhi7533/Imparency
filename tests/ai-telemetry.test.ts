import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * AI-009 (telemetry) and AI-010 (timeout + fault injection + degraded paths).
 *
 * No test makes a network or model call: with fault injection on, callAi
 * refuses BEFORE the provider function runs, which is itself asserted.
 */

const db = vi.hoisted(() => ({
  aiCallLog: { create: vi.fn() },
  appSetting: { findUnique: vi.fn(), upsert: vi.fn() },
  project: { findUnique: vi.fn(), update: vi.fn() },
  adminActionLog: { create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ isBlocked: false }) }));
vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { AiUnavailableError, callAi, estimateCostUsd, runRules, usageOf, AI_UNAVAILABLE_MESSAGE } from "@/lib/ai/telemetry";
import { clearFaultCache, getAiFaultMode } from "@/lib/ai/fault-injection";
import { GET as FAULT_GET, POST as FAULT_POST } from "@/app/api/admin/ai-telemetry/fault-injection/route";
import { GET as TELEMETRY_GET } from "@/app/api/admin/ai-telemetry/route";
import { POST as SCREEN } from "@/app/api/admin/screen-project/route";
import { draftNudgeMessage } from "@/lib/gemini/draft-ngo-nudge";
import { generateImpactNarrative } from "@/lib/gemini/generate-narrative";
import { extractOutcomes } from "@/lib/gemini/extract-outcomes";
import { claudeStructured } from "@/lib/ai/claude";

const session = getServerSession as any;
const meta = { site: "test-site", model: "gemini-3.5-flash-lite", promptVersion: "v1" };
const env = process.env as Record<string, string | undefined>;
const lastLog = () => db.aiCallLog.create.mock.calls.at(-1)?.[0].data;

beforeEach(() => {
  vi.clearAllMocks();
  clearFaultCache();
  db.appSetting.findUnique.mockResolvedValue(null);
  db.aiCallLog.create.mockResolvedValue({});
  session.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  delete env.AI_FAULT_INJECTION;
  delete env.AI_FAULT_INJECTION_ALLOW_PRODUCTION;
  delete env.AI_TIMEOUT_MS;
  delete env.GEMINI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  env.NODE_ENV = "test";
  vi.useRealTimers();
});

describe("AI-009 — one telemetry row per call", () => {
  it("records model, prompt version, latency, tokens and a cost estimate on success", async () => {
    const result = { text: "ok", usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 } };
    await expect(callAi(meta, async () => result)).resolves.toBe(result);
    expect(lastLog()).toMatchObject({
      site: "test-site",
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      promptVersion: "v1",
      outcome: "OK",
      faultInjected: false,
      tokensIn: 1000,
      tokensOut: 200,
    });
    expect(Number(lastLog().costUsd)).toBeCloseTo(0.00018, 6);
    expect(typeof lastLog().latencyMs).toBe("number");
  });

  it("stores no prompt or response text", async () => {
    await callAi(meta, async () => ({ text: "SECRET RESPONSE" }));
    expect(JSON.stringify(lastLog())).not.toContain("SECRET");
  });

  it("records ERROR and rethrows the provider error unchanged (retry helpers read its status)", async () => {
    const err: any = Object.assign(new Error("quota"), { status: 429 });
    await expect(callAi(meta, async () => Promise.reject(err))).rejects.toBe(err);
    expect(lastLog()).toMatchObject({ outcome: "ERROR", errorCode: "429", costUsd: null });
  });

  it("a call over budget is TIMEOUT and becomes AiUnavailableError", async () => {
    env.AI_TIMEOUT_MS = "20";
    const never = () => new Promise(() => {});
    const p = callAi(meta, never);
    await expect(p).rejects.toBeInstanceOf(AiUnavailableError);
    expect(lastLog()).toMatchObject({ outcome: "TIMEOUT", errorCode: "TIMEOUT" });
  });

  it("reads usage from Anthropic and OpenAI-compatible responses too", () => {
    expect(usageOf({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 } })).toEqual({ tokensIn: 12, tokensOut: 5 });
    expect(usageOf({ usage: { prompt_tokens: 7, completion_tokens: 3 } })).toEqual({ tokensIn: 7, tokensOut: 3 });
    expect(usageOf({ text: "x" })).toEqual({ tokensIn: null, tokensOut: null });
    expect(estimateCostUsd("unknown-model", { tokensIn: 5, tokensOut: 5 })).toBeNull();
  });

  it("rule-based runs are recorded with provider 'rules' so they show on the page", async () => {
    await runRules("extract-ngo-fields", async () => "ok", "gemini");
    expect(lastLog()).toMatchObject({ site: "extract-ngo-fields", provider: "rules", outcome: "OK", errorCode: "FALLBACK_FROM_GEMINI" });
  });

  it("a telemetry write failure never fails the call", async () => {
    db.aiCallLog.create.mockRejectedValue(new Error("db down"));
    await expect(callAi(meta, async () => "fine")).resolves.toBe("fine");
  });

  it("GET /api/admin/ai-telemetry is admin-only", async () => {
    session.mockResolvedValue({ user: { id: "d", role: "DONOR" } });
    const res = await TELEMETRY_GET(new Request("http://localhost/api/admin/ai-telemetry"));
    expect(res.status).toBe(403);
  });
});

describe("AI-010 — fault injection", () => {
  it("env AI_FAULT_INJECTION=error fails the call WITHOUT calling the provider", async () => {
    env.AI_FAULT_INJECTION = "error";
    const provider = vi.fn();
    await expect(callAi(meta, provider)).rejects.toMatchObject({ name: "AiUnavailableError", kind: "ERROR", faultInjected: true });
    expect(provider).not.toHaveBeenCalled();
    expect(lastLog()).toMatchObject({ outcome: "ERROR", faultInjected: true, errorCode: "FAULT_INJECTED_ERROR" });
  });

  it("the AppSetting toggle forces TIMEOUT", async () => {
    db.appSetting.findUnique.mockResolvedValue({ key: "ai_fault_injection", value: "timeout" });
    await expect(callAi(meta, vi.fn())).rejects.toMatchObject({ kind: "TIMEOUT", faultInjected: true });
    expect(lastLog()).toMatchObject({ outcome: "TIMEOUT", faultInjected: true });
  });

  it("is ignored in production unless explicitly allowed", async () => {
    env.NODE_ENV = "production";
    env.AI_FAULT_INJECTION = "error";
    expect(await getAiFaultMode()).toBeNull();
    env.AI_FAULT_INJECTION_ALLOW_PRODUCTION = "true";
    expect(await getAiFaultMode()).toBe("error");
  });

  it("the admin toggle is refused in production", async () => {
    env.NODE_ENV = "production";
    const res = await FAULT_POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ mode: "error" }) }));
    expect(res.status).toBe(403);
    expect(db.appSetting.upsert).not.toHaveBeenCalled();
  });

  it("the admin toggle is admin-only, validated, and audited", async () => {
    session.mockResolvedValue({ user: { id: "n", role: "NGO" } });
    expect((await FAULT_GET()).status).toBe(403);
    session.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
    expect((await FAULT_POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ mode: "explode" }) }))).status).toBe(400);
    const res = await FAULT_POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ mode: "timeout" }) }));
    expect(res.status).toBe(200);
    expect(db.appSetting.upsert.mock.calls[0][0].update).toEqual({ value: "timeout" });
    expect(db.adminActionLog.create.mock.calls[0][0].data).toMatchObject({ action: "AI_FAULT_INJECTION_CHANGED", newValue: { mode: "timeout" } });
  });
});

describe("AI-010 — every caller degrades to 'human review required', never a 500 or invented output", () => {
  beforeEach(() => {
    env.GEMINI_API_KEY = "test-key-never-used";
    env.AI_FAULT_INJECTION = "error";
  });

  it("project screening returns a structured 503 and stores no score", async () => {
    db.project.findUnique.mockResolvedValue({
      id: "p1", title: "T", description: "D", causeCategory: "EDUCATION", targetAmount: 100, location: "L",
      problem_statement: null, expected_outcome: null, aiScreeningScore: null, milestones: [],
    });
    const res = await SCREEN(new Request("http://localhost/api/admin/screen-project", { method: "POST", body: JSON.stringify({ projectId: "p1" }) }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: AI_UNAVAILABLE_MESSAGE, code: "AI_UNAVAILABLE", humanReviewRequired: true });
    expect(db.project.update).not.toHaveBeenCalled();
  });

  it("the milestone narrative falls back to a factual template with NO invented SDG/IRIS tags", async () => {
    const out = await generateImpactNarrative(
      { name: "Asha" }, { amount: 1000 }, { title: "School", raisedAmount: 10000 }, { orgName: "Org" },
      { title: "Roof", description: "Built the roof" }, "Roof done"
    );
    expect(out.narrative).toContain("Roof");
    expect(out.sdgTags).toEqual([]);
    expect(out.irisMetrics).toEqual([]);
  });

  it("outcome extraction returns INSUFFICIENT_DATA with a reason, never a figure", async () => {
    const res = await extractOutcomes({
      metrics: [{ code: "M1", name: "People trained", unit: "COUNT", definition: "d" } as any],
      sources: [{ id: "x", label: "proof", text: "We trained 40 people." } as any],
    });
    expect(res.usedModel).toBe(false);
    expect(res.suggestions[0]).toMatchObject({ metricCode: "M1", status: "INSUFFICIENT_DATA" });
    expect((res.suggestions[0] as any).value ?? null).toBeNull();
  });

  it("the nudge draft falls back to the deterministic template for the admin to edit", async () => {
    const text = await draftNudgeMessage({ orgName: "Org", reason: "QUIET", activeProjectTitles: [], overdueMilestones: [] });
    expect(text).toContain("Org");
  });

  it("the Claude path is gated by the same switch and never reaches the provider", async () => {
    env.ANTHROPIC_API_KEY = "test-key-never-used";
    const { z } = await import("zod");
    await expect(claudeStructured({ schema: z.object({ a: z.string() }), content: [{ type: "text", text: "x" }], site: "claude-test" }))
      .rejects.toMatchObject({ name: "AiUnavailableError", faultInjected: true });
    expect(lastLog()).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", site: "claude-test", faultInjected: true });
  });
});

describe("AI-010 — keyless stand-ins honour the switch too", () => {
  it("screening without a model key fails under fault injection instead of returning a heuristic score", async () => {
    env.AI_FAULT_INJECTION = "timeout";
    db.project.findUnique.mockResolvedValue({
      id: "p1", title: "T", description: "D", causeCategory: "EDUCATION", targetAmount: 100, location: "L",
      problem_statement: null, expected_outcome: null, aiScreeningScore: null, milestones: [],
    });
    const res = await SCREEN(new Request("http://localhost/api/admin/screen-project", { method: "POST", body: JSON.stringify({ projectId: "p1" }) }));
    expect(res.status).toBe(503);
    expect(db.project.update).not.toHaveBeenCalled();
    expect(lastLog()).toMatchObject({ site: "screen-project", provider: "rules", outcome: "TIMEOUT", faultInjected: true });
  });

  it("without fault injection the heuristic runs and is recorded as provider 'rules'", async () => {
    db.project.findUnique.mockResolvedValue({
      id: "p1", title: "T", description: "D", causeCategory: "EDUCATION", targetAmount: 100, location: "L",
      problem_statement: null, expected_outcome: null, aiScreeningScore: null, milestones: [],
    });
    db.project.update.mockResolvedValue({});
    const res = await SCREEN(new Request("http://localhost/api/admin/screen-project", { method: "POST", body: JSON.stringify({ projectId: "p1" }) }));
    expect(res.status).toBe(200);
    expect(db.aiCallLog.create.mock.calls[0][0].data).toMatchObject({ site: "screen-project", provider: "rules", model: "mock-heuristic", outcome: "OK" });
  });
});
