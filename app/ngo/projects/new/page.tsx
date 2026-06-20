"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import DatePicker from "@/app/components/DatePicker";
import ShareProjectModal from "@/app/components/ShareProjectModal";

const CAUSE_CATEGORIES = [
  "Education",
  "Healthcare",
  "Environment",
  "Women Empowerment",
  "Rural Development",
  "Hunger",
];

const PROOF_TYPES = [
  "Photo Evidence",
  "Receipt + Photo",
  "Document Upload",
  "Any",
];

interface MilestoneInput {
  title: string;
  description: string;
  targetAmount: string;
  deadline: string;
  proofType: string;
}

export default function NewProjectPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [causeCategory, setCauseCategory] = useState("Education");
  const [targetAmount, setTargetAmount] = useState("");
  const [location, setLocation] = useState("");
  const [coverImage, setCoverImage] = useState<File | null>(null);

  // Milestones state
  const [milestones, setMilestones] = useState<MilestoneInput[]>([
    { title: "", description: "", targetAmount: "", deadline: "", proofType: "Photo Evidence" },
  ]);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Validate NGO role
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (session?.user && session.user.role !== "NGO") {
      router.push("/unauthorized");
    }
  }, [session, status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  const [projectTarget, setProjectTarget] = useState(0);
  const [totalAllocated, setTotalAllocated] = useState(0);

  useEffect(() => {
    setProjectTarget(parseFloat(targetAmount) || 0);
  }, [targetAmount]);

  useEffect(() => {
    const total = milestones.reduce((sum, m) => {
      const val = parseFloat(m.targetAmount) || 0;
      return sum + val;
    }, 0);
    setTotalAllocated(total);
  }, [milestones]);

  const allocationPct = projectTarget > 0 ? (totalAllocated / projectTarget) * 100 : 0;
  const isAllocationValid = projectTarget > 0 && totalAllocated === projectTarget;

  const handleAddMilestone = () => {
    setMilestones((prev) => [
      ...prev,
      { title: "", description: "", targetAmount: "", deadline: "", proofType: "Photo Evidence" },
    ]);
  };

  const handleRemoveMilestone = (index: number) => {
    if (milestones.length === 1) return;
    setMilestones((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMilestoneChange = (index: number, field: keyof MilestoneInput, value: string) => {
    setMilestones((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    );
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.type.startsWith("image/")) {
        setError("Only image files (JPEG, PNG, WebP) are allowed");
        e.target.value = "";
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        setError("Image file size must not exceed 2MB");
        e.target.value = "";
        return;
      }
      setError("");
      setCoverImage(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!title || !description || !targetAmount || !location || !coverImage) {
      setError("Please complete all basic project details and cover image.");
      setLoading(false);
      return;
    }

    if (!isAllocationValid) {
      setError("Project targeting validation failed. Milestones must sum up to the total target exactly.");
      setLoading(false);
      return;
    }

    // Validate milestone fields
    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      if (!m.title || !m.description || !m.targetAmount || !m.deadline) {
        setError(`Please fill in all details for Milestone ${i + 1}`);
        setLoading(false);
        return;
      }
    }

    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("description", description);
      formData.append("causeCategory", causeCategory);
      formData.append("targetAmount", targetAmount);
      formData.append("location", location);
      formData.append("coverImage", coverImage);
      formData.append("milestones", JSON.stringify(milestones));

      const response = await fetch("/api/ngo/projects", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to publish project");
      }

      setCreatedProjectId(result.projectId);
      setIsShareOpen(true);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-12 px-4 sm:px-6 lg:px-8 font-sans transition-colors duration-200">
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 p-8 sm:p-10 relative overflow-hidden">
        
        <div className="mb-8 border-b border-gray-100 dark:border-gray-800 pb-5">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Launch New Project</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Define your campaign parameters and sequence milestones. Milestone targets must allocate the total project budget exactly.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/30 border-l-4 border-red-500 rounded text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-950/30 border-l-4 border-emerald-500 rounded text-sm text-emerald-700 dark:text-emerald-300">
            Project published successfully!
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          
          {/* Section 1: Project Details */}
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">1. Project Information</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Project Title *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                  placeholder="e.g. Clean Water for Dharavi"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Cause Category *</label>
                <select
                  value={causeCategory}
                  onChange={(e) => setCauseCategory(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                >
                  {CAUSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Target Amount (INR) *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold text-sm">₹</span>
                  <input
                    type="number"
                    min="1"
                    value={targetAmount}
                    onChange={(e) => setTargetAmount(e.target.value)}
                    className="w-full pl-8 pr-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                    placeholder="e.g. 50000"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Location / Target Area *</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                  placeholder="e.g. Dharavi, Mumbai"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Description *</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition resize-none"
                placeholder="Describe the scope, objectives, and impact goals of this project..."
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Cover Image * (Max size: 2MB)</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 dark:file:bg-emerald-950/30 dark:file:text-emerald-400 hover:file:bg-emerald-100 cursor-pointer"
                required
              />
            </div>
          </div>

          {/* Section 2: Sequential Milestone Builder */}
          <div className="border-t border-gray-200 dark:border-gray-800 pt-8 space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">2. Sequential Milestone Builder</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Milestones run in chronological order. Add goals sequentially.</p>
              </div>
              <button
                type="button"
                onClick={handleAddMilestone}
                className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold py-2 px-4 rounded-lg text-xs transition"
              >
                + Add Milestone
              </button>
            </div>

            {/* Live progress Allocation tracker */}
            {projectTarget > 0 && (
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-5 border border-gray-100 dark:border-gray-800/80">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Target Budget Allocation:</span>
                  <span className={`text-xs font-bold ${isAllocationValid ? "text-emerald-600" : totalAllocated > projectTarget ? "text-red-500" : "text-amber-500"}`}>
                    ₹{totalAllocated.toLocaleString()} of ₹{projectTarget.toLocaleString()} allocated ({allocationPct.toFixed(1)}%)
                  </span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-800 h-2.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isAllocationValid
                        ? "bg-emerald-600"
                        : totalAllocated > projectTarget
                        ? "bg-red-500"
                        : "bg-amber-500"
                    }`}
                    style={{ width: `${Math.min(100, allocationPct)}%` }}
                  ></div>
                </div>
                {!isAllocationValid && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-2 font-medium">
                    * The publish button is locked until the milestone total matches ₹{projectTarget.toLocaleString()} exactly.
                  </p>
                )}
              </div>
            )}

            {/* Milestone Cards List */}
            <div className="space-y-6">
              {milestones.map((milestone, idx) => (
                <div
                  key={idx}
                  className="bg-gray-50/50 dark:bg-gray-900/30 rounded-xl p-6 border border-gray-200/60 dark:border-gray-800/80 relative pr-12"
                >
                  {/* Absolute positioned Remove/Trash button */}
                  {milestones.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveMilestone(idx)}
                      className="absolute top-4 right-4 p-2 text-gray-400 hover:text-red-500 transition rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                      title="Remove Milestone"
                    >
                      <svg className="w-5 h-5 fill-none stroke-current" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}

                  {/* Card Header with sequencing badge */}
                  <div className="flex items-center gap-2 mb-4 border-b border-gray-200/50 dark:border-gray-800/50 pb-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-400 font-extrabold text-xs">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">Milestone {idx + 1}</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">Milestone Title *</label>
                      <input
                        type="text"
                        value={milestone.title}
                        onChange={(e) => handleMilestoneChange(idx, "title", e.target.value)}
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        placeholder="e.g. Purchase 500 textbooks"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">Target Amount (INR) *</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs font-semibold">₹</span>
                        <input
                          type="number"
                          min="1"
                          value={milestone.targetAmount}
                          onChange={(e) => handleMilestoneChange(idx, "targetAmount", e.target.value)}
                          className="w-full pl-7 pr-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          placeholder="e.g. 15000"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">Deadline *</label>
                      <DatePicker
                        value={milestone.deadline}
                        onChange={(val) => handleMilestoneChange(idx, "deadline", val)}
                        min={new Date().toISOString().split("T")[0]}
                        placeholder="Select deadline"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">Proof Type Required *</label>
                      <select
                        value={milestone.proofType}
                        onChange={(e) => handleMilestoneChange(idx, "proofType", e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        {PROOF_TYPES.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">Description *</label>
                    <textarea
                      value={milestone.description}
                      onChange={(e) => handleMilestoneChange(idx, "description", e.target.value)}
                      rows={2}
                      className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                      placeholder="e.g. Buy and distribute physical textbooks to primary students..."
                      required
                    />
                  </div>

                </div>
              ))}
            </div>
          </div>

          {/* Sticky Allocation Tracker & Form Actions */}
          <div className="pt-6 border-t border-gray-200 dark:border-gray-800 space-y-4">
            
            {/* Sticky/visible Allocation Tracker */}
            <div className="sticky bottom-4 z-20 bg-white/95 dark:bg-gray-900/95 backdrop-blur border border-gray-200 dark:border-gray-800 rounded-xl p-4 shadow-lg flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-300">Milestone Allocation Tracker</span>
                <span className={`text-xs font-black ${
                  isAllocationValid 
                    ? "text-emerald-600 dark:text-emerald-400" 
                    : totalAllocated > projectTarget 
                    ? "text-red-500" 
                    : "text-teal-600 dark:text-teal-400"
                }`}>
                  ₹{totalAllocated.toLocaleString()} of ₹{projectTarget.toLocaleString()} allocated ({projectTarget > 0 ? allocationPct.toFixed(1) : "0.0"}%)
                </span>
              </div>
              
              <div className="w-full bg-gray-200 dark:bg-gray-800 h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    isAllocationValid
                      ? "bg-emerald-500"
                      : totalAllocated > projectTarget
                      ? "bg-red-500"
                      : "bg-teal-500"
                  }`}
                  style={{ width: `${Math.min(100, projectTarget > 0 ? allocationPct : 0)}%` }}
                ></div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || success || !isAllocationValid}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  Publishing Project...
                </>
              ) : (
                "Publish Project & Milestones"
              )}
            </button>

            {/* Helper Validation text below the button */}
            {!isAllocationValid && (
              <p className={`text-xs text-center font-bold ${totalAllocated > projectTarget ? "text-red-500" : "text-amber-500"}`}>
                {projectTarget === 0 ? (
                  "Please enter a valid Project Target Amount above to start allocating milestones."
                ) : totalAllocated < projectTarget ? (
                  `Add milestones totaling ₹${(projectTarget - totalAllocated).toLocaleString()} more to publish`
                ) : (
                  `Remove ₹${(totalAllocated - projectTarget).toLocaleString()} to publish`
                )}
              </p>
            )}
            {isAllocationValid && (
              <p className="text-xs text-center text-emerald-600 dark:text-emerald-400 font-bold">
                ✓ Milestone targets match project target exactly. Ready to publish!
              </p>
            )}
          </div>
        </form>
      </div>

      {createdProjectId && (
        <ShareProjectModal
          isOpen={isShareOpen}
          onClose={() => {
            setIsShareOpen(false);
            router.push("/ngo/dashboard");
          }}
          projectId={createdProjectId}
          projectTitle={title}
          targetAmount={targetAmount}
          causeCategory={causeCategory}
          location={location}
        />
      )}
    </div>
  );
}
