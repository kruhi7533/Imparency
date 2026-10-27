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
      name: "ImpactBridge",
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
    <div className="min-h-[70vh] text-gray-900 flex items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full bg-white border border-gray-200/80 rounded-2xl p-8 sm:p-10 shadow-[0_1px_2px_rgba(16,24,40,0.04)] text-center">
        {/* Branding header */}
        <div className="mb-8">
          <Link href="/" className="font-display text-2xl font-semibold text-gray-900 tracking-tight">
            ImpactBridge
          </Link>
          <p className="text-xs text-gray-600 font-bold uppercase tracking-wider mt-1">
            Donation Recovery Portal
          </p>
        </div>

        {/* Loading State */}
        {state === "loading" && (
          <div className="space-y-4 py-8">
            <Loader2 className="h-10 w-10 text-trust-600 animate-spin mx-auto" />
            <p className="text-sm font-semibold text-gray-700">Verifying your retry link...</p>
          </div>
        )}

        {/* Error State */}
        {state === "error" && (
          <div className="space-y-6 py-4">
            <XCircle className="h-14 w-14 text-red-600 mx-auto" />
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900">This link has expired</h2>
              <p className="text-xs text-gray-600 leading-relaxed">{errorMsg}</p>
            </div>
            <Link
              href="/discover"
              className="inline-block w-full bg-trust-600 hover:bg-trust-700 text-white font-semibold py-3 px-4 rounded-lg shadow-sm transition text-sm cursor-pointer"
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
              <h2 className="text-xl font-semibold text-gray-900">Your retry link is valid</h2>
              <p className="text-xs text-gray-600 leading-relaxed">
                Opening payment window for Rs. {orderData.amount.toLocaleString("en-IN")} to{" "}
                <span className="text-gray-900 font-semibold">{orderData.projectTitle}</span>...
              </p>
              <p className="text-[11px] text-gray-600 italic mt-2">
                If the payment window doesn't open automatically, click the button below.
              </p>
            </div>
            <button
              onClick={handleOpenClick}
              className="w-full bg-trust-600 hover:bg-trust-700 text-white font-semibold py-3 px-4 rounded-lg shadow-sm transition text-sm cursor-pointer"
            >
              Open Payment Window
            </button>
          </div>
        )}

        {/* Dismissed State */}
        {state === "dismissed" && orderData && (
          <div className="space-y-6 py-4">
            <AlertTriangle className="h-14 w-14 text-amber-600 mx-auto" />
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900">Payment Window Closed</h2>
              <p className="text-xs text-gray-600 leading-relaxed">
                The payment process was closed before completion. Click below to try again.
              </p>
            </div>
            <button
              onClick={handleOpenClick}
              className="w-full bg-trust-600 hover:bg-trust-700 text-white font-semibold py-3 px-4 rounded-lg shadow-sm transition text-sm cursor-pointer"
            >
              Open Payment Window
            </button>
          </div>
        )}

        {/* Failed Again State */}
        {state === "failed_again" && (
          <div className="space-y-6 py-4">
            <AlertTriangle className="h-14 w-14 text-orange-600 mx-auto" />
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900">Payment Unsuccessful Again</h2>
              <p className="text-xs text-gray-600 leading-relaxed">
                Your retry link has been used. Please start a new donation from the project page if you'd like to try again.
              </p>
            </div>
            <Link
              href="/discover"
              className="inline-block w-full bg-trust-600 hover:bg-trust-700 text-white font-semibold py-3 px-4 rounded-lg shadow-sm transition text-sm cursor-pointer"
            >
              Go to Discover →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
