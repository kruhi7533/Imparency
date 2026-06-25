"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Check } from "lucide-react";

const CAUSE_CATEGORIES = [
  "Education",
  "Healthcare",
  "Environment",
  "Women Empowerment",
  "Rural Development",
  "Hunger",
];

export default function NGORegistrationPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [orgName, setOrgName] = useState("");
  const [regNum, setRegNum] = useState("");
  const [panNum, setPanNum] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [foundedYear, setFoundedYear] = useState("");
  const [description, setDescription] = useState("");
  const [selectedCauses, setSelectedCauses] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const consentVersion = "v1.0";
  
  // File states
  const [regFile, setRegFile] = useState<File | null>(null);
  const [panFile, setPanFile] = useState<File | null>(null);
  const [taxFile, setTaxFile] = useState<File | null>(null);

  // Optional compliance documents
  const [a12File, setA12File] = useState<File | null>(null);
  const [fcraFile, setFcraFile] = useState<File | null>(null);
  const [fcraNumber, setFcraNumber] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Individual file error states
  const [regError, setRegError] = useState("");
  const [panError, setPanError] = useState("");
  const [taxError, setTaxError] = useState("");
  const [a12Error, setA12Error] = useState("");
  const [fcraError, setFcraError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (session?.user && session.user.role !== "NGO") {
      router.push("/unauthorized");
    }
  }, [session, status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  const handleCheckboxChange = (cause: string) => {
    setSelectedCauses((prev) =>
      prev.includes(cause)
        ? prev.filter((c) => c !== cause)
        : [...prev, cause]
    );
  };

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: React.Dispatch<React.SetStateAction<File | null>>,
    setErrorKey: React.Dispatch<React.SetStateAction<string>>
  ) => {
    setErrorKey("");
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type !== "application/pdf") {
        setErrorKey("Only PDF documents are allowed for verification");
        setter(null);
        e.target.value = ""; // Clear input
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setErrorKey("File size must not exceed 10MB");
        setter(null);
        e.target.value = "";
        return;
      }
      setter(file);
    } else {
      setter(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!orgName || !regNum || !panNum || !address || !foundedYear || !description) {
      setError("Please fill out all mandatory fields");
      setLoading(false);
      return;
    }

    if (!consent) {
      setError("Data processing consent is required to register");
      setLoading(false);
      return;
    }

    if (selectedCauses.length === 0) {
      setError("Please select at least one cause category");
      setLoading(false);
      return;
    }

    if (!regFile || !panFile || !taxFile) {
      setError("Please upload all three verification documents (PDF only)");
      setLoading(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append("orgName", orgName);
      formData.append("registrationNumber", regNum);
      formData.append("panNumber", panNum);
      formData.append("address", address);
      formData.append("website", website);
      formData.append("foundedYear", foundedYear);
      formData.append("description", description);
      formData.append("causeCategories", JSON.stringify(selectedCauses));
      
      formData.append("regFile", regFile);
      formData.append("panFile", panFile);
      formData.append("taxFile", taxFile);
      
      formData.append("dataProcessingConsent", consent ? "true" : "false");
      formData.append("consentVersion", consentVersion);

      // Optional compliance documents
      if (a12File) formData.append("a12File", a12File);
      if (fcraFile) formData.append("fcraFile", fcraFile);
      if (fcraNumber.trim()) formData.append("fcraNumber", fcraNumber.trim());

      const response = await fetch("/api/ngo/register", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to submit registration documents");
      }

      setSuccess(true);
      setTimeout(() => {
        router.push("/ngo/dashboard");
      }, 2000);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-12 px-4 sm:px-6 lg:px-8 font-sans transition-colors duration-200">
      <div className="max-w-3xl mx-auto bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 p-8 sm:p-10 relative overflow-hidden">
        
        {/* Background decorative gradient */}
        <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl -mr-20 -mt-20"></div>

        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">NGO Profile Verification</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Please register your organization's legal credentials. These details are reviewed manually for compliance under Section 80G.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/30 border-l-4 border-red-500 rounded text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-950/30 border-l-4 border-emerald-500 rounded text-sm text-emerald-700 dark:text-emerald-300">
            Application submitted successfully! Redirecting to dashboard...
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Organization Name *</label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                placeholder="e.g. Hope Foundation"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Founded Year *</label>
              <input
                type="number"
                min="1800"
                max={new Date().getFullYear().toString()}
                value={foundedYear}
                onChange={(e) => setFoundedYear(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                placeholder="e.g. 2012"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Registration Number *</label>
              <input
                type="text"
                value={regNum}
                onChange={(e) => setRegNum(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                placeholder="e.g. U85100MH2021NPL12345"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">PAN Number *</label>
              <input
                type="text"
                maxLength={10}
                value={panNum}
                onChange={(e) => setPanNum(e.target.value.toUpperCase())}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                placeholder="e.g. AAATH1234F"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Office Address *</label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition resize-none"
              placeholder="e.g. 101, Business Hub, Bandra West, Mumbai, Maharashtra 400050"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Website URL (Optional)</label>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
              placeholder="e.g. https://hopefoundation.org"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Cause Categories * (Select all that apply)</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
              {CAUSE_CATEGORIES.map((cause) => {
                const isSelected = selectedCauses.includes(cause);
                return (
                  <button
                    key={cause}
                    type="button"
                    onClick={() => handleCheckboxChange(cause)}
                    className={`flex items-center justify-center gap-2 px-4 py-2 border rounded-lg cursor-pointer text-sm font-medium transition select-none ${
                      isSelected
                        ? "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-600 dark:bg-emerald-600 dark:text-white font-bold"
                        : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    {isSelected && <Check className="w-4 h-4 text-white shrink-0 font-black" />}
                    {cause}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">About Organization (Description) *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition resize-none"
              placeholder="Describe your organization's mission, goals, and focus areas..."
              required
            />
          </div>

          <div className="border-t border-gray-200 dark:border-gray-800 pt-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Verification Documents</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Upload all 3 required files in PDF format (Max size: 10MB per file).</p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Certificate of Registration */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Certificate of Registration *
                </label>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 cursor-pointer hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-955/10 transition group text-center min-h-[120px]">
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => handleFileChange(e, setRegFile, setRegError)}
                    className="hidden"
                    required={!regFile}
                  />
                  {regFile ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <svg className="w-5 h-5 fill-current shrink-0" viewBox="0 0 20 20">
                          <path d="M0 11l2-2 5 5L18 3l2 2L7 18z" />
                        </svg>
                        <span className="text-xs font-bold line-clamp-1 max-w-[150px]">{regFile.name}</span>
                      </div>
                      <span className="text-[10px] text-gray-400">Click to change file</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Choose PDF Document</span>
                      <span className="block text-[10px] text-gray-400">No file chosen</span>
                    </div>
                  )}
                </label>
                {regError && (
                  <p className="text-xs text-red-500 mt-1 font-medium">{regError}</p>
                )}
              </div>

              {/* NGO PAN Card Copy */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  NGO PAN Card Copy *
                </label>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 cursor-pointer hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-955/10 transition group text-center min-h-[120px]">
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => handleFileChange(e, setPanFile, setPanError)}
                    className="hidden"
                    required={!panFile}
                  />
                  {panFile ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <svg className="w-5 h-5 fill-current shrink-0" viewBox="0 0 20 20">
                          <path d="M0 11l2-2 5 5L18 3l2 2L7 18z" />
                        </svg>
                        <span className="text-xs font-bold line-clamp-1 max-w-[150px]">{panFile.name}</span>
                      </div>
                      <span className="text-[10px] text-gray-400">Click to change file</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Choose PDF Document</span>
                      <span className="block text-[10px] text-gray-400">No file chosen</span>
                    </div>
                  )}
                </label>
                {panError && (
                  <p className="text-xs text-red-500 mt-1 font-medium">{panError}</p>
                )}
              </div>

              {/* 80G Registration Copy */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  80G Registration Copy *
                </label>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 cursor-pointer hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-955/10 transition group text-center min-h-[120px]">
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => handleFileChange(e, setTaxFile, setTaxError)}
                    className="hidden"
                    required={!taxFile}
                  />
                  {taxFile ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <svg className="w-5 h-5 fill-current shrink-0" viewBox="0 0 20 20">
                          <path d="M0 11l2-2 5 5L18 3l2 2L7 18z" />
                        </svg>
                        <span className="text-xs font-bold line-clamp-1 max-w-[150px]">{taxFile.name}</span>
                      </div>
                      <span className="text-[10px] text-gray-400">Click to change file</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Choose PDF Document</span>
                      <span className="block text-[10px] text-gray-400">No file chosen</span>
                    </div>
                  )}
                </label>
                {taxError && (
                  <p className="text-xs text-red-500 mt-1 font-medium">{taxError}</p>
                )}
              </div>

            </div>
          </div>

          {/* Optional compliance documents */}
          <div className="border-t border-gray-200 dark:border-gray-800 pt-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
              Additional Compliance <span className="text-xs font-semibold text-gray-400">(Optional)</span>
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Add these if you have them — they strengthen your public Compliance Score and donor trust. You can also add them later.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* 12A Registration Copy (optional) */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  12A Registration Copy
                </label>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 cursor-pointer hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-955/10 transition group text-center min-h-[120px]">
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => handleFileChange(e, setA12File, setA12Error)}
                    className="hidden"
                  />
                  {a12File ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <svg className="w-5 h-5 fill-current shrink-0" viewBox="0 0 20 20">
                          <path d="M0 11l2-2 5 5L18 3l2 2L7 18z" />
                        </svg>
                        <span className="text-xs font-bold line-clamp-1 max-w-[150px]">{a12File.name}</span>
                      </div>
                      <span className="text-[10px] text-gray-400">Click to change file</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Choose PDF Document</span>
                      <span className="block text-[10px] text-gray-400">No file chosen</span>
                    </div>
                  )}
                </label>
                {a12Error && (
                  <p className="text-xs text-red-500 mt-1 font-medium">{a12Error}</p>
                )}
              </div>

              {/* FCRA Certificate (optional) */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  FCRA Certificate
                </label>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 cursor-pointer hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-955/10 transition group text-center min-h-[120px]">
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => handleFileChange(e, setFcraFile, setFcraError)}
                    className="hidden"
                  />
                  {fcraFile ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <svg className="w-5 h-5 fill-current shrink-0" viewBox="0 0 20 20">
                          <path d="M0 11l2-2 5 5L18 3l2 2L7 18z" />
                        </svg>
                        <span className="text-xs font-bold line-clamp-1 max-w-[150px]">{fcraFile.name}</span>
                      </div>
                      <span className="text-[10px] text-gray-400">Click to change file</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Choose PDF Document</span>
                      <span className="block text-[10px] text-gray-400">Only if registered for foreign contributions</span>
                    </div>
                  )}
                </label>
                {fcraError && (
                  <p className="text-xs text-red-500 mt-1 font-medium">{fcraError}</p>
                )}
              </div>
            </div>

            {/* FCRA registration number */}
            <div className="mt-6 md:max-w-sm">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                FCRA Registration Number
              </label>
              <input
                type="text"
                value={fcraNumber}
                onChange={(e) => setFcraNumber(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                placeholder="e.g. 094421234"
              />
            </div>
          </div>

          <div className="pt-2">
            <label className="flex items-start gap-3 p-4 border border-gray-200 dark:border-gray-800 rounded-xl bg-gray-50/50 dark:bg-gray-900/50 cursor-pointer group hover:border-emerald-500/50 transition-colors">
              <div className="flex items-center h-5 mt-0.5">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 bg-white border-gray-300 rounded focus:ring-emerald-500 dark:focus:ring-emerald-600 dark:ring-offset-gray-900 focus:ring-2 dark:bg-gray-800 dark:border-gray-700"
                  required
                />
              </div>
              <div className="text-sm">
                <p className="font-medium text-gray-900 dark:text-white">Data Processing Consent *</p>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                  I agree to the collection and processing of organizational data as described in the <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:text-emerald-700 hover:underline">Privacy Policy</a>.
                </p>
              </div>
            </label>
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={loading || success || !!regError || !!panError || !!taxError || !!a12Error || !!fcraError}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg hover:shadow-emerald-600/10 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-200 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  Submitting Documents...
                </>
              ) : (
                "Submit Registration Documents"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
