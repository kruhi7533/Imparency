"use client";

import React, { useState, useEffect } from "react";

export interface Milestone {
  id: string;
  title: string;
  description: string;
  targetAmount: number;
  deadline: Date | string;
  status: string;
  sequenceOrder: number;
}

interface DonateModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: {
    id: string;
    title: string;
    targetAmount: number;
    raisedAmount: number;
    milestones: Milestone[];
  };
  ngoName: string;
  ngoId: string;
  donorCategory: string; // passed from parent after declaration
}

export function DonateModal({
  isOpen,
  onClose,
  project,
  ngoName,
  ngoId,
  donorCategory,
}: DonateModalProps) {
  const [fcraStatus, setFcraStatus] = useState<string | null>(null);
  const [fcraLoading, setFcraLoading] = useState(true);
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const [selectedMilestoneIds, setSelectedMilestoneIds] = useState<string[]>([]);
  const [donationMode, setDonationMode] = useState<"project" | "milestone">(
    "project"
  );

  useEffect(() => {
    if (!isOpen) return;
    setFcraLoading(true);
    fetch(`/api/ngo/${ngoId}/fcra-status`)
      .then((r) => r.json())
      .then((data) => {
        setFcraStatus(data.fcraStatus);
      })
      .catch(() => setFcraStatus("NOT_REGISTERED"))
      .finally(() => setFcraLoading(false));
  }, [isOpen, ngoId]);

  // Compute suggested amount based on selection
  const suggestedAmount = React.useMemo(() => {
    if (donationMode === "project" || selectedMilestoneIds.length === 0) {
      return null; // no suggestion for whole-project mode
    }
    const selectedMilestones = project.milestones.filter((m) =>
      selectedMilestoneIds.includes(m.id)
    );
    return selectedMilestones.reduce(
      (sum, m) => sum + Number(m.targetAmount), 0
    );
  }, [selectedMilestoneIds, donationMode, project.milestones]);

  // When suggestedAmount changes, pre-fill the amount field
  useEffect(() => {
    if (suggestedAmount !== null) {
      setAmount(suggestedAmount);
      setCustomAmount(suggestedAmount.toString());
      setShowCustom(true); // switch to custom input to show the pre-filled value
    }
  }, [suggestedAmount]);

  if (!isOpen) return null;

  const isInternationalDonor =
    donorCategory === "NRI_OCI" || donorCategory === "FOREIGN_NATIONAL";
  const isFCRABlocked =
    isInternationalDonor && fcraStatus !== "ACTIVE";

  const effectiveAmount = showCustom
    ? parseInt(customAmount, 10)
    : amount;

  const toggleMilestone = (milestoneId: string) => {
    setSelectedMilestoneIds((prev) =>
      prev.includes(milestoneId)
        ? prev.filter((id) => id !== milestoneId)
        : [...prev, milestoneId]
    );
  };

  const donatableMilestones = project.milestones.filter(
    (m) => m.status === "PENDING" || m.status === "IN_PROGRESS"
  );
  const lockedMilestones = project.milestones.filter(
    (m) => !["PENDING", "IN_PROGRESS"].includes(m.status)
  );

  const handleProceedToPayment = () => {
    if (!effectiveAmount || isFCRABlocked) return;

    const payload = {
      projectId: project.id,
      amount: effectiveAmount,
      milestoneIds: donationMode === "milestone" ? selectedMilestoneIds : [],
      donorCategory,
    };

    // TODO B3: Replace with actual Razorpay order creation
    console.log("Proceeding to payment:", payload);
    alert(
      `Payment flow coming soon.\n\nAmount: Rs.${effectiveAmount}\n` +
      (payload.milestoneIds.length > 0
        ? `Earmarked for ${payload.milestoneIds.length} milestone(s)`
        : "Donated to entire project")
    );
  };

  const isPayDisabled =
    isFCRABlocked ||
    fcraLoading ||
    !effectiveAmount ||
    (donationMode === "milestone" && selectedMilestoneIds.length === 0);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center animate-fadeIn"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-800 rounded-2xl max-w-lg w-full mx-4 p-6 shadow-2xl space-y-5 text-left"
      >
        {/* Header row */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-black text-white">{project.title}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{ngoName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-600 hover:text-white transition cursor-pointer hover:bg-gray-800 p-1.5 rounded-lg"
          >
            {/* X SVG */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress bar (target vs raised) */}
        <div>
          <div className="flex justify-between text-[10px] text-gray-500 mb-1">
            <span>Rs.{project.raisedAmount.toLocaleString("en-IN")} raised</span>
            <span>Goal: Rs.{project.targetAmount.toLocaleString("en-IN")}</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full"
              style={{
                width: `${Math.min(100, (project.raisedAmount / project.targetAmount) * 100)}%`,
              }}
            />
          </div>
        </div>

        {/* FCRA block banner — only shown when isFCRABlocked */}
        {!fcraLoading && isFCRABlocked && (
          <div className="p-4 rounded-xl bg-red-950/30 border border-red-800/60 animate-fadeIn">
            <div className="flex items-start gap-3">
              <span className="text-red-400 mt-0.5 flex-shrink-0">
                {/* Warning SVG — 20x20 */}
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
              <div>
                <p className="text-sm font-bold text-red-300">
                  Foreign contributions not accepted
                </p>
                <p className="text-xs text-red-400/80 mt-1 leading-relaxed">
                  This NGO's FCRA registration is{" "}
                  {fcraStatus === "EXPIRED" ? "expired" : "not active"}.
                  It cannot currently accept donations from NRIs or foreign nationals under Indian law.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Donation Mode Toggle */}
        {project.milestones.length > 0 && (
          <div>
            {/* Mode switcher tabs */}
            <div className="flex gap-2 mb-4 p-1 bg-gray-800 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setDonationMode("project");
                  setSelectedMilestoneIds([]);
                }}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  donationMode === "project"
                    ? "bg-gray-700 text-white shadow"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                Donate to Project
              </button>
              <button
                type="button"
                onClick={() => setDonationMode("milestone")}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  donationMode === "milestone"
                    ? "bg-gray-700 text-white shadow"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                Choose Milestones
              </button>
            </div>

            {/* Milestone list — only shown in milestone mode */}
            {donationMode === "milestone" && (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                {/* Donatable milestones */}
                {donatableMilestones.map((milestone) => {
                  const isSelected = selectedMilestoneIds.includes(milestone.id);
                  const deadlineDate = new Date(milestone.deadline);
                  const isOverdue = deadlineDate < new Date();

                  return (
                    <button
                      key={milestone.id}
                      type="button"
                      onClick={() => toggleMilestone(milestone.id)}
                      className={`
                        w-full text-left p-3.5 rounded-xl border-2 transition-all
                        duration-150 relative cursor-pointer
                        ${isSelected
                          ? "border-emerald-500 bg-emerald-950/30"
                          : "border-gray-800 bg-gray-900/50 hover:border-gray-700"
                        }
                      `}
                    >
                      {/* Checkbox indicator */}
                      <div className={`
                        absolute top-3.5 right-3.5 w-4 h-4 rounded border-2
                        flex items-center justify-center flex-shrink-0
                        transition-all duration-150
                        ${isSelected
                          ? "bg-emerald-500 border-emerald-500"
                          : "border-gray-600"
                        }
                      `}>
                        {isSelected && (
                          <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                            <path
                              d="M2 6l3 3 5-5"
                              stroke="white"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </div>

                      {/* Milestone content */}
                      <div className="pr-6">
                        {/* Sequence + title */}
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-black px-1.5 py-0.5
                            rounded-md ${isSelected
                              ? "bg-emerald-500/20 text-emerald-400"
                              : "bg-gray-800 text-gray-500"
                            }`}>
                            #{milestone.sequenceOrder}
                          </span>
                          <span className={`text-xs font-bold ${
                            isSelected ? "text-white" : "text-gray-300"
                          }`}>
                            {milestone.title}
                          </span>
                        </div>

                        {/* Description */}
                        <p className="text-[11px] text-gray-500 leading-snug line-clamp-2 mb-2">
                          {milestone.description}
                        </p>

                        {/* Amount + deadline row */}
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-extrabold ${
                            isSelected ? "text-emerald-400" : "text-gray-400"
                          }`}>
                            Rs.{Number(milestone.targetAmount).toLocaleString("en-IN")}
                          </span>
                          <span className={`text-[10px] ${
                            isOverdue ? "text-red-400" : "text-gray-600"
                          }`}>
                            Due {deadlineDate.toLocaleDateString("en-IN", {
                              day: "numeric", month: "short", year: "numeric"
                            })}
                            {isOverdue && " (overdue)"}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* Locked milestones — greyed out, not selectable */}
                {lockedMilestones.map((milestone) => (
                  <div
                    key={milestone.id}
                    className="w-full p-3.5 rounded-xl border border-gray-800/50 bg-gray-900/20 opacity-50 cursor-not-allowed"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md bg-gray-800 text-gray-600">
                          #{milestone.sequenceOrder}
                        </span>
                        <span className="text-xs font-bold text-gray-500">
                          {milestone.title}
                        </span>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        milestone.status === "COMPLETED" || milestone.status === "VERIFIED"
                          ? "bg-emerald-950/30 text-emerald-600"
                          : "bg-amber-950/30 text-amber-600"
                      }`}>
                        {milestone.status === "COMPLETED" ? "✓ Funded"
                          : milestone.status === "VERIFIED" ? "✓ Verified"
                          : milestone.status === "PROOF_SUBMITTED" ? "Under review"
                          : milestone.status}
                      </span>
                    </div>
                  </div>
                ))}

                {/* Selection summary */}
                {selectedMilestoneIds.length > 0 && (
                  <div className="mt-1 pt-2 border-t border-gray-800 flex items-center justify-between">
                    <span className="text-[11px] text-gray-500">
                      {selectedMilestoneIds.length} milestone{selectedMilestoneIds.length > 1 ? "s" : ""} selected
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedMilestoneIds([])}
                      className="text-[11px] text-gray-600 hover:text-gray-400 underline underline-offset-2 transition cursor-pointer bg-transparent border-0"
                    >
                      Clear selection
                    </button>
                  </div>
                )}

                {/* Empty state */}
                {donatableMilestones.length === 0 && (
                  <div className="text-center py-6 text-gray-600 text-xs">
                    All milestones for this project are fully funded or under review. Donate to the project instead.
                  </div>
                )}
              </div>
            )}

            {/* Mode helper text */}
            <p className="text-[10px] text-gray-600 mt-2 leading-relaxed">
              {donationMode === "project"
                ? "Your donation will be distributed across all active milestones by the NGO."
                : selectedMilestoneIds.length === 0
                ? "Select one or more milestones to earmark your donation."
                : `Your donation will be tracked against the ${
                    selectedMilestoneIds.length
                  } selected milestone${selectedMilestoneIds.length > 1 ? "s" : ""}.`
              }
            </p>
          </div>
        )}

        {/* Amount selector (disabled when isFCRABlocked) */}
        <div className={`space-y-4 ${isFCRABlocked ? "opacity-40 pointer-events-none" : ""}`}>
          <div className="flex flex-wrap justify-center gap-3">
            {[500, 1000, 5000, 10000].map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => {
                  setAmount(amt);
                  setShowCustom(false);
                  setCustomAmount("");
                }}
                className={`
                  px-6 py-3 rounded-2xl text-sm font-black transition-all duration-150
                  border-2 min-w-[100px] cursor-pointer
                  ${amount === amt && !showCustom
                    ? "bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-500/20 scale-105"
                    : "bg-gray-900/60 border-gray-800 text-gray-300 hover:border-emerald-700 hover:text-white hover:bg-gray-900"
                  }
                `}
              >
                ₹{amt.toLocaleString("en-IN")}
              </button>
            ))}

            {/* Custom Amount button */}
            <button
              type="button"
              onClick={() => {
                setShowCustom(true);
                setAmount(null);
              }}
              className={`
                px-6 py-3 rounded-2xl text-sm font-black transition-all duration-150
                border-2 min-w-[140px] cursor-pointer
                ${showCustom
                  ? "bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-500/20 scale-105"
                  : "bg-gray-900/60 border-gray-800 text-gray-300 hover:border-emerald-700 hover:text-white hover:bg-gray-900"
                }
              `}
            >
              Custom Amount
            </button>
          </div>

          {showCustom && (
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="text-white font-bold text-lg">₹</span>
              <input
                type="number"
                min="100"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="Enter amount"
                autoFocus
                className="
                  w-40 px-4 py-3 bg-gray-900 border-2 border-emerald-600
                  rounded-2xl text-white font-bold text-center text-sm
                  focus:outline-none focus:ring-2 focus:ring-emerald-500
                  placeholder-gray-600
                  [appearance:textfield]
                  [&::-webkit-outer-spin-button]:appearance-none
                  [&::-webkit-inner-spin-button]:appearance-none
                "
              />
            </div>
          )}
        </div>

        {/* Pay button */}
        <button
          type="button"
          disabled={isPayDisabled}
          onClick={handleProceedToPayment}
          className={`
            w-full py-3.5 rounded-xl text-sm font-extrabold transition-all cursor-pointer
            ${isPayDisabled
              ? "bg-gray-800 text-gray-600 cursor-not-allowed border border-gray-850"
              : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/10"
            }
          `}
        >
          {fcraLoading
            ? "Checking eligibility..."
            : isFCRABlocked
            ? "Donation not available"
            : donationMode === "milestone" && selectedMilestoneIds.length === 0
            ? "Select milestones to continue"
            : effectiveAmount
            ? `Donate Rs.${effectiveAmount.toLocaleString("en-IN")} →`
            : "Select an amount"
          }
        </button>
      </div>
    </div>
  );
}
