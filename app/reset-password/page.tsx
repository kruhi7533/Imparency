"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("This reset link is missing its token. Please request a new one.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to reset password.");
      }

      setSuccess(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md w-full bg-white border border-gray-200/80 rounded-2xl shadow-[0_8px_30px_rgba(16,24,40,0.06)] p-8 sm:p-10 relative">
      <div className="text-center mb-8">
        <Link href="/" className="font-display text-3xl font-semibold text-gray-900 tracking-tight">
          ImpactBridge<span className="text-trust-600">.</span>
        </Link>
        <p className="font-mono text-[11px] text-gray-500 uppercase tracking-widest mt-2">
          Reset your password
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3.5 bg-red-50 border-l-2 border-red-500 rounded-r text-xs text-red-700">
          {error}
        </div>
      )}

      {success ? (
        <div className="mb-4 p-3.5 bg-emerald-50 border-l-2 border-emerald-500 rounded-r text-xs text-emerald-700">
          Your password has been reset. Redirecting you to sign in...
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">New Password *</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 transition"
              placeholder="••••••••"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Confirm New Password *</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 transition"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-trust-600 hover:bg-trust-700 text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2 mt-6"
          >
            {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>}
            Reset Password
          </button>
        </form>
      )}

      <p className="text-center mt-6">
        <Link href="/login" className="text-xs text-trust-700 hover:text-trust-800 hover:underline">
          Back to Sign In
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-canvas bg-gradient-to-b from-trust-50/70 via-canvas to-canvas text-gray-900 flex flex-col items-center justify-center p-4 sm:p-6 font-sans relative overflow-hidden">
      <Suspense fallback={
        <div className="max-w-md w-full bg-white border border-gray-200/80 rounded-2xl shadow-[0_8px_30px_rgba(16,24,40,0.06)] p-8 sm:p-10 flex items-center justify-center min-h-[300px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-trust-500"></div>
        </div>
      }>
        <ResetPasswordContent />
      </Suspense>
    </div>
  );
}
