"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface InitiativeDetail {
  id: string;
  organizerName: string;
  organizerType: string;
  description: string;
  location: string;
  requiredFunds: number;
  raisedAmount: number;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankProofUrl: string;
  images: string[];
  documents: string[];
  status: string;
  reviewNote: string | null;
  crisisEvent: { title: string; slug: string };
  submittedBy: { name: string; email: string };
}

export default function AdminInitiativeDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [initiative, setInitiative] = useState<InitiativeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/initiatives/${params.id}`)
      .then((r) => r.json())
      .then((d) => setInitiative(d.initiative))
      .finally(() => setLoading(false));
  }, [params.id]);

  async function decide(decision: "VERIFIED" | "REJECTED") {
    if (decision === "REJECTED" && !rejectNote.trim()) {
      setError("A rejection note is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/initiatives/${params.id}/verify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: decision === "REJECTED" ? rejectNote : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      router.push("/admin/initiatives");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="min-h-screen bg-gray-50 dark:bg-gray-950" />;
  if (!initiative) return <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-10 text-center text-gray-400">Initiative not found.</div>;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <a href="/admin/initiatives" className="text-xs text-gray-400 hover:text-emerald-600 font-semibold">← Back to Initiatives</a>

        {error && (
          <div className="mt-4 p-3.5 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/50 rounded-xl text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6 mt-4">
          <p className="text-xs text-gray-400 mb-1">For crisis: <span className="font-semibold text-gray-600 dark:text-gray-300">{initiative.crisisEvent.title}</span></p>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">{initiative.organizerName}</h1>
          <p className="text-sm text-gray-500 mt-1">{initiative.organizerType} · {initiative.location}</p>
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-4 leading-relaxed">{initiative.description}</p>

          <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-gray-100 dark:border-gray-800 text-sm">
            <div>
              <div className="text-xs text-gray-400 uppercase font-bold">Funds required</div>
              <div className="font-bold text-gray-900 dark:text-white">₹{initiative.requiredFunds.toLocaleString("en-IN")}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase font-bold">Submitted by</div>
              <div className="font-bold text-gray-900 dark:text-white">{initiative.submittedBy.name}</div>
              <div className="text-xs text-gray-400">{initiative.submittedBy.email}</div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
            <h3 className="font-bold text-gray-900 dark:text-white mb-3">Bank details (cross-check against proof below)</h3>
            <div className="grid grid-cols-3 gap-4 text-sm bg-gray-50 dark:bg-gray-950 rounded-xl p-4">
              <div>
                <div className="text-[10px] text-gray-400 uppercase font-bold">Account holder</div>
                <div className="font-semibold text-gray-900 dark:text-white">{initiative.bankAccountName}</div>
              </div>
              <div>
                <div className="text-[10px] text-gray-400 uppercase font-bold">Account number</div>
                <div className="font-mono font-semibold text-gray-900 dark:text-white">{initiative.bankAccountNumber}</div>
              </div>
              <div>
                <div className="text-[10px] text-gray-400 uppercase font-bold">IFSC</div>
                <div className="font-mono font-semibold text-gray-900 dark:text-white">{initiative.bankIfsc}</div>
              </div>
            </div>
            <a href={initiative.bankProofUrl} target="_blank" rel="noreferrer" className="inline-block mt-3 text-xs font-bold text-emerald-600 hover:text-emerald-700">
              View bank proof document →
            </a>
          </div>

          {initiative.images.length > 0 && (
            <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
              <h3 className="font-bold text-gray-900 dark:text-white mb-3">Photos</h3>
              <div className="grid grid-cols-4 gap-2">
                {initiative.images.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt="" className="w-full h-20 object-cover rounded-lg" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {initiative.documents.length > 0 && (
            <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
              <h3 className="font-bold text-gray-900 dark:text-white mb-3">Supporting documents</h3>
              <div className="flex flex-wrap gap-2">
                {initiative.documents.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer" className="text-xs font-bold text-emerald-600 hover:text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-1.5 rounded-lg">
                    Document {i + 1}
                  </a>
                ))}
              </div>
            </div>
          )}

          {["SUBMITTED", "UNDER_REVIEW"].includes(initiative.status) ? (
            <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
              <div className="flex gap-3">
                <button
                  onClick={() => decide("VERIFIED")}
                  disabled={busy}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2 px-5 rounded-xl text-sm transition"
                >
                  Verify & Publish
                </button>
                <button
                  onClick={() => setShowReject(!showReject)}
                  className="bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 font-bold py-2 px-5 rounded-xl text-sm transition"
                >
                  Reject
                </button>
              </div>
              {showReject && (
                <div className="mt-4">
                  <textarea
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 py-2.5 text-sm"
                    rows={3}
                    placeholder="Reason for rejection (required)"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                  />
                  <button
                    onClick={() => decide("REJECTED")}
                    disabled={busy}
                    className="mt-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-2 px-5 rounded-xl text-sm transition"
                  >
                    Confirm rejection
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800 text-sm text-gray-500">
              Status: <span className="font-bold">{initiative.status}</span>
              {initiative.reviewNote && <p className="mt-1 text-xs">{initiative.reviewNote}</p>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
