"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import SubmitProofModal from "./SubmitProofModal";
import ShareProjectModal from "@/app/components/ShareProjectModal";
import ProjectCoverImage from "@/app/components/ProjectCoverImage";
import { 
  Briefcase, 
  MapPin, 
  Share2, 
  ChevronDown, 
  ChevronUp, 
  Info, 
  Settings, 
  Globe, 
  X, 
  Upload,
  IndianRupee,
  FileCheck,
  Pencil,
  MessageCircle
} from "lucide-react";

interface Milestone {
  id: string;
  title: string;
  description: string;
  targetAmount: any;
  deadline: any;
  status: string;
  sequenceOrder: number;
}

interface Project {
  id: string;
  title: string;
  description: string;
  causeCategory: string;
  targetAmount: any;
  raisedAmount: any;
  status: string;
  coverImage: string;
  location: string;
  createdAt: Date;
  milestones: Milestone[];
}

export interface FieldWorker {
  name: string;
  reliabilityScore: number;
  approvedCount: number;
  rejectedCount: number;
}

export interface DraftProof {
  id: string;
  senderPhone: string;
  rawMessage: string;
  workerStatus: string;
  status: string;
  aiSummary: string | null;
  riskLevel: string | null;
  riskReason: string | null;
  photoCount: number;
  rawGpsLat: number | null;
  rawGpsLng: number | null;
  predictedProjectId: string | null;
  predictedMilestoneId: string | null;
  predictionConfidence: number | null;
  createdAt: Date;
  fieldWorker: FieldWorker | null;
  mediaUrls: string[];
}

interface NGOProfile {
  id: string;
  userId: string;
  orgName: string;
  registrationNumber: string;
  panNumber: string;
  address: string;
  causeCategories: string[];
  verificationStatus: string;
  healthScore: any;
  healthScoreBreakdown: any;
  description: string;
  website: string | null;

  foundedYear: number;
  logo_url: string | null;
  projects: Project[];
}

interface DashboardClientProps {
  profile: NGOProfile;
}

const getInitials = (name: string) => name.charAt(0).toUpperCase();

const getAvatarColorClass = (name: string) => {
  const colors = [
    "bg-teal-600/20 text-teal-400 border-teal-500/20",
    "bg-blue-600/20 text-blue-400 border-blue-500/20",
    "bg-amber-600/20 text-amber-400 border-amber-500/20",
    "bg-purple-600/20 text-purple-400 border-purple-500/20",
    "bg-indigo-600/20 text-indigo-400 border-indigo-500/20",
    "bg-emerald-600/20 text-emerald-400 border-emerald-500/20",
    "bg-rose-600/20 text-rose-400 border-rose-500/20",
  ];
  if (!name) return colors[0];
  const charCodeSum = name.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return colors[charCodeSum % colors.length];
};

