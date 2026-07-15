"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AskNgoBox from "@/app/admin/components/AskNgoBox";

interface Milestone {
  id: string;
  title: string;
  description: string;
  targetAmount: number;
  deadline: string;
  sequenceOrder: number;
}

interface AiScreening {
  score: number;
  recommendation: "APPROVE" | "REVIEW" | "REJECT";
  reasoning: string;
  flags: string[];
}

interface PendingProject {
  id: string;
  title: string;
  description: string;
  causeCategory: string;
  location: string;
  coverImage: string;
  targetAmount: number;
  problemStatement: string | null;
  expectedOutcome: string | null;
  aiScreening: AiScreening | null;
  createdAt: string;
  ngo: {
    id: string;
    orgName: string;
    email: string;
    healthScore: number | null;
  };
  milestones: Milestone[];
}

interface AuditRecord {
  id: string;
  action: string;
  note: string | null;
  reviewedAt: string;
  admin: { name: string | null; email: string };
  project: { title: string; orgName: string };
}

interface Props {
  initialPending: PendingProject[];
  initialAudit: AuditRecord[];
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const RECO_STYLE: Record<AiScreening["recommendation"], { label: string; classes: string }> = {
  APPROVE: { label: "AI: Approve", classes: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900" },
  REVIEW: { label: "AI: Review carefully", classes: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900" },
  REJECT: { label: "AI: Reject", classes: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900" },
};

export default function ProjectReviewClient({ initialPending, initialAudit }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingProject[]>(initialPending);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [screeningId, setScreeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingProject | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  // Approving against a low AI score requires a written justification (AI override)
  const [overrideTarget, setOverrideTarget] = useState<PendingProject | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  async function runScreening(projectId: string) {
    setScreeningId(projectId);
    setError(null);
    try {
      const res = await fetch("/api/admin/screen-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Screening failed");
      }
      setPending((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, aiScreening: data.screening } : p))
      );
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setScreeningId(null);
    }
  }

  async function submitReview(projectId: string, action: "APPROVE" | "REJECT", rejectionReason?: string) {
    setBusyId(projectId);
    setError(null);
    try {
      const res = await fetch("/api/admin/review-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action, rejectionReason }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Review failed");
      }
      // Optimistically drop the project from the pending list, then refresh
      // server data so the audit trail and badges stay in sync.
      setPending((prev) => prev.filter((p) => p.id !== projectId));
      setRejectTarget(null);
      setRejectReason("");
      setOverrideTarget(null);
      setOverrideReason("");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-10">
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Pending queue */}
      <section>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
          Awaiting Approval{" "}
          <span className="ml-1 text-sm font-bold text-emerald-600">({pending.length})</span>
        </h2>

        {pending.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-16 text-center">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
              No projects awaiting approval. You&apos;re all caught up. 🎉
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {pending.map((p) => {
              const busy = busyId === p.id;
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden"
                >
                  <div className="flex flex-col sm:flex-row">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.coverImage}
                      alt={p.title}
                      className="h-40 w-full sm:w-56 object-cover bg-gray-100 dark:bg-gray-800"
                    />
                    <div className="flex-1 p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-lg font-bold text-gray-900 dark:text-white">{p.title}</h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            <a href={`/admin/ngos/${p.ngo.id}`} className="hover:text-emerald-600 hover:underline">
                              {p.ngo.orgName}
                            </a>{" "}
                            · {p.location} · {p.causeCategory}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-emerald-600">{inr(p.targetAmount)}</p>
                          <p className="text-xs text-gray-400">target</p>
                        </div>
                      </div>

                      <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 line-clamp-3">{p.description}</p>

                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                        <span>Submitted {fmtDate(p.createdAt)}</span>
                        <span>NGO health: {p.ngo.healthScore != null ? p.ngo.healthScore : "—"}</span>
                        <span>{p.milestones.length} milestone{p.milestones.length === 1 ? "" : "s"}</span>
                      </div>
                    </div>
                  </div>

                  {/* AI screening recommendation */}
                  {p.aiScreening ? (
                    <div className={`border-t border-gray-100 dark:border-gray-800 px-5 py-4`}>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${RECO_STYLE[p.aiScreening.recommendation].classes}`}>
                          {RECO_STYLE[p.aiScreening.recommendation].label}
                        </span>
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                          Score {p.aiScreening.score}/100
                        </span>
                        <span className="text-[11px] text-gray-400">Advisory only — your decision stands.</span>
                        <button
                          disabled={screeningId === p.id}
                          onClick={() => runScreening(p.id)}
                          className="ml-auto text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition disabled:opacity-50"
                        >
                          {screeningId === p.id ? "Re-running…" : "Re-run"}
                        </button>
                      </div>
                      {p.aiScreening.reasoning && (
                        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{p.aiScreening.reasoning}</p>
                      )}
                      {p.aiScreening.flags.length > 0 && (
                        <ul className="mt-2 list-disc list-inside space-y-0.5">
                          {p.aiScreening.flags.map((f, i) => (
                            <li key={i} className="text-xs text-amber-700 dark:text-amber-400">{f}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-3 flex items-center justify-between gap-3">
                      <span className="text-xs text-gray-400">AI screening has not been run for this project yet.</span>
                      <button
                        disabled={screeningId === p.id}
                        onClick={() => runScreening(p.id)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-200 dark:border-emerald-900 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition disabled:opacity-50 whitespace-nowrap"
                      >
                        {screeningId === p.id ? "Running AI screening…" : "Run AI screening"}
                      </button>
                    </div>
                  )}

                  {/* Milestones + rationale */}
                  <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">Milestones</p>
                      <ol className="space-y-2">
                        {p.milestones.map((m) => (
                          <li key={m.id} className="text-sm text-gray-700 dark:text-gray-300">
                            <span className="font-semibold">{m.sequenceOrder}. {m.title}</span>{" "}
                            <span className="text-gray-400">— {inr(m.targetAmount)}, due {fmtDate(m.deadline)}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div className="space-y-3">
                      {p.problemStatement && (
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-1">Problem</p>
                          <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-3">{p.problemStatement}</p>
                        </div>
                      )}
                      {p.expectedOutcome && (
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-1">Expected outcome</p>
                          <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-3">{p.expectedOutcome}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-3 flex items-center gap-3">
                    <div className="mr-auto">
                      <AskNgoBox
                        ngoId={p.ngo.id}
                        ngoName={p.ngo.orgName}
                        subject={`Question about project "${p.title}"`}
                        entityType="PROJECT"
                        entityId={p.id}
                      />
                    </div>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setRejectTarget(p);
                        setRejectReason("");
                      }}
                      className="px-4 py-2 text-sm font-semibold rounded-lg border border-red-200 dark:border-red-900 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (p.aiScreening && p.aiScreening.score < 40) {
                          setOverrideTarget(p);
                          setOverrideReason("");
                        } else {
                          submitReview(p.id, "APPROVE");
                        }
                      }}
                      className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50"
                    >
                      {busy ? "Working…" : "Approve & Publish"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Audit trail */}
      <section>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Recent Decisions</h2>
        {initialAudit.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No decisions recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 text-left text-xs font-bold uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-4 py-3">Project</th>
                  <th className="px-4 py-3">NGO</th>
                  <th className="px-4 py-3">Decision</th>
                  <th className="px-4 py-3">Note</th>
                  <th className="px-4 py-3">Admin</th>
                  <th className="px-4 py-3">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-900">
                {initialAudit.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 text-gray-900 dark:text-white">{r.project.title}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{r.project.orgName}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                          r.action === "APPROVED"
                            ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                            : "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400"
                        }`}
                      >
                        {r.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 max-w-xs truncate">{r.note || "—"}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{r.admin.name || r.admin.email}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmtDate(r.reviewedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Reject modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Reject project</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              &ldquo;{rejectTarget.title}&rdquo; will be returned to {rejectTarget.ngo.orgName} as a draft. They&apos;ll see your note.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              placeholder="Explain what the NGO needs to fix before resubmitting…"
              className="mt-4 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setRejectTarget(null)}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
              >
                Cancel
              </button>
              <button
                disabled={!rejectReason.trim() || busyId === rejectTarget.id}
                onClick={() => submitReview(rejectTarget.id, "REJECT", rejectReason.trim())}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50"
              >
                {busyId === rejectTarget.id ? "Working…" : "Reject & Return"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI-override approve modal */}
      {overrideTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Approve against AI recommendation</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              The AI scored &ldquo;{overrideTarget.title}&rdquo; at{" "}
              <span className="font-bold text-red-600">{overrideTarget.aiScreening?.score}/100</span>.
              A written justification is required and will be recorded in the audit log.
            </p>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              rows={4}
              placeholder="Why is this project safe to publish despite the low AI score?"
              className="mt-4 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setOverrideTarget(null)}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
              >
                Cancel
              </button>
              <button
                disabled={!overrideReason.trim() || busyId === overrideTarget.id}
                onClick={() => submitReview(overrideTarget.id, "APPROVE", overrideReason.trim())}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50"
              >
                {busyId === overrideTarget.id ? "Working…" : "Approve with Justification"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
