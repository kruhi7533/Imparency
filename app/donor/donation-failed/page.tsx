"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { XCircle, RefreshCw, ArrowRight } from "lucide-react";

function FailedContent() {
  const searchParams = useSearchParams();
  const donationId = searchParams.get("donationId");
  const reason = searchParams.get("reason");

  const getReasonDetails = () => {
    switch (reason) {
      case "cancelled":
        return {
          title: "Donation Cancelled",
          description: "You have cancelled this donation transaction. No funds were captured and your account was not charged.",
        };
      case "TOKEN_EXPIRED":
      case "token_expired":
        return {
          title: "Approval Link Expired",
          description: "The confirmation link has expired (expiry window is 30 minutes). Please initiate a new donation.",
        };
      case "INVALID_TOKEN":
      case "invalid_token":
        return {
          title: "Verification Failed",
          description: "The payment verification link is invalid, already processed, or has been tampered with.",
        };
      default:
        return {
          title: "Transaction Failed",
          description: "We encountered an issue verifying or processing this donation payment. Please try again.",
        };
    }
  };

  const details = getReasonDetails();

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full p-8 text-center shadow-2xl relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute -top-24 -left-24 w-48 h-48 bg-red-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Failure Icon */}
      <div className="w-16 h-16 rounded-full bg-red-950/80 border-2 border-red-500 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-red-500/10">
        <XCircle className="w-9 h-9 text-red-400" />
      </div>

      <h1 className="text-2xl font-black text-white mb-3">
        {details.title}
      </h1>
      <p className="text-sm text-gray-400 mb-6 leading-relaxed">
        {details.description}
      </p>

      {donationId && (
        <div className="mb-6 p-4 rounded-xl bg-gray-950/60 border border-gray-800 text-left">
          <span className="block text-[10px] uppercase tracking-wider font-extrabold text-gray-500">
            Reference ID
          </span>
          <span className="font-mono text-xs text-gray-300">
            {donationId}
          </span>
        </div>
      )}

      <div className="space-y-3">
        <Link
          href="/ngo/discover"
          className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-sm font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          Find NGOs to Support
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

export default function DonationFailedPage() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <Suspense fallback={<div className="text-gray-400">Loading...</div>}>
        <FailedContent />
      </Suspense>
    </div>
  );
}
