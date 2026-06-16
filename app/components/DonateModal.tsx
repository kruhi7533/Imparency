"use client";

import React, { useState } from "react";

interface DonateModalProps {
  projectId: string;
  projectTitle: string;
  onClose: () => void;
}

const PRESET_AMOUNTS = [500, 1000, 2000, 5000];

export default function DonateModal({ projectId, projectTitle, onClose }: DonateModalProps) {
  const [amount, setAmount] = useState<number>(1000);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // Billing Form State
  const [showDetailsForm, setShowDetailsForm] = useState<boolean>(false);
  const [donorName, setDonorName] = useState<string>("");
  const [panNumber, setPanNumber] = useState<string>("");
  const [addressStreet, setAddressStreet] = useState<string>("");
  const [addressCity, setAddressCity] = useState<string>("");
  const [addressState, setAddressState] = useState<string>("");
  const [addressPincode, setAddressPincode] = useState<string>("");

  const loadRazorpayScript = () => {
    return new Promise((resolve) => {
      const existingScript = document.querySelector(`script[src="https://checkout.razorpay.com/v1/checkout.js"]`);
      if (existingScript) {
        resolve(true);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handleCheckoutInit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError("");
    setLoading(true);

    const finalAmount = customAmount ? parseFloat(customAmount) : amount;
    if (isNaN(finalAmount) || finalAmount <= 0) {
      setError("Please select or enter a valid amount.");
      setLoading(false);
      return;
    }

    try {
      // Build billingAddress if in form state
      let billingAddress = undefined;
      if (showDetailsForm) {
        if (!donorName.trim() || !panNumber.trim() || !addressStreet.trim() || !addressCity.trim() || !addressState.trim() || !addressPincode.trim()) {
          setError("All billing details are required for 80G tax receipt generation.");
          setLoading(false);
          return;
        }

        const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
        if (!panRegex.test(panNumber.toUpperCase())) {
          setError("Invalid PAN Number format (e.g. ABCDE1234F).");
          setLoading(false);
          return;
        }

        billingAddress = `${addressStreet.trim()}, ${addressCity.trim()}, ${addressState.trim()} - ${addressPincode.trim()}`;
      }

      const res = await fetch("/api/donations/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          amount: finalAmount,
          name: showDetailsForm ? donorName.trim() : undefined,
          panNumber: showDetailsForm ? panNumber.toUpperCase().trim() : undefined,
          billingAddress,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === "Missing donor details") {
          setShowDetailsForm(true);
          setLoading(false);
          return;
        }
        throw new Error(data.error || "Failed to initiate payment");
      }

      // Load SDK & open popup
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error("Could not load Razorpay SDK. Please try again.");
      }

      const options = {
        key: data.keyId,
        amount: data.amount,
        currency: "INR",
        name: "ImpactBridge",
        description: `Donation to ${projectTitle}`,
        order_id: data.razorpayOrderId,
        handler: function (response: any) {
          window.location.href = `/donor/donations/${data.donationId}/pending?payment_id=${response.razorpay_payment_id}`;
        },
        prefill: {
          name: data.donorName,
          email: data.donorEmail,
        },
        theme: {
          color: "#059669",
        },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
      onClose();

    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 w-full max-w-lg rounded-3xl p-6 sm:p-8 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition"
        >
          ✕
        </button>

        {!showDetailsForm ? (
          /* Step 1: Select Amount */
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-black text-gray-900 dark:text-white">Make a Donation</h3>
              <p className="text-xs text-gray-400 mt-1">To: {projectTitle}</p>
            </div>

            {error && (
              <div className="p-3.5 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/50 rounded-xl text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {PRESET_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => {
                    setAmount(amt);
                    setCustomAmount("");
                  }}
                  className={`py-3 rounded-2xl text-xs font-bold border transition ${
                    amount === amt && !customAmount
                      ? "bg-emerald-600 border-emerald-600 text-white shadow-md shadow-emerald-500/10"
                      : "bg-gray-50 border-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:border-gray-700 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                  }`}
                >
                  ₹{amt.toLocaleString()}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Custom Amount (INR)</label>
              <div className="relative flex items-center bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-2xl p-1.5 focus-within:ring-2 focus-within:ring-emerald-500 transition">
                <span className="pl-3 text-sm font-bold text-gray-400">₹</span>
                <input
                  type="number"
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value);
                    setAmount(0);
                  }}
                  placeholder="Enter other amount..."
                  className="w-full bg-transparent border-0 focus:outline-none pl-2 pr-4 py-2 text-sm dark:text-white"
                />
              </div>
            </div>

            <button
              onClick={() => handleCheckoutInit()}
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3.5 rounded-2xl shadow-lg transition disabled:opacity-50 text-sm"
            >
              {loading ? "Initializing..." : "Proceed to Donate"}
            </button>
          </div>
        ) : (
          /* Step 2: Collection of Billing Details */
          <form onSubmit={handleCheckoutInit} className="space-y-5">
            <div>
              <h3 className="text-xl font-black text-gray-900 dark:text-white">Billing & 80G Tax Details</h3>
              <p className="text-xs text-gray-400 mt-1">Provide your details to enable automated 80G tax receipt generation.</p>
            </div>

            {error && (
              <div className="p-3.5 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/50 rounded-xl text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-extrabold text-gray-500 dark:text-gray-400 mb-1">Donor Full Name *</label>
                <input
                  type="text"
                  required
                  value={donorName}
                  onChange={(e) => setDonorName(e.target.value)}
                  placeholder="As per PAN card"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-transparent text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-gray-500 dark:text-gray-400 mb-1">PAN Number *</label>
                <input
                  type="text"
                  required
                  value={panNumber}
                  onChange={(e) => setPanNumber(e.target.value)}
                  placeholder="E.g., ABCDE1234F"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-transparent text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-gray-500 dark:text-gray-400 mb-1">Street Address *</label>
                <input
                  type="text"
                  required
                  value={addressStreet}
                  onChange={(e) => setAddressStreet(e.target.value)}
                  placeholder="House number, Street name"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-transparent text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div className="col-span-1">
                  <label className="block text-xs font-extrabold text-gray-500 dark:text-gray-400 mb-1">City *</label>
                  <input
                    type="text"
                    required
                    value={addressCity}
                    onChange={(e) => setAddressCity(e.target.value)}
                    placeholder="City"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-xl bg-transparent text-xs dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-extrabold text-gray-500 dark:text-gray-400 mb-1">State *</label>
                  <input
                    type="text"
                    required
                    value={addressState}
                    onChange={(e) => setAddressState(e.target.value)}
                    placeholder="State"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-xl bg-transparent text-xs dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-extrabold text-gray-500 dark:text-gray-400 mb-1">Pincode *</label>
                  <input
                    type="text"
                    required
                    value={addressPincode}
                    onChange={(e) => setAddressPincode(e.target.value)}
                    placeholder="6 digits"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-xl bg-transparent text-xs dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-3">
              <button
                type="button"
                onClick={() => setShowDetailsForm(false)}
                className="w-1/3 border border-gray-200 dark:border-gray-850 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold py-3 rounded-2xl transition text-xs"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="w-2/3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3 rounded-2xl shadow-lg transition disabled:opacity-50 text-xs"
              >
                {loading ? "Processing..." : "Confirm & Pay"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
