"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Participant {
  id: string;
  ngoId: string;
  orgName: string;
  joinedAt: string;
}

interface CrisisEventDetail {
  id: string;
  title: string;
  slug: string;
  disasterType: string;
  description: string;
  affectedLocation: string;
  country: string;
  stateName: string | null;
  city: string | null;
  severity: string;
  coverImage: string;
  galleryImages: string[];
  status: string;
  verificationStatus: string;
  isFeatured: boolean;
  isArchived: boolean;
  startDate: string;
  expectedEndDate: string | null;
  totalRaised: number;
  totalDonors: number;
  totalCampaigns: number;
  totalNgos: number;
  createdBy: { name: string; email: string };
  participants: Participant[];
  _count: { initiatives: number; donations: number; updates: number };
}

const SEVERITIES = ["LOW", "MODERATE", "HIGH", "CRITICAL"];
const STATUSES = ["UPCOMING", "ACTIVE", "CLOSED"];

const badgeClass = "text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide";
const VERIFICATION_BADGE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-950/20 dark:text-amber-400",
  VERIFIED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400",
};
const STATUS_BADGE: Record<string, string> = {
  UPCOMING: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
  ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400",
  CLOSED: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export default function CrisisDetailClient({ event }: { event: CrisisEventDetail }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [status, setStatus] = useState(event.status);
  const [severity, setSeverity] = useState(event.severity);

  async function callApi(url: string, body: any) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const verify = () => callApi(`/api/admin/crisis/${event.id}/verify`, { decision: "VERIFIED" });
  const reject = () => {
    if (!rejectNote.trim()) {
      setError("A rejection note is required.");
      return;
    }
    callApi(`/api/admin/crisis/${event.id}/verify`, { decision: "REJECTED", note: rejectNote });
  };
  const toggleFeatured = () => callApi(`/api/admin/crisis/${event.id}/feature`, { featured: !event.isFeatured });
  const archive = () => callApi(`/api/admin/crisis/${event.id}/archive`, {});
  const saveStatusSeverity = () => callApi(`/api/admin/crisis/${event.id}`, { status, severity });

  return (
    <div className="mt-4">
      {error && (
        <div className="mb-6 p-3.5 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/50 rounded-xl text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden mb-6">
        <img src={event.coverImage} alt="" className="w-full h-56 object-cover" />
        <div className="p-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className={`${badgeClass} ${STATUS_BADGE[event.status]}`}>{event.status}</span>
            <span className={`${badgeClass} ${VERIFICATION_BADGE[event.verificationStatus]}`}>{event.verificationStatus}</span>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 uppercase">
              {event.disasterType} · {event.severity}
            </span>
            {event.isFeatured && (
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-yellow-100 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-400">
                ⭐ FEATURED
              </span>
            )}
            {event.isArchived && (
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">ARCHIVED</span>
            )}
          </div>

          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">{event.title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{event.affectedLocation}</p>
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-4 leading-relaxed">{event.description}</p>

          <div className="grid grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
            <div>
              <div className="text-xs text-gray-400 uppercase font-bold">Raised</div>
              <div className="text-lg font-extrabold text-gray-900 dark:text-white">₹{event.totalRaised.toLocaleString("en-IN")}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase font-bold">Donors</div>
              <div className="text-lg font-extrabold text-gray-900 dark:text-white">{event.totalDonors}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase font-bold">NGOs</div>
              <div className="text-lg font-extrabold text-gray-900 dark:text-white">{event.totalNgos}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase font-bold">Campaigns</div>
              <div className="text-lg font-extrabold text-gray-900 dark:text-white">{event.totalCampaigns}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4 text-xs text-gray-500">
            <div>{event._count.initiatives} individual initiatives</div>
            <div>{event._count.donations} direct/crisis donations</div>
            <div>{event._count.updates} transparency updates</div>
          </div>
        </div>
      </div>

      {/* Verification */}
      {event.verificationStatus === "PENDING" && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-amber-200 dark:border-amber-900/40 p-6 mb-6">
          <h2 className="font-bold text-gray-900 dark:text-white mb-3">Verification required</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            This event is not visible anywhere publicly until it&apos;s verified.
          </p>
          <div className="flex gap-3">
            <button
              onClick={verify}
              disabled={busy}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2 px-5 rounded-xl text-sm transition"
            >
              Verify
            </button>
            <button
              onClick={() => setShowRejectBox(!showRejectBox)}
              className="bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 font-bold py-2 px-5 rounded-xl text-sm transition"
            >
              Reject
            </button>
          </div>
          {showRejectBox && (
            <div className="mt-4">
              <textarea
                className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 py-2.5 text-sm"
                rows={3}
                placeholder="Reason for rejection (required, shown internally)"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
              />
              <button
                onClick={reject}
                disabled={busy}
                className="mt-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-2 px-5 rounded-xl text-sm transition"
              >
                Confirm rejection
              </button>
            </div>
          )}
        </div>
      )}

      {/* Status / severity / featured / archive controls */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6 mb-6">
        <h2 className="font-bold text-gray-900 dark:text-white mb-4">Manage</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">Status</label>
            <select
              className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">Severity</label>
            <select
              className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <button
          onClick={saveStatusSeverity}
          disabled={busy || (status === event.status && severity === event.severity)}
          className="bg-gray-900 dark:bg-white text-white dark:text-gray-900 disabled:opacity-40 font-bold py-2 px-5 rounded-xl text-sm transition mb-4"
        >
          Save
        </button>

        <div className="flex gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={toggleFeatured}
            disabled={busy || (event.verificationStatus !== "VERIFIED" && !event.isFeatured)}
            className="text-xs font-bold px-4 py-2 rounded-xl bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-400 disabled:opacity-40"
          >
            {event.isFeatured ? "★ Unfeature" : "☆ Mark Featured"}
          </button>
          <button
            onClick={archive}
            disabled={busy || event.status !== "CLOSED" || event.isArchived}
            className="text-xs font-bold px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 disabled:opacity-40"
          >
            {event.isArchived ? "Archived" : "Archive"}
          </button>
        </div>
      </div>

      {/* Participants */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6">
        <h2 className="font-bold text-gray-900 dark:text-white mb-4">Participating NGOs ({event.participants.length})</h2>
        {event.participants.length === 0 ? (
          <p className="text-xs text-gray-400">No NGOs have joined this relief effort yet.</p>
        ) : (
          <ul className="space-y-2">
            {event.participants.map((p) => (
              <li key={p.id} className="flex justify-between text-sm">
                <span className="font-semibold text-gray-800 dark:text-gray-200">{p.orgName}</span>
                <span className="text-xs text-gray-400">joined {new Date(p.joinedAt).toLocaleDateString("en-IN")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
