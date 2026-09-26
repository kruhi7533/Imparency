"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PRESET_AMOUNTS = [500, 1000, 2500, 5000];

interface DonateTarget {
  type: "CRISIS_DIRECT" | "NGO_CAMPAIGN" | "INITIATIVE";
  id?: string;
  label: string;
}

interface CrisisDonateModalProps {
  crisisEventId: string;
  crisisTitle: string;
  target: DonateTarget;
  isSignedIn: boolean;
  onClose: () => void;
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.querySelector(`script[src="https://checkout.razorpay.com/v1/checkout.js"]`)) {
      resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function CrisisDonateModal({ crisisEventId, crisisTitle, target, isSignedIn, onClose }: CrisisDonateModalProps) {
  const router = useRouter();
  const [amount, setAmount] = useState<number>(1000);
  const [customAmount, setCustomAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!isSignedIn) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
        <div className="bg-gray-900 border border-gray-800 w-full max-w-sm rounded-3xl p-6 text-center">
          <p className="text-white font-semibold mb-4">Sign in to donate to this crisis.</p>
          <button
            onClick={() => router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`)}
            className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-xl text-sm mb-2"
          >
            Sign in
          </button>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-white">Cancel</button>
        </div>
      </div>
    );
  }

  const handleDonate = async () => {
    setError("");
    const finalAmount = customAmount ? parseFloat(customAmount) : amount;
    if (isNaN(finalAmount) || finalAmount < 100) {
      setError("Please enter an amount of at least ₹100.");
      return;
    }
    setLoading(true);

    try {
      const res = await fetch(`/api/crisis/${crisisEventId}/donate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: target.type,
          amount: finalAmount,
          campaignProjectId: target.type === "NGO_CAMPAIGN" ? target.id : undefined,
          initiativeId: target.type === "INITIATIVE" ? target.id : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to initiate donation");

      if (data.isMock) {
        // Mock mode completes synchronously (already SUCCESS server-side) —
        // no webhook to wait on, so go straight back with a success flag.
        router.push(`/crisis/${crisisEventId}?donated=1`);
        router.refresh();
        return;
      }

      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) throw new Error("Could not load Razorpay SDK. Please try again.");

      const options = {
        key: data.keyId,
        amount: Math.round(data.amount * 100),
        currency: "INR",
        name: "ImpactBridge Emergency Relief",
        description: `Donation to ${crisisTitle} — ${target.label}`,
        order_id: data.razorpayOrderId,
        handler: function () {
          router.push(`/crisis/${crisisEventId}?donated=1`);
        },
        prefill: { name: data.donorName, email: data.donorEmail },
        theme: { color: "#dc2626" },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
      onClose();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 w-full max-w-md rounded-3xl p-6 sm:p-8 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white">✕</button>

        <span className="inline-flex items-center gap-1.5 bg-red-600 text-white text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full mb-4">
          Emergency Relief
        </span>
        <h3 className="text-xl font-display font-semibold text-white">Support {crisisTitle}</h3>
        <p className="text-xs text-gray-400 mt-1">Donating to: {target.label}</p>

        {error && (
          <div className="mt-4 p-3 bg-red-950/30 border border-red-900 rounded-xl text-xs text-red-300">{error}</div>
        )}

        <div className="grid grid-cols-2 gap-3 mt-6">
          {PRESET_AMOUNTS.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => { setAmount(amt); setCustomAmount(""); }}
              className={`py-3 rounded-2xl text-sm font-bold border transition ${
                amount === amt && !customAmount
                  ? "bg-red-600 border-red-600 text-white"
                  : "bg-gray-950 border-gray-800 text-gray-300 hover:border-gray-700"
              }`}
            >
              ₹{amt.toLocaleString("en-IN")}
            </button>
          ))}
        </div>

        <div className="mt-3">
          <input
            type="number"
            min={100}
            placeholder="Or enter a custom amount"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            className="w-full rounded-xl border border-gray-800 bg-gray-950 px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>

        <button
          onClick={handleDonate}
          disabled={loading}
          className="w-full mt-6 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold py-3.5 rounded-2xl text-sm transition"
        >
          {loading ? "Processing…" : `Donate ₹${(customAmount ? parseFloat(customAmount) || 0 : amount).toLocaleString("en-IN")}`}
        </button>
      </div>
    </div>
  );
}
