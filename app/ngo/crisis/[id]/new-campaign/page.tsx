"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface MilestoneRow {
  title: string;
  description: string;
  targetAmount: string;
  deadline: string;
}

const inputClass =
  "w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500";
const labelClass = "block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide";

export default function NewCrisisCampaignPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [milestones, setMilestones] = useState<MilestoneRow[]>([{ title: "", description: "", targetAmount: "", deadline: "" }]);

  const addMilestone = () => setMilestones([...milestones, { title: "", description: "", targetAmount: "", deadline: "" }]);
  const updateMilestone = (i: number, field: keyof MilestoneRow, value: string) => {
    const next = [...milestones];
    next[i] = { ...next[i], [field]: value };
    setMilestones(next);
  };
  const removeMilestone = (i: number) => setMilestones(milestones.filter((_, idx) => idx !== i));

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
      formData.append("description", description);
      formData.append("location", location);
      formData.append("targetAmount", targetAmount);
      formData.append("coverImage", coverImage);
      formData.append("milestones", JSON.stringify(milestones));

      const res = await fetch(`/api/crisis/${params.id}/campaigns`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create campaign");

      router.push(`/ngo/dashboard`);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">New Relief Campaign</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            This campaign will be tagged to the crisis you joined, and — like every campaign — goes through the standard admin approval queue before it's live.
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
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div>
            <label className={labelClass}>Description</label>
            <textarea className={inputClass} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Location</label>
              <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} required />
            </div>
            <div>
              <label className={labelClass}>Target amount (₹)</label>
              <input type="number" min={1} className={inputClass} value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} required />
            </div>
          </div>
          <div>
            <label className={labelClass}>Cover image</label>
            <input type="file" accept="image/*" className={inputClass} onChange={(e) => setCoverImage(e.target.files?.[0] || null)} required />
          </div>

          <div className="border-t border-gray-200 dark:border-gray-800 pt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">Milestones</h3>
              <button type="button" onClick={addMilestone} className="text-xs font-bold text-red-600 hover:text-red-700">+ Add milestone</button>
            </div>
            <p className="text-[11px] text-gray-400 mb-3">Milestone target amounts must sum exactly to the campaign target.</p>
            {milestones.map((m, i) => (
              <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-gray-500">Milestone {i + 1}</span>
                  {milestones.length > 1 && (
                    <button type="button" onClick={() => removeMilestone(i)} className="text-[11px] text-red-500 hover:text-red-600">Remove</button>
                  )}
                </div>
                <input placeholder="Title" className={inputClass} value={m.title} onChange={(e) => updateMilestone(i, "title", e.target.value)} required />
                <textarea placeholder="Description" rows={2} className={inputClass} value={m.description} onChange={(e) => updateMilestone(i, "description", e.target.value)} required />
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" min={1} placeholder="Target amount (₹)" className={inputClass} value={m.targetAmount} onChange={(e) => updateMilestone(i, "targetAmount", e.target.value)} required />
                  <input type="date" className={inputClass} value={m.deadline} onChange={(e) => updateMilestone(i, "deadline", e.target.value)} required />
                </div>
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition"
          >
            {loading ? "Submitting…" : "Submit for approval"}
          </button>
        </form>
      </main>
    </div>
  );
}
