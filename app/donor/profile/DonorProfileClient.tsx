"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SECTOR_OPTIONS } from "@/lib/requirements/form-options";

type PanStatus = "UNVERIFIED" | "VERIFIED" | "FAILED" | "PROVIDER_ERROR";

interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  billingAddress: string;
  panNumber: string;
  panStatus: PanStatus;
  panNameMatch: boolean | null;
  isCorporate: boolean;
  companyName: string;
  gstNumber: string;
  totalDonated: number;
  createdAt: string;
  pendingReceiptCount: number;
  donorPersona?: "INDIVIDUAL" | "CSR_OFFICER" | "HNI" | "FOUNDATION" | "GOVERNMENT" | null;
  hniAdvisorName?: string;
  hniAdvisorEmail?: string;
  hniAnnualBudget?: number | null;
  cin?: string | null;
  orgVerificationStatus?: "NOT_SUBMITTED" | "PENDING" | "VERIFIED" | "REJECTED";
  orgVerificationNote?: string;
  csrRegistrationNumber?: string;
  csrBudget?: number | null;
  csrPolicySummary?: string;
  csrFocusAreas?: string[];
  trustRegistrationId?: string;
  trust12a80gRegNo?: string;
  trustAnnualBudget?: number | null;
}

interface DonorProfileClientProps {
  user: UserProfile;
}

