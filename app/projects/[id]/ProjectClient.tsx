"use client";

import React, { useState } from "react";
import DonateModal from "@/app/components/DonateModal";
import { useSession } from "next-auth/react";

interface ProjectClientProps {
  projectId: string;
  projectTitle: string;
}

export default function ProjectClient({ projectId, projectTitle }: ProjectClientProps) {
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
      <button
        onClick={handleDonateClick}
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3.5 px-6 rounded-2xl shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 hover:-translate-y-0.5 active:translate-y-0 transition duration-150 text-sm"
      >
        Donate to Campaign
      </button>

      {isModalOpen && (
        <DonateModal
          projectId={projectId}
          projectTitle={projectTitle}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  );
}
