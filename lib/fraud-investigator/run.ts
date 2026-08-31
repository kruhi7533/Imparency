import prisma from "@/lib/prisma";
import { captureError } from "@/lib/observability";
import {
  INVESTIGATOR_ENABLED,
  INVESTIGATOR_PROVIDER,
  STEP_BUDGET,
  COST_CAP_PAISE,
  WALL_CLOCK_MS,
  NO_PROGRESS_LIMIT,
  PRICE_PAISE_PER_MTOK_IN,
  PRICE_PAISE_PER_MTOK_OUT,
} from "./config";
import { READ_TOOLS, type InvestigatorContext } from "./tools";
import { createProvider } from "./providers";
import type { ProviderToolCall } from "./providers/types";
import { acquireModelSlot, recordTokenUsage } from "./rate-limit";

/**
 * The investigation loop.
 *
 * Unlike the deleted verification caseworker, this runs to completion in ONE
 * call — no lock, no heartbeat, no resume. If it crashes mid-run, the whole
 * investigation is simply re-triggerable; nothing was left half-sent, because
 * the only write (file_finding) happens once, at the very end, and only on a
 * successful close.
 *
 * Findings are staged in memory and committed to the DB together when the run
 * finishes cleanly — so a run that errors out midway leaves no partial,
 * confusing RiskReview behind.
 *
 * Model-agnostic: which provider actually answers is decided by
 * INVESTIGATOR_PROVIDER (see ./config and ./providers) — this file only calls
 * the ModelProvider interface, never a specific SDK.
 */

interface StagedFinding {
  severity: "LOW" | "MEDIUM" | "HIGH";
  finding: string;
  evidence: string;
  confidence: "POSSIBLE" | "LIKELY" | "CONFIRMED";
}

interface TraceEntry {
  seq: number;
  kind: "MODEL_CALL" | "TOOL_CALL" | "TOOL_RESULT" | "ERROR";
  toolName?: string;
  args?: any;
  result?: any;
  ok?: boolean;
  tokensIn?: number;
  tokensOut?: number;
}

export interface InvestigationResult {
  investigationId: string;
  status: "COMPLETED" | "FAILED";
  riskLevel: string | null;
  summary: string | null;
  riskReviewId: string | null;
  stepsUsed: number;
  costPaise: number;
}

function estimatePaise(tokensIn: number, tokensOut: number): number {
  return Math.ceil(
    (tokensIn / 1_000_000) * PRICE_PAISE_PER_MTOK_IN + (tokensOut / 1_000_000) * PRICE_PAISE_PER_MTOK_OUT
  );
}

const RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/**
 * Identity of a tool call for repeat detection.
 *
 * `reason` is stripped because it is decoration, not an argument — every
 * no-argument tool carries one purely so the schema is non-empty (see NO_ARGS
 * in declarations.ts). Including it would let a model call
 * check_duplicate_identity ten times with ten different reasons and never once
 * be told it is going in circles.
 */
function callSignature(name: string, args: any): string {
  const { reason: _reason, ...rest } = (args ?? {}) as Record<string, unknown>;
  return `${name}(${JSON.stringify(rest)})`;
}

/**
 * Investigate one NGO in the context of one triggering alert (or none, for a
 * manual run). Never throws — a failure is recorded on the FraudInvestigation
 * row and returned as status FAILED, so a bad run is visible, not silent.
 */
