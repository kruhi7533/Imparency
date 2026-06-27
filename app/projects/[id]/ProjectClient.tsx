"use client";

import React, { useState } from "react";
import DonateModal from "@/app/components/DonateModal";
import { useSession } from "next-auth/react";

interface ProjectClientProps {
  projectId: string;
  projectTitle: string;
  ngoName: string;
}

export default function ProjectClient({ projectId, projectTitle, ngoName }: ProjectClientProps) {
  const { data: session } = useSession();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleDonateClick = () => {
    if (!session?.user) {
      alert("Please login as a donor to donate to this campaign");
      window.location.href = `/login?callbackUrl=/projects/${projectId}`;
      return;
    }
    if (session.user.role !== "DONOR") {
      alert("Only donors can make payments on projects.");
      return;
    }
    setIsModalOpen(true);
  };

  return (
    <>
      {/* Desktop button inline */}
      <div className="hidden lg:block">
        <button
          onClick={handleDonateClick}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3.5 px-6 rounded-2xl shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 hover:-translate-y-0.5 active:translate-y-0 transition duration-150 text-sm"
        >
          Donate to Campaign
        </button>
      </div>

      {/* Mobile/Tablet sticky bottom bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 p-4 z-40 shadow-[0_-8px_30px_rgb(0,0,0,0.06)] flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Campaign</span>
          <span className="text-xs font-bold text-gray-800 dark:text-gray-200 line-clamp-1 max-w-[180px]">{projectTitle}</span>
        </div>
        <button
          onClick={handleDonateClick}
          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3 px-6 rounded-xl shadow-md active:scale-[0.98] transition text-xs text-center"
        >
          Donate Now
        </button>
      </div>

      {isModalOpen && (
        <DonateModal
          projectId={projectId}
          projectTitle={projectTitle}
          ngoName={ngoName}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  );
}
