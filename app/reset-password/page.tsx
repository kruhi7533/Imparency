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
    <div className="max-w-md w-full bg-gray-900/40 border border-gray-800 border-t-2 border-t-gold-500/70 rounded-xl p-8 sm:p-10 relative">
      <div className="text-center mb-8">
        <Link href="/" className="font-display text-3xl font-semibold italic text-white tracking-tight">
          ImpactBridge<span className="text-gold-400">.</span>
        </Link>
        <p className="font-mono text-[11px] text-gray-500 uppercase tracking-widest mt-2">
          Reset your password
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3.5 bg-red-950/40 border-l-2 border-red-500 rounded-r text-xs text-red-300">
          {error}
        </div>
      )}

      {success ? (
        <div className="mb-4 p-3.5 bg-emerald-950/30 border-l-2 border-emerald-500 rounded-r text-xs text-emerald-300">
          Your password has been reset. Redirecting you to sign in...
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1">New Password *</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-950 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:border-trust-400 focus:ring-1 focus:ring-trust-400 transition"
              placeholder="••••••••"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1">Confirm New Password *</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-950 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:border-trust-400 focus:ring-1 focus:ring-trust-400 transition"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-trust-600 hover:bg-trust-500 text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2 mt-6"
          >
            {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>}
            Reset Password
          </button>
        </form>
      )}

      <p className="text-center mt-6">
        <Link href="/login" className="text-xs text-trust-300 hover:text-trust-200 hover:underline">
          Back to Sign In
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-gray-950 bg-gradient-to-b from-trust-950/60 via-gray-950 to-gray-950 text-white flex flex-col items-center justify-center p-4 sm:p-6 font-sans relative overflow-hidden">
      <Suspense fallback={
        <div className="max-w-md w-full bg-gray-900/40 border border-gray-800 border-t-2 border-t-gold-500/70 rounded-xl p-8 sm:p-10 flex items-center justify-center min-h-[300px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-trust-500"></div>
        </div>
      }>
        <ResetPasswordContent />
      </Suspense>
    </div>
  );
}
