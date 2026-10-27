import React from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-canvas text-gray-900 flex items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full bg-white border border-gray-200/80 rounded-2xl p-8 sm:p-10 shadow-[0_8px_30px_rgba(16,24,40,0.06)] text-center space-y-6">
        <div className="w-14 h-14 bg-red-50 text-red-600 ring-1 ring-red-100 rounded-full flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" strokeWidth={1.75} aria-hidden />
        </div>

        <div className="space-y-2">
          <h1 className="font-display text-3xl font-semibold text-gray-900 tracking-tight">Access Denied</h1>
          <p className="text-gray-600 text-sm leading-relaxed max-w-sm mx-auto">
            You do not have the required role permissions to view this dashboard page. If you registered as a Donor, you cannot access NGO panels (and vice-versa).
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link
            href="/login"
            className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 font-semibold px-4 py-2 rounded-lg text-sm transition"
          >
            Switch Account
          </Link>
          <Link
            href="/"
            className="bg-trust-600 hover:bg-trust-700 text-white font-semibold px-4 py-2 rounded-lg text-sm transition"
          >
            Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}
