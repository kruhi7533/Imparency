"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import ProjectCoverImage from "@/app/components/ProjectCoverImage";
import { DonorCategoryModal } from "@/components/donor/DonorCategoryModal";
import { DonateModal } from "@/components/donor/DonateModal";

interface Milestone {
  id: string;
  title: string;
  description: string;
  targetAmount: any; // Decimal
  deadline: Date | string;
  status: string;   // MilestoneStatus enum as string
  sequenceOrder: number;
}

interface Project {
  id: string;
  title: string;
  description: string;
  causeCategory: string;
  targetAmount: any; // Decimal
  raisedAmount: any;  // Decimal
  status: string;
  coverImage: string;
  location: string;
  createdAt: Date;
  milestones: Milestone[];
}

interface NGO {
  id: string;
  orgName: string;
  causeCategories: string[];
  address: string;
  healthScore: any; // Decimal
  healthScoreBreakdown: any; // Json
  description: string;
  website: string | null;
  foundedYear: number;
  projects?: Project[];
  logo_url?: string | null;
  registrationNumber: string;
  panNumber: string;
}

interface NGOProfileClientProps {
  ngo: NGO;
  donorsCount: number;
  initialFollowersCount: number;
  initialIsFollowed: boolean;
  isAuthenticated: boolean;
}

