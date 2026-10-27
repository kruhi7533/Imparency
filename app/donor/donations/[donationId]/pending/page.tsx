"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export default function PendingDonationPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const donationId = params.donationId as string;
  const paymentId = searchParams.get("payment_id");

  const [status, setStatus] = useState<"PENDING" | "SUCCESS" | "FAILED" | "UNKNOWN">("PENDING");
  const [details, setDetails] = useState<{ amount: number; projectTitle: string; receiptUrl: string | null } | null>(null);
  const [attempts, setAttempts] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!donationId) return;

    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/donations/${donationId}/status`);
        if (!res.ok) {
          throw new Error("Failed to retrieve payment status");
        }
        const data = await res.json();
        
        setDetails({
          amount: Number(data.amount),
          projectTitle: data.projectTitle,
          receiptUrl: data.receiptUrl ?? null
        });

        if (data.status === "SUCCESS") {
          setStatus("SUCCESS");
          setLoading(false);
          return true; // Stop polling
        } else if (data.status === "FAILED") {
          setStatus("FAILED");
          setLoading(false);
          return true; // Stop polling
        }
        return false; // Keep polling
      } catch (err: any) {
        console.error("Polling checkStatus error:", err);
        setError(err.message || "Unable to load status");
        return false; // Keep attempting
      }
    };

    // Initial check
    checkStatus();

    // Setup polling interval
    const interval = setInterval(async () => {
      setAttempts((prev) => {
        const nextAttempt = prev + 1;
        if (nextAttempt >= 10) {
          clearInterval(interval);
          setLoading(false);
          setStatus("UNKNOWN");
          return nextAttempt;
        }
        
        checkStatus().then((shouldStop) => {
          if (shouldStop) {
            clearInterval(interval);
          }
        });
        
        return nextAttempt;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [donationId]);

  return (
    <div className="font-sans">

      <div className="max-w-md mx-auto px-4 py-20">
        <div className="bg-white border border-gray-200/80 rounded-2xl p-6 sm:p-8 shadow-[0_1px_2px_rgba(16,24,40,0.04)] text-center space-y-6">
          
          {status === "PENDING" && (
            <div className="space-y-6 py-6">
              {/* Spinning Loader */}
              <div className="flex justify-center">
                <div className="w-16 h-16 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin"></div>
              </div>
              
              <div className="space-y-2">
                <h2 className="text-xl font-black text-gray-900">Verifying Payment...</h2>
                <p className="text-xs text-gray-600">
                  Please do not close this window or navigate away. We are securing your transaction confirmation.
                </p>
              </div>

              {details && (
                <div className="bg-gray-50 rounded-2xl p-4 text-xs font-semibold text-gray-600 text-left space-y-1">
                  <div><strong>Campaign:</strong> {details.projectTitle}</div>
                  <div><strong>Amount:</strong> ₹{details.amount.toLocaleString()}</div>
                  {paymentId && <div><strong>Razorpay Ref:</strong> {paymentId}</div>}
                </div>
              )}
              
              <div className="text-[10px] text-gray-600 font-bold">
                Attempt {attempts + 1} of 10
              </div>
            </div>
          )}

          {status === "SUCCESS" && (
            <div className="space-y-6 py-4">
              {/* Success Badge Icon */}
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-emerald-50 text-emerald-700 rounded-full flex items-center justify-center text-4xl shadow-inner border border-emerald-100 animate-bounce">
                  ✓
                </div>
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-black text-gray-900">Donation Successful!</h2>
                <p className="text-xs text-gray-600">
                  Thank you for your generosity. Your contribution is now secured and locked against milestones.
                </p>
              </div>

              {details && (
                <div className="bg-emerald-50/50 border border-emerald-100/50 rounded-2xl p-5 text-xs text-emerald-800 text-left space-y-2">
                  <div><strong>Project:</strong> {details.projectTitle}</div>
                  <div className="text-sm font-black text-emerald-700"><strong>Contributed:</strong> ₹{details.amount.toLocaleString()}</div>
                  <div className="text-[10px] text-gray-600">
                    {details.receiptUrl
                      ? "An 80G tax receipt has been generated and dispatched to your email."
                      : "Your 80G tax receipt is on hold until your PAN is verified — verify it from your profile to receive it by email."}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2 pt-4">
                <Link
                  href="/donor/portfolio"
                  className="bg-trust-600 hover:bg-trust-700 text-white font-semibold py-3 rounded-lg shadow-sm transition text-xs"
                >
                  View Impact Portfolio
                </Link>
                <Link
                  href="/discover"
                  className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 font-semibold py-3 rounded-lg transition text-xs"
                >
                  Discover More Campaigns
                </Link>
              </div>
            </div>
          )}

          {status === "FAILED" && (
            <div className="space-y-6 py-4">
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-red-50 text-red-600 rounded-full flex items-center justify-center text-4xl border border-red-100">
                  ✕
                </div>
              </div>

              <div className="space-y-2">
                <h2 className="text-xl font-black text-gray-900">Transaction Failed</h2>
                <p className="text-xs text-gray-600">
                  The payment gateway reported a transaction failure. No funds were debited.
                </p>
              </div>

              <div className="flex flex-col gap-2 pt-4">
                <button
                  onClick={() => router.back()}
                  className="bg-trust-600 hover:bg-trust-700 text-white font-semibold py-3 rounded-lg shadow-sm transition text-xs"
                >
                  Try Again
                </button>
                <Link
                  href="/discover"
                  className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 font-semibold py-3 rounded-lg transition text-xs"
                >
                  Return to Discovery
                </Link>
              </div>
            </div>
          )}

          {status === "UNKNOWN" && (
            <div className="space-y-6 py-4">
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-amber-50 text-amber-700 rounded-full flex items-center justify-center text-4xl border border-amber-100">
                  ⚠️
                </div>
              </div>

              <div className="space-y-2">
                <h2 className="text-xl font-black text-gray-900">Verification Pending</h2>
                <p className="text-xs text-gray-600 leading-relaxed">
                  We are still waiting for confirmation from Razorpay. Do not worry—if your account was debited, the donation will be processed shortly.
                </p>
                <p className="text-[10px] text-amber-700 font-semibold bg-amber-50 border border-amber-100 rounded-lg p-2.5">
                  If this continues, please contact support with Order ID: <span className="font-mono">{donationId}</span>
                </p>
              </div>

              <div className="flex flex-col gap-2 pt-4">
                <Link
                  href="/donor/portfolio"
                  className="bg-trust-600 hover:bg-trust-700 text-white font-semibold py-3 rounded-lg shadow-sm transition text-xs"
                >
                  Go to Portfolio
                </Link>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
