import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * End-to-end proof that the OpenAI-compatible path (Groq / OpenRouter / any
 * custom endpoint) drives the SAME investigate() loop correctly — tool call
 * out, result back in, terminal tool ends the run, finding gets committed.
 * No real API key needed: fetch is mocked to speak the OpenAI dialect.
 */

const prismaMock = vi.hoisted(() => ({
  fraudInvestigation: { create: vi.fn(), update: vi.fn() },
  riskReview: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  nGOProfile: { findUnique: vi.fn() },
  fraudAlert: { findUnique: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  process.env.INVESTIGATOR_ENABLED = "true";
  process.env.INVESTIGATOR_PROVIDER = "custom";
  process.env.INVESTIGATOR_BASE_URL = "https://fake-provider.test/v1";
  process.env.INVESTIGATOR_API_KEY = "test-key";
  process.env.INVESTIGATOR_MODEL = "test-model";
  process.env.INVESTIGATOR_RPM = "1000"; // don't let the throttle slow the test down

  // investigate() verifies the NGO exists before creating a run — see the
  // foreign-key guard in run.ts.
  prismaMock.nGOProfile.findUnique.mockResolvedValue({
    id: "ngo-1",
    orgName: "Test NGO",
    panNumber: "AAAAA1111A",
    registrationNumber: "REG/1",
    foundedYear: 2020,
    verificationStatus: "PENDING",
    isSuspended: false,
    suspensionReason: null,
    createdAt: new Date(),
  });
  prismaMock.fraudInvestigation.create.mockResolvedValue({ id: "inv-1" });
  prismaMock.fraudInvestigation.update.mockResolvedValue({});
  prismaMock.riskReview.findFirst.mockResolvedValue(null);
  prismaMock.riskReview.create.mockResolvedValue({ id: "review-1" });
  prismaMock.fraudAlert.findUnique.mockResolvedValue({
    id: "alert-1",
    type: "TEST_ALERT",
    description: "test",
    severity: "HIGH",
    alertCategory: "FRAUD_ALERT",
    subType: null,
    createdAt: new Date(),
  });
});

function openAIResponse(message: any, usage = { prompt_tokens: 100, completion_tokens: 20 }): any {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message }], usage }),
    text: async (): Promise<string> => "",
    headers: { get: (_h: string): string | null => null },
  };
}

