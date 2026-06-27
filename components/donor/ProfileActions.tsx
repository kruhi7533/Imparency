"use client";

import React from "react";
import { signOut } from "next-auth/react";

export function ProfileActions() {
  return (
    <div className="space-y-6 pt-4">
      <div className="text-left">
        <button
          onClick={() => alert("Profile editing coming soon")}
          className="border border-gray-700 text-gray-400 hover:text-white font-bold py-2.5 px-5 rounded-xl text-xs transition active:scale-95"
        >
          Edit Profile
        </button>
      </div>
      
      {/* Danger Zone */}
      <div className="border-t border-gray-900 pt-6 text-left">
        <span className="block text-[10px] font-bold text-red-505 uppercase tracking-wider mb-2">
          Danger Zone
        </span>
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="bg-red-950/30 text-red-400 border border-red-900 font-bold py-2 px-4 rounded-xl text-xs transition active:scale-95"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
