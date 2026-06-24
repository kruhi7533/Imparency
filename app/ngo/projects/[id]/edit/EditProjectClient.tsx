"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import DatePicker from "@/app/components/DatePicker";
import ShareProjectModal from "@/app/components/ShareProjectModal";
import AIGenerateField from "@/app/components/AIGenerateField";

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
  id?: string;
  title: string;
  description: string;
  targetAmount: string;
  deadline: string;
  proofType: string;
  status?: string;
}

interface EditProjectClientProps {
  project: {
    id: string;
    title: string;
    description: string;
    problem_statement: string;
    expected_outcome: string;
    causeCategory: string;
    targetAmount: number;
    raisedAmount: number;
    location: string;
    coverImage: string;
    milestones: Array<{
      id: string;
      title: string;
      description: string;
      targetAmount: string;
      deadline: string;
      status: string;
    }>;
  };
}

export default function EditProjectClient({ project }: EditProjectClientProps) {
  const router = useRouter();

  const isLocked = project.raisedAmount > 0;

  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description);
  const [problemStatement, setProblemStatement] = useState(project.problem_statement);
  const [expectedOutcome, setExpectedOutcome] = useState(project.expected_outcome);
  const [causeCategory, setCauseCategory] = useState(project.causeCategory);
  const [targetAmount, setTargetAmount] = useState(project.targetAmount.toString());
  const [location, setLocation] = useState(project.location);
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [coverImagePreview, setCoverImagePreview] = useState<string>(project.coverImage);

  // Milestones state prefilled
  const [milestones, setMilestones] = useState<MilestoneInput[]>(
    project.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      targetAmount: m.targetAmount,
      deadline: m.deadline,
      proofType: "Photo Evidence",
      status: m.status,
    }))
  );

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);

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
    if (isLocked) return;
    setMilestones((prev) => [
      ...prev,
      { title: "", description: "", targetAmount: "", deadline: "", proofType: "Photo Evidence" },
    ]);
  };

  const handleRemoveMilestone = (index: number) => {
    if (isLocked || milestones.length === 1) return;
    setMilestones((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMilestoneChange = (index: number, field: keyof MilestoneInput, value: string) => {
    if (isLocked) return;
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
      setCoverImagePreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!title || !description || !targetAmount || !location) {
      setError("Please complete all required project details.");
      setLoading(false);
      return;
    }

    if (!isLocked && !isAllocationValid) {
      setError("Project targeting validation failed. Milestones must sum up to the total target exactly.");
      setLoading(false);
      return;
    }

    // Validate milestone fields if editable
    if (!isLocked) {
      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i];
        if (!m.title || !m.description || !m.targetAmount || !m.deadline) {
          setError(`Please fill in all details for Milestone ${i + 1}`);
          setLoading(false);
          return;
        }
      }
    }

    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("description", description);
      formData.append("problemStatement", problemStatement);
      formData.append("expectedOutcome", expectedOutcome);
      formData.append("causeCategory", causeCategory);
      formData.append("location", location);
      
      if (coverImage) {
        formData.append("coverImage", coverImage);
      }

      if (!isLocked) {
        formData.append("targetAmount", targetAmount);
        formData.append("milestones", JSON.stringify(milestones));
      }

      const response = await fetch(`/api/ngo/projects/${project.id}`, {
        method: "PATCH",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to update project");
      }

      setSuccess(true);
      router.push("/ngo/dashboard");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-12 px-4 sm:px-6 lg:px-8 font-sans transition-colors duration-200">
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 p-8 sm:p-10 relative overflow-hidden">
        
        <div className="mb-8 border-b border-gray-100 dark:border-gray-800 pb-5 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Edit Campaign</h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {isLocked 
                ? "This campaign has received donations. Budget and milestones are locked to protect donor transparency." 
                : "Modify campaign parameters and sequence milestones. Milestones must sum up to target exactly."}
            </p>
          </div>
          <button 
            type="button" 
            onClick={() => router.push("/ngo/dashboard")} 
            className="px-4 py-2 border border-gray-300 dark:border-gray-700 hover:bg-gray-150 dark:hover:bg-gray-850 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 transition"
          >
            Back to Dashboard
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/30 border-l-4 border-red-500 rounded text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-950/30 border-l-4 border-emerald-500 rounded text-sm text-emerald-700 dark:text-emerald-300">
            Campaign updated successfully!
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
                  disabled={isLocked}
                  className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition disabled:opacity-60 disabled:cursor-not-allowed"
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
                    disabled={isLocked}
                    className="w-full pl-8 pr-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition disabled:opacity-60 disabled:cursor-not-allowed"
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
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Description *</label>
                <AIGenerateField
                  fieldType="description"
                  title={title}
                  causeCategory={causeCategory}
                  targetAmount={targetAmount}
                  location={location}
                  currentValue={description}
                  onGenerated={setDescription}
                />
              </div>
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
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Problem Statement (Optional)</label>
                <AIGenerateField
                  fieldType="problem_statement"
                  title={title}
                  causeCategory={causeCategory}
                  targetAmount={targetAmount}
                  location={location}
                  currentValue={problemStatement}
                  onGenerated={setProblemStatement}
                />
              </div>
              <textarea
                value={problemStatement}
                onChange={(e) => setProblemStatement(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition resize-none"
                placeholder="What issue or gap does this campaign address? e.g., '200 children in Dharavi lack access to basic learning materials...'"
              />
              <p className="text-[11px] text-gray-500 mt-1">Adding this helps donors understand your campaign's purpose and builds trust.</p>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Expected Outcome (Optional)</label>
                <AIGenerateField
                  fieldType="expected_outcome"
                  title={title}
                  causeCategory={causeCategory}
                  targetAmount={targetAmount}
                  location={location}
                  currentValue={expectedOutcome}
                  onGenerated={setExpectedOutcome}
                />
              </div>
              <textarea
                value={expectedOutcome}
                onChange={(e) => setExpectedOutcome(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition resize-none"
                placeholder="What does success look like once this campaign is complete? e.g., 'Improved school attendance and literacy among 200 children...'"
              />
              <p className="text-[11px] text-gray-500 mt-1">Adding this helps donors understand your campaign's purpose and builds trust.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Cover Image (Optional, leave blank to keep current)</label>
              {coverImagePreview && (
                <div className="mb-3 w-48 h-28 relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-800">
                  <img src={coverImagePreview} alt="Cover Preview" className="w-full h-full object-cover" />
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 dark:file:bg-emerald-950/30 dark:file:text-emerald-400 hover:file:bg-emerald-100 cursor-pointer"
              />
            </div>
          </div>

          {/* Section 2: Sequential Milestone Builder */}
          <div className="border-t border-gray-200 dark:border-gray-800 pt-8 space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">2. Sequential Milestone Builder</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {isLocked 
                    ? "Milestones cannot be altered as donations have already been made."
                    : "Milestones run in chronological order. Add goals sequentially."}
                </p>
              </div>
              {!isLocked && (
                <button
                  type="button"
                  onClick={handleAddMilestone}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md transition"
                >
                  + Add Milestone Goal
                </button>
              )}
            </div>

            {/* Total allocated target match tracker */}
            {!isLocked && (
              <div className="p-4 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800/60 rounded-xl space-y-3">
                <div className="flex justify-between items-center text-xs font-semibold">
                  <span className="text-gray-600 dark:text-gray-450">Milestones Allocated: ₹{totalAllocated.toLocaleString()} / ₹{projectTarget.toLocaleString()}</span>
                  <span className={isAllocationValid ? "text-emerald-600" : "text-red-500"}>
                    {isAllocationValid ? "✓ Balanced Target!" : "✗ Allocations Mismatch"}
                  </span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-800 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${isAllocationValid ? "bg-emerald-600" : "bg-red-500"}`}
                    style={{ width: `${Math.min(100, allocationPct)}%` }}
                  ></div>
                </div>
              </div>
            )}

            {/* List of Milestones */}
            <div className="space-y-6">
              {milestones.map((milestone, idx) => (
                <div
                  key={idx}
                  className="p-5 border border-gray-200 dark:border-gray-800 rounded-xl bg-gray-50/50 dark:bg-gray-900/30 space-y-4 relative"
                >
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-full">
                      Goal #{idx + 1}
                    </span>
                    {!isLocked && milestones.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMilestone(idx)}
                        className="text-xs font-bold text-red-500 hover:text-red-650"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">Goal Title *</label>
                      <input
                        type="text"
                        value={milestone.title}
                        onChange={(e) => handleMilestoneChange(idx, "title", e.target.value)}
                        disabled={isLocked}
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
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
                          disabled={isLocked}
                          className="w-full pl-7 pr-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
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
                        disabled={isLocked}
                        min={new Date().toISOString().split("T")[0]}
                        placeholder="Select deadline"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">Proof Type Required *</label>
                      <select
                        value={milestone.proofType}
                        onChange={(e) => handleMilestoneChange(idx, "proofType", e.target.value)}
                        disabled={isLocked}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {PROOF_TYPES.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-xs font-bold text-gray-600 dark:text-gray-400">Description *</label>
                      <AIGenerateField
                        fieldType="milestone_description"
                        title={milestone.title || `Milestone ${idx + 1}`}
                        causeCategory={causeCategory}
                        targetAmount={milestone.targetAmount || 0}
                        currentValue={milestone.description}
                        onGenerated={(val) => handleMilestoneChange(idx, "description", val)}
                        disabled={isLocked}
                        milestoneTitle={milestone.title || `Milestone ${idx + 1}`}
                        proofTypeRequired={milestone.proofType}
                        parentProjectTitle={title}
                      />
                    </div>
                    <textarea
                      value={milestone.description}
                      onChange={(e) => handleMilestoneChange(idx, "description", e.target.value)}
                      disabled={isLocked}
                      rows={2}
                      className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none disabled:opacity-60 disabled:cursor-not-allowed"
                      placeholder="e.g. Buy and distribute physical textbooks to primary students..."
                      required
                    />
                  </div>

                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-800 pt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => router.push("/ngo/dashboard")}
              className="px-5 py-2.5 border border-gray-300 dark:border-gray-700 hover:bg-gray-150 dark:hover:bg-gray-850 rounded-xl text-sm font-semibold text-gray-700 dark:text-gray-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || (!isLocked && !isAllocationValid)}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Saving Changes..." : "Save Changes"}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
