"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const DISASTER_TYPES = ["FLOOD", "EARTHQUAKE", "CYCLONE", "WILDFIRE", "LANDSLIDE", "DROUGHT", "WAR_CONFLICT", "EPIDEMIC", "OTHER"];
const SEVERITIES = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

const inputClass =
  "w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500";
const labelClass = "block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide";

export default function NewCrisisEventPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [disasterType, setDisasterType] = useState("FLOOD");
  const [severity, setSeverity] = useState("MODERATE");
  const [description, setDescription] = useState("");
  const [affectedLocation, setAffectedLocation] = useState("");
  const [country, setCountry] = useState("India");
  const [stateName, setStateName] = useState("");
  const [city, setCity] = useState("");
  const [startDate, setStartDate] = useState("");
  const [expectedEndDate, setExpectedEndDate] = useState("");
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [galleryImages, setGalleryImages] = useState<File[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!coverImage) {
      setError("A cover image is required.");
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("disasterType", disasterType);
      formData.append("severity", severity);
      formData.append("description", description);
      formData.append("affectedLocation", affectedLocation);
      formData.append("country", country);
      if (stateName) formData.append("stateName", stateName);
      if (city) formData.append("city", city);
      formData.append("startDate", startDate);
      if (expectedEndDate) formData.append("expectedEndDate", expectedEndDate);
      formData.append("coverImage", coverImage);
      galleryImages.forEach((f) => formData.append("galleryImages", f));

      const res = await fetch("/api/admin/crisis", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create crisis event");
      }

      router.push(`/admin/crisis/${data.id}`);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <a href="/admin/crisis" className="text-xs text-gray-400 hover:text-emerald-600 font-semibold">← Back to Crisis Events</a>
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight mt-2">New Crisis Event</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Created as <span className="font-semibold">Upcoming</span> / <span className="font-semibold">Pending verification</span>.
            It won&apos;t appear anywhere publicly until you verify and activate it.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3.5 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/50 rounded-xl text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className={labelClass}>Title</label>
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Assam Floods 2026" required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Disaster type</label>
              <select className={inputClass} value={disasterType} onChange={(e) => setDisasterType(e.target.value)}>
                {DISASTER_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Severity</label>
              <select className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Description</label>
            <textarea className={inputClass} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} required />
          </div>

          <div>
            <label className={labelClass}>Affected location (display text)</label>
            <input className={inputClass} value={affectedLocation} onChange={(e) => setAffectedLocation(e.target.value)} placeholder="Assam, India" required />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Country</label>
              <input className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>State</label>
              <input className={inputClass} value={stateName} onChange={(e) => setStateName(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>City</label>
              <input className={inputClass} value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Start date</label>
              <input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div>
              <label className={labelClass}>Expected end date (optional)</label>
              <input type="date" className={inputClass} value={expectedEndDate} onChange={(e) => setExpectedEndDate(e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Cover image</label>
            <input
              type="file"
              accept="image/*"
              className={inputClass}
              onChange={(e) => setCoverImage(e.target.files?.[0] || null)}
              required
            />
          </div>

          <div>
            <label className={labelClass}>Gallery images (up to 8, optional)</label>
            <input
              type="file"
              accept="image/*"
              multiple
              className={inputClass}
              onChange={(e) => setGalleryImages(Array.from(e.target.files || []).slice(0, 8))}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition"
          >
            {loading ? "Creating…" : "Create Crisis Event"}
          </button>
        </form>
      </main>
    </div>
  );
}
