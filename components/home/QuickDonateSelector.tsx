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
              px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-150
              border min-w-[100px] cursor-pointer
              ${selected === amount && !showCustom
                ? "bg-trust-50 border-trust-500 text-trust-800 ring-1 ring-trust-500"
                : "bg-white border-gray-300 text-gray-800 hover:border-trust-300 hover:bg-gray-50"
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
            px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-150
            border min-w-[140px] cursor-pointer
            ${showCustom
              ? "bg-trust-50 border-trust-500 text-trust-800 ring-1 ring-trust-500"
              : "bg-white border-gray-300 text-gray-800 hover:border-trust-300 hover:bg-gray-50"
            }
          `}
        >
          Custom Amount
        </button>
      </div>

      {showCustom && (
        <div className="flex items-center justify-center gap-2 mt-2">
          <span className="text-gray-700 font-semibold text-lg">₹</span>
          <input
            type="number"
            min="100"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder="Enter amount"
            autoFocus
            className="
              w-40 px-4 py-3 bg-white border border-gray-300
              rounded-xl text-gray-900 font-semibold text-center text-sm
              focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100
              placeholder-gray-400
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
            px-8 py-3.5 rounded-xl text-sm font-semibold transition-all duration-200
            ${isReady
              ? "bg-trust-600 hover:bg-trust-700 text-white cursor-pointer shadow-sm"
              : "bg-gray-100 text-gray-500 cursor-not-allowed border border-gray-200"
            }
          `}
        >
          {isReady
            ? `Find campaigns for ₹${(effectiveAmount as number).toLocaleString("en-IN")} →`
            : "Select an amount to continue"
          }
        </button>
      </div>

      <p className="text-xs text-gray-500 mt-3 uppercase tracking-wider">
        Min ₹100 · Secured by Razorpay · 80G receipt auto-generated
      </p>
    </div>
  );
}
