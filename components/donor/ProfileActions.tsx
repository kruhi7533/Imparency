"use client";

import React from "react";
import { signOut } from "next-auth/react";

export function ProfileActions() {
  return (
    <div className="space-y-6 pt-4">
      <div className="text-left">
        <button
          onClick={() => alert("Profile editing coming soon")}
          className="border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 font-semibold py-2 px-4 rounded-lg text-sm transition active:scale-95"
        >
          Edit Profile
        </button>
      </div>
      
      {/* Danger Zone */}
      <div className="border-t border-gray-200 pt-6 text-left">
        <span className="block text-[10px] font-semibold text-red-700 uppercase tracking-wider mb-2">
          Danger Zone
        </span>
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 font-semibold py-2 px-4 rounded-lg text-sm transition active:scale-95"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