describe("investigate() over an OpenAI-compatible provider", () => {
  it("calls a read tool, feeds the result back, then closes cleanly with no finding", async () => {
    let call = 0;
    const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit) => {
      call += 1;
      if (call === 1) {
        // Turn 1: the model asks for the alert context.
        return openAIResponse({
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "get_alert_context", arguments: "{}" } },
          ],
        });
      }
      // Turn 2: having seen the alert, the model closes with nothing found.
      return openAIResponse({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_2",
            type: "function",
            function: {
              name: "close_investigation",
              arguments: JSON.stringify({ summary: "Nothing concerning.", clean: true }),
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { investigate } = await import("@/lib/fraud-investigator/run");
    const result = await investigate("ngo-1", "alert-1", "test");

    expect(result.status).toBe("COMPLETED");
    expect(result.riskLevel).toBeNull();
    expect(result.riskReviewId).toBeNull();
    expect(result.stepsUsed).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The request actually reached the configured custom endpoint.
    const firstCall = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(firstCall[0]).toBe("https://fake-provider.test/v1/chat/completions");
    const firstBody = JSON.parse(String(firstCall[1].body));
    expect(firstBody.model).toBe("test-model");
    expect(firstBody.tools.some((t: any) => t.function.name === "get_alert_context")).toBe(true);

    // Turn 2's request history includes the tool result from turn 1, correctly
    // tagged with the tool_call_id the model issued — this is the exact
    // linkage that breaks if appendToolResults ever loses track of ids.
    const secondCall = fetchMock.mock.calls[1] as [string, RequestInit];
    const secondBody = JSON.parse(String(secondCall[1].body));
    const toolResultMsg = secondBody.messages.find((m: any) => m.role === "tool");
    expect(toolResultMsg.tool_call_id).toBe("call_1");
    expect(JSON.parse(toolResultMsg.content).type).toBe("TEST_ALERT");

    vi.unstubAllGlobals();
  });

  it("stages a finding and commits it to a RiskReview only when the run closes", async () => {
    let call = 0;
    const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit) => {
      call += 1;
      if (call === 1) {
        return openAIResponse({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "file_finding",
                arguments: JSON.stringify({
                  severity: "HIGH",
                  finding: "Shared team member across two NGOs.",
                  evidence: "finance.office@demo.org is FINANCE on both.",
                  confidence: "LIKELY",
                }),
              },
            },
          ],
        });
      }
      return openAIResponse({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_2",
            type: "function",
            function: {
              name: "close_investigation",
              arguments: JSON.stringify({ summary: "Filed one finding.", clean: false }),
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { investigate } = await import("@/lib/fraud-investigator/run");
    const result = await investigate("ngo-1", "alert-1", "test");

    expect(result.status).toBe("COMPLETED");
    expect(result.riskLevel).toBe("HIGH");
    expect(result.riskReviewId).toBe("review-1");
    expect(prismaMock.riskReview.create).toHaveBeenCalledTimes(1);
    const createdFindings = prismaMock.riskReview.create.mock.calls[0][0].data.findings;
    expect(createdFindings[0].severity).toBe("HIGH");
    expect(createdFindings[0].source).toBe("fraud-investigator");

    vi.unstubAllGlobals();
  });

  it("surfaces a Retry-After header to the retry logic rather than swallowing it", async () => {
    let call = 0;
    const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit): Promise<any> => {
      call += 1;
      if (call === 1) {
        return {
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          text: async (): Promise<string> => '{"error":"rate limited"}',
          headers: { get: (h: string): string | null => (h.toLowerCase() === "retry-after" ? "0" : null) },
        };
      }
      return openAIResponse({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "close_investigation", arguments: JSON.stringify({ summary: "ok", clean: true }) },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { investigate } = await import("@/lib/fraud-investigator/run");
    const result = await investigate("ngo-1", "alert-1", "test");

    // Recovered after one retry rather than failing the whole investigation.
    expect(result.status).toBe("COMPLETED");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it("survives a provider error that outlives the transport retries, instead of losing the run", async () => {
    // Groq's real 400 from 2026-08-16: the model emitted tool-call arguments
    // that were not valid JSON. withModelRetry resends the same turn twice and
    // both resends fail the same way — the loop must still carry on.
    let call = 0;
    const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit): Promise<any> => {
      call += 1;
      if (call <= 3) {
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          text: async (): Promise<string> =>
            '{"error":{"message":"Failed to parse tool call arguments as JSON","code":"tool_use_failed"}}',
          headers: { get: (_h: string): string | null => null },
        };
      }
      return openAIResponse({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "close_investigation", arguments: JSON.stringify({ summary: "ok", clean: true }) },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { investigate } = await import("@/lib/fraud-investigator/run");
    const result = await investigate("ngo-1", "alert-1", "test");

    expect(result.status).toBe("COMPLETED");
    // Three failed attempts, then one good turn — the failure did not end the run.
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // The failure is on the record, so an admin reading the trace can see the
    // model misbehaved even though the investigation recovered.
    const trace = prismaMock.fraudInvestigation.update.mock.calls.at(-1)![0].data.trace as any[];
    expect(trace.some((e) => e.kind === "ERROR" && String(e.result?.error).includes("tool_use_failed"))).toBe(true);

    vi.unstubAllGlobals();
  });

  it("still catches a repeated call when the model varies only its `reason`", async () => {
    // `reason` exists so no-argument tools have a non-empty schema; it is
    // decoration. If it counted towards a call's identity, a model could circle
    // on one tool forever and never be told.
    let call = 0;
    const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit): Promise<any> => {
      call += 1;
      if (call <= 2) {
        return openAIResponse({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call_${call}`,
              type: "function",
              function: {
                name: "get_alert_context",
                arguments: JSON.stringify({ reason: `checking the alert, attempt ${call}` }),
              },
            },
          ],
        });
      }
      return openAIResponse({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_close",
            type: "function",
            function: { name: "close_investigation", arguments: JSON.stringify({ summary: "done", clean: true }) },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { investigate } = await import("@/lib/fraud-investigator/run");
    const result = await investigate("ngo-1", "alert-1", "test");

    expect(result.status).toBe("COMPLETED");
    const trace = prismaMock.fraudInvestigation.update.mock.calls.at(-1)![0].data.trace as any[];
    const corrections = trace.filter(
      (e) => e.kind === "TOOL_RESULT" && e.ok === false && String(e.result?.error).includes("already called")
    );
    expect(corrections).toHaveLength(1);

    vi.unstubAllGlobals();
  });

  it("records a run that ran out of budget as FAILED, never as a clean COMPLETED", async () => {
    // The trap this guards: a run that never reached a conclusion writes no
    // riskLevel, so a COMPLETED status would be indistinguishable from "looked
    // and found nothing" — the one reading an admin must never be given.
    process.env.INVESTIGATOR_STEP_BUDGET = "2";

    let call = 0;
    const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit): Promise<any> => {
      call += 1;
      // Never closes: keeps gathering until the budget stops it.
      const name = call === 1 ? "get_alert_context" : "get_ngo_profile";
      return openAIResponse({
        role: "assistant",
        content: null,
        tool_calls: [{ id: `call_${call}`, type: "function", function: { name, arguments: "{}" } }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { investigate } = await import("@/lib/fraud-investigator/run");
    const result = await investigate("ngo-1", "alert-1", "test");

    expect(result.status).toBe("FAILED");
    expect(result.riskLevel).toBeNull();
    expect(result.summary).toContain("step budget");

    const data = prismaMock.fraudInvestigation.update.mock.calls.at(-1)![0].data;
    expect(data.status).toBe("FAILED");
    expect(data.summary).toContain("step budget");

    delete process.env.INVESTIGATOR_STEP_BUDGET;
    vi.unstubAllGlobals();
  });
});
