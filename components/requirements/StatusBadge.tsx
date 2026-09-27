import { STATUS_LABELS } from "@/lib/requirements/status";

const STATUS_STYLES: Record<string, string> = {
  UPLOADED: "bg-gray-800 text-gray-300 border-gray-700",
  PROCESSING: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  AI_EXTRACTED: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  DONOR_REVIEW: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  PENDING_ADMIN_REVIEW: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  NEEDS_CORRECTION: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  VALIDATED: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  MATCHING: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  SHORTLISTED: "bg-teal-500/10 text-teal-300 border-teal-500/30",
  NGO_RESPONSE: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
  SELECTED: "bg-emerald-500/15 text-emerald-200 border-emerald-400/40",
  CONTRACTED: "bg-emerald-600/20 text-emerald-100 border-emerald-400/50",
  REJECTED: "bg-red-500/10 text-red-300 border-red-500/30",
  FAILED: "bg-red-500/10 text-red-300 border-red-500/30",
};

export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const label = (STATUS_LABELS as Record<string, string>)[status] ?? status;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${
        STATUS_STYLES[status] ?? STATUS_STYLES.UPLOADED
      } ${className}`}
    >
      {label}
    </span>
  );
}
