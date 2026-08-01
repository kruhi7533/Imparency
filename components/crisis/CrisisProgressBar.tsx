"use client";

interface CrisisProgressBarProps {
  totalRaised: number;
  targetAmount?: number | null;
  totalDonors: number;
  totalNgos?: number;
  expectedEndDate?: string | null;
  compact?: boolean;
}

function daysRemaining(expectedEndDate: string): number | null {
  const end = new Date(expectedEndDate).getTime();
  const now = Date.now();
  const days = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  return days > 0 ? days : null;
}

export default function CrisisProgressBar({
  totalRaised,
  targetAmount,
  totalDonors,
  totalNgos,
  expectedEndDate,
  compact = false,
}: CrisisProgressBarProps) {
  // Crisis funds don't always have a hard target — when they don't, show an
  // open-ended raised total instead of fabricating a percentage against nothing.
  const pct = targetAmount && targetAmount > 0 ? Math.min(100, (totalRaised / targetAmount) * 100) : null;
  const remaining = expectedEndDate ? daysRemaining(expectedEndDate) : null;

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      {pct !== null ? (
        <div className="h-2 w-full rounded-full bg-gray-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-red-500 to-gold-400 transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : (
        <div className="h-2 w-full rounded-full bg-gradient-to-r from-red-500/40 to-gold-400/40" />
      )}

      <div className={`flex items-center justify-between flex-wrap gap-x-4 gap-y-1 ${compact ? "text-[11px]" : "text-xs"}`}>
        <span className="font-bold text-white">
          ₹{totalRaised.toLocaleString("en-IN")}
          {targetAmount ? <span className="text-gray-400 font-medium"> / ₹{targetAmount.toLocaleString("en-IN")}</span> : null}
        </span>
        <span className="text-gray-400 font-mono uppercase tracking-wide text-[10px]">
          {totalDonors.toLocaleString("en-IN")} donor{totalDonors === 1 ? "" : "s"}
          {typeof totalNgos === "number" ? ` · ${totalNgos} NGO${totalNgos === 1 ? "" : "s"}` : ""}
          {remaining !== null ? ` · ${remaining}d left` : ""}
        </span>
      </div>
    </div>
  );
}
