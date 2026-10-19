"use client";

import { useState } from "react";
import { requirementApi } from "./api";

interface AssistantResult {
  answer: string;
  citations: string[];
  invalidCitations: string[];
  grounded: boolean;
  usedModel: boolean;
  sources: Array<{ id: string; label: string }>;
}

const SUGGESTIONS = [
  "Compare the proposed budgets and durations.",
  "What changed between V1 and V2?",
  "Which proposals mention FCRA or 80G compliance?",
  "Do the milestones add up to the budget?",
];

/** Ask questions about the proposals; every answer cites the proposal (and version) it came from. */
export function ProposalAssistant({ requirementId }: { requirementId: string }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssistantResult | null>(null);

  async function ask(q: string) {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await requirementApi<AssistantResult>(`/api/requirements/${requirementId}/assistant`, {
          method: "POST",
          body: JSON.stringify({ question: q }),
        })
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const label = (id: string) => result?.sources.find((s) => s.id === id)?.label ?? id;

  return (
    <div className="border border-blue-500/25 bg-blue-500/5 rounded-2xl p-5 space-y-3">
      <div>
        <p className="text-sm font-bold text-blue-200">Ask about these proposals</p>
        <p className="text-xs text-gray-400 mt-0.5">
          Answers come only from your requirement and the NGOs&apos; proposals, with a source for every claim. It compares; you decide.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim().length >= 3) ask(question.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={question}
          maxLength={500}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Which proposal has the lowest budget per milestone?"
          className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
        />
        <button type="submit" disabled={busy || question.trim().length < 3} className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-400 text-gray-950 text-xs font-bold disabled:opacity-50">
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => {
              setQuestion(s);
              ask(s);
            }}
            className="px-2.5 py-1 rounded-full border border-gray-700 text-[11px] text-gray-400 hover:text-white"
          >
            {s}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      {result && (
        <div className="rounded-xl bg-gray-950/60 border border-gray-800 p-4 space-y-2">
          {!result.grounded && (
            <p className="text-[11px] font-bold text-amber-300">⚠ This answer cites no source — treat it as unverified.</p>
          )}
          <p className="text-sm text-gray-100 whitespace-pre-wrap">{result.answer}</p>
          {result.citations.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {result.citations.map((id) => (
                <span key={id} className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 text-[10px] font-bold">
                  [{id}] {label(id)}
                </span>
              ))}
            </div>
          )}
          {result.invalidCitations.length > 0 && (
            <p className="text-[11px] text-amber-300/80">Removed {result.invalidCitations.length} citation(s) that pointed at no real source.</p>
          )}
          {!result.usedModel && <p className="text-[11px] text-gray-500">AI model not configured — showing the facts directly.</p>}
        </div>
      )}
    </div>
  );
}
