"use client";

import React, { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Get redirect callback path if redirected by middleware
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"DONOR" | "NGO">("DONOR");
  
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentError, setConsentError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setConsentError("");
    setSuccess("");
    setLoading(true);

    if (!email || !password) {
      setError("Please fill in email and password.");
      setLoading(false);
      return;
    }

    try {
      let signupData: any = null;

      if (isSignUp) {
        if (!name) {
          setError("Name is required for registration.");
          setLoading(false);
          return;
        }

        if (!consentGiven) {
          setConsentError("You must accept the data processing terms to create an account.");
          setLoading(false);
          return;
        }

        // 1. Trigger registration signup endpoint
        const signupRes = await fetch("/api/auth/signup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name, email, password, role }),
        });

        signupData = await signupRes.json();

        if (!signupRes.ok) {
          throw new Error(signupData.error || "Registration failed.");
        }

        setSuccess("Account registered successfully! Logging in...");
      }

      // 2. Perform NextAuth Sign In
      const result = await signIn("credentials", {
        redirect: false,
        email,
        password,
      });

      if (result?.error) {
        throw new Error(result.error || "Authentication failed.");
      }

      // If it was a signup, record consent now that the user session is active
      if (isSignUp && signupData?.userId) {
        try {
          await fetch("/api/consent/record", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              userId: signupData.userId,
              purpose: "ACCOUNT_CREATION",
            }),
          });
        } catch (consentErr) {
          console.error("DPDP Consent Logging DB Failure (soft-failed):", consentErr);
        }
      }

      // 3. Post-Auth Routing Logic
      setTimeout(async () => {
        if (role === "NGO" || callbackUrl.includes("/ngo")) {
          router.push("/ngo/register");
        } else if (callbackUrl.includes("/admin")) {
          router.push("/admin/dashboard");
        } else {
          // For DONOR: check if persona is set via a quick API call
          const personaRes = await fetch("/api/donor/persona/check");
          const personaData = await personaRes.json();
          if (!personaData.personaSet) {
            router.push("/donor/onboarding");
          } else {
            router.push(callbackUrl !== "/" ? callbackUrl : "/discover");
          }
        }
        router.refresh();
      }, 1000);

    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    signIn("google", { callbackUrl });
  };

  return (
    <div className="max-w-md w-full bg-gray-900/40 border border-gray-900 rounded-2xl p-8 sm:p-10 shadow-2xl relative">
      
      {/* Logo Branding */}
      <div className="text-center mb-8">
        <Link href="/" className="text-2xl font-black bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent tracking-tight">
          ImpactBridge
        </Link>
        <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mt-1.5">
          Trust-First Donation Protocol
        </p>
      </div>

      {/* Form State Tabs */}
      <div className="flex bg-gray-950 p-1 rounded-xl border border-gray-900 mb-6">
        <button
          onClick={() => { setIsSignUp(false); setError(""); setSuccess(""); }}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${!isSignUp ? "bg-emerald-600 text-white shadow" : "text-gray-400 hover:text-white"}`}
        >
          Sign In
        </button>
        <button
          onClick={() => { setIsSignUp(true); setError(""); setSuccess(""); }}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${isSignUp ? "bg-emerald-600 text-white shadow" : "text-gray-400 hover:text-white"}`}
        >
          Register Account
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3.5 bg-red-50 dark:bg-red-950/30 border-l-4 border-red-500 rounded text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3.5 bg-emerald-50 dark:bg-emerald-950/30 border-l-4 border-emerald-500 rounded text-xs text-emerald-700 dark:text-emerald-300">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {isSignUp && (
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1">Full Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 bg-gray-950 border border-gray-900 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
              placeholder="e.g. John Doe"
              required
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1">Email Address *</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2 bg-gray-950 border border-gray-900 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
            placeholder="e.g. name@organization.org"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1">Password *</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2 bg-gray-950 border border-gray-900 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
            placeholder="••••••••"
            required
          />
        </div>

        {isSignUp && (
          <>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Account Role *</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "DONOR" | "NGO")}
                className="w-full px-4 py-2 bg-gray-950 border border-gray-900 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
              >
                <option value="DONOR">Donor Account (Fund projects & track impact)</option>
                <option value="NGO">NGO Organization (Publish projects & submit proof)</option>
              </select>
            </div>

            <div className="flex items-start gap-2.5 mt-4">
              <input
                id="consentCheckbox"
                type="checkbox"
                checked={consentGiven}
                onChange={(e) => {
                  setConsentGiven(e.target.checked);
                  if (e.target.checked) setConsentError("");
                }}
                className="mt-1 h-4 w-4 rounded border-gray-900 bg-gray-950 text-emerald-600 focus:ring-emerald-500 focus:ring-offset-gray-950 transition cursor-pointer"
              />
              <label htmlFor="consentCheckbox" className="text-xs text-gray-400 leading-normal cursor-pointer select-none">
                I consent to Imparency collecting and processing my personal data (name, email) for donation tracking and tax receipt generation, as required under India's DPDP Act 2023.{" "}
                <Link href="/privacy-policy" target="_blank" className="text-emerald-500 hover:underline">
                  Privacy Policy
                </Link>
              </label>
            </div>
            {consentError && (
              <p className="text-[11px] text-red-500 mt-1 font-semibold">
                {consentError}
              </p>
            )}
          </>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3 px-4 rounded-xl shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 transition disabled:opacity-50 flex items-center justify-center gap-2 mt-6"
        >
          {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>}
          {isSignUp ? "Register Account" : "Sign In"}
        </button>
      </form>

      <div className="relative my-6 text-center">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-900"></div>
        </div>
        <span className="relative bg-gray-950 px-3 text-[10px] text-gray-500 font-bold uppercase tracking-widest">
          or continue with
        </span>
      </div>

      {/* OAuth Buttons */}
      <button
        onClick={handleGoogleLogin}
        type="button"
        className="w-full border border-gray-900 hover:border-gray-800 bg-gray-950 hover:bg-gray-900 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition flex items-center justify-center gap-2 shadow"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="currentColor"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="currentColor"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
          />
          <path
            fill="currentColor"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
          />
        </svg>
        Sign In with Google
      </button>

    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4 sm:p-6 font-sans relative overflow-hidden">
      
      {/* Background radial glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none -z-10" />

      <Suspense fallback={
        <div className="max-w-md w-full bg-gray-900/40 border border-gray-900 rounded-2xl p-8 sm:p-10 shadow-2xl flex items-center justify-center min-h-[300px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
        </div>
      }>
        <LoginContent />
      </Suspense>
    </div>
  );
}
