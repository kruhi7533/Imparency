"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ArrowRight, History } from "lucide-react";

function SuccessContent() {
  const searchParams = useSearchParams();
  const donationId = searchParams.get("donationId");

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full p-8 text-center shadow-2xl relative overflow-hidden">
      {/* Animated Background Glow */}
      <div className="absolute -top-24 -left-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Success Icon with pulse ring */}
      <div className="relative w-20 h-20 mx-auto mb-6 flex items-center justify-center">
        <div className="absolute inset-0 bg-emerald-500/20 rounded-full animate-ping opacity-75" />
        <div className="relative w-16 h-16 rounded-full bg-emerald-950/80 border-2 border-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
          <CheckCircle2 className="w-9 h-9 text-emerald-400" />
        </div>
      </div>

      <h1 className="text-2xl font-black text-white mb-3">
        Payment Confirmed!
      </h1>
      <p className="text-sm text-gray-400 mb-6 leading-relaxed">
        Thank you! Your mock donation has been approved and processed successfully. The NGO and project raised amounts have been updated.
      </p>

      {donationId && (
        <div className="mb-6 p-4 rounded-xl bg-gray-950/60 border border-gray-800 text-left">
          <span className="block text-[10px] uppercase tracking-wider font-extrabold text-gray-500">
            Reference ID
          </span>
          <span className="font-mono text-xs text-gray-300 select-all">
            {donationId}
          </span>
        </div>
      )}

      <div className="space-y-3">
        <Link
          href="/donor/donations"
          className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-sm font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 cursor-pointer"
        >
          <History className="w-4 h-4" />
          View Donation History
        </Link>
        <Link
          href="/donor/dashboard"
          className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-sm font-extrabold bg-gray-800 hover:bg-gray-700 text-gray-300 transition cursor-pointer"
        >
          Go to Dashboard
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

export default function DonationSuccessPage() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <Suspense fallback={<div className="text-gray-400">Loading...</div>}>
        <SuccessContent />
      </Suspense>
    </div>
  );
}
