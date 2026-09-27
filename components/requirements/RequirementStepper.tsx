const STEPS = [
  { label: "Uploaded", statuses: ["UPLOADED", "PROCESSING"] },
  { label: "AI extraction", statuses: ["AI_EXTRACTED"] },
  { label: "Donor review", statuses: ["DONOR_REVIEW", "NEEDS_CORRECTION"] },
  { label: "Admin verification", statuses: ["PENDING_ADMIN_REVIEW"] },
  { label: "Validated", statuses: ["VALIDATED", "MATCHING"] },
  { label: "Shortlist", statuses: ["SHORTLISTED"] },
  { label: "NGO responses", statuses: ["NGO_RESPONSE"] },
  { label: "Selected", statuses: ["SELECTED"] },
  { label: "Contracted", statuses: ["CONTRACTED"] },
];

/** Horizontal lifecycle indicator. FAILED/REJECTED are shown by the status badge instead. */
export function RequirementStepper({ status }: { status: string }) {
  const current = STEPS.findIndex((s) => s.statuses.includes(status));
  if (current === -1) return null;
  return (
    <ol className="flex flex-wrap items-center gap-y-2 text-[11px] font-semibold">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step.label} className="flex items-center">
            <span
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${
                active ? "bg-emerald-500/15 text-emerald-300" : done ? "text-emerald-500" : "text-gray-600"
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black ${
                  active ? "bg-emerald-400 text-gray-950" : done ? "bg-emerald-700 text-white" : "bg-gray-800 text-gray-500"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              {step.label}
            </span>
            {i < STEPS.length - 1 && <span className="w-3 h-px bg-gray-800 mx-0.5" />}
          </li>
        );
      })}
    </ol>
  );
}
