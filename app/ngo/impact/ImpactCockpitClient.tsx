"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { NgoImpactCockpit } from "@/lib/outcome-cockpit";

/**
 * The NGO impact cockpit. Every rule is enforced server-side; this screen only
 * shows the state and offers the actions the API would accept.
 *
 * Note: type-only import from lib/outcome-cockpit (which imports Prisma), so
 * nothing server-side reaches the browser bundle.
 */

type Claim = NgoImpactCockpit["claims"][number];
type Evidence = NgoImpactCockpit["evidence"][number];
type Preview = {
  triage: { verdict: "CLEAN" | "NEEDS_REVIEW" | "BLOCKED"; findings: Array<{ code: string; severity: string; message: string }> };
  upperBound: number | null;
  approvedCitations: number;
};

const UNIT: Record<string, string> = {
  COUNT_PEOPLE: "people",
  COUNT_ITEMS: "items",
  COUNT_EVENTS: "events",
  CURRENCY_INR: "₹",
  PERCENTAGE: "%",
  HOURS: "hours",
  KILOGRAMS: "kg",
  LITRES: "litres",
  AREA_SQM: "m²",
};
const KIND_LABEL: Record<string, string> = {
  MILESTONE_PROOF: "Milestone proof",
  FIELD_PHOTO: "Field photo",
  BENEFICIARY_FEEDBACK: "Beneficiary feedback",
  ATTENDANCE_RECORD: "Attendance record",
  FINANCIAL_RECORD: "Financial record",
};
const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "bg-gray-800 text-gray-300 border-gray-700" },
  SUBMITTED: { label: "In review", cls: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  NEEDS_EVIDENCE: { label: "Needs evidence", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  APPROVED: { label: "Approved", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  REJECTED: { label: "Rejected", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
  WITHDRAWN: { label: "Withdrawn", cls: "bg-gray-800 text-gray-500 border-gray-700" },
};
const VERDICT: Record<string, { label: string; cls: string }> = {
  CLEAN: { label: "Evidence supports this figure", cls: "text-emerald-300" },
  NEEDS_REVIEW: { label: "A reviewer will have questions", cls: "text-amber-300" },
  BLOCKED: { label: "Cannot be approved as it stands", cls: "text-red-300" },
};

const fmtValue = (value: string, unit: string) =>
  unit === "CURRENCY_INR" ? `₹${Number(value).toLocaleString("en-IN")}` : `${Number(value).toLocaleString("en-IN")} ${UNIT[unit] ?? ""}`.trim();
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN");
const today = () => new Date().toISOString().slice(0, 10);

const input =
  "w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500";

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function Findings({ triage }: { triage: Preview["triage"] | null }) {
  if (!triage) return <p className="text-xs text-amber-300">The evidence could not be checked right now.</p>;
  return (
    <div className="space-y-1">
      <p className={`text-xs font-bold ${VERDICT[triage.verdict].cls}`}>{VERDICT[triage.verdict].label}</p>
      {triage.findings.map((f) => (
        <p key={f.code + f.message} className="text-xs text-gray-400">
          <span className={f.severity === "BLOCK" ? "text-red-300" : f.severity === "HIGH" ? "text-amber-300" : "text-gray-300"}>
            {f.severity === "BLOCK" ? "Blocks approval" : f.severity === "HIGH" ? "Serious" : "Note"}:
          </span>{" "}
          {f.message}
        </p>
      ))}
    </div>
  );
}

/** Create a new claim, or edit a DRAFT / NEEDS_EVIDENCE one. */
function ClaimForm({
  cockpit,
  editing,
  onDone,
}: {
  cockpit: NgoImpactCockpit;
  editing: Claim | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(editing?.projectId ?? cockpit.projects[0]?.id ?? "");
  const [milestoneId, setMilestoneId] = useState(editing?.milestoneId ?? "");
  const [metricCode, setMetricCode] = useState(editing?.metricCode ?? cockpit.metrics[0]?.code ?? "");
  const [value, setValue] = useState(editing?.value ?? "");
  const [periodStart, setPeriodStart] = useState(editing?.periodStart.slice(0, 10) ?? "");
  const [periodEnd, setPeriodEnd] = useState(editing?.periodEnd.slice(0, 10) ?? today());
  const [method, setMethod] = useState(editing?.method ?? "");
  const [cited, setCited] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<null | "check" | "save">(null);
  const [error, setError] = useState<string | null>(null);

  const project = cockpit.projects.find((p) => p.id === projectId);
  const metric = cockpit.metrics.find((m) => m.code === metricCode);
  const evidence = cockpit.evidence.filter((e) => e.projectId === projectId);
  const key = (e: Evidence) => `${e.kind}:${e.id}`;
  const citations = evidence.filter((e) => cited.has(key(e))).map((e) => ({ kind: e.kind, id: e.id }));
  const payload = { projectId, milestoneId: milestoneId || null, metricCode, value, periodStart, periodEnd, method, citations };
  const missingKinds = metric ? metric.requiredEvidence.filter((k) => !citations.some((c) => c.kind === k)) : [];

  async function check() {
    setBusy("check");
    setError(null);
    try {
      setPreview(await call("/api/ngo/outcome-claims/preview", { method: "POST", body: JSON.stringify(payload) }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      if (editing) await call(`/api/ngo/outcome-claims/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await call("/api/ngo/outcome-claims", { method: "POST", body: JSON.stringify(payload) });
      onDone();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border border-emerald-500/30 bg-gray-900/60 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-white">{editing ? "Edit claim" : "Report an outcome"}</p>
        <button type="button" onClick={onDone} className="text-xs text-gray-400 hover:text-white">
          Cancel
        </button>
      </div>
      {editing?.status === "NEEDS_EVIDENCE" && editing.decisionNote && (
        <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 whitespace-pre-wrap">
          Reviewer: {editing.decisionNote}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-xs text-gray-400">
          Project
          <select
            className={`${input} mt-1`}
            value={projectId}
            disabled={!!editing}
            onChange={(e) => {
              setProjectId(e.target.value);
              setMilestoneId("");
              setCited(new Set());
              setPreview(null);
            }}
          >
            {cockpit.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-400">
          Milestone (optional)
          <select className={`${input} mt-1`} value={milestoneId} disabled={!!editing} onChange={(e) => setMilestoneId(e.target.value)}>
            <option value="">Whole project</option>
            {project?.milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-400 md:col-span-2">
          Metric
          <select
            className={`${input} mt-1`}
            value={metricCode}
            disabled={!!editing}
            onChange={(e) => {
              setMetricCode(e.target.value);
              setPreview(null);
            }}
          >
            {cockpit.metrics.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name} ({m.code})
              </option>
            ))}
          </select>
          {metric && (
            <span className="block mt-1 text-[11px] text-gray-500">
              {metric.definition} · Needs: {metric.requiredEvidence.map((k) => KIND_LABEL[k]).join(", ")}
            </span>
          )}
        </label>
        <label className="text-xs text-gray-400">
          Value {metric ? `(${UNIT[metric.unit] ?? metric.unit})` : ""}
          <input className={`${input} mt-1`} inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); setPreview(null); }} placeholder="e.g. 120" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-400">
            From
            <input className={`${input} mt-1`} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </label>
          <label className="text-xs text-gray-400">
            To
            <input className={`${input} mt-1`} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </label>
        </div>
        <label className="text-xs text-gray-400 md:col-span-2">
          How you arrived at the number
          <textarea
            className={`${input} mt-1`}
            rows={3}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="e.g. Counted from the signed attendance sheets of the 4 training batches; each person counted once."
          />
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-300">
          Evidence to cite <span className="font-normal text-gray-500">— only approved evidence supports a figure</span>
        </p>
        {evidence.length === 0 ? (
          <p className="text-xs text-gray-500">No evidence on this project yet. Submit milestone proof or capture field evidence first.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
            {evidence.map((e) => (
              <label key={key(e)} className="flex items-start gap-2 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={cited.has(key(e))}
                  onChange={() => {
                    setPreview(null);
                    setCited((prev) => {
                      const next = new Set(prev);
                      next.has(key(e)) ? next.delete(key(e)) : next.add(key(e));
                      return next;
                    });
                  }}
                />
                <span className="flex-1">
                  <span className="text-gray-200">{e.label}</span> <span className="text-gray-500">· {day(e.date)}</span>
                  {e.detail && <span className="block text-gray-500">{e.detail}</span>}
                  {e.approved ? (
                    <span className="block text-emerald-400">Approved</span>
                  ) : (
                    <span className="block text-amber-400">{e.note}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
        {editing && <p className="text-[11px] text-gray-500">Saving replaces this claim&apos;s citations with the ones ticked here.</p>}
        {metric && missingKinds.length > 0 && citations.length > 0 && (
          <p className="text-[11px] text-amber-300">This metric also needs: {missingKinds.map((k) => KIND_LABEL[k]).join(", ")}.</p>
        )}
      </div>

      {preview && (
        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3 space-y-2">
          <Findings triage={preview.triage} />
          {preview.upperBound !== null ? (
            <p className="text-xs text-gray-300">
              Outcome calculation: your cited, consented and approved beneficiary records support up to{" "}
              <span className="font-bold text-white">{preview.upperBound}</span> people.
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              {preview.approvedCitations} approved citation{preview.approvedCitations === 1 ? "" : "s"}. This metric has no automatic upper
              bound — the reviewer judges the number against your method and evidence.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={!!busy || !metricCode || !value || !periodStart || !periodEnd}
          onClick={check}
          className="px-4 py-2 rounded-lg border border-gray-700 text-gray-200 text-xs font-semibold disabled:opacity-40"
        >
          {busy === "check" ? "Checking…" : "Check against review"}
        </button>
        <button
          type="button"
          disabled={!!busy || method.trim().length < 10}
          onClick={save}
          className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-xs font-bold disabled:opacity-40"
        >
          {busy === "save" ? "Saving…" : editing ? "Save changes" : "Save as draft"}
        </button>
      </div>
    </div>
  );
}

function ClaimRow({ claim, projectTitle, canEdit, onEdit }: { claim: Claim; projectTitle: string; canEdit: boolean; onEdit: () => void }) {
  const router = useRouter();
  const [withdrawing, setWithdrawing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const style = STATUS_STYLE[claim.status];

  async function act(action: "SUBMIT" | "WITHDRAW") {
    setBusy(true);
    setError(null);
    try {
      await call(`/api/ngo/outcome-claims/${claim.id}`, { method: "PATCH", body: JSON.stringify({ action, note }) });
      setWithdrawing(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/40 px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-white">
            {fmtValue(claim.value, claim.unit)} <span className="font-normal text-gray-400">· {claim.metricName}</span>
          </p>
          <p className="text-[11px] text-gray-500">
            {projectTitle} · {day(claim.periodStart)} – {day(claim.periodEnd)} · {claim.citationCount} citation{claim.citationCount === 1 ? "" : "s"}
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${style.cls}`}>{style.label}</span>
      </div>
      {claim.status === "APPROVED" && claim.display.kind === "unverified" && (
        <p className="text-xs text-red-300">Donors see this as unverified: {claim.display.reason}</p>
      )}
      {claim.decisionNote && (claim.status === "NEEDS_EVIDENCE" || claim.status === "REJECTED") && (
        <p className="text-xs text-amber-200 whitespace-pre-wrap">Reviewer: {claim.decisionNote}</p>
      )}
      {["DRAFT", "SUBMITTED", "NEEDS_EVIDENCE"].includes(claim.status) && <Findings triage={claim.triage} />}

      {canEdit && (
        <div className="flex flex-wrap gap-2 pt-1">
          {(claim.status === "DRAFT" || claim.status === "NEEDS_EVIDENCE") && (
            <>
              <button type="button" onClick={onEdit} className="px-3 py-1.5 rounded-lg border border-gray-700 text-gray-200 text-xs font-semibold">
                Edit
              </button>
              <button
                type="button"
                disabled={busy || claim.citationCount === 0}
                title={claim.citationCount === 0 ? "Cite at least one piece of evidence first" : undefined}
                onClick={() => act("SUBMIT")}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-xs font-bold disabled:opacity-40"
              >
                {claim.status === "NEEDS_EVIDENCE" ? "Resubmit for review" : "Submit for review"}
              </button>
            </>
          )}
          {(claim.status === "SUBMITTED" || claim.status === "APPROVED") && !withdrawing && (
            <button type="button" onClick={() => setWithdrawing(true)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-300 border border-red-500/30">
              Withdraw
            </button>
          )}
        </div>
      )}
      {withdrawing && (
        <div className="space-y-2">
          <textarea
            className={input}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why are you withdrawing this figure? (at least 10 characters)"
          />
          <div className="flex gap-2">
            <button type="button" disabled={busy || note.trim().length < 10} onClick={() => act("WITHDRAW")} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-40">
              Withdraw claim
            </button>
            <button type="button" onClick={() => setWithdrawing(false)} className="text-xs text-gray-400">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}

export default function ImpactCockpitClient({ cockpit, canEdit, verified }: { cockpit: NgoImpactCockpit; canEdit: boolean; verified: boolean }) {
  const [mode, setMode] = useState<null | { editing: Claim | null }>(null);
  const [projectFilter, setProjectFilter] = useState("ALL");
  const projectTitle = useMemo(() => new Map(cockpit.projects.map((p) => [p.id, p.title])), [cockpit.projects]);
  const claims = projectFilter === "ALL" ? cockpit.claims : cockpit.claims.filter((c) => c.projectId === projectFilter);
  const needsAction = cockpit.claims.filter((c) => c.status === "NEEDS_EVIDENCE" || c.status === "DRAFT").length;

  return (
    <div className="min-h-screen bg-gray-950 py-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold text-white">Impact cockpit</h1>
            <p className="text-sm text-gray-400 mt-1 max-w-3xl">
              Report outcomes against the platform&apos;s governed metrics, backed by approved evidence. A figure reaches donors only
              once a reviewer approves it and its evidence still supports it — until then donors see it as unverified, never as zero.
            </p>
          </div>
          {canEdit && verified && !mode && cockpit.projects.length > 0 && cockpit.metrics.length > 0 && (
            <button type="button" onClick={() => setMode({ editing: null })} className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-sm font-bold">
              Report an outcome
            </button>
          )}
        </div>

        {!verified && (
          <p className="text-sm text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-2xl px-5 py-3">
            Only verified organisations can report outcomes. Complete verification to start.
          </p>
        )}
        {!canEdit && (
          <p className="text-sm text-gray-300 border border-gray-800 rounded-2xl px-5 py-3">
            You are viewing your organisation&apos;s impact as a team member. Only the account owner can file or change claims.
          </p>
        )}
        {cockpit.metrics.length === 0 && (
          <p className="text-sm text-gray-400 border border-gray-800 rounded-2xl px-5 py-3">No metrics are open for reporting yet.</p>
        )}

        {mode && <ClaimForm cockpit={cockpit} editing={mode.editing} onDone={() => setMode(null)} />}

        {/* Per-metric totals — never summed across metrics (different units). */}
        <div>
          <p className="text-sm font-bold text-white mb-2">Verified impact by metric</p>
          {cockpit.rollup.length === 0 ? (
            <p className="text-xs text-gray-500">No outcomes reported yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {cockpit.rollup.map((r) => (
                <div key={r.metricCode} className="border border-gray-800 bg-gray-900/40 rounded-2xl p-4">
                  <p className="text-xs text-gray-400">{r.metricName}</p>
                  <p className="text-2xl font-extrabold text-emerald-300 mt-1">
                    {r.verifiedCount > 0 ? fmtValue(r.verifiedTotal, r.unit) : "—"}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-1">
                    {r.verifiedCount} verified · {r.inReviewCount} in review · {r.draftCount} draft
                    {r.unverifiedApprovedCount > 0 && <span className="text-red-300"> · {r.unverifiedApprovedCount} approved but no longer backed</span>}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-white">
              Claims {needsAction > 0 && <span className="text-amber-300 font-normal text-xs">· {needsAction} need your action</span>}
            </p>
            <select className="bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-gray-200" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="ALL">All projects</option>
              {cockpit.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          {claims.length === 0 ? (
            <p className="text-xs text-gray-500 border border-gray-800 rounded-2xl py-6 text-center">No claims here yet.</p>
          ) : (
            claims.map((c) => (
              <ClaimRow
                key={c.id}
                claim={c}
                projectTitle={projectTitle.get(c.projectId) ?? "Project"}
                canEdit={canEdit}
                onEdit={() => setMode({ editing: c })}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
