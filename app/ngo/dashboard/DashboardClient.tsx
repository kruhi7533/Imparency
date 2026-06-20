"use client";

import React, { useState } from "react";
import Link from "next/link";
import SubmitProofModal from "./SubmitProofModal";
import ShareProjectModal from "@/app/components/ShareProjectModal";

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

interface DashboardClientProps {
  initialProjects: Project[];
}

export default function DashboardClient({ initialProjects }: DashboardClientProps) {
  const [projects] = useState<Project[]>(initialProjects);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [activeMilestone, setActiveMilestone] = useState<{ id: string; title: string } | null>(null);
  const [sharingProject, setSharingProject] = useState<Project | null>(null);

  const toggleExpandProject = (projectId: string) => {
    setExpandedProjectId((prev) => (prev === projectId ? null : projectId));
  };

  const handleSuccess = () => {
    window.location.reload();
  };

  return (
    <div className="space-y-8">
      {projects.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-12 text-center max-w-xl mx-auto shadow-sm">
          <span className="text-4xl mb-4 block">📦</span>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">No active campaigns</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            You haven't launched any fundraising campaigns yet. Launch your first project to define milestones and collect verified donations.
          </p>
          <Link
            href="/ngo/projects/new"
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-5 rounded-xl shadow-md transition text-sm"
          >
            Create Project
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
                className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition duration-200"
              >
                {/* Project Overview Bar */}
                <div 
                  className="p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 cursor-pointer" 
                  onClick={() => toggleExpandProject(project.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 rounded-xl overflow-hidden flex-shrink-0">
                      {project.coverImage ? (
                        <img src={project.coverImage} alt={project.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center font-bold">🏫</div>
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase text-emerald-600 tracking-wider">
                        {project.causeCategory}
                      </span>
                      <h4 className="text-base font-extrabold text-gray-900 dark:text-white mt-0.5">
                        {project.title}
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        📍 {project.location} • Status: <span className="font-bold">{project.status}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 w-full md:w-auto justify-between md:justify-end">
                    <div className="text-right text-xs font-semibold text-gray-650 dark:text-gray-400">
                      <div>Raised: <strong>₹{raised.toLocaleString()}</strong> of ₹{target.toLocaleString()}</div>
                      <div className="w-28 bg-gray-100 dark:bg-gray-800 h-1.5 rounded-full overflow-hidden mt-1 ml-auto">
                        <div className="bg-emerald-600 h-full rounded-full" style={{ width: `${percent}%` }}></div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSharingProject(project);
                      }}
                      className="p-2 text-gray-400 hover:text-emerald-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
                      title="Share Campaign"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
                      </svg>
                    </button>
                    <span 
                      className="text-gray-400 text-lg transition-transform duration-200" 
                      style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                    >
                      ▼
                    </span>
                  </div>
                </div>

                {/* Collapsible Milestones */}
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50/30 dark:bg-gray-900/10 p-6 space-y-6">
                    <div>
                      <h5 className="text-xs font-bold text-gray-405 uppercase tracking-wider mb-4">Milestones Sequence</h5>
                      
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
                                    ? "bg-amber-500 border-amber-500 text-white"
                                    : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-400"
                                }`}>
                                  {idx + 1}
                                </span>
                                
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h6 className="text-xs font-extrabold text-gray-900 dark:text-white">{milestone.title}</h6>
                                    <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                      isCompleted
                                        ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                                        : isPendingReview
                                        ? "bg-amber-50 text-amber-700 border border-amber-100"
                                        : "bg-gray-100 text-gray-500 border border-gray-200"
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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
