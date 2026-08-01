"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import CrisisProgressBar from "./CrisisProgressBar";

export interface CrisisCardData {
  id: string;
  title: string;
  slug: string;
  disasterType: string;
  severity: string;
  affectedLocation: string;
  coverImage: string;
  status: string;
  isFeatured?: boolean;
  totalRaised: number;
  totalDonors: number;
  totalNgos: number;
  totalCampaigns: number;
  expectedEndDate: string | null;
}

const SEVERITY_LABEL: Record<string, string> = {
  LOW: "Low",
  MODERATE: "Moderate",
  HIGH: "High",
  CRITICAL: "Critical",
};

export default function CrisisCard({ event, index = 0, large = false }: { event: CrisisCardData; index?: number; large?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: Math.min(index * 0.06, 0.42), ease: [0.16, 1, 0.3, 1] }}
    >
      <Link
        href={`/crisis/${event.slug}`}
        className={`group block bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden hover:border-red-600/60 hover:shadow-[0_8px_40px_-12px_rgba(220,38,38,0.35)] hover:-translate-y-[3px] transition-all duration-200 ${
          large ? "" : "h-full"
        }`}
      >
        <div className={`relative w-full overflow-hidden ${large ? "h-56" : "h-36"}`}>
          <img src={event.coverImage} alt={event.title} loading="lazy" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
          <div className="absolute top-3 left-3 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Emergency
            </span>
            <span className="bg-black/60 backdrop-blur-sm border border-white/10 text-[10px] font-bold uppercase px-2 py-1 rounded-full text-gray-200">
              {SEVERITY_LABEL[event.severity]}
            </span>
          </div>
          <div className="absolute bottom-3 left-4 right-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-gold-300 mb-0.5">{event.disasterType.replace("_", " ")}</p>
            <h3 className={`font-display font-semibold text-white leading-tight ${large ? "text-2xl" : "text-base"} line-clamp-2`}>
              {event.title}
            </h3>
            <p className="text-[11px] text-gray-300 mt-0.5">{event.affectedLocation}</p>
          </div>
        </div>
        <div className="p-4">
          <CrisisProgressBar
            totalRaised={event.totalRaised}
            totalDonors={event.totalDonors}
            totalNgos={event.totalNgos}
            expectedEndDate={event.expectedEndDate}
            compact
          />
          <div className="mt-3 text-center bg-red-600 group-hover:bg-red-500 text-white font-bold text-xs py-2 rounded-xl transition">
            Donate Now
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
