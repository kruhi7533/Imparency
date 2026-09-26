import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The provider seam is what lets the investigator run against Gemini, Groq, or
 * OpenRouter without run.ts knowing which. Two things need pinning down:
 *
 *   1. The Gemini→JSON-Schema tool converter doesn't silently drop a tool or
 *      mangle its shape — a broken conversion here is invisible until the
 *      OTHER provider's investigation runs and every tool call 400s.
 *   2. The in-process rate limiter actually throttles, so a burst of alerts
 *      firing investigations back to back can't blow a free-tier daily quota
 *      on retries alone.
 */

describe("toJsonSchema — Gemini declaration to OpenAI tool format", () => {
  it("lowercases Gemini's Type.* enum values", async () => {
    const { toJsonSchema } = await import("@/lib/fraud-investigator/providers/openai-compatible-provider");
    const out = toJsonSchema({ type: "OBJECT", properties: { a: { type: "STRING" } } });
    expect(out.type).toBe("object");
    expect(out.properties.a.type).toBe("string");
  });

  it("converts every declared tool without dropping one", async () => {
    const { TOOLS } = await import("@/lib/fraud-investigator/providers/openai-compatible-provider");
    const { DECLARATIONS } = await import("@/lib/fraud-investigator/declarations");

    expect(TOOLS).toHaveLength(DECLARATIONS.length);
    for (const tool of TOOLS) {
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBeTruthy();
      expect(tool.function.parameters.type).toBe("object");
    }
  });

  it("preserves enum constraints — a malformed severity would slip through undetected without this", async () => {
    const { TOOLS } = await import("@/lib/fraud-investigator/providers/openai-compatible-provider");
    const fileFinding = TOOLS.find((t) => t.function.name === "file_finding")!;
    expect(fileFinding.function.parameters.properties.severity.enum).toEqual(["LOW", "MEDIUM", "HIGH"]);
  });

  it("preserves required fields, so the model can't omit them silently", async () => {
    const { TOOLS } = await import("@/lib/fraud-investigator/providers/openai-compatible-provider");
    const fileFinding = TOOLS.find((t) => t.function.name === "file_finding")!;
    expect(fileFinding.function.parameters.required).toEqual(
      expect.arrayContaining(["severity", "finding", "evidence", "confidence"])
    );
  });

  it("recurses into array items", async () => {
    const { toJsonSchema } = await import("@/lib/fraud-investigator/providers/openai-compatible-provider");
    const out = toJsonSchema({ type: "ARRAY", items: { type: "STRING" } });
    expect(out.type).toBe("array");
    expect(out.items.type).toBe("string");
  });

  it("drops nullable rather than failing on it — no OpenAI-side equivalent, and the field stays optional", async () => {
    const { toJsonSchema } = await import("@/lib/fraud-investigator/providers/openai-compatible-provider");
    const out = toJsonSchema({ type: "STRING", nullable: true });
    expect(out).not.toHaveProperty("nullable");
    expect(out.type).toBe("string");
  });
});

describe("rate limiter", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.INVESTIGATOR_RPM = "3";
  });
  afterEach(() => {
    delete process.env.INVESTIGATOR_RPM;
  });

  it("allows calls up to the configured limit without waiting", async () => {
    const { acquireModelSlot, currentWindowCount } = await import("@/lib/fraud-investigator/rate-limit");
    await acquireModelSlot();
    await acquireModelSlot();
    await acquireModelSlot();
    expect(currentWindowCount()).toBe(3);
  });

  it("blocks the call that would exceed the limit until the window has room", async () => {
    vi.useFakeTimers();
    const { acquireModelSlot } = await import("@/lib/fraud-investigator/rate-limit");

    await acquireModelSlot();
    await acquireModelSlot();
    await acquireModelSlot(); // window is now full (RPM=3)

    let resolved = false;
    const pending = acquireModelSlot().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(resolved).toBe(false); // still throttled — window hasn't rolled

    await vi.advanceTimersByTimeAsync(61_000);
    await pending;
    expect(resolved).toBe(true);

    vi.useRealTimers();
  });
});