export default function DashboardClient({ 
  profile, 
  whatsappBotNumber = "+1 (234) 567-8900",
  joinCode
}: { 
  profile: any;
  whatsappBotNumber?: string;
  joinCode?: string | null;
}) {
  const [ngoProfile, setNgoProfile] = useState<NGOProfile>(profile);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [activeMilestone, setActiveMilestone] = useState<{ id: string; title: string } | null>(null);
  const [sharingProject, setSharingProject] = useState<Project | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // AI Insight state
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiInsightLoading, setAiInsightLoading] = useState(true);

  // Draft proofs state
  const [drafts, setDrafts] = useState<DraftProof[]>([]);
  const [isDraftsLoading, setIsDraftsLoading] = useState(true);
  const [rejectingDraftId, setRejectingDraftId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showAllDrafts, setShowAllDrafts] = useState(false);

  // Polling effect
  useEffect(() => {
    let interval: NodeJS.Timeout;

    const fetchDrafts = async () => {
      try {
        const res = await fetch('/api/drafts');
        if (res.ok) {
          const data = await res.json();
          setDrafts(data.drafts);
          setIsDraftsLoading(false);
        }
      } catch (err) {
        console.error("Error fetching drafts", err);
      }
    };

    fetchDrafts();

    interval = setInterval(() => {
      setDrafts(current => {
        const needsPolling = current.some(d => d.workerStatus === 'ENRICHING' || d.workerStatus === 'PENDING');
        if (needsPolling) {
          fetchDrafts();
        }
        return current;
      });
    }, 8000);

    return () => clearInterval(interval);
  }, []);

  const retryEnrichment = async (id: string) => {
    setDrafts(curr => curr.map(d => d.id === id ? { ...d, workerStatus: 'PENDING' } : d));
    await fetch(`/api/drafts/${id}/retry`, { method: 'POST' });
  };

  const handleApprove = async (id: string) => {
    setDrafts(curr => curr.map(d => d.id === id ? { ...d, status: 'APPROVED' } : d));
    await fetch(`/api/drafts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'APPROVED' })
    });
  };

  const handleReject = async (id: string) => {
    if (rejectingDraftId !== id) {
      setRejectingDraftId(id);
      setRejectReason("");
      return;
    }
    setDrafts(curr => curr.map(d => d.id === id ? { ...d, status: 'REJECTED' } : d));
    setRejectingDraftId(null);
    await fetch(`/api/drafts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'REJECTED', reason: rejectReason })
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this update?')) return;
    setDrafts(curr => curr.filter(d => d.id !== id));
    await fetch(`/api/drafts/${id}`, { method: 'DELETE' });
  };

  // Close dropdown menu on click outside
  useEffect(() => {
    const handleClose = () => setOpenMenuId(null);
    window.addEventListener("click", handleClose);
    return () => window.removeEventListener("click", handleClose);
  }, []);

  // Fetch AI insight on mount
  useEffect(() => {
    let cancelled = false;
    setAiInsightLoading(true);
    fetch("/api/ai/ngo-insight?bust=1")
      .then((res) => {
        if (!res.ok) {
          return res.json().then((body) => {
            console.error("[AI Insight] API error", res.status, body);
            return Promise.reject(new Error(`${res.status}: ${body?.error ?? "unknown"}`));
          });
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setAiInsight(data.insight ?? null);
          setAiInsightLoading(false);
        }
      })
      .catch((err) => {
        console.error("[AI Insight] Failed to load insight:", err?.message ?? err);
        if (!cancelled) {
          setAiInsight(null);
          setAiInsightLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  // Settings states
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editDescription, setEditDescription] = useState(ngoProfile.description);
  const [editWebsite, setEditWebsite] = useState(ngoProfile.website || "");
  const [editLogoFile, setEditLogoFile] = useState<File | null>(null);
  const [editLogoPreview, setEditLogoPreview] = useState<string | null>(ngoProfile.logo_url);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState("");

  const toggleExpandProject = (projectId: string) => {
    setExpandedProjectId((prev) => (prev === projectId ? null : projectId));
  };

  const handleSuccess = () => {
    window.location.reload();
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setEditLogoFile(file);
      
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setEditLogoPreview(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSettingsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    setSettingsError("");
    try {
      const formData = new FormData();
      formData.append("description", editDescription);
      formData.append("website", editWebsite);
      if (editLogoFile) {
        formData.append("logo", editLogoFile);
      }
      const res = await fetch("/api/ngo/settings", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update settings");
      }
      setNgoProfile((prev) => ({
        ...prev,
        logo_url: data.ngo.logo_url,
        description: data.ngo.description,
        website: data.ngo.website,
      }));
      setIsSettingsOpen(false);
      setEditLogoFile(null);
    } catch (err: any) {
      setSettingsError(err.message || "An unexpected error occurred");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const projects = ngoProfile.projects;
  const activeProjectsCount = projects.filter((p) => p.status === "ACTIVE").length;
  const totalFundsRaised = projects.reduce((sum, p) => sum + Number(p.raisedAmount), 0);

  // Health Score calculations
  const healthScore = ngoProfile.healthScore !== null && ngoProfile.healthScore !== undefined ? Number(ngoProfile.healthScore) : null;
  const isHealthPending = healthScore === null;
  const radius = 20;
  const strokeWidth = 3;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = isHealthPending ? 0 : circumference - (Math.min(100, healthScore) / 100) * circumference;

  let healthColor = "text-emerald-500";
  let healthBorderColor = "border-l-4 border-l-emerald-500";
  if (!isHealthPending) {
    if (healthScore < 50) {
      healthColor = "text-red-500";
      healthBorderColor = "border-l-4 border-l-red-500";
    } else if (healthScore < 80) {
      healthColor = "text-amber-500";
      healthBorderColor = "border-l-4 border-l-amber-500";
    }
  } else {
    healthBorderColor = "border-l-4 border-l-teal-500";
  }

  return (
    <div className="space-y-8">
      {/* 1. Organization Identity Header */}
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative overflow-hidden">
        {/* Background decorative gradient */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none"></div>

        <div className="flex flex-col sm:flex-row gap-5 items-start sm:items-center w-full min-w-0">
          {/* Circular avatar logo */}
          {ngoProfile.logo_url ? (
            <img
              src={ngoProfile.logo_url}
              alt={ngoProfile.orgName}
              className="w-16 h-16 rounded-full object-cover shadow-sm border border-gray-100 dark:border-gray-850 shrink-0"
            />
          ) : (
            <div className={`w-16 h-16 rounded-full flex items-center justify-center font-black text-2xl border shrink-0 ${getAvatarColorClass(ngoProfile.orgName)}`}>
              {getInitials(ngoProfile.orgName)}
            </div>
          )}

          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-black text-gray-900 dark:text-white truncate">{ngoProfile.orgName}</h1>
              <div className="flex flex-wrap gap-1.5">
                {ngoProfile.causeCategories.map((c) => (
                  <span key={c} className="text-[10px] font-extrabold px-2.5 py-0.5 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 rounded-full border border-emerald-500/25">
                    {c}
                  </span>
                ))}
              </div>
            </div>
            
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed">
              {ngoProfile.description ? (
                ngoProfile.description.length > 85 
                  ? `${ngoProfile.description.substring(0, 85)}...` 
                  : ngoProfile.description
              ) : (
                "Write a description to help donors understand your mission."
              )}
            </p>

            {ngoProfile.website && (
              <a
                href={ngoProfile.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 mt-1 font-semibold"
              >
                <Globe className="w-3.5 h-3.5" />
                {ngoProfile.website}
              </a>
            )}
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto shrink-0 mt-4 md:mt-0">
          <Link
            href={`/ngo/profile/${ngoProfile.id}`}
            className="w-full md:w-auto px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm shadow-emerald-500/20"
          >
            <Globe className="w-3.5 h-3.5" />
            Public Profile
          </Link>
          <button
            onClick={() => {
              setEditDescription(ngoProfile.description);
              setEditWebsite(ngoProfile.website || "");
              setEditLogoPreview(ngoProfile.logo_url);
              setIsSettingsOpen(true);
            }}
            className="w-full md:w-auto px-5 py-2.5 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800/60 dark:hover:bg-gray-850 border border-gray-200/50 dark:border-gray-800 text-gray-700 dark:text-gray-300 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
          >
            <Settings className="w-3.5 h-3.5" />
            Edit Settings
          </button>
        </div>
      </div>

      {/* 2. Redesigned 3 Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Health Score Card */}
        <div className={`bg-white dark:bg-gray-900 ${healthBorderColor} rounded-2xl p-6 shadow-sm flex items-center justify-between`}>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400">NGO Health Score</h3>
              {isHealthPending && (
                <div className="relative group inline-block shrink-0">
                  <Info className="w-4 h-4 text-amber-500 dark:text-amber-400 cursor-pointer" />
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 p-3 bg-gray-950 text-white text-[11px] rounded-xl shadow-xl border border-gray-800 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-50 leading-relaxed">
                    Complete your first milestone and gain 3+ donors to unlock your Health Score.
                  </div>
                </div>
              )}
            </div>
            <p className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">
              {isHealthPending ? "Pending" : `${healthScore.toFixed(0)}/100`}
            </p>
            {isHealthPending && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                Complete 1st milestone & 3+ donors to unlock
              </p>
            )}
          </div>
          
          {/* Circular Progress Ring */}
          <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="28"
                cy="28"
                r={radius}
                className="text-gray-100 dark:text-gray-800"
                strokeWidth={strokeWidth}
                fill="transparent"
                stroke="currentColor"
              />
              {isHealthPending ? (
                <circle
                  cx="28"
                  cy="28"
                  r={radius}
                  className="text-amber-500/60 dark:text-amber-400/40"
                  strokeWidth={strokeWidth}
                  fill="transparent"
                  stroke="currentColor"
                  strokeDasharray="4, 4"
                />
              ) : (
                <circle
                  cx="28"
                  cy="28"
                  r={radius}
                  className={`${healthColor} transition-all duration-1000 ease-out`}
                  strokeWidth={strokeWidth}
                  fill="transparent"
                  stroke="currentColor"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                />
              )}
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              {isHealthPending ? (
                <span className="text-xs font-bold text-amber-500">?</span>
              ) : (
                <span className={`text-xs font-black ${healthColor}`}>
                  {healthScore.toFixed(0)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Active Projects Card */}
        <div className="bg-white dark:bg-gray-900 border-l-4 border-l-blue-500 rounded-2xl p-6 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400">Active Projects</h3>
            <p className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">
              {activeProjectsCount}
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">
              across {projects.length} {projects.length === 1 ? "campaign" : "campaigns"}
            </p>
          </div>
          <div className="w-12 h-12 bg-blue-500/10 text-blue-500 dark:text-blue-400 rounded-full flex items-center justify-center shrink-0">
            <Briefcase className="w-6 h-6" />
          </div>
        </div>

        {/* Total Funds Raised Card */}
        <div className="bg-white dark:bg-gray-900 border-l-4 border-l-amber-500 rounded-2xl p-6 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400">Total Funds Raised</h3>
            <p className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">
              ₹{totalFundsRaised.toLocaleString()}
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">
              across active projects
            </p>
          </div>
          <div className="w-12 h-12 bg-amber-500/10 text-amber-500 dark:text-amber-400 rounded-full flex items-center justify-center shrink-0">
            <IndianRupee className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* AI Insight Card */}
      {aiInsightLoading ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl px-5 py-4 shadow-sm flex items-center gap-4 animate-pulse">
          <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded-full w-3/4" />
            <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full w-1/2" />
          </div>
        </div>
      ) : aiInsight ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl px-5 py-4 shadow-sm flex items-start gap-4">
          <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center text-base shrink-0 mt-0.5">
            ✨
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-0.5">AI Insight</p>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{aiInsight}</p>
          </div>
        </div>
      ) : null}
      {/* WhatsApp Field Updates */}
      {!isDraftsLoading && (
        <div className="mb-8 mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-emerald-500" />
              <h2 className="text-xl font-extrabold text-gray-900 dark:text-white">WhatsApp Field Updates</h2>
              {/* Pending count badge */}
              {drafts.filter(d => d.status === 'PENDING_REVIEW').length > 0 && (
                <span className="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                  {drafts.filter(d => d.status === 'PENDING_REVIEW').length} pending
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {/* Filter toggle */}
              <button
                onClick={() => setShowAllDrafts(p => !p)}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition ${
                  showAllDrafts
                    ? 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'
                }`}
              >
                {showAllDrafts ? '📋 All updates' : '🔔 Pending only'}
              </button>
              {whatsappBotNumber && (
                <div className="bg-white dark:bg-gray-800 px-4 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm inline-flex items-center gap-2 text-sm">
                  <span className="text-gray-400">Bot:</span>
                  <span className="font-mono font-bold text-gray-800 dark:text-white">{whatsappBotNumber}</span>
                </div>
              )}
              {joinCode && (
                <div className="bg-emerald-50 dark:bg-emerald-900/20 px-4 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 shadow-sm inline-flex items-center gap-2 text-sm">
                  <span className="text-gray-400">Join Code:</span>
                  <span className="font-mono font-bold text-emerald-600 tracking-widest">{joinCode}</span>
                </div>
              )}
            </div>
          </div>
          {drafts.filter(d => d.status === 'PENDING_REVIEW').length === 0 && !showAllDrafts ? (
            <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30 rounded-2xl p-8 text-center flex flex-col items-center">
              <MessageCircle className="w-12 h-12 text-emerald-400 mb-4" />
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Connect Your Field Team on WhatsApp</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md mx-auto mb-6">
                Tell your field workers to message the bot number below and send their <strong>NGO Join Code</strong> to register. After that, they can send photos and updates directly from WhatsApp!
              </p>
              <div className="flex flex-col sm:flex-row gap-3 items-center">
                <div className="bg-white dark:bg-gray-800 px-5 py-3 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm inline-flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-500">Bot Number:</span>
                  <span className="font-mono font-bold text-emerald-600 text-lg">{whatsappBotNumber}</span>
                </div>
                {joinCode && (
                  <div className="bg-white dark:bg-gray-800 px-5 py-3 rounded-xl border border-emerald-300 dark:border-emerald-700 shadow-sm inline-flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-500">Join Code:</span>
                    <span className="font-mono font-bold text-emerald-600 text-lg tracking-widest">{joinCode}</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-4">Workers save the bot number, message it, and send their join code once to register.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {(showAllDrafts ? drafts : drafts.filter(d => d.status === 'PENDING_REVIEW')).map((draft) => {
              const workerName = draft.fieldWorker?.name || draft.senderPhone;
              const trustScore = draft.fieldWorker?.reliabilityScore ?? 100;
              const trustColor = trustScore >= 90 ? "bg-emerald-100 text-emerald-700" : trustScore >= 70 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
              
              const isEnriching = draft.workerStatus === "ENRICHING" || draft.workerStatus === "PENDING";
              const isFailed = draft.workerStatus === "ENRICHMENT_FAILED";
              const isEnriched = draft.workerStatus === "ENRICHED";
              
              const isNewWorker = draft.fieldWorker ? (draft.fieldWorker.approvedCount + draft.fieldWorker.rejectedCount) < 3 : false;

              // Get milestone name
              let milestoneName = "Unknown Milestone";
              if (draft.predictedProjectId && draft.predictedMilestoneId) {
                const proj = profile.projects.find(p => p.id === draft.predictedProjectId);
                if (proj) {
                  const ms = proj.milestones.find(m => m.id === draft.predictedMilestoneId);
                  if (ms) milestoneName = ms.title;
                }
              }

              return (
                <div key={draft.id} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm hover:shadow-md transition flex flex-col">
                  
                  {/* HEADER ROW */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${getAvatarColorClass(workerName)}`}>
                        {getInitials(workerName)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-900 dark:text-white">{workerName}</span>
                          <span 
                            className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${trustColor}`}
                            title="Based on actioned submissions"
                          >
                            {isNewWorker ? "New" : `${trustScore}% trust`}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(draft.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    {draft.riskLevel && (
                      <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wide ${
                        draft.riskLevel === 'HIGH' ? 'bg-red-500 text-white' : 
                        draft.riskLevel === 'MEDIUM' ? 'bg-amber-500 text-white' :
                        'bg-emerald-500 text-white'
                      }`}>
                        {draft.riskLevel} Risk
                      </span>
                    )}
                  </div>

                  {/* AI PROCESSING STATE */}
                  {isEnriching && (
                    <div className="flex items-center gap-2 text-sm text-gray-500 italic mb-4">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      AI is analyzing...
                    </div>
                  )}
                  {isFailed && (
                    <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-900/20 p-2 rounded-lg mb-4">
                      <span className="text-xs text-amber-600">⚠️ AI analysis unavailable</span>
                      <button 
                        onClick={() => retryEnrichment(draft.id)}
                        className="text-xs font-bold text-amber-700 hover:text-amber-800 dark:text-amber-500 dark:hover:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-2.5 py-1 rounded-md transition"
                      >
                        Retry AI analysis
                      </button>
                    </div>
                  )}
                  {isEnriched && draft.aiSummary && (
                    <div className="mb-4">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 mb-1">AI Summary</div>
                      <div className="bg-emerald-50/50 dark:bg-emerald-900/10 p-3 rounded-xl text-sm italic text-gray-700 dark:text-gray-300 border-l-2 border-emerald-500">
                        {draft.aiSummary}
                      </div>
                    </div>
                  )}

                  {/* RAW MESSAGE */}
                  <div className="mb-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Field Report</div>
                    <blockquote className="border-l-2 border-gray-200 dark:border-gray-700 pl-3 py-1 text-sm text-gray-800 dark:text-gray-200 line-clamp-3 hover:line-clamp-none transition-all cursor-pointer">
                      "{draft.rawMessage}"
                    </blockquote>
                  </div>

                  {/* RISK REASON */}
                  {isEnriched && draft.riskReason && (draft.riskLevel === 'HIGH' || draft.riskLevel === 'MEDIUM') && (
                    <div className="mb-4 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 p-3 rounded-xl text-xs text-red-700 dark:text-red-400">
                      <strong>Risk Note:</strong> {draft.riskReason}
                    </div>
                  )}

                  {/* IMAGES */}
                  {draft.mediaUrls && draft.mediaUrls.length > 0 && (
                    <div className="mb-4 flex gap-2 overflow-x-auto pb-2 snap-x">
                      {draft.mediaUrls.map((url, i) => (
                        <img 
                          key={i} 
                          src={`/api/media-proxy?url=${encodeURIComponent(url)}`}
                          alt={`Field evidence ${i+1}`} 
                          className="h-24 w-auto rounded-lg object-cover border border-gray-200 dark:border-gray-700 snap-center shadow-sm" 
                        />
                      ))}
                    </div>
                  )}

                  {/* METADATA ROW */}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl mb-5 mt-auto">
                    <div className="flex items-center gap-1"><FileCheck className="w-3.5 h-3.5"/> {draft.photoCount} photos</div>
                    {draft.rawGpsLat !== null && draft.rawGpsLng !== null && (
                      <a href={`https://maps.google.com/?q=${draft.rawGpsLat},${draft.rawGpsLng}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-500 hover:underline">
                        <MapPin className="w-3.5 h-3.5"/> 📍 {draft.rawGpsLat.toFixed(4)}, {draft.rawGpsLng.toFixed(4)}
                      </a>
                    )}
                    {draft.predictionConfidence && (
                      <div className="flex items-center gap-1 ml-auto">
                        <span className="font-semibold text-emerald-600">{Math.round(draft.predictionConfidence * 100)}% match</span>
                        <span>→ {milestoneName}</span>
                      </div>
                    )}
                  </div>

                  {/* ACTION BUTTONS */}
                  {draft.status === 'PENDING_REVIEW' ? (
                    <div className="flex gap-2">
                      <button onClick={() => handleApprove(draft.id)} className="flex-1 bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 font-bold py-2.5 rounded-xl text-sm transition">
                        Approve
                      </button>
                      
                      {rejectingDraftId === draft.id ? (
                        <div className="flex-1 flex gap-2">
                          <input 
                            type="text" 
                            placeholder="Reason..." 
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            className="flex-1 text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2 dark:bg-gray-800"
                          />
                          <button onClick={() => handleReject(draft.id)} className="bg-red-500 hover:bg-red-600 text-white font-bold px-3 py-2.5 rounded-xl text-sm transition">
                            Confirm
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setRejectingDraftId(draft.id)} className="flex-1 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 font-bold py-2.5 rounded-xl text-sm transition">
                          Reject
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex gap-2 items-center">
                      <div className={`flex-1 text-center py-2.5 rounded-xl text-sm font-bold ${draft.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'}`}>
                        {draft.status}
                      </div>
                      <button
                        onClick={() => handleDelete(draft.id)}
                        title="Delete this update"
                        className="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 transition"
                      >
                        🗑️
                      </button>
                    </div>
                  )}
                  
                </div>
              );
            })}
            </div>
          )}
        </div>
      )}

      {/* Projects Section Header */}
      <div className="flex justify-between items-center border-b border-gray-150 dark:border-gray-800 pb-4">
        <div>
          <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white">Fundraising Campaigns</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage your active projects and submit milestone verification proofs.</p>
        </div>
        <Link
          href="/ngo/projects/new"
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-5 rounded-xl shadow-md transition text-sm flex items-center gap-1"
        >
          <span>+</span> Launch New Project
        </Link>
      </div>

      {/* 3. Empty State or Projects List */}
      {projects.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-12 text-center max-w-xl mx-auto shadow-sm space-y-6">
          <div className="w-20 h-20 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto">
            <Briefcase className="w-10 h-10" />
          </div>
          <div>
            <h3 className="text-xl font-extrabold text-gray-900 dark:text-white mb-2">Launch your first project</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
              Define transparent milestones, track donations in real-time, and build credibility with donors worldwide.
            </p>
          </div>
          <Link
            href="/ngo/projects/new"
            className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:shadow-emerald-600/10 transition text-sm"
          >
            <span>+</span> Launch New Project
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {projects.map((project) => {
            const isExpanded = expandedProjectId === project.id;
            const raised = Number(project.raisedAmount);
            const target = Number(project.targetAmount);
            const percent = target > 0 ? Math.min(100, Math.round((raised / target) * 100)) : 0;
            return (
              <div
                key={project.id}
                onClick={() => toggleExpandProject(project.id)}
                className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm hover:shadow-md hover:border-emerald-500/30 hover:translate-y-[-2px] transition-all duration-200 flex flex-col cursor-pointer"
              >
                <div className="flex flex-col md:flex-row w-full">
                  {/* Responsive cover image */}
                <div className="relative md:w-64 w-full h-48 md:h-auto overflow-hidden shrink-0">
                  <ProjectCoverImage
                    src={project.coverImage}
                    alt={project.title}
                    causeCategory={project.causeCategory}
                    className="w-full h-full object-cover object-center"
                  />
                  {/* Subtle dark gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                  
                  {/* Cause category badge overlay */}
                  <div className="absolute top-3 left-3">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-emerald-400 border border-emerald-500/20">
                      {project.causeCategory}
                    </span>
                  </div>
                </div>

                {/* Card Content body */}
                <div className="p-6 flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-1.5">
                    <h4 className="text-lg font-black text-gray-900 dark:text-white line-clamp-1">
                      {project.title}
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                      {project.description}
                    </p>
                  </div>

                  {/* Funding progress bar */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs font-bold">
                      <span className="text-gray-500 dark:text-gray-400">
                        Raised: <strong className="text-gray-900 dark:text-white font-extrabold">₹{raised.toLocaleString()}</strong> of ₹{target.toLocaleString()}
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">{percent}% funded</span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-800 h-2.5 rounded-full overflow-hidden">
                      <div className="bg-gradient-to-r from-emerald-500 to-teal-500 h-full rounded-full transition-all duration-500" style={{ width: `${percent}%` }}></div>
                    </div>
                  </div>

                  {/* Reorganized row below progress bar */}
                  <div className="flex justify-between items-center pt-1">
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-1 font-medium">
                        <MapPin className="w-3.5 h-3.5 text-gray-400" />
                        {project.location}
                      </span>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                        project.status === "ACTIVE" 
                          ? "bg-blue-500/10 text-blue-400 border-blue-500/25" 
                          : "bg-gray-500/10 text-gray-400 border-gray-500/25"
                      }`}>
                        {project.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* Dropdown Menu Toggle */}
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(openMenuId === project.id ? null : project.id);
                          }}
                          className="p-2 text-gray-400 hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl transition flex items-center justify-center"
                          title="More Options"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        
                        {openMenuId === project.id && (
                          <div 
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-lg z-20 py-1 text-left"
                          >
                            <button
                              onClick={() => {
                                setOpenMenuId(null);
                                toggleExpandProject(project.id);
                              }}
                              className="w-full px-4 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2"
                            >
                              <FileCheck className="w-3.5 h-3.5" />
                              {isExpanded ? "Collapse Milestones" : "View Milestones"}
                            </button>
                            <button
                              onClick={() => {
                                setOpenMenuId(null);
                                setSharingProject(project);
                              }}
                              className="w-full px-4 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                              Share Campaign
                            </button>
                            <Link
                              href={`/ngo/projects/${project.id}/edit`}
                              className="w-full px-4 py-2 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit Project
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

                {/* Collapsible Milestones list */}
                {isExpanded && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="p-6 pt-5 border-t border-gray-150 dark:border-gray-850 bg-gray-50/50 dark:bg-gray-800/20 space-y-4 cursor-default"
                  >
                      <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                        <FileCheck className="w-4 h-4" />
                        Milestones Roadmap
                      </h5>
                      
                      {project.milestones.length === 0 ? (
                        <p className="text-xs text-gray-500">No milestones defined for this campaign.</p>
                      ) : (
                        <div className="relative border-l border-gray-200 dark:border-gray-800 ml-4 space-y-6 pb-2">
                          {project.milestones.map((milestone, idx) => {
                            const isCompleted = milestone.status === "COMPLETED" || milestone.status === "VERIFIED";
                            const isPendingReview = milestone.status === "PROOF_SUBMITTED";
                            const canSubmit = (project.status === "ACTIVE") && (milestone.status === "PENDING" || milestone.status === "IN_PROGRESS");
                            return (
                              <div key={milestone.id} className="relative pl-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                <span className={`absolute -left-[13px] top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-extrabold border ${
                                  isCompleted
                                    ? "bg-emerald-600 border-emerald-600 text-white"
                                    : isPendingReview
                                    ? "bg-amber-500 border-amber-500 text-white animate-pulse"
                                    : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-400"
                                }`}>
                                  {idx + 1}
                                </span>
                                
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h6 className="text-xs font-extrabold text-gray-900 dark:text-white">{milestone.title}</h6>
                                    <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                      isCompleted
                                        ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/25"
                                        : isPendingReview
                                        ? "bg-amber-500/10 text-amber-500 border border-amber-500/25"
                                        : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-750"
                                    }`}>
                                      {milestone.status}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400 max-w-xl">{milestone.description}</p>
                                  <div className="text-[9px] text-gray-400 font-bold">
                                    Allocation: ₹{Number(milestone.targetAmount).toLocaleString()} • Deadline: {new Date(milestone.deadline).toLocaleDateString("en-IN")}
                                  </div>
                                </div>

                                {canSubmit && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveMilestone({ id: milestone.id, title: milestone.title });
                                    }}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 rounded-lg text-[10px] shadow-sm transition flex-shrink-0"
                                  >
                                    Submit Proof
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
              </div>
            );
          })}
        </div>
      )}

      {/* 4. Edit Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center p-6 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-lg font-black text-gray-900 dark:text-white">Organization Settings</h3>
              <button 
                onClick={() => {
                  setIsSettingsOpen(false);
                  setSettingsError("");
                  setEditLogoFile(null);
                }}
                className="p-1 text-gray-450 hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSettingsSubmit} className="p-6 space-y-6">
              {settingsError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/30 border-l-4 border-red-500 rounded text-xs text-red-700 dark:text-red-300">
                  {settingsError}
                </div>
              )}
              
              {/* Logo upload field */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Organization Logo</label>
                <div className="flex items-center gap-4">
                  <div className="shrink-0">
                    {editLogoPreview ? (
                      <img
                        src={editLogoPreview}
                        alt="Logo Preview"
                        className="w-16 h-16 rounded-full object-cover border border-gray-200 dark:border-gray-850"
                      />
                    ) : (
                      <div className={`w-16 h-16 rounded-full flex items-center justify-center font-black text-2xl border ${getAvatarColorClass(ngoProfile.orgName)}`}>
                        {getInitials(ngoProfile.orgName)}
                      </div>
                    )}
                  </div>
                  
                  <label className="flex items-center gap-1.5 px-4 py-2 border border-dashed border-gray-300 dark:border-gray-700 hover:border-emerald-500 dark:hover:border-emerald-500 rounded-xl cursor-pointer text-xs font-bold text-gray-500 hover:text-emerald-500 transition">
                    <Upload className="w-4 h-4" />
                    Upload Logo
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoChange}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
              
              {/* Description field */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">About / Tagline</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition resize-none text-sm"
                  placeholder="Describe your organization's mission..."
                  required
                />
              </div>
              
              {/* Website field */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Website URL</label>
                <input
                  type="url"
                  value={editWebsite}
                  onChange={(e) => setEditWebsite(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition text-sm"
                  placeholder="e.g. https://yourorg.org"
                />
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsOpen(false);
                    setSettingsError("");
                    setEditLogoFile(null);
                  }}
                  className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 dark:hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingSettings}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-5 rounded-xl text-xs shadow-md transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSavingSettings ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                      Saving...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Proof Upload and Share Modals */}
      {activeMilestone && (
        <SubmitProofModal
          milestoneId={activeMilestone.id}
          milestoneTitle={activeMilestone.title}
          onClose={() => setActiveMilestone(null)}
          onSuccess={handleSuccess}
        />
      )}

      {sharingProject && (
        <ShareProjectModal
          isOpen={!!sharingProject}
          onClose={() => setSharingProject(null)}
          projectId={sharingProject.id}
          projectTitle={sharingProject.title}
          targetAmount={sharingProject.targetAmount}
          causeCategory={sharingProject.causeCategory}
          location={sharingProject.location}
        />
      )}
    </div>
  );
}
