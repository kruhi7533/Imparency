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
              px-6 py-3 rounded-lg text-sm font-semibold transition-all duration-150
              border-2 min-w-[100px] cursor-pointer
              ${selected === amount && !showCustom
                ? "bg-gold-500/10 border-gold-400 text-gold-200"
                : "bg-gray-900/60 border-gray-800 text-gray-300 hover:border-gold-700 hover:text-white hover:bg-gray-900"
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
              w-40 px-4 py-3 bg-gray-900 border-2 border-gold-500/50
              rounded-lg text-white font-semibold text-center text-sm
              focus:outline-none focus:border-gold-400
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
            px-10 py-4 rounded-lg text-sm font-semibold transition-all duration-200
            ${isReady
              ? "bg-trust-600 hover:bg-trust-500 text-white cursor-pointer"
              : "bg-gray-900 text-gray-600 cursor-not-allowed border border-gray-800"
            }
          `}
        >
          {isReady
            ? `Find campaigns for ₹${(effectiveAmount as number).toLocaleString("en-IN")} →`
            : "Select an amount to continue"
          }
        </button>
      </div>

      <p className="font-mono text-[10px] text-gray-600 mt-3 uppercase tracking-wider">
        Min ₹100 · Secured by Razorpay · 80G receipt auto-generated
      </p>
    </div>
  );
}
