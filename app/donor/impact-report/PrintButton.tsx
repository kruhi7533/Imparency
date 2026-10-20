"use client";

/** Opens the browser's print dialog, which also saves the report as a PDF. */
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="min-h-[44px] px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-sm font-bold"
    >
      Print / save as PDF
    </button>
  );
}
