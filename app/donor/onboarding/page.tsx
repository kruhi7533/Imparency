"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  User,
  Users,
  Briefcase,
  Landmark,
  GraduationCap,
  Heart,
  Leaf,
  Smile,
  Globe,
  Baby,
  ShieldAlert,
  ArrowRight,
  ArrowLeft,
  Receipt,
  FileCheck,
  Handshake,
} from "lucide-react";

// Q1 options
interface PersonaOption {
  id: "individual" | "hni" | "csr" | "foundation";
  label: string;
  description: string;
  icon: React.ComponentType<any>;
}

const personaOptions: PersonaOption[] = [
  {
    id: "individual",
    label: "Individual / Personal",
    description: "I donate with my own funds for personal impact and tax benefits",
    icon: User,
  },
  {
    id: "hni",
    label: "High Net-worth Individual (HNI)",
    description: "I make significant personal donations and want detailed impact visibility",
    icon: Users,
  },
  {
    id: "csr",
    label: "CSR / Corporate",
    description: "I manage corporate social responsibility funds and need compliance reports",
    icon: Briefcase,
  },
  {
    id: "foundation",
    label: "Foundation / Trust",
    description: "I represent a charitable foundation or trust looking for grant opportunities",
    icon: Landmark,
  },
];

// Q2 options
interface CauseOption {
  id: string;
  label: string;
  icon: React.ComponentType<any>;
}

const causeOptions: CauseOption[] = [
  { id: "Education", label: "Education", icon: GraduationCap },
  { id: "Healthcare", label: "Healthcare", icon: Heart },
  { id: "Environment", label: "Environment", icon: Leaf },
  { id: "Women Empowerment", label: "Women Empowerment", icon: Smile },
  { id: "Rural Development", label: "Rural Development", icon: Globe },
  { id: "Child Welfare", label: "Child Welfare", icon: Baby },
  { id: "Disaster Relief", label: "Disaster Relief", icon: ShieldAlert },
  { id: "Animal Welfare", label: "Animal Welfare", icon: Heart }, // Fallback to Heart
];

// Q3 options
interface MotivationOption {
  id: string;
  label: string;
  icon: React.ComponentType<any>;
}

const motivationOptions: MotivationOption[] = [
  { id: "Tax savings (80G deduction)", label: "Tax savings (80G deduction)", icon: Receipt },
  { id: "Genuine social impact", label: "Genuine social impact", icon: Heart },
  { id: "CSR compliance / audit requirement", label: "CSR compliance / audit requirement", icon: FileCheck },
  { id: "Building long-term NGO partnerships", label: "Building long-term NGO partnerships", icon: Handshake },
];