function PanStatusBadge({ status, nameMatch }: { status: PanStatus; nameMatch: boolean | null }) {
  let label: string;
  let classes: string;
  if (status === "VERIFIED" && nameMatch === false) {
    label = "⚠️ Name mismatch";
    classes = "bg-amber-50 text-amber-700 border-amber-200";
  } else if (status === "VERIFIED") {
    label = "✅ Verified";
    classes = "bg-emerald-50 text-emerald-700 border-emerald-200";
  } else if (status === "PROVIDER_ERROR") {
    label = "⏳ Provider unavailable — try again";
    classes = "bg-gray-50 text-gray-600 border-gray-200";
  } else if (status === "FAILED") {
    label = "✕ Not verified";
    classes = "bg-red-50 text-red-700 border-red-200";
  } else {
    label = "Unverified";
    classes = "bg-gray-50 text-gray-600 border-gray-200";
  }
  return (
    <span className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold border whitespace-nowrap ${classes}`}>
      {label}
    </span>
  );
}

export default function DonorProfileClient({ user }: DonorProfileClientProps) {
  const router = useRouter();
  
  // Form states
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone);
  const [city, setCity] = useState(user.city);
  const [billingAddress, setBillingAddress] = useState(user.billingAddress);
  const [panNumber, setPanNumber] = useState(user.panNumber);
  
  // Persona type selection
  const [persona, setPersona] = useState<"INDIVIDUAL" | "CSR_OFFICER" | "HNI" | "FOUNDATION" | "GOVERNMENT" | null>(user.donorPersona || "INDIVIDUAL");
  
  // HNI states
  const [hniAdvisorName, setHniAdvisorName] = useState(user.hniAdvisorName || "");
  const [hniAdvisorEmail, setHniAdvisorEmail] = useState(user.hniAdvisorEmail || "");
  const [hniAnnualBudget, setHniAnnualBudget] = useState(user.hniAnnualBudget != null ? String(user.hniAnnualBudget) : "");

  // CSR states
  const [companyName, setCompanyName] = useState(user.companyName);
  const [gstNumber, setGstNumber] = useState(user.gstNumber);
  const [cin, setCin] = useState(user.cin || "");
  const [csrRegistrationNumber, setCsrRegistrationNumber] = useState(user.csrRegistrationNumber || "");
  const [csrBudget, setCsrBudget] = useState(user.csrBudget != null ? String(user.csrBudget) : "");
  const [csrPolicySummary, setCsrPolicySummary] = useState(user.csrPolicySummary || "");
  const [csrFocusAreas, setCsrFocusAreas] = useState<string[]>(user.csrFocusAreas || []);

  // Foundation states
  const [trustRegistrationId, setTrustRegistrationId] = useState(user.trustRegistrationId || "");
  const [trust12a80gRegNo, setTrust12a80gRegNo] = useState(user.trust12a80gRegNo || "");
  const [trustAnnualBudget, setTrustAnnualBudget] = useState(user.trustAnnualBudget != null ? String(user.trustAnnualBudget) : "");

  // Status states
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [claiming, setClaiming] = useState(false);

  // PAN verification status reflects the last-saved server state.
  const panVerified = user.panStatus === "VERIFIED";
  const showClaim = panVerified && user.pendingReceiptCount > 0;

  const handleClaimReceipts = async () => {
    setClaiming(true);
    setMessage(null);
    try {
      const res = await fetch("/api/donor/receipts/claim", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate receipts");
      setMessage({
        type: "success",
        text: `Generated ${data.issued} tax receipt${data.issued === 1 ? "" : "s"}. Check your email and portfolio.`,
      });
      router.refresh();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Could not generate receipts" });
    } finally {
      setClaiming(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    if (!name.trim()) {
      setMessage({ type: "error", text: "Name is required" });
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/donor/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          phone,
          city,
          billingAddress,
          panNumber,
          isCorporate: persona === "CSR_OFFICER",
          companyName: persona === "CSR_OFFICER" || persona === "FOUNDATION" ? companyName : "",
          gstNumber: persona === "CSR_OFFICER" ? gstNumber : "",
          donorPersona: persona,
          hniAdvisorName: persona === "HNI" ? hniAdvisorName : "",
          hniAdvisorEmail: persona === "HNI" ? hniAdvisorEmail : "",
          hniAnnualBudget: persona === "HNI" ? hniAnnualBudget : "",
          cin: persona === "CSR_OFFICER" ? cin : "",
          csrRegistrationNumber: persona === "CSR_OFFICER" ? csrRegistrationNumber : "",
          csrBudget: persona === "CSR_OFFICER" ? csrBudget : "",
          csrPolicySummary: persona === "CSR_OFFICER" ? csrPolicySummary : "",
          csrFocusAreas: persona === "CSR_OFFICER" ? csrFocusAreas : [],
          trustRegistrationId: persona === "FOUNDATION" ? trustRegistrationId : "",
          trust12a80gRegNo: persona === "FOUNDATION" ? trust12a80gRegNo : "",
          trustAnnualBudget: persona === "FOUNDATION" ? trustAnnualBudget : "",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong");
      }

      setMessage({ type: "success", text: "Profile updated successfully!" });
      
      // Refresh the page data to update session info
      router.refresh();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Failed to update profile" });
    } finally {
      setLoading(false);
    }
  };

  // Helper to get formatted profile label
  const getProfileLabel = () => {
    switch (persona) {
      case "CSR_OFFICER":
        return "CSR / Corporate";
      case "HNI":
        return "High Net-worth Individual";
      case "FOUNDATION":
        return "Foundation / Trust";
      case "INDIVIDUAL":
      default:
        return "Individual / Personal";
    }
  };

  return (
    <div className="font-sans">
      
      {/* Hero Header */}
      <section className="pt-8 sm:pt-10 px-4 sm:px-6 lg:px-8">
        
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-1.5">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900 flex flex-wrap items-center gap-2">
              <span>My Profile Settings</span>
              <span className="font-sans text-[10px] font-semibold tracking-wider px-2 py-0.5 bg-trust-50 text-trust-700 ring-1 ring-trust-200 rounded-full uppercase">
                {getProfileLabel()}
              </span>
            </h1>
            <p className="text-sm text-gray-600">
              Manage your preferences, configurations, and tailored profile details.
            </p>
          </div>
          
          <div className="flex gap-3">
            <div className="px-5 py-3 bg-white border border-gray-200/80 rounded-2xl text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <span className="block text-xl font-semibold text-emerald-700">
                ₹{user.totalDonated.toLocaleString("en-IN")}
              </span>
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Total Contributed</span>
            </div>
            <Link 
              href="/donor/portfolio" 
              className="px-5 py-3 bg-white hover:bg-gray-50 border border-gray-300 rounded-2xl text-center transition flex flex-col items-center justify-center"
            >
              <span className="text-xs font-semibold text-trust-700">View Portfolio</span>
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Go to Ledger</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Main Content Layout */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Left Column: Avatar & Quick Info Card */}
          <div className="space-y-6">
            <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col items-center text-center">
              <div className="w-20 h-20 rounded-full bg-trust-50 border-2 border-trust-200 text-trust-700 font-semibold flex items-center justify-center text-2xl select-none mb-4">
                {(name || "U").charAt(0).toUpperCase()}
              </div>
              <h3 className="font-semibold text-gray-900 truncate max-w-full text-base">{name}</h3>
              <p className="text-xs text-gray-500 mb-2 truncate max-w-full">{user.email}</p>
              
              <div className="w-full border-t border-gray-200 my-4"></div>
              
              <div className="w-full text-left space-y-3">
                <div>
                  <span className="block text-[10px] uppercase font-semibold tracking-wider text-gray-500">Account Persona</span>
                  <span className="text-xs font-semibold text-gray-800">
                    {getProfileLabel()}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase font-semibold tracking-wider text-gray-500">Member Since</span>
                  <span className="text-xs font-semibold text-gray-800">
                    {new Date(user.createdAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
            </div>

            {/* Need Help Box */}
            <div className="bg-trust-50 border border-trust-100 rounded-2xl p-6">
              <h4 className="font-semibold text-sm text-gray-900 mb-2">Need Platform Help?</h4>
              <p className="text-xs text-gray-600 leading-relaxed mb-4">
                Explore FAQs, learn how 80G tax deductions work, and understand our milestone tracking system.
              </p>
              <Link
                href="/help"
                className="inline-block bg-trust-600 hover:bg-trust-700 text-white font-semibold px-4 py-2 rounded-lg text-xs transition"
              >
                Go to Help Center
              </Link>
            </div>
          </div>

          {/* Right Column: Edit Forms */}
          <div className="md:col-span-2 space-y-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              
              {/* Notification Message */}
              {message && (
                <div
                  className={`p-4 rounded-xl text-xs font-bold transition-all duration-300 flex items-center gap-2 ${
                    message.type === "success"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                      : "bg-red-50 text-red-700 border border-red-100"
                  }`}
                >
                  <span>{message.type === "success" ? "✅" : "⚠️"}</span>
                  <p>{message.text}</p>
                </div>
              )}

              {/* Profile Type Selector Card */}
              <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Profile Registration Type</h2>
                  <p className="text-xs text-gray-600">Choose your profile registration type to unlock tailored capabilities and compliance tracking.</p>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: "INDIVIDUAL", label: "Individual" },
                    { id: "HNI", label: "HNI" },
                    { id: "CSR_OFFICER", label: "CSR / Corporate" },
                    { id: "FOUNDATION", label: "Foundation / Trust" }
                  ].map((item) => {
                    const active = (persona === item.id) || (item.id === "INDIVIDUAL" && !persona);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setPersona(item.id as any);
                        }}
                        className={`px-3 py-2.5 text-xs font-semibold rounded-lg border text-center transition-all duration-200 ${
                          active
                            ? "bg-trust-600 border-trust-600 text-white shadow-sm"
                            : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 1: Basic Information (Common to all profiles) */}
              <div className="bg-white border border-gray-200/80 rounded-2xl p-6 sm:p-8 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-6">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    {persona === "CSR_OFFICER" ? "Corporate Representative Info" : 
                     persona === "FOUNDATION" ? "Foundation Representative Info" : 
                     "Personal Information"}
                  </h2>
                  <p className="text-xs text-gray-600">
                    {persona === "CSR_OFFICER" || persona === "FOUNDATION" ? 
                     "Details of the primary contact person administering the portal." : 
                     "Update your base account info used for transparency records."}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor="name" className="block text-xs font-semibold text-gray-700">
                      {persona === "CSR_OFFICER" || persona === "FOUNDATION" ? "Representative Name" : "Full Name"}
                    </label>
                    <input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all"
                      placeholder="Your name"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="email" className="block text-xs font-semibold text-gray-700">
                      Email Address
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={user.email}
                      disabled
                      className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-500 cursor-not-allowed focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="phone" className="block text-xs font-semibold text-gray-700">
                      Phone Number
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all"
                      placeholder="Phone number"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="city" className="block text-xs font-semibold text-gray-700">
                      City
                    </label>
                    <input
                      id="city"
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all"
                      placeholder="Mumbai, Bangalore, etc."
                    />
                  </div>

                  <div className="sm:col-span-2 space-y-1.5">
                    <label htmlFor="billingAddress" className="block text-xs font-semibold text-gray-700">
                      Billing Address
                    </label>
                    <textarea
                      id="billingAddress"
                      value={billingAddress}
                      onChange={(e) => setBillingAddress(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all min-h-[80px] resize-y"
                      placeholder="Required for generating standard 80G tax certificates"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: HNI Philanthropy Details (Only for HNI) */}
              {persona === "HNI" && (
                <div className="bg-white border border-gray-200/80 rounded-2xl p-6 sm:p-8 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-6 animate-fadeIn">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">Philanthropy Focus</h2>
                    <p className="text-xs text-gray-600">Configure wealth advisor contacts and target contribution thresholds.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="hniAdvisorName" className="block text-xs font-semibold text-gray-700">
                        Advisor / Relationship Manager Name
                      </label>
                      <input
                        id="hniAdvisorName"
                        type="text"
                        value={hniAdvisorName}
                        onChange={(e) => setHniAdvisorName(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all"
                        placeholder="Advisor Name"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="hniAdvisorEmail" className="block text-xs font-semibold text-gray-700">
                        Advisor Email Address
                      </label>
                      <input
                        id="hniAdvisorEmail"
                        type="email"
                        value={hniAdvisorEmail}
                        onChange={(e) => setHniAdvisorEmail(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all"
                        placeholder="advisor@firm.com"
                      />
                    </div>

                    <div className="sm:col-span-2 space-y-1.5">
                      <label htmlFor="hniAnnualBudget" className="block text-xs font-semibold text-gray-700">
                        Annual Philanthropy Target (₹)
                      </label>
                      <input
                        id="hniAnnualBudget"
                        type="number"
                        value={hniAnnualBudget}
                        onChange={(e) => setHniAnnualBudget(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all"
                        placeholder="e.g. 500000"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Section 3: CSR Corporate Settings (Only for CSR_OFFICER) */}
              {persona === "CSR_OFFICER" && (
                <div className="bg-white border border-gray-200/80 rounded-2xl p-6 sm:p-8 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-6 animate-fadeIn">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">CSR Compliance Settings</h2>
                    <p className="text-xs text-gray-600">Company registration identifiers and annual CSR allocation details.</p>
                  </div>

                  {/* Where this organisation stands. Without it the only way a
                      company learns it is not yet verified is by being refused
                      at the moment it tries to give, which is the worst
                      possible time to find out. */}
                  {user.orgVerificationStatus && (
                    <div
                      className={`rounded-xl border px-4 py-3 text-[11px] ${
                        user.orgVerificationStatus === "VERIFIED"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : user.orgVerificationStatus === "PENDING"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : user.orgVerificationStatus === "REJECTED"
                              ? "border-red-200 bg-red-50 text-red-700"
                              : "border-gray-200 bg-gray-50 text-gray-500"
                      }`}
                    >
                      <span className="font-bold">
                        {user.orgVerificationStatus === "VERIFIED"
                          ? "Organisation verified."
                          : user.orgVerificationStatus === "PENDING"
                            ? "Organisation awaiting verification."
                            : user.orgVerificationStatus === "REJECTED"
                              ? "Organisation could not be verified."
                              : "Organisation not yet submitted."}
                      </span>{" "}
                      {user.orgVerificationStatus === "VERIFIED"
                        ? "You can give as a company and download CSR utilisation certificates."
                        : user.orgVerificationStatus === "PENDING"
                          ? "Our team is reviewing your details. Company giving unlocks once that is done."
                          : user.orgVerificationStatus === "REJECTED"
                            ? user.orgVerificationNote || "Please contact us before giving as a company."
                            : "Fill in your company name, CIN and annual CSR budget below, then save — that sends your details for review."}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2 space-y-1.5">
                      <label htmlFor="companyName" className="block text-xs font-semibold text-gray-700">
                        Company Registered Name
                      </label>
                      <input
                        id="companyName"
                        type="text"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all"
                        placeholder="ABC Private Limited"
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="cin" className="block text-xs font-semibold text-gray-700">
                        Corporate Identity Number (CIN)
                      </label>
                      <input
                        id="cin"
                        type="text"
                        value={cin}
                        onChange={(e) => setCin(e.target.value.toUpperCase())}
                        className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all tracking-wider font-mono"
                        placeholder="U99999TG2026PLC000001"
                        maxLength={21}
                        required
                      />
                      <p className="text-[11px] text-gray-500">
                        The 21-character number on your certificate of incorporation. Our team verifies your
                        organisation against this before you can give as a company.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="gstNumber" className="block text-xs font-semibold text-gray-700">
                        Company GSTIN
                      </label>
                      <input
                        id="gstNumber"
                        type="text"
                        value={gstNumber}
                        onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
                        className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all tracking-wider font-mono"
                        placeholder="27AAAAA1111A1Z1"
                        maxLength={15}
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="csrRegistrationNumber" className="block text-xs font-semibold text-gray-700">
                        CSR Registration Number (CSR-1)
                      </label>
                      <input
                        id="csrRegistrationNumber"
                        type="text"
                        value={csrRegistrationNumber}
                        onChange={(e) => setCsrRegistrationNumber(e.target.value.toUpperCase())}
                        className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all tracking-wider font-mono"
                        placeholder="CSR00000000"
                        maxLength={15}
                      />
                    </div>

                    <div className="sm:col-span-2 space-y-1.5">
                      <label htmlFor="csrBudget" className="block text-xs font-semibold text-gray-700">
                        Annual CSR Budget Allocation (₹)
                      </label>
                      <input
                        id="csrBudget"
                        type="number"
                        value={csrBudget}
                        onChange={(e) => setCsrBudget(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all"
                        placeholder="e.g. 2000000"
                      />
                    </div>

                    <div className="sm:col-span-2 space-y-1.5">
                      <label htmlFor="csrPolicySummary" className="block text-xs font-semibold text-gray-700">
                        CSR policy (summary)
                      </label>
                      <textarea
                        id="csrPolicySummary"
                        rows={4}
                        maxLength={4000}
                        value={csrPolicySummary}
                        onChange={(e) => setCsrPolicySummary(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all"
                        placeholder="What your board-approved CSR policy commits to: focus areas, geographies, how projects are chosen and monitored."
                      />
                    </div>

                    <fieldset className="sm:col-span-2 space-y-1.5">
                      <legend className="block text-xs font-semibold text-gray-700">CSR focus areas</legend>
                      <div className="flex flex-wrap gap-2">
                        {SECTOR_OPTIONS.map((area) => (
                          <label key={area} className="inline-flex items-center gap-2 min-h-[40px] px-3 rounded-lg border border-gray-300 bg-white text-xs text-gray-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={csrFocusAreas.includes(area)}
                              onChange={(e) =>
                                setCsrFocusAreas((cur) => (e.target.checked ? [...cur, area] : cur.filter((x) => x !== area)))
                              }
                            />
                            {area}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </div>
                </div>
              )}

              {/* Section 4: Foundation / Trust Settings (Only for FOUNDATION) */}
              {persona === "FOUNDATION" && (
                <div className="bg-white border border-gray-200/80 rounded-2xl p-6 sm:p-8 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-6 animate-fadeIn">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">Foundation Legal Info</h2>
                    <p className="text-xs text-gray-600">Trust Deed registration, NGO 12A/80G status, and grant budgets.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2 space-y-1.5">
                      <label htmlFor="trustName" className="block text-xs font-semibold text-gray-700">
                        Foundation / Trust Legal Name
                      </label>
                      <input
                        id="trustName"
                        type="text"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all"
                        placeholder="e.g. Tata Trusts / Foundation"
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="trustRegistrationId" className="block text-xs font-semibold text-gray-700">
                        Trust Deed / Registration ID
                      </label>
                      <input
                        id="trustRegistrationId"
                        type="text"
                        value={trustRegistrationId}
                        onChange={(e) => setTrustRegistrationId(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all"
                        placeholder="Reg ID / Deed Number"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="trust12a80gRegNo" className="block text-xs font-semibold text-gray-700">
                        12A / 80G Approval Number (if applicable)
                      </label>
                      <input
                        id="trust12a80gRegNo"
                        type="text"
                        value={trust12a80gRegNo}
                        onChange={(e) => setTrust12a80gRegNo(e.target.value.toUpperCase())}
                        className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all tracking-wider font-mono"
                        placeholder="12A/80G Number"
                      />
                    </div>

                    <div className="sm:col-span-2 space-y-1.5">
                      <label htmlFor="trustAnnualBudget" className="block text-xs font-semibold text-gray-700">
                        Annual Grant Allocation Target (₹)
                      </label>
                      <input
                        id="trustAnnualBudget"
                        type="number"
                        value={trustAnnualBudget}
                        onChange={(e) => setTrustAnnualBudget(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all"
                        placeholder="e.g. 5000000"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Section 5: Tax KYC and Benefits (PAN Card for tax receipts - needed for all profile types) */}
              <div className="bg-white border border-gray-200/80 rounded-2xl p-6 sm:p-8 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">
                      {persona === "CSR_OFFICER" ? "Company Tax Details" :
                       persona === "FOUNDATION" ? "Trust/Foundation Tax Details" :
                       "Tax Deductions (80G Benefit)"}
                    </h2>
                    <p className="text-xs text-gray-600">
                      {persona === "CSR_OFFICER" ? "Provide the company's PAN for corporate tax audit purposes." :
                       persona === "FOUNDATION" ? "Provide the Trust's PAN for tax reporting and audit compliance." :
                       "Verify your PAN to receive automated 80G tax receipts. Receipts are only issued once your PAN is verified."}
                    </p>
                  </div>
                  <PanStatusBadge status={user.panStatus} nameMatch={user.panNameMatch} />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="panNumber" className="block text-xs font-semibold text-gray-700">
                    {persona === "CSR_OFFICER" ? "Company PAN Number" : 
                     persona === "FOUNDATION" ? "Trust PAN Number" : 
                     "PAN Card Number"}
                  </label>
                  <input
                    id="panNumber"
                    type="text"
                    value={panNumber}
                    onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                    className="w-full px-3.5 py-2.5 bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 rounded-lg text-sm focus:outline-none transition-all tracking-wider font-mono"
                    placeholder="ABCDE1234F"
                    maxLength={10}
                  />
                  <p className="text-[11px] text-gray-500">
                    We verify your PAN against government records on save.
                  </p>
                </div>

                {showClaim && (
                  <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-emerald-50 border border-emerald-100">
                    <p className="text-[11px] font-semibold text-emerald-800">
                      You have {user.pendingReceiptCount} donation{user.pendingReceiptCount === 1 ? "" : "s"} awaiting an 80G receipt.
                    </p>
                    <button
                      type="button"
                      onClick={handleClaimReceipts}
                      disabled={claiming}
                      className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-lg text-xs transition disabled:opacity-50"
                    >
                      {claiming ? "Generating…" : "Generate 80G receipts"}
                    </button>
                  </div>
                )}
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end items-center gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setName(user.name);
                    setPhone(user.phone);
                    setCity(user.city);
                    setBillingAddress(user.billingAddress);
                    setPanNumber(user.panNumber);
                    setPersona(user.donorPersona || "INDIVIDUAL");
                    setHniAdvisorName(user.hniAdvisorName || "");
                    setHniAdvisorEmail(user.hniAdvisorEmail || "");
                    setHniAnnualBudget(user.hniAnnualBudget != null ? String(user.hniAnnualBudget) : "");
                    setCompanyName(user.companyName);
                    setGstNumber(user.gstNumber);
                    setCsrRegistrationNumber(user.csrRegistrationNumber || "");
                    setCsrBudget(user.csrBudget != null ? String(user.csrBudget) : "");
                    setTrustRegistrationId(user.trustRegistrationId || "");
                    setTrust12a80gRegNo(user.trust12a80gRegNo || "");
                    setTrustAnnualBudget(user.trustAnnualBudget != null ? String(user.trustAnnualBudget) : "");
                    setMessage(null);
                  }}
                  className="border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 font-semibold py-2 px-4 rounded-lg text-sm transition"
                  disabled={loading}
                >
                  Discard Changes
                </button>
                <button
                  type="submit"
                  className="bg-trust-600 hover:bg-trust-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition flex items-center justify-center gap-2 disabled:opacity-50"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>Saving Profile...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>

            </form>
          </div>

        </div>
      </div>
    </div>
  );
}