export async function investigate(
  ngoId: string,
  alertId: string | null,
  triggeredBy: string,
  options: { wallClockMs?: number } = {}
): Promise<InvestigationResult> {
  // Guard before the insert. FraudAlert.entityId is not always an NGO id even
  // when entityType says "NGO" (see lib/fraud-investigator/resolve-ngo.ts), and
  // a bad id used to surface as a raw P2003 foreign-key 500 with an orphaned
  // row attempt. Callers should resolve first; this is the backstop that turns
  // a mistake into a readable message instead of a stack trace.
  const ngoExists = await prisma.nGOProfile.findUnique({
    where: { id: ngoId },
    select: { id: true },
  });
  if (!ngoExists) {
    return {
      investigationId: "",
      status: "FAILED",
      riskLevel: null,
      summary: `No NGO exists with id ${ngoId}. This alert's entityId probably points at a milestone or project rather than an NGO.`,
      riskReviewId: null,
      stepsUsed: 0,
      costPaise: 0,
    };
  }

  const investigation = await prisma.fraudInvestigation.create({
    data: { ngoId, triggeredBy, alertId, status: "RUNNING" },
  });

  const fail = async (summary: string): Promise<InvestigationResult> => {
    await prisma.fraudInvestigation.update({
      where: { id: investigation.id },
      data: { status: "FAILED", summary },
    });
    return {
      investigationId: investigation.id,
      status: "FAILED",
      riskLevel: null,
      summary,
      riskReviewId: null,
      stepsUsed: 0,
      costPaise: 0,
    };
  };

  if (!INVESTIGATOR_ENABLED) {
    return fail("INVESTIGATOR_ENABLED is not 'true'.");
  }

  const providerResult = createProvider();
  if ("error" in providerResult) {
    return fail(providerResult.error);
  }
  const provider = providerResult.provider;

  const ctx: InvestigatorContext = { ngoId, alertId };
  const startedAt = Date.now();

  /**
   * The default is sized for the ADMIN route, where a human is holding an open
   * request waiting for an answer. The automatic path in trigger.ts is
   * fire-and-forget — nobody is waiting on it — so it passes a longer budget.
   *
   * This matters because on a free tier the binding constraint is the TPM
   * throttle, not the model. Measured 2026-08-26 on Groq/gpt-oss-120b: ~2.9k
   * tokens per step against an 8,000 TPM ceiling, so a full investigation
   * spends most of its wall clock WAITING for the token window to roll, and
   * simply cannot reach a conclusion inside the interactive budget.
   */
  const wallClockMs = options.wallClockMs && options.wallClockMs > 0 ? options.wallClockMs : WALL_CLOCK_MS;

  const trace: TraceEntry[] = [];
  const staged: StagedFinding[] = [];
  let stepsUsed = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let costPaise = 0;
  let noToolStreak = 0;
  /** How many times we've had to tell the model it's repeating itself. */
  let repeatCorrections = 0;
  const recentSignatures: string[] = [];

  const history: any[] = provider.initialHistory(
    `Investigate NGO ${ngoId}${alertId ? ` in the context of alert ${alertId}` : " (manual investigation, no specific alert)"}.`
  );

  let finalSummary: string | null = null;
  let finalClean = true;
  /**
   * Set when the loop exits for any reason OTHER than the model calling
   * close_investigation — budget exhausted, wall clock, repeated provider
   * failure. It is what stops a stopped run from reading as a clean one: a run
   * that never reached a conclusion is recorded FAILED, never COMPLETED with a
   * null riskLevel, because "we ran out of time" and "we looked and found
   * nothing" must never look the same to an admin.
   */
  let incompleteReason: string | null = null;
  /** Consecutive provider failures. Reset by any successful model call. */
  let providerErrorStreak = 0;

  try {
    while (true) {
      if (Date.now() - startedAt > wallClockMs) {
        incompleteReason = "Investigation stopped: wall-clock limit reached before it could conclude.";
        finalSummary = incompleteReason;
        break;
      }
      if (stepsUsed >= STEP_BUDGET) {
        incompleteReason = `Investigation stopped: step budget (${STEP_BUDGET}) exhausted before it could conclude.`;
        finalSummary = incompleteReason;
        break;
      }
      if (costPaise >= COST_CAP_PAISE) {
        incompleteReason = "Investigation stopped: cost cap reached before it could conclude.";
        finalSummary = incompleteReason;
        break;
      }

      // Courtesy throttle BEFORE the call — distinct from the after-the-fact
      // 429 backoff inside provider.step(). See rate-limit.ts.
      await acquireModelSlot();

      // A provider error used to abort the whole investigation from the outer
      // catch: one malformed tool call from the model and eleven steps of work
      // were thrown away. Observed 2026-08-16 — Groq returned 400
      // `tool_use_failed` ("Failed to parse tool call arguments as JSON") on
      // step 2 and the run died there.
      //
      // withModelRetry has already resent the same turn by the time we get
      // here, so this is the second line of defence: treat a surviving failure
      // the way a bad tool result is treated — record it, tell the model, and
      // let it try something else. Only a persistent failure ends the run, and
      // it ends as FAILED, never as a clean close.
      let step: Awaited<ReturnType<typeof provider.step>>;
      try {
        step = await provider.step(history);
      } catch (err: any) {
        providerErrorStreak += 1;
        const message = String(err?.message ?? err).slice(0, 500);
        trace.push({ seq: trace.length, kind: "ERROR", result: { error: message }, ok: false });

        if (providerErrorStreak > NO_PROGRESS_LIMIT) {
          incompleteReason = `Investigation stopped: the model provider failed ${providerErrorStreak} times in a row. Last error: ${message}`;
          finalSummary = incompleteReason;
          break;
        }

        provider.appendNudge(
          history,
          "Your previous response could not be processed. Reply with ONE tool call whose arguments are valid JSON, or call close_investigation if you have finished."
        );
        continue;
      }
      providerErrorStreak = 0;

      tokensIn += step.tokensIn;
      tokensOut += step.tokensOut;
      costPaise += estimatePaise(step.tokensIn, step.tokensOut);
      stepsUsed += 1;

      // Feed real usage back to the throttle so the NEXT acquireModelSlot()
      // knows what this loop actually costs per turn.
      recordTokenUsage(step.tokensIn + step.tokensOut);

      trace.push({ seq: trace.length, kind: "MODEL_CALL", tokensIn: step.tokensIn, tokensOut: step.tokensOut });

      const calls = step.toolCalls;

      if (calls.length === 0) {
        noToolStreak += 1;
        if (noToolStreak >= NO_PROGRESS_LIMIT) {
          incompleteReason = "Investigation stopped: model answered in prose instead of taking action.";
          finalSummary = incompleteReason;
          break;
        }
        provider.appendNudge(history, "Call a tool, or call close_investigation if you are done.");
        continue;
      }
      noToolStreak = 0;

      const responses: any[] = [];
      let terminated = false;

      for (const call of calls) {
        const signature = callSignature(call.name, call.args);
        const repeats = recentSignatures.filter((s) => s === signature).length;

        if (repeats > 0) {
          // Repeating a call verbatim means the model has lost the thread —
          // common with smaller/faster models. Correct it in-band rather than
          // killing the run: it already has this result, so hand back an
          // instruction instead of re-running the query. Only a persistent
          // repeat (past NO_PROGRESS_LIMIT) ends the investigation, and
          // STEP_BUDGET bounds the whole thing regardless.
          repeatCorrections += 1;
          if (repeatCorrections > NO_PROGRESS_LIMIT) {
            incompleteReason = `Investigation stopped: kept repeating ${call.name} with identical arguments after being told not to.`;
            finalSummary = incompleteReason;
            terminated = true;
            break;
          }

          const result = {
            error: `You already called ${call.name} with these exact arguments earlier in this investigation and have its result. Do not call it again. Either call a DIFFERENT tool that follows up on what you have learned, or call file_finding if you have enough evidence, or call close_investigation if you do not.`,
          };
          trace.push({ seq: trace.length, kind: "TOOL_RESULT", toolName: call.name, result, ok: false });
          responses.push(result);
          continue;
        }
        recentSignatures.push(signature);

        trace.push({ seq: trace.length, kind: "TOOL_CALL", toolName: call.name, args: call.args ?? {} });

        if (call.name === "file_finding") {
          const severity = ["LOW", "MEDIUM", "HIGH"].includes(call.args?.severity) ? call.args.severity : "LOW";
          const finding = String(call.args?.finding ?? "").slice(0, 1000);
          const evidence = String(call.args?.evidence ?? "").slice(0, 1000);
          const confidence = ["POSSIBLE", "LIKELY", "CONFIRMED"].includes(call.args?.confidence)
            ? call.args.confidence
            : "POSSIBLE";
          staged.push({ severity, finding, evidence, confidence });
          finalClean = false;
          const result = { recorded: true, note: "Staged. It will be written when the investigation closes." };
          trace.push({ seq: trace.length, kind: "TOOL_RESULT", toolName: call.name, result, ok: true });
          responses.push(result);
          continue;
        }

        if (call.name === "close_investigation") {
          finalSummary = String(call.args?.summary ?? "").slice(0, 2000) || null;
          finalClean = call.args?.clean !== false && staged.length === 0;
          terminated = true;
          break;
        }

        const handler = READ_TOOLS[call.name];
        if (!handler) {
          const result = { error: `No such tool: "${call.name}".` };
          trace.push({ seq: trace.length, kind: "TOOL_RESULT", toolName: call.name, result, ok: false });
          responses.push(result);
          continue;
        }

        try {
          const result = await handler(call.args ?? {}, ctx);
          trace.push({ seq: trace.length, kind: "TOOL_RESULT", toolName: call.name, result, ok: true });
          responses.push(result);
        } catch (err: any) {
          const result = { error: `${call.name} failed: ${err?.message ?? "unknown error"}` };
          trace.push({ seq: trace.length, kind: "TOOL_RESULT", toolName: call.name, result, ok: false });
          responses.push(result);
        }
      }

      if (terminated) break;

      provider.appendToolResults(history, calls as ProviderToolCall[], responses);
    }

    // ── commit: everything or nothing ─────────────────────────────────────
    let riskReviewId: string | null = null;
    let riskLevel: string | null = null;

    if (staged.length > 0) {
      riskLevel = staged.reduce(
        (worst, f) => (RANK[f.severity] > RANK[worst ?? "LOW"] ? f.severity : worst ?? "LOW"),
        null as string | null
      );

      const existing = await prisma.riskReview.findFirst({ where: { ngoId, status: "OPEN" } });
      const findingsPayload = staged.map((f) => ({
        source: "fraud-investigator",
        investigationId: investigation.id,
        ...f,
      }));

      if (existing) {
        const priorFindings = Array.isArray(existing.findings) ? (existing.findings as any[]) : [];
        await prisma.riskReview.update({
          where: { id: existing.id },
          data: {
            findings: [...priorFindings, ...findingsPayload] as any,
            riskLevel: RANK[riskLevel!] > RANK[existing.riskLevel] ? riskLevel! : existing.riskLevel,
            alertIds: alertId ? Array.from(new Set([...existing.alertIds, alertId])) : existing.alertIds,
          },
        });
        riskReviewId = existing.id;
      } else {
        const created = await prisma.riskReview.create({
          data: {
            ngoId,
            alertIds: alertId ? [alertId] : [],
            riskLevel: riskLevel!,
            findings: findingsPayload as any,
            status: "OPEN",
          },
        });
        riskReviewId = created.id;
      }
    }

    // Findings are committed either way — evidence the run did gather is real
    // whether or not it got to finish — but the STATUS tells the truth about
    // whether it finished. See incompleteReason.
    const status = incompleteReason ? "FAILED" : "COMPLETED";

    await prisma.fraudInvestigation.update({
      where: { id: investigation.id },
      data: {
        status,
        stepsUsed,
        tokensIn,
        tokensOut,
        costPaise,
        trace: trace as any,
        riskLevel,
        summary: finalSummary ?? (finalClean ? "No findings." : `${staged.length} finding(s) filed.`),
        riskReviewId,
      },
    });

    return {
      investigationId: investigation.id,
      status,
      riskLevel,
      summary: finalSummary,
      riskReviewId,
      stepsUsed,
      costPaise,
    };
  } catch (err) {
    captureError(err, {
      scope: "lib/fraud-investigator/run",
      operation: "investigate",
      entityType: "NGO",
      entityId: ngoId,
      extra: { provider: INVESTIGATOR_PROVIDER },
    });
    await prisma.fraudInvestigation
      .update({
        where: { id: investigation.id },
        data: {
          status: "FAILED",
          stepsUsed,
          tokensIn,
          tokensOut,
          costPaise,
          trace: trace as any,
          summary: `Run failed: ${String((err as any)?.message ?? err).slice(0, 500)}`,
        },
      })
      .catch(() => {});

    return {
      investigationId: investigation.id,
      status: "FAILED",
      riskLevel: null,
      summary: null,
      riskReviewId: null,
      stepsUsed,
      costPaise,
    };
  }
}