export default function OnboardingPage() {
  const router = useRouter();
  
  // Wizard state
  const [step, setStep] = useState<number>(1);
  const [selectedPersona, setSelectedPersona] = useState<PersonaOption["id"] | null>(null);
  const [selectedCauses, setSelectedCauses] = useState<string[]>([]);
  const [selectedMotivation, setSelectedMotivation] = useState<string | null>(null);
  
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // Handle cause selection (multi-select, max 3)
  const handleToggleCause = (causeId: string) => {
    if (selectedCauses.includes(causeId)) {
      setSelectedCauses(selectedCauses.filter((id) => id !== causeId));
    } else {
      if (selectedCauses.length < 3) {
        setSelectedCauses([...selectedCauses, causeId]);
      }
    }
  };

  const handleNext = () => {
    if (step === 1 && !selectedPersona) return;
    if (step === 2 && selectedCauses.length === 0) return;
    setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleSubmit = async () => {
    if (!selectedPersona || selectedCauses.length === 0 || !selectedMotivation) {
      setError("Please complete all questions before submitting.");
      return;
    }

    setLoading(true);
    setError("");

    // Map Q1 answer to DonorPersona enum
    // individual -> HNI, hni -> HNI, csr -> CSR_OFFICER, foundation -> FOUNDATION
    let mappedPersona = "HNI";
    if (selectedPersona === "csr") {
      mappedPersona = "CSR_OFFICER";
    } else if (selectedPersona === "foundation") {
      mappedPersona = "FOUNDATION";
    }

    try {
      const res = await fetch("/api/donor/persona", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ persona: mappedPersona }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save persona profile.");
      }

      router.push("/discover");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col justify-between p-6 sm:p-12 font-sans relative overflow-hidden">
      {/* Background radial glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-emerald-500/5 rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Header */}
      <header className="flex justify-between items-center max-w-4xl w-full mx-auto mb-8">
        <Link href="/" className="text-2xl font-black bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent tracking-tight">
          Imparency
        </Link>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-32 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300 ease-out"
              style={{ width: `${(step / 3) * 100}%` }}
            />
          </div>
          <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">
            Step {step} of 3
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-4xl w-full mx-auto flex-1 flex flex-col justify-center py-6 sm:py-12">
        {error && (
          <div className="mb-6 p-4 bg-red-950/30 border border-red-900 rounded-xl text-sm text-red-400 max-w-lg mx-auto w-full text-center">
            {error}
          </div>
        )}

        {/* Step 1: Who are you donating as */}
        {step === 1 && (
          <div className="space-y-8 animate-fadeIn">
            <div className="text-center sm:text-left space-y-2">
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
                Who are you donating as?
              </h1>
              <p className="text-sm text-gray-400">
                Choose the profile that best describes your philanthropic entity.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {personaOptions.map((option) => {
                const IconComponent = option.icon;
                const isSelected = selectedPersona === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      setSelectedPersona(option.id);
                      setError("");
                    }}
                    className={`flex items-start gap-4 p-5 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-950/20 shadow-lg shadow-emerald-500/5 ring-1 ring-emerald-500"
                        : "border-gray-800 bg-gray-900/30 hover:border-gray-700 hover:bg-gray-900/50"
                    }`}
                  >
                    <div className={`p-3 rounded-xl ${isSelected ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-400"}`}>
                      <IconComponent className="h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-bold text-base text-white">{option.label}</h3>
                      <p className="text-xs text-gray-400 leading-relaxed">{option.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 2: Causes of interest */}
        {step === 2 && (
          <div className="space-y-8 animate-fadeIn">
            <div className="text-center sm:text-left space-y-2">
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
                What causes matter most to you?
              </h1>
              <p className="text-sm text-gray-400">
                Select up to 3 sectors you wish to fund or support (min. 1).
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {causeOptions.map((option) => {
                const IconComponent = option.icon;
                const isSelected = selectedCauses.includes(option.id);
                const disabled = !isSelected && selectedCauses.length >= 3;
                return (
                  <button
                    key={option.id}
                    disabled={disabled}
                    onClick={() => {
                      handleToggleCause(option.id);
                      setError("");
                    }}
                    className={`flex flex-col items-center justify-center p-6 rounded-2xl border text-center transition-all duration-200 cursor-pointer aspect-square ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-950/20 shadow-lg shadow-emerald-500/5 ring-1 ring-emerald-500"
                        : disabled
                        ? "border-gray-900 bg-gray-950/40 opacity-40 cursor-not-allowed"
                        : "border-gray-800 bg-gray-900/30 hover:border-gray-700 hover:bg-gray-900/50"
                    }`}
                  >
                    <div className={`p-3 rounded-xl mb-3 ${isSelected ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-400"}`}>
                      <IconComponent className="h-6 w-6" />
                    </div>
                    <span className="text-xs font-bold text-white tracking-wide">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3: Primary Motivation */}
        {step === 3 && (
          <div className="space-y-8 animate-fadeIn">
            <div className="text-center sm:text-left space-y-2">
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
                What is your primary motivation?
              </h1>
              <p className="text-sm text-gray-400">
                Help us highlight details aligned with your goals.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {motivationOptions.map((option) => {
                const IconComponent = option.icon;
                const isSelected = selectedMotivation === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      setSelectedMotivation(option.id);
                      setError("");
                    }}
                    className={`flex items-center gap-4 p-5 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-950/20 shadow-lg shadow-emerald-500/5 ring-1 ring-emerald-500"
                        : "border-gray-800 bg-gray-900/30 hover:border-gray-700 hover:bg-gray-900/50"
                    }`}
                  >
                    <div className={`p-3 rounded-xl ${isSelected ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-400"}`}>
                      <IconComponent className="h-5 w-5" />
                    </div>
                    <span className="font-semibold text-sm text-white leading-snug">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="flex justify-between items-center mt-12 pt-6 border-t border-gray-900">
          <div>
            {step > 1 && (
              <button
                onClick={handleBack}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-800 hover:border-gray-700 hover:bg-gray-900/50 text-gray-400 hover:text-white transition font-semibold text-sm cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            )}
          </div>

          <div>
            {step < 3 ? (
              <button
                onClick={handleNext}
                disabled={
                  (step === 1 && !selectedPersona) ||
                  (step === 2 && selectedCauses.length === 0)
                }
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold px-6 py-3 rounded-xl shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 transition text-sm cursor-pointer"
              >
                Next
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading || !selectedMotivation}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold px-6 py-3 rounded-xl shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 transition text-sm cursor-pointer"
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  "Complete Setup"
                )}
              </button>
            )}
          </div>
        </div>
      </main>

      {/* Footer / Skip Link */}
      <footer className="text-center mt-8">
        <Link
          href="/discover"
          className="inline-block text-xs font-bold text-gray-500 hover:text-gray-300 uppercase tracking-widest transition cursor-pointer"
        >
          Skip for now →
        </Link>
      </footer>
    </div>
  );
}
