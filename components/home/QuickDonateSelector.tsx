"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export default function QuickDonateSelector() {
  const [selected, setSelected] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [showCustom, setShowCustom] = useState<boolean>(false);
  const router = useRouter();

  // Compute effective amount
  const effectiveAmount = showCustom
    ? parseInt(customAmount, 10)
    : selected;

  const isReady = effectiveAmount !== null &&
    !isNaN(effectiveAmount as number) &&
    (effectiveAmount as number) >= 100;

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div className="flex flex-wrap justify-center gap-3">
        {[500, 1000, 5000, 10000].map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => {
              setSelected(amount);
              setShowCustom(false);
              setCustomAmount("");
            }}
            className={`
              px-6 py-3 rounded-2xl text-sm font-black transition-all duration-150
              border-2 min-w-[100px] cursor-pointer
              ${selected === amount && !showCustom
                ? "bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-500/20 scale-105"
                : "bg-gray-900/60 border-gray-800 text-gray-300 hover:border-emerald-700 hover:text-white hover:bg-gray-900"
              }
            `}
          >
            ₹{amount.toLocaleString("en-IN")}
          </button>
        ))}

        {/* Custom Amount button */}
        <button
          type="button"
          onClick={() => {
            setShowCustom(true);
            setSelected(null);
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

      <div className="pt-2">
        <button
          type="button"
          onClick={() => {
            if (!isReady) return;
            router.push(`/discover?minBudget=${effectiveAmount}`);
          }}
          disabled={!isReady}
          className={`
            px-10 py-4 rounded-2xl text-sm font-extrabold transition-all duration-200
            ${isReady
              ? "bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-lg shadow-emerald-500/20 hover:-translate-y-0.5 cursor-pointer"
              : "bg-gray-850 text-gray-600 cursor-not-allowed border border-gray-800"
            }
          `}
        >
          {isReady
            ? `Find campaigns for ₹${(effectiveAmount as number).toLocaleString("en-IN")} →`
            : "Select an amount to continue"
          }
        </button>
      </div>

      <p className="text-[11px] text-gray-600 mt-3">
        Minimum donation ₹100 · Secured by Razorpay · 80G receipt auto-generated
      </p>
    </div>
  );
}
