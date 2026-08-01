"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { SearchX } from "lucide-react";
import CrisisCard, { CrisisCardData } from "@/components/crisis/CrisisCard";

const DISASTER_TYPES = ["FLOOD", "EARTHQUAKE", "CYCLONE", "WILDFIRE", "LANDSLIDE", "DROUGHT", "WAR_CONFLICT", "EPIDEMIC", "OTHER"];
const SEVERITIES = ["LOW", "MODERATE", "HIGH", "CRITICAL"];
const STATUSES = ["UPCOMING", "ACTIVE", "CLOSED"];

export default function CrisisLandingPage() {
  const [events, setEvents] = useState<CrisisCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [disasterType, setDisasterType] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [stateName, setStateName] = useState("");
  const [city, setCity] = useState("");

  useEffect(() => {
    const fetchEvents = async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (disasterType) params.append("disasterType", disasterType);
        if (severity) params.append("severity", severity);
        if (status) params.append("status", status);
        if (stateName) params.append("state", stateName);
        if (city) params.append("city", city);

        const res = await fetch(`/api/crisis?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load crisis events");
        setEvents(data.events);
      } catch (err: any) {
        setError(err.message || "Something went wrong");
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, [disasterType, severity, status, stateName, city]);

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans selection:bg-red-500 selection:text-white">
      <section className="relative border-b border-gray-900 py-16 px-4 sm:px-6 lg:px-8 text-center overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none -z-10 bg-[radial-gradient(ellipse_70%_90%_at_50%_-20%,rgba(220,38,38,0.18),transparent_70%)]"
        />
        <div className="max-w-3xl mx-auto space-y-6">
          <span className="inline-flex items-center gap-1.5 bg-red-600 text-white text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> Emergency Relief
          </span>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold text-white tracking-tight">
            When disaster strikes, <span className="italic text-gold-300">respond within hours</span>
          </h1>
          <p className="text-base text-gray-400 max-w-xl mx-auto">
            Every crisis below has been independently verified before it's allowed to raise a rupee. Give directly to the fund, to a verified NGO's relief campaign, or to an individual on the ground.
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-wrap gap-3 mb-10 items-center">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 border border-gray-800 rounded-lg bg-gray-900/60 text-white text-xs focus:outline-none focus:border-red-500">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={disasterType} onChange={(e) => setDisasterType(e.target.value)} className="px-3 py-2 border border-gray-800 rounded-lg bg-gray-900/60 text-white text-xs focus:outline-none focus:border-red-500">
            <option value="">All disaster types</option>
            {DISASTER_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
          </select>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="px-3 py-2 border border-gray-800 rounded-lg bg-gray-900/60 text-white text-xs focus:outline-none focus:border-red-500">
            <option value="">All severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            placeholder="State"
            value={stateName}
            onChange={(e) => setStateName(e.target.value)}
            className="px-3 py-2 border border-gray-800 rounded-lg bg-gray-900/60 text-white text-xs placeholder:text-gray-500 focus:outline-none focus:border-red-500 w-28"
          />
          <input
            placeholder="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="px-3 py-2 border border-gray-800 rounded-lg bg-gray-900/60 text-white text-xs placeholder:text-gray-500 focus:outline-none focus:border-red-500 w-28"
          />
          {(disasterType || severity || status || stateName || city) && (
            <button
              onClick={() => { setDisasterType(""); setSeverity(""); setStatus(""); setStateName(""); setCity(""); }}
              className="text-[11px] text-gray-500 hover:text-white underline underline-offset-2"
            >
              Clear filters
            </button>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-gray-900/40 border border-gray-800 rounded-2xl h-64 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="p-4 bg-red-950/30 border border-red-900 rounded text-sm text-red-300">{error}</div>
        ) : events.length === 0 ? (
          <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-12 text-center max-w-md mx-auto">
            <SearchX className="w-8 h-8 mx-auto mb-4 text-gray-600" strokeWidth={1.5} />
            <h3 className="font-display text-lg font-semibold text-white mb-2">No crisis events found</h3>
            <p className="text-sm text-gray-400">
              {disasterType || severity || status || stateName || city
                ? "Try adjusting your filters."
                : "There are no active or verified emergencies right now."}
            </p>
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            initial="hidden"
            animate="show"
          >
            {events.map((e, i) => (
              <CrisisCard key={e.id} event={e} index={i} />
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
