import React from "react";
import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6 font-sans relative overflow-hidden">
      
      {/* Background radial glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-red-500/5 rounded-full blur-3xl pointer-events-none -z-10" />

      <div className="max-w-md w-full bg-gray-900/40 border border-red-950/40 rounded-2xl p-8 sm:p-10 shadow-2xl text-center space-y-6">
        
        {/* Warning Icon Shield */}
        <div className="w-16 h-16 bg-red-500/10 text-red-500 border border-red-500/20 rounded-full flex items-center justify-center text-3xl mx-auto">
          ⚠️
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-black text-white tracking-tight">Access Denied</h1>
          <p className="text-gray-400 text-xs leading-relaxed max-w-sm mx-auto">
            You do not have the required role permissions to view this dashboard page. If you registered as a Donor, you cannot access NGO panels (and vice-versa).
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
          <Link
            href="/login"
            className="bg-gray-800 hover:bg-gray-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs transition-all"
          >
            Switch Account
          </Link>
          <Link
            href="/"
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs shadow-md shadow-emerald-500/10 transition-all"
          >
            Return Home
          </Link>
        </div>

      </div>
    </div>
  );
}
