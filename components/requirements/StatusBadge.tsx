import { STATUS_LABELS } from "@/lib/requirements/status";

const STATUS_STYLES: Record<string, string> = {
  UPLOADED: "bg-gray-100 text-gray-700 border-gray-300",
  PROCESSING: "bg-sky-50 text-sky-700 border-sky-200",
  AI_EXTRACTED: "bg-violet-50 text-violet-700 border-violet-200",
  DONOR_REVIEW: "bg-amber-50 text-amber-700 border-amber-200",
  PENDING_ADMIN_REVIEW: "bg-blue-50 text-blue-700 border-blue-200",
  NEEDS_CORRECTION: "bg-orange-50 text-orange-700 border-orange-200",
  VALIDATED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  MATCHING: "bg-sky-50 text-sky-700 border-sky-200",
  SHORTLISTED: "bg-teal-50 text-teal-700 border-teal-200",
  NGO_RESPONSE: "bg-indigo-50 text-indigo-700 border-indigo-200",
  SELECTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CONTRACTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
  WITHDRAWN: "bg-gray-100 text-gray-600 border-gray-300",
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
