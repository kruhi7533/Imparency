"use client";

import { useState } from "react";
import type { MatchRunDTO } from "@/lib/requirements/dto";

/**
 * ADM-006 — the admin's shortlist decision before any NGO is invited:
 * approve candidates in an explicit order (↑/↓), reject others with a reason.
 * Submits to PUT /api/requirements/[id]/shortlist; the server re-checks every
 * rule (latest run, no invitations yet, eligible only, each candidate decided).
 */
export function ShortlistReview({
  run,
  onSubmit,
  busy,
}: {
  run: MatchRunDTO;
  onSubmit: (payload: { gapReportId: string; order: string[]; rejected: Array<{ matchId: string; reason: string }>; note: string }) => void;
  busy: boolean;
}) {
  const eligible = run.matches.filter((m) => m.eligible);
  const initialOrder = () => {
    const approved = eligible.filter((m) => m.adminDecision === "APPROVED").sort((a, b) => (a.adminRank ?? 0) - (b.adminRank ?? 0));
    const rest = eligible.filter((m) => m.adminDecision !== "APPROVED" && m.adminDecision !== "REJECTED");
    return [...approved, ...rest].map((m) => m.id);
  };
  const [order, setOrder] = useState<string[]>(initialOrder);
  const [rejected, setRejected] = useState<Record<string, string>>(() =>
    Object.fromEntries(eligible.filter((m) => m.adminDecision === "REJECTED").map((m) => [m.id, m.adminNote ?? ""]))
  );
  const [note, setNote] = useState("");
  const byId = new Map(eligible.map((m) => [m.id, m]));

  if (eligible.length === 0) return null;

  const move = (i: number, d: -1 | 1) =>
    setOrder((o) => {
      const next = [...o];
      const j = i + d;
      if (j < 0 || j >= next.length) return o;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const reject = (id: string) => {
    setOrder((o) => o.filter((x) => x !== id));
    setRejected((r) => ({ ...r, [id]: r[id] ?? "" }));
  };
  const restore = (id: string) => {
    setRejected((r) => {
      const rest = { ...r };
      delete rest[id];
      return rest;
    });
    setOrder((o) => [...o, id]);
  };
  const rejectedIds = Object.keys(rejected);
  const valid = order.length > 0 && rejectedIds.every((id) => rejected[id].trim().length >= 3);

  return (
    <div className="border border-emerald-200 bg-emerald-50 rounded-2xl p-4 space-y-3">
      <div>
        <p className="text-sm font-bold text-gray-900">Approve the shortlist before NGOs are invited</p>
        <p className="text-xs text-gray-600">
          Put the approved candidates in the order the donor should see them, and exclude any that should not be invited (a reason is
          required). The donor can invite only approved candidates. This is recorded in the audit trail.
        </p>
      </div>
      <ol className="space-y-2">
        {order.map((id, i) => {
          const m = byId.get(id)!;
          return (
            <li key={id} className="flex flex-wrap items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs">
              <span className="font-mono font-bold text-emerald-700 w-6">{i + 1}.</span>
              <span className="flex-1 min-w-0">
                <span className="font-semibold text-gray-900">{m.ngoName}</span> <span className="text-gray-600">— {m.projectTitle}</span>
                <span className="ml-2 text-gray-500">engine #{m.rank} · {m.score === null ? "unscored" : `${m.score}%`}</span>
              </span>
              <button type="button" aria-label={`Move ${m.ngoName} up`} disabled={i === 0} onClick={() => move(i, -1)} className="px-2 py-1 rounded bg-gray-100 disabled:opacity-30">↑</button>
              <button type="button" aria-label={`Move ${m.ngoName} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)} className="px-2 py-1 rounded bg-gray-100 disabled:opacity-30">↓</button>
              <button type="button" onClick={() => reject(id)} className="px-2 py-1 rounded bg-red-50 text-red-700 font-bold">Exclude</button>
            </li>
          );
        })}
      </ol>
      {rejectedIds.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-red-700">Excluded</p>
          {rejectedIds.map((id) => {
            const m = byId.get(id)!;
            return (
              <div key={id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-700 min-w-[10rem]">{m.ngoName}</span>
                <input
                  aria-label={`Reason for excluding ${m.ngoName}`}
                  value={rejected[id]}
                  onChange={(e) => setRejected((r) => ({ ...r, [id]: e.target.value }))}
                  placeholder="Reason (required)"
                  className="flex-1 bg-white border border-gray-300 rounded-lg px-2 py-1 text-gray-900"
                />
                <button type="button" onClick={() => restore(id)} className="text-emerald-700 font-semibold">Restore</button>
              </div>
            );
          })}
        </div>
      )}
      <textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note for the record"
        className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-900"
      />
      <button
        type="button"
        disabled={!valid || busy}
        onClick={() =>
          onSubmit({
            gapReportId: run.id,
            order,
            rejected: rejectedIds.map((matchId) => ({ matchId, reason: rejected[matchId] })),
            note,
          })
        }
        className="px-4 py-2 rounded-lg bg-trust-600 hover:bg-trust-700 text-white text-xs font-bold disabled:opacity-40"
      >
        {busy ? "Saving…" : `Approve shortlist (${order.length} in this order)`}
      </button>
    </div>
  );
}
