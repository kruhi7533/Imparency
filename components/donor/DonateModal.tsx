"use client";

import React, { useState, useEffect } from "react";

interface DonateModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: {
    id: string;
    title: string;
    targetAmount: number;
    raisedAmount: number;
  };
  ngoName: string;
  ngoId: string;
  donorCategory: string; // passed from parent after declaration
}

export function DonateModal({
  isOpen,
  onClose,
  project,
  ngoName,
  ngoId,
  donorCategory,
}: DonateModalProps) {
  const [fcraStatus, setFcraStatus] = useState<string | null>(null);
  const [fcraLoading, setFcraLoading] = useState(true);
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setFcraLoading(true);
    fetch(`/api/ngo/${ngoId}/fcra-status`)
      .then((r) => r.json())
      .then((data) => {
        setFcraStatus(data.fcraStatus);
      })
      .catch(() => setFcraStatus("NOT_REGISTERED"))
      .finally(() => setFcraLoading(false));
  }, [isOpen, ngoId]);

  if (!isOpen) return null;

  const isInternationalDonor =
    donorCategory === "NRI_OCI" || donorCategory === "FOREIGN_NATIONAL";
  const isFCRABlocked =
    isInternationalDonor && fcraStatus !== "ACTIVE";

  const effectiveAmount = showCustom
    ? parseInt(customAmount, 10)
    : amount;

  const handleProceedToPayment = () => {
    if (!effectiveAmount || isFCRABlocked) return;
    // TODO B3: Replace with Razorpay order creation call
    console.log("Proceeding to payment:", {
      projectId: project.id,
      amount: effectiveAmount,
      donorCategory,
    });
    alert(`Payment flow coming soon. Amount: Rs.${effectiveAmount}`);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center animate-fadeIn"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-800 rounded-2xl max-w-lg w-full mx-4 p-6 shadow-2xl space-y-6 text-left"
      >
        {/* Header row */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-black text-white">{project.title}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{ngoName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-600 hover:text-white transition cursor-pointer"
          >
            {/* X SVG */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress bar (target vs raised) */}
        <div>
          <div className="flex justify-between text-[10px] text-gray-500 mb-1">
            <span>Rs.{project.raisedAmount.toLocaleString("en-IN")} raised</span>
            <span>Goal: Rs.{project.targetAmount.toLocaleString("en-IN")}</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full"
              style={{
                width: `${Math.min(100, (project.raisedAmount / project.targetAmount) * 100)}%`,
              }}
            />
          </div>
        </div>

        {/* FCRA block banner — only shown when isFCRABlocked */}
        {!fcraLoading && isFCRABlocked && (
          <div className="p-4 rounded-xl bg-red-950/30 border border-red-800/60 animate-fadeIn">
            <div className="flex items-start gap-3">
              <span className="text-red-400 mt-0.5 flex-shrink-0">
                {/* Warning SVG — 20x20 */}
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
              <div>
                <p className="text-sm font-bold text-red-300">
                  Foreign contributions not accepted
                </p>
                <p className="text-xs text-red-400/80 mt-1 leading-relaxed">
                  This NGO's FCRA registration is{" "}
                  {fcraStatus === "EXPIRED" ? "expired" : "not active"}.
                  It cannot currently accept donations from NRIs or foreign nationals under Indian law.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Amount selector (disabled when isFCRABlocked) */}
        <div className={`space-y-4 ${isFCRABlocked ? "opacity-40 pointer-events-none" : ""}`}>
          <div className="flex flex-wrap justify-center gap-3">
            {[500, 1000, 5000, 10000].map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => {
                  setAmount(amt);
                  setShowCustom(false);
                  setCustomAmount("");
                }}
                className={`
                  px-6 py-3 rounded-2xl text-sm font-black transition-all duration-150
                  border-2 min-w-[100px] cursor-pointer
                  ${amount === amt && !showCustom
                    ? "bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-500/20 scale-105"
                    : "bg-gray-900/60 border-gray-800 text-gray-300 hover:border-emerald-700 hover:text-white hover:bg-gray-900"
                  }
                `}
              >
                ₹{amt.toLocaleString("en-IN")}
              </button>
            ))}

            {/* Custom Amount button */}
            <button
              type="button"
              onClick={() => {
                setShowCustom(true);
                setAmount(null);
              }}
              className={`
                px-6 py-3 rounded-2xl text-sm font-black transition-all duration-150
                border-2 min-w-[140px] cursor-pointer
                ${showCustom
                  ? "bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-500/20 scale-105"
                  : "bg-gray-900/60 border-gray-800 text-gray-300 hover:border-emerald-700 hover:text-white hover:bg-gray-900"
                }
              `}
            >
              Custom Amount
            </button>
          </div>

          {showCustom && (
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="text-white font-bold text-lg">₹</span>
              <input
                type="number"
                min="100"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="Enter amount"
                autoFocus
                className="
                  w-40 px-4 py-3 bg-gray-900 border-2 border-emerald-600
                  rounded-2xl text-white font-bold text-center text-sm
                  focus:outline-none focus:ring-2 focus:ring-emerald-500
                  placeholder-gray-600
                  [appearance:textfield]
                  [&::-webkit-outer-spin-button]:appearance-none
                  [&::-webkit-inner-spin-button]:appearance-none
                "
              />
            </div>
          )}
        </div>

        {/* Pay button */}
        <button
          type="button"
          disabled={isFCRABlocked || !effectiveAmount || fcraLoading}
          onClick={handleProceedToPayment}
          className={`
            w-full py-3.5 rounded-xl text-sm font-extrabold transition-all cursor-pointer
            ${isFCRABlocked || !effectiveAmount || fcraLoading
              ? "bg-gray-800 text-gray-600 cursor-not-allowed border border-gray-850"
              : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/10"
            }
          `}
        >
          {fcraLoading
            ? "Checking eligibility..."
            : isFCRABlocked
            ? "Donation not available"
            : effectiveAmount
            ? `Donate Rs.${effectiveAmount.toLocaleString("en-IN")} →`
            : "Select an amount"
          }
        </button>
      </div>
    </div>
  );
}