export default function NGOProfileClient({
  ngo,
  donorsCount,
  initialFollowersCount,
  initialIsFollowed,
  isAuthenticated,
}: NGOProfileClientProps) {
  const [activeTab, setActiveTab] = useState<"active" | "completed" | "story" | "about">("active");
  const [isFollowed, setIsFollowed] = useState(initialIsFollowed);
  const [followersCount, setFollowersCount] = useState(initialFollowersCount);
  
  const [donorCategory, setDonorCategory] = useState<string | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showDonateModal, setShowDonateModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [categoryCheckDone, setCategoryCheckDone] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch("/api/user/donor-category")
      .then((r) => r.json())
      .then((data) => {
        if (data.isSet) {
          setDonorCategory(data.donorCategory);
        }
        setCategoryCheckDone(true);
      })
      .catch(() => setCategoryCheckDone(true));
  }, [isAuthenticated]);

  const handleDonateClick = (project: Project) => {
    if (!isAuthenticated) {
      alert("Please login to donate");
      return;
    }
    setSelectedProject(project);
    if (!donorCategory) {
      // First time — show category declaration modal
      setShowCategoryModal(true);
    } else {
      // Category already set — go straight to donate modal
      setShowDonateModal(true);
    }
  };
  
  // Health score count-up animation state
  const targetHealth = ngo.healthScore !== null && ngo.healthScore !== undefined ? Number(ngo.healthScore) : null;
  const [animatedScore, setAnimatedScore] = useState<number | null>(null);

  useEffect(() => {
    if (targetHealth === null) {
      setAnimatedScore(null);
      return;
    }
    
    let start = 0;
    const duration = 1000; // 1s animation duration
    const stepTime = targetHealth > 0 ? Math.abs(Math.floor(duration / targetHealth)) : 1000;
    
    const timer = setInterval(() => {
      start += 1;
      if (start >= targetHealth) {
        setAnimatedScore(targetHealth);
        clearInterval(timer);
      } else {
        setAnimatedScore(start);
      }
    }, stepTime);

    return () => clearInterval(timer);
  }, [targetHealth]);

  const handleFollowToggle = async () => {
    if (!isAuthenticated) {
      alert("Please login to follow NGOs");
      return;
    }

    try {
      const response = await fetch(`/api/ngo/${ngo.id}/follow`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to follow NGO");
      }

      const result = await response.json();
      setIsFollowed(result.followed);
      setFollowersCount((prev) => (result.followed ? prev + 1 : prev - 1));
    } catch (err) {
      console.error(err);
    }
  };

  const activeProjects = ngo.projects ? (ngo as any).projects.filter((p: Project) => p.status === "ACTIVE") : [];
  const completedProjects = ngo.projects ? (ngo as any).projects.filter((p: Project) => p.status === "COMPLETED") : [];
  const totalRaised = ngo.projects ? (ngo as any).projects.reduce((sum: number, p: Project) => sum + Number(p.raisedAmount), 0) : 0;

  // Extract real Health metrics from breakdown for display
  const breakdown = ngo.healthScoreBreakdown ? (typeof ngo.healthScoreBreakdown === 'string' ? JSON.parse(ngo.healthScoreBreakdown) : ngo.healthScoreBreakdown) : null;

  const metrics = [
    { label: "Fund Utilization Rate", val: breakdown?.utilization?.score ?? null },
    { label: "Milestone Completion Rate", val: breakdown?.completion?.score ?? null },
    { label: "Average Proof Submission Speed", val: breakdown?.speed?.score ?? null },
    { label: "Donor Return Rate", val: breakdown?.donorReturn?.score ?? null },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      
      {/* Banner / Header */}
      <div className="h-64 w-full bg-gradient-to-r from-emerald-600 to-teal-500 relative">
        <div className="absolute inset-0 bg-black/10"></div>
      </div>

      {/* Profile Info Details Card */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-24 pb-16 relative z-10">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="flex flex-col sm:flex-row gap-5 items-start sm:items-center">
            
            {/* Logo Avatar Place-holder */}
            {ngo.logo_url ? (
              <img
                src={ngo.logo_url}
                alt={ngo.orgName}
                className="w-24 h-24 rounded-2xl object-cover shadow-md border-4 border-white dark:border-gray-900"
              />
            ) : (
              <div className="w-24 h-24 bg-emerald-600 text-white rounded-2xl flex items-center justify-center font-black text-4xl shadow-md border-4 border-white dark:border-gray-900">
                {ngo.orgName.charAt(0)}
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-black text-gray-900 dark:text-white">{ngo.orgName}</h1>
                <span className="text-xs px-2.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 rounded-full font-bold border border-emerald-100 dark:border-emerald-900/50">
                  Verified NGO
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <span>📍</span> {ngo.address.split(",").slice(-2).join(",").trim()}
                {ngo.website && (
                  <>
                    <span className="mx-1.5">•</span>
                    <a href={ngo.website} target="_blank" rel="noopener noreferrer" className="text-emerald-600 dark:text-emerald-400 hover:underline">
                      {ngo.website}
                    </a>
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {ngo.causeCategories.map((c) => (
                  <span key={c} className="text-[10px] font-bold px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Action follow button */}
          <div>
            <button
              onClick={handleFollowToggle}
              className={`w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-bold shadow-md transition ${
                isFollowed
                  ? "bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/10"
              }`}
            >
              {isFollowed ? "Following Organization" : "Follow NGO"}
            </button>
          </div>
        </div>

        {/* Stats and Health Score Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
          
          {/* Main Info Columns */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* Tabs List */}
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm flex gap-2 overflow-x-auto">
              {(["active", "completed", "story", "about"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-5 py-2 rounded-xl text-xs font-bold transition capitalize whitespace-nowrap ${
                    activeTab === tab
                      ? "bg-emerald-600 text-white shadow-md shadow-emerald-500/10"
                      : "text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  {tab === "active"
                    ? "Active Campaigns"
                    : tab === "completed"
                    ? "Completed Campaigns"
                    : tab === "story"
                    ? "Impact Story"
                    : "About NGO"}
                </button>
              ))}
            </div>

            {/* Tab Contents */}
            <div>
              {activeTab === "active" && (
                <div className="space-y-6">
                  {activeProjects.length === 0 ? (
                    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-10 text-center shadow-sm">
                      <span className="text-3xl mb-3 block">📦</span>
                      <h4 className="text-sm font-bold text-gray-900 dark:text-white">No Active Campaigns</h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">This NGO does not have any active fundraising projects right now.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      {activeProjects.map((project: Project) => (
                        <div
                          key={project.id}
                          className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-150"
                        >
                          <div className="h-40 bg-gray-200 dark:bg-gray-800 relative">
                            <ProjectCoverImage src={project.coverImage} alt={project.title} causeCategory={project.causeCategory} className="w-full h-full object-cover object-center" />
                          </div>
                          <div className="p-5 space-y-3">
                            <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">{project.causeCategory}</span>
                            <h4 className="text-base font-extrabold text-gray-900 dark:text-white mt-1 line-clamp-1">{project.title}</h4>
                            <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{project.description}</p>
                            <div className="pt-2">
                              <div className="flex justify-between text-[10px] font-bold text-gray-500 mb-1">
                                <span>Raised: ₹{Number(project.raisedAmount).toLocaleString()}</span>
                                <span>Target: ₹{Number(project.targetAmount).toLocaleString()}</span>
                              </div>
                              <div className="w-full bg-gray-100 dark:bg-gray-800 h-1.5 rounded-full overflow-hidden">
                                <div
                                  className="bg-emerald-600 h-full rounded-full"
                                  style={{ width: `${Math.min(100, (Number(project.raisedAmount) / Number(project.targetAmount)) * 100)}%` }}
                                ></div>
                              </div>
                            </div>
                            <div className="pt-2">
                              <button
                                type="button"
                                onClick={() => handleDonateClick(project)}
                                className="w-full block text-center bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-xl text-xs shadow-md transition cursor-pointer"
                              >
                                Donate to this Project
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "completed" && (
                <div className="space-y-6">
                  {completedProjects.length === 0 ? (
                    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-10 text-center shadow-sm">
                      <span className="text-3xl mb-3 block">📦</span>
                      <h4 className="text-sm font-bold text-gray-900 dark:text-white">No Completed Campaigns</h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">No completed campaigns yet — check back as milestones are achieved</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      {completedProjects.map((project: Project) => (
                        <div
                          key={project.id}
                          className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm opacity-85 hover:opacity-100 transition duration-150 flex flex-col justify-between"
                        >
                          <div>
                            <div className="h-40 bg-gray-200 dark:bg-gray-800 relative">
                              <ProjectCoverImage src={project.coverImage} alt={project.title} causeCategory={project.causeCategory} className="w-full h-full object-cover object-center grayscale" />
                              <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 bg-gray-900/80 text-white rounded-full">Completed</span>
                            </div>
                            <div className="p-5 space-y-2">
                              <h4 className="text-base font-extrabold text-gray-900 dark:text-white line-clamp-1">{project.title}</h4>
                              <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{project.description}</p>
                              <div className="pt-2 text-xs font-semibold text-emerald-600">
                                ✓ ₹{Number(project.targetAmount).toLocaleString()} raised and deployed successfully.
                              </div>
                            </div>
                          </div>
                          <div className="p-5 pt-0">
                            <Link
                              href={`/projects/${project.id}`}
                              className="block text-center border border-emerald-600/50 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 font-bold py-2 rounded-xl text-xs transition"
                            >
                              View Milestones & Proofs
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "story" && (
                <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-8 shadow-sm space-y-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">Our Impact Story</h3>
                  <div className="bg-gray-50 dark:bg-gray-800/20 border border-gray-100 dark:border-gray-800/50 rounded-xl p-8 text-center w-full">
                    <span className="text-3xl mb-3 block">📖</span>
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white">No Impact Story Shared</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">This NGO hasn't shared their impact story yet.</p>
                  </div>
                </div>
              )}

              {activeTab === "about" && (
                <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-8 shadow-sm space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">About Organization</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{ngo.description}</p>
                  </div>
                  <div className="border-t border-gray-100 dark:border-gray-800 pt-6 grid grid-cols-2 gap-4 text-sm text-gray-700 dark:text-gray-300">
                    <div>
                      <strong className="block text-xs text-gray-400 font-semibold mb-0.5">Founded Year</strong>
                      {ngo.foundedYear}
                    </div>
                    <div>
                      <strong className="block text-xs text-gray-400 font-semibold mb-0.5">Focus Cause Areas</strong>
                      {ngo.causeCategories.join(", ")}
                    </div>
                    <div>
                      <strong className="block text-xs text-gray-400 font-semibold mb-0.5">Registration Number</strong>
                      {ngo.registrationNumber}
                    </div>
                    <div>
                      <strong className="block text-xs text-gray-400 font-semibold mb-0.5">PAN Number</strong>
                      {ngo.panNumber}
                    </div>
                    <div className="col-span-2">
                      <strong className="block text-xs text-gray-400 font-semibold mb-0.5">HQ Address</strong>
                      {ngo.address}
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Right Metrics Sidebar */}
          <div className="space-y-6">
            
            {/* Health Score Panel */}
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">NGO Health Details</h3>
              
              {/* Animated Big Score */}
              <div className="text-center py-6 border-b border-gray-100 dark:border-gray-800 mb-6">
                {animatedScore !== null ? (
                  <>
                    <span className="text-5xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
                      {animatedScore.toFixed(0)}
                    </span>
                    <span className="text-gray-400 text-sm font-bold">/100</span>
                  </>
                ) : (
                  <span className="text-lg font-black text-gray-500 dark:text-gray-400 tracking-tight block">
                    New NGO — Score Pending
                  </span>
                )}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 font-medium">Auto-computed NGO Health Score</p>
              </div>

              {/* Metrics Progress bars */}
              <div className="space-y-5">
                {metrics.map((metric) => {
                  const hasVal = metric.val !== null && metric.val !== undefined;
                  const displayVal = hasVal ? `${Number(metric.val).toFixed(0)}%` : "Pending";
                  const widthPercent = hasVal ? Number(metric.val) : 0;
                  return (
                    <div key={metric.label}>
                      <div className="flex justify-between text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                        <span>{metric.label}</span>
                        <span>{displayVal}</span>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-800 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-emerald-600 h-full rounded-full transition-all duration-1000 ease-out"
                          style={{ width: `${widthPercent}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Stats Panel */}
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2">Campaign Stats</h3>
              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="p-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl">
                  <span className="block text-lg font-black text-gray-900 dark:text-white">{followersCount}</span>
                  <span className="text-[10px] text-gray-400">Followers</span>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl">
                  <span className="block text-lg font-black text-gray-900 dark:text-white">₹{totalRaised.toLocaleString()}</span>
                  <span className="text-[10px] text-gray-400">Total Raised</span>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl col-span-2">
                  <span className="block text-lg font-black text-gray-900 dark:text-white">{donorsCount}</span>
                  <span className="text-[10px] text-gray-400">Active Donors</span>
                </div>
              </div>
            </div>

          </div>

        </div>
      </div>

      {/* FCRA Category Declaration Modal */}
      <DonorCategoryModal
        isOpen={showCategoryModal}
        onComplete={(category) => {
          setDonorCategory(category);
          setShowCategoryModal(false);
          setShowDonateModal(true);
        }}
        onClose={() => setShowCategoryModal(false)}
      />

      {/* Donate Modal */}
      {selectedProject && (
        <DonateModal
          isOpen={showDonateModal}
          onClose={() => {
            setShowDonateModal(false);
            setSelectedProject(null);
          }}
          project={{
            id: selectedProject.id,
            title: selectedProject.title,
            targetAmount: Number(selectedProject.targetAmount),
            raisedAmount: Number(selectedProject.raisedAmount),
            milestones: selectedProject.milestones || [],
          }}
          ngoName={ngo.orgName}
          ngoId={ngo.id}
          donorCategory={donorCategory ?? "INDIAN_RESIDENT"}
        />
      )}

    </div>
  );
}
