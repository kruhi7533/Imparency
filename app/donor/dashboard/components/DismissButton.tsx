"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface DismissButtonProps {
  eventId: string;
}

export default function DismissButton({ eventId }: DismissButtonProps) {
  const router = useRouter();
  const [isDismissing, setIsDismissing] = useState(false);

  const handleDismiss = async () => {
    setIsDismissing(true);
    try {
      const res = await fetch(`/api/engagement/re-engage/${eventId}/dismiss`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (res.ok) {
        // Refresh the server component data
        router.refresh();
      } else {
        console.error("Failed to dismiss re-engagement event");
      }
    } catch (err) {
      console.error("Error dismissing event:", err);
    } finally {
      setIsDismissing(false);
    }
  };

  return (
    <button
      onClick={handleDismiss}
      disabled={isDismissing}
      className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors disabled:opacity-50 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-gray-50 border border-gray-300"
    >
      {isDismissing ? (
        <>
          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Dismissing...
        </>
      ) : (
        "Not now"
      )}
    </button>
  );
}
