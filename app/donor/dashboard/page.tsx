import React from "react";

export default function DonorDashboardPage() {
  const stats = [
    { label: "Total Donated", value: "Rs.0", sub: "across all NGOs" },
    { label: "Donations", value: "0", sub: "successful payments" },
    { label: "NGOs Followed", value: "0", sub: "organizations" },
    { label: "Donor Tier", value: "Standard", sub: "tier status" },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto text-left">
      
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white">Impact Portfolio</h1>
        <p className="text-gray-400 text-sm mt-1">
          Your complete giving history and verified impact
        </p>
      </div>

      {/* Re-engagement CTA placeholder */}
      {/* TODO B5: ReEngagementCard component goes here */}

      {/* Stats row — 4 cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-gray-900 border border-gray-800 rounded-2xl p-4 shadow-sm relative overflow-hidden"
          >
            <div className="text-xs text-gray-500 mb-1">{stat.label}</div>
            <div className="text-xl font-black text-white">{stat.value}</div>
            <div className="text-[10px] text-gray-600 mt-0.5">{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Impact reports feed placeholder */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 relative overflow-hidden">
        <h2 className="text-sm font-bold text-white mb-4">Recent Impact Reports</h2>
        <div className="text-center py-8 text-gray-600 text-sm">
          Impact reports will appear here after your first donation milestone is verified.
        </div>
      </div>

    </div>
  );
}
