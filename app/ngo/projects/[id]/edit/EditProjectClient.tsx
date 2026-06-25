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
    districtName: string;
    stateName: string;
    latitude: number | null;
    longitude: number | null;
    geoIntelligence: any;
    geoFetchedAt: string | null;
    coverImage: string;
    tocAnalysis: any;
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
  const [districtName, setDistrictName] = useState(project.districtName);
  const [stateName, setStateName] = useState(project.stateName);
  const [latitude, setLatitude] = useState(project.latitude?.toString() || "");
  const [longitude, setLongitude] = useState(project.longitude?.toString() || "");
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

  // TOC State
  const [tocData, setTocData] = useState<any>(project.tocAnalysis || null);
  const [tocLoading, setTocLoading] = useState(false);
  const [tocError, setTocError] = useState("");

  // Geo State
  const [geoData, setGeoData] = useState<any>(project.geoIntelligence || null);
  const [geoFetchedAt, setGeoFetchedAt] = useState<string | null>(project.geoFetchedAt);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState("");

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

  const handleCheckToc = async () => {
    setTocLoading(true);
    setTocError("");
    try {
      // First, save current details (if not locked) so the backend analyzes the latest
      if (!isLocked) {
        const formData = new FormData();
        formData.append("title", title);
        formData.append("description", description);
        formData.append("problemStatement", problemStatement);
        formData.append("expectedOutcome", expectedOutcome);
        formData.append("causeCategory", causeCategory);
        formData.append("location", location);
        formData.append("districtName", districtName);
        formData.append("stateName", stateName);
        formData.append("latitude", latitude);
        formData.append("longitude", longitude);
        formData.append("targetAmount", targetAmount);
        formData.append("milestones", JSON.stringify(milestones));
        await fetch(`/api/ngo/projects/${project.id}`, { method: "PATCH", body: formData });
      }

      const response = await fetch(`/api/ngo/projects/${project.id}/toc-check`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "TOC Check failed");
      setTocData(data);
    } catch (err: any) {
      setTocError(err.message || "Failed to check Theory of Change");
    } finally {
      setTocLoading(false);
    }
  };

  const handleFetchGeo = async () => {
    setGeoLoading(true);
    setGeoError("");
    try {
      if (!isLocked) {
        const formData = new FormData();
        formData.append("title", title);
        formData.append("description", description);
        formData.append("location", location);
        formData.append("districtName", districtName);
        formData.append("stateName", stateName);
        formData.append("latitude", latitude);
        formData.append("longitude", longitude);
        await fetch(`/api/ngo/projects/${project.id}`, { method: "PATCH", body: formData });
      }

      const response = await fetch(`/api/ngo/projects/${project.id}/geo-enrich`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Geo fetch failed");
      setGeoData(data);
      setGeoFetchedAt(data.fetchedAt);
    } catch (err: any) {
      setGeoError(err.message || "Failed to fetch Geo Intelligence");
    } finally {
      setGeoLoading(false);
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
      formData.append("districtName", districtName);
      formData.append("stateName", stateName);
      formData.append("latitude", latitude);
      formData.append("longitude", longitude);
      
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

          {/* Section 1.5: Project Location */}
          <div className="border-t border-gray-200 dark:border-gray-800 pt-8 space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Project Location & Geo Context</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Add precise coordinates to unlock AI Geo Intelligence for this project, helping donors understand the environmental and demographic context.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">District Name</label>
                <input
                  type="text"
                  value={districtName}
                  onChange={(e) => setDistrictName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                  placeholder="e.g. Hyderabad"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">State Name</label>
                <input
                  type="text"
                  value={stateName}
                  onChange={(e) => setStateName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                  placeholder="e.g. Telangana"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Latitude (optional)</label>
                <input
                  type="number"
                  step="any"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                  placeholder="e.g. 17.385"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Longitude (optional)</label>
                <input
                  type="number"
                  step="any"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                  placeholder="e.g. 78.4867"
                />
              </div>
            </div>

            {(latitude && longitude) && (
              <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={handleFetchGeo}
                  disabled={geoLoading}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {geoLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      Fetching...
                    </>
                  ) : (
                    <>🌍 {geoData ? "Refresh Area Intelligence" : "Fetch Area Intelligence"}</>
                  )}
                </button>
                {geoError && <p className="mt-2 text-sm text-red-500">{geoError}</p>}

                {geoData && (
                  <div className="mt-6 bg-white dark:bg-gray-900 border border-blue-100 dark:border-blue-900/50 rounded-2xl p-6 shadow-sm">
                    <div className="flex justify-between items-center mb-4 border-b border-gray-100 dark:border-gray-800 pb-4">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                        {geoData.district}, {geoData.state}
                      </h3>
                      {geoFetchedAt && (
                        <p className="text-xs text-gray-500 font-medium">
                          Last updated: {Math.floor((Date.now() - new Date(geoFetchedAt).getTime()) / (1000 * 60 * 60 * 24))} days ago
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Literacy Rate <span className="text-[10px] bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-gray-400 ml-1">Census 2011</span></p>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">
                          {geoData.literacyRate ? `${geoData.literacyRate}%` : 'Data Unavailable'}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Rural Population <span className="text-[10px] bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-gray-400 ml-1">Census 2011</span></p>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">
                          {geoData.ruralPopulation ? geoData.ruralPopulation.toLocaleString() : 'Data Unavailable'}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Vegetation (NDVI) <span className="text-[10px] bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-gray-400 ml-1">Satellite</span></p>
                        <div className="flex flex-col gap-1">
                          <div className={`px-2 py-1 rounded w-fit text-xs font-bold ${
                            geoData.ndviScore > 0.5 ? 'bg-emerald-100 text-emerald-700' :
                            geoData.ndviScore >= 0.2 ? 'bg-amber-100 text-amber-700' :
                            geoData.ndviScore >= 0 ? 'bg-red-100 text-red-700' :
                            geoData.ndviScore !== null ? 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {geoData.ndviScore !== null ? geoData.ndviScore.toFixed(3) : 'No Data'}
                          </div>
                          <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                            {geoData.ndviInterpretation}
                          </p>
                        </div>
                      </div>
                    </div>
                    <p className="mt-6 text-[11px] text-gray-400 italic">
                      Data aggregated from data.gov.in and Agromonitoring satellite imagery
                    </p>
                  </div>
                )}
              </div>
            )}
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

          {/* Section 3: Theory of Change Check */}
          <div className="border-t border-gray-200 dark:border-gray-800 pt-8 space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">3. Theory of Change Check</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Verify if your activities (milestones) logically lead to your expected outcomes. 
                <span className="italic ml-1 block mt-1">This is an advisory check — it does not affect publishing.</span>
              </p>
              
              <button
                type="button"
                onClick={handleCheckToc}
                disabled={tocLoading || milestones.length === 0 || !expectedOutcome}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {tocLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Analysing your impact logic...
                  </>
                ) : (
                  <>✨ {tocData ? "Re-check Theory of Change Alignment" : "Check Theory of Change Alignment"}</>
                )}
              </button>
              
              {tocError && <p className="mt-3 text-sm text-red-500">{tocError}</p>}
            </div>

            {tocData && (
              <div className="bg-white dark:bg-gray-900 border border-indigo-100 dark:border-indigo-900/50 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-100 dark:border-gray-800">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center font-bold text-xl shadow-sm ${
                    tocData.alignmentScore >= 75 ? "bg-emerald-100 text-emerald-700" :
                    tocData.alignmentScore >= 50 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                  }`}>
                    {tocData.alignmentScore}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Alignment Score</h3>
                    <p className={`text-sm font-medium uppercase tracking-wider ${
                      tocData.alignmentScore >= 75 ? "text-emerald-600" :
                      tocData.alignmentScore >= 50 ? "text-amber-600" : "text-red-500"
                    }`}>
                      {tocData.alignmentScore >= 75 ? "Strong Alignment" :
                       tocData.alignmentScore >= 50 ? "Moderate Alignment" : "Weak Alignment"}
                    </p>
                    {tocData.analyzedAt && (
                      <p className="text-xs text-gray-500 mt-1 font-medium">
                        Last checked: {new Date(tocData.analyzedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h4 className="text-sm font-bold text-emerald-800 dark:text-emerald-400 flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 text-xs">✓</span>
                      Strengths
                    </h4>
                    <ul className="space-y-2">
                      {tocData.strengths?.map((str: string, i: number) => (
                        <li key={i} className="text-sm text-gray-600 dark:text-gray-300 flex items-start gap-2">
                          <span className="text-emerald-500 mt-0.5">•</span>
                          {str}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-sm font-bold text-amber-800 dark:text-amber-400 flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400 text-xs">!</span>
                      Impact Gaps
                    </h4>
                    {tocData.gaps?.length > 0 ? (
                      <ul className="space-y-2">
                        {tocData.gaps.map((gap: string, i: number) => (
                          <li key={i} className="text-sm text-gray-600 dark:text-gray-300 flex items-start gap-2">
                            <span className="text-amber-500 mt-0.5">•</span>
                            {gap}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-500 italic">No significant gaps detected.</p>
                    )}
                  </div>
                </div>

                {tocData.suggestion && (
                  <div className="mt-6 p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/30 rounded-xl">
                    <h4 className="text-xs font-bold text-indigo-800 dark:text-indigo-400 mb-1 uppercase tracking-wider">Expert Suggestion</h4>
                    <p className="text-sm text-indigo-900 dark:text-indigo-200 leading-relaxed">
                      {tocData.suggestion}
                    </p>
                  </div>
                )}
              </div>
            )}
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
