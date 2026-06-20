"use client";

import React, { useState, useEffect } from "react";

interface ShareProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectTitle: string;
  targetAmount: number | string;
  causeCategory: string;
  location: string;
}

export default function ShareProjectModal({
  isOpen,
  onClose,
  projectId,
  projectTitle,
  targetAmount,
  causeCategory,
  location,
}: ShareProjectModalProps) {
  const [copied, setCopied] = useState(false);
  const [projectUrl, setProjectUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setProjectUrl(`${window.location.origin}/projects/${projectId}`);
    }
  }, [projectId]);

  if (!isOpen) return null;

  const targetVal = typeof targetAmount === "number" ? targetAmount : parseFloat(targetAmount) || 0;
  const formattedTarget = targetVal.toLocaleString("en-IN");

  // Dynamic share text generations
  const fullShareText = `We just launched "${projectTitle}" on ImpactBridge! Help us reach our goal of ₹${formattedTarget} for ${causeCategory} in ${location}. Every rupee is tracked and verified. Support us here: ${projectUrl}`;
  
  // Twitter limit handling
  const twitterShareText = fullShareText.length <= 280 
    ? fullShareText 
    : `"${projectTitle}" is live on ImpactBridge — help us reach ₹${formattedTarget} for ${location}. ${projectUrl}`;

  // URLs for sharing
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(fullShareText)}`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(twitterShareText)}`;
  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(projectUrl)}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(projectUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const handleShareClick = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-fade-in backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative space-y-6 text-center text-white">
        
        {/* Banner Poppers */}
        <div className="flex flex-col items-center space-y-2">
          <div className="w-14 h-14 bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 rounded-full flex items-center justify-center text-2xl animate-bounce">
            🎉
          </div>
          <h3 className="text-xl font-black tracking-tight text-white mt-2">
            Your project is live!
          </h3>
          <p className="text-xs text-gray-400 max-w-sm">
            Spread the word and invite supporters to trace and verify every contribution in real-time.
          </p>
        </div>

        {/* Link Copy Box */}
        <div className="space-y-1.5 text-left">
          <label className="text-[10px] font-bold text-gray-450 uppercase tracking-wider block">
            Public Campaign Link
          </label>
          <div className="flex items-center gap-2 bg-gray-950 border border-gray-800 rounded-xl p-1.5">
            <input
              type="text"
              readOnly
              value={projectUrl}
              className="bg-transparent text-xs font-semibold text-gray-300 px-2 flex-grow outline-none select-all"
            />
            <button
              onClick={handleCopyLink}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 shrink-0 ${
                copied 
                  ? "bg-emerald-600/20 border border-emerald-500/30 text-emerald-400" 
                  : "bg-emerald-600 hover:bg-emerald-700 text-white"
              }`}
            >
              {copied ? "Copied!" : "Copy Link"}
            </button>
          </div>
        </div>

        {/* Sharing Intent Buttons */}
        <div className="space-y-3">
          <span className="text-[10px] font-bold text-gray-450 uppercase tracking-wider block text-left">
            Share to Social Channels
          </span>
          <div className="grid grid-cols-1 gap-2.5">
            {/* WhatsApp */}
            <button
              onClick={() => handleShareClick(whatsappUrl)}
              className="w-full flex items-center justify-center gap-2.5 bg-emerald-600/10 hover:bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 font-bold py-2.5 px-4 rounded-xl text-xs transition duration-150"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.458 5.704 1.46h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              <span>Share to WhatsApp</span>
            </button>

            {/* Twitter/X */}
            <button
              onClick={() => handleShareClick(twitterUrl)}
              className="w-full flex items-center justify-center gap-2.5 bg-gray-800 hover:bg-gray-700/80 border border-gray-700/60 text-gray-250 font-bold py-2.5 px-4 rounded-xl text-xs transition duration-150"
            >
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span>Post to Twitter / X</span>
            </button>

            {/* LinkedIn */}
            <div className="space-y-1">
              <button
                onClick={() => handleShareClick(linkedinUrl)}
                className="w-full flex items-center justify-center gap-2.5 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/30 text-blue-400 font-bold py-2.5 px-4 rounded-xl text-xs transition duration-150"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.779-1.75-1.75s.784-1.75 1.75-1.75 1.75.779 1.75 1.75-.784 1.75-1.75 1.75zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                </svg>
                <span>Share on LinkedIn</span>
              </button>
              <p className="text-[9px] text-gray-500 text-center font-medium italic mt-1">
                LinkedIn will open with the link — add your own caption there.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-gray-800 pt-4 flex justify-center">
          <button
            onClick={onClose}
            className="px-6 py-2 border border-gray-800 text-gray-400 hover:text-white rounded-xl text-xs font-bold hover:bg-gray-800 transition"
          >
            Go to Dashboard
          </button>
        </div>

      </div>
    </div>
  );
}
