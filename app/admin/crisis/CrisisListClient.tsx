"use client";

import { useState } from "react";

interface CrisisEventRow {
  id: string;
  title: string;
  slug: string;
  disasterType: string;
  severity: string;
  status: string;
  verificationStatus: string;
  isFeatured: boolean;
  isArchived: boolean;
  coverImage: string;
  totalRaised: number;
  totalDonors: number;
  totalCampaigns: number;
  totalNgos: number;
  startDate: string;
  expectedEndDate: string | null;
  createdAt: string;
}

const VERIFICATION_BADGE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  VERIFIED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-700",
};

const STATUS_BADGE: Record<string, string> = {
  UPCOMING: "bg-blue-100 text-blue-700",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-gray-100 text-gray-600",
};

const SEVERITY_BADGE: Record<string, string> = {
  LOW: "bg-gray-100 text-gray-600",
  MODERATE: "bg-amber-100 text-amber-700",
  HIGH: "bg-orange-100 text-orange-700",
  CRITICAL: "bg-red-100 text-red-700",
};

export default function CrisisListClient({ initialEvents }: { initialEvents: CrisisEventRow[] }) {
  const [filter, setFilter] = useState<string>("ALL");

  const filtered = initialEvents.filter((e) => {
    if (filter === "ALL") return true;
    if (filter === "PENDING") return e.verificationStatus === "PENDING";
    return e.status === filter;
  });

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {["ALL", "PENDING", "UPCOMING", "ACTIVE", "CLOSED"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${
              filter === f
                ? "bg-trust-600 text-white"
                : "bg-white text-gray-600 border border-gray-200"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200/80 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wide">
              <th className="py-3 px-4">Event</th>
              <th className="py-3 px-4">Type / Severity</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Verification</th>
              <th className="py-3 px-4">Raised</th>
              <th className="py-3 px-4">NGOs / Campaigns</th>
              <th className="py-3 px-4"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-gray-500 text-sm">
                  No crisis events match this filter.
                </td>
              </tr>
            )}
            {filtered.map((e) => (
              <tr key={e.id} className="border-b border-gray-50 last:border-0">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <img src={e.coverImage} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                    <div>
                      <div className="font-bold text-gray-900 flex items-center gap-1.5">
                        {e.title}
                        {e.isFeatured && <span title="Featured">⭐</span>}
                        {e.isArchived && <span className="text-[10px] text-gray-500">(archived)</span>}
                      </div>
                      <div className="text-xs text-gray-500">{e.slug}</div>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-4">
                  <div className="text-xs font-semibold text-gray-600">{e.disasterType}</div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SEVERITY_BADGE[e.severity]}`}>{e.severity}</span>
                </td>
                <td className="py-3 px-4">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[e.status]}`}>{e.status}</span>
                </td>
                <td className="py-3 px-4">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${VERIFICATION_BADGE[e.verificationStatus]}`}>
                    {e.verificationStatus}
                  </span>
                </td>
                <td className="py-3 px-4 font-bold text-gray-900">
                  ₹{e.totalRaised.toLocaleString("en-IN")}
                  <div className="text-[10px] font-normal text-gray-500">{e.totalDonors} donors</div>
                </td>
                <td className="py-3 px-4 text-xs text-gray-500">
                  {e.totalNgos} NGOs · {e.totalCampaigns} campaigns
                </td>
                <td className="py-3 px-4 text-right">
                  <a href={`/admin/crisis/${e.id}`} className="text-emerald-600 hover:text-emerald-700 font-bold text-xs">
                    Manage →
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
