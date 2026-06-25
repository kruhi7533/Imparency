"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import Link from "next/link";

interface OrderData {
  orderId: string;
  amount: number;
  currency: string;
  donationId: string;
  donorName: string;
  donorEmail: string;
  projectTitle: string;
}

type PageState = "loading" | "error" | "success" | "dismissed" | "failed_again";

export default function RetryPage() {
  const params = useParams();
  const token = params?.token as string;

  const [state, setState] = useState<PageState>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [orderData, setOrderData] = useState<OrderData | null>(null);
  
  const rzpRef = useRef<any>(null);

  const openCheckout = useCallback((data: OrderData) => {
    if (!(window as any).Razorpay) {
      setErrorMsg("Razorpay SDK failed to load. Please refresh the page.");
      setState("error");
      return;
    }

    const options = {
      key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "",
      amount: data.amount * 100, // paise
      currency: "INR",
      name: "Imparency",
      description: `Donation retry — ${data.projectTitle}`,
      order_id: data.orderId,
      prefill: {
        name: data.donorName,
        email: data.donorEmail,
      },
      theme: { color: "#059669" },
      handler: function () {
        // Payment captured — redirect to donor dashboard
        window.location.href = "/donor/dashboard?payment=success";
      },
      modal: {
        ondismiss: function () {
          setState("dismissed");
        },
      },
    };

    const rzp = new (window as any).Razorpay(options);
    rzpRef.current = rzp;

    rzp.on("payment.failed", function (response: any) {
      console.error("Payment failed event:", response);
      setState("failed_again");
    });

    rzp.open();
  }, []);

  const loadRazorpayScript = useCallback((data: OrderData) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
    script.onload = () => {
      openCheckout(data);
    };
  }, [openCheckout]);

  useEffect(() => {
    if (!token) {
      setErrorMsg("Invalid retry token.");
      setState("error");
      return;
    }

    const fetchOrderDetails = async () => {
      try {
        const res = await fetch(`/api/donations/retry/${token}`);
        const data = await res.json();

        if (!res.ok) {
          setErrorMsg(data.error || "Failed to load retry information.");
          setState("error");
          return;
        }

        setOrderData(data);
        setState("success");
        // Dynamically load Razorpay checkout script
        loadRazorpayScript(data);
      } catch (err) {
        console.error(err);
        setErrorMsg("Failed to connect to server. Please try again.");
        setState("error");
      }
    };

    fetchOrderDetails();
  }, [token, loadRazorpayScript]);

  const handleOpenClick = () => {
    if (orderData) {
      setState("success");
      openCheckout(orderData);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6 relative overflow-hidden font-sans">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none -z-10" />

      <div className="max-w-md w-full bg-gray-900/40 border border-gray-900 rounded-3xl p-8 sm:p-10 shadow-2xl relative text-center">
        {/* Branding header */}
        <div className="mb-8">
          <Link href="/" className="text-2xl font-black bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent tracking-tight">
            Imparency
          </Link>
          <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mt-1">
            Donation Recovery Portal
          </p>
        </div>

        {/* Loading State */}
        {state === "loading" && (
          <div className="space-y-4 py-8">
            <Loader2 className="h-10 w-10 text-emerald-500 animate-spin mx-auto" />
            <p className="text-sm font-semibold text-gray-300">Verifying your retry link...</p>
          </div>
        )}

        {/* Error State */}
        {state === "error" && (
          <div className="space-y-6 py-4">
            <XCircle className="h-14 w-14 text-red-500 mx-auto" />
            <div className="space-y-2">
              <h2 className="text-xl font-extrabold text-white">This link has expired</h2>
              <p className="text-xs text-gray-400 leading-relaxed">{errorMsg}</p>
            </div>
            <Link
              href="/discover"
              className="inline-block w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3 px-4 rounded-xl shadow-lg shadow-emerald-500/10 transition text-sm cursor-pointer"
            >
              Make a new donation →
            </Link>
          </div>
        )}

        {/* Success State */}
        {state === "success" && orderData && (
          <div className="space-y-6 py-4">
            <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto animate-pulse" />
            <div className="space-y-2">
              <h2 className="text-xl font-extrabold text-white">Your retry link is valid</h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                Opening payment window for Rs. {orderData.amount.toLocaleString("en-IN")} to{" "}
                <span className="text-white font-semibold">{orderData.projectTitle}</span>...
              </p>
              <p className="text-[10px] text-gray-500 italic mt-2">
                If the payment window doesn't open automatically, click the button below.
              </p>
            </div>
            <button
              onClick={handleOpenClick}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3 px-4 rounded-xl shadow-lg shadow-emerald-500/10 transition text-sm cursor-pointer"
            >
              Open Payment Window
            </button>
          </div>
        )}

        {/* Dismissed State */}
        {state === "dismissed" && orderData && (
          <div className="space-y-6 py-4">
            <AlertTriangle className="h-14 w-14 text-emerald-500 mx-auto" />
            <div className="space-y-2">
              <h2 className="text-xl font-extrabold text-white">Payment Window Closed</h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                The payment process was closed before completion. Click below to try again.
              </p>
            </div>
            <button
              onClick={handleOpenClick}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3 px-4 rounded-xl shadow-lg shadow-emerald-500/10 transition text-sm cursor-pointer"
            >
              Open Payment Window
            </button>
          </div>
        )}

        {/* Failed Again State */}
        {state === "failed_again" && (
          <div className="space-y-6 py-4">
            <AlertTriangle className="h-14 w-14 text-orange-500 mx-auto" />
            <div className="space-y-2">
              <h2 className="text-xl font-extrabold text-white">Payment Unsuccessful Again</h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                Your retry link has been used. Please start a new donation from the project page if you'd like to try again.
              </p>
            </div>
            <Link
              href="/discover"
              className="inline-block w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3 px-4 rounded-xl shadow-lg shadow-emerald-500/10 transition text-sm cursor-pointer"
            >
              Go to Discover →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
