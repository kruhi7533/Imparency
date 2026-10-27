"use client";

/** Opens the browser's print dialog, which also saves the report as a PDF. */
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="min-h-[44px] px-4 rounded-lg bg-trust-600 hover:bg-trust-700 text-white text-sm font-semibold"
    >
      Print / save as PDF
    </button>
  );
}
