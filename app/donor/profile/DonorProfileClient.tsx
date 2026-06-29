"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  billingAddress: string;
  panNumber: string;
  isCorporate: boolean;
  companyName: string;
  gstNumber: string;
  totalDonated: number;
  createdAt: string;
  donorPersona?: "INDIVIDUAL" | "CSR_OFFICER" | "HNI" | "FOUNDATION" | "GOVERNMENT" | null;
  hniAdvisorName?: string;
  hniAdvisorEmail?: string;
  hniAnnualBudget?: number | null;
  csrRegistrationNumber?: string;
  csrBudget?: number | null;
  trustRegistrationId?: string;
  trust12a80gRegNo?: string;
  trustAnnualBudget?: number | null;
}

interface DonorProfileClientProps {
  user: UserProfile;
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
  const [csrRegistrationNumber, setCsrRegistrationNumber] = useState(user.csrRegistrationNumber || "");
  const [csrBudget, setCsrBudget] = useState(user.csrBudget != null ? String(user.csrBudget) : "");

  // Foundation states
  const [trustRegistrationId, setTrustRegistrationId] = useState(user.trustRegistrationId || "");
  const [trust12a80gRegNo, setTrust12a80gRegNo] = useState(user.trust12a80gRegNo || "");
  const [trustAnnualBudget, setTrustAnnualBudget] = useState(user.trustAnnualBudget != null ? String(user.trustAnnualBudget) : "");

  // Status states
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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
          csrRegistrationNumber: persona === "CSR_OFFICER" ? csrRegistrationNumber : "",
          csrBudget: persona === "CSR_OFFICER" ? csrBudget : "",
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      
      {/* Hero Header */}
      <section className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -z-10"></div>
        
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight flex flex-wrap items-center gap-2">
              <span>My Profile Settings</span>
              <span className="text-[10px] font-black tracking-wider px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-full uppercase">
                {getProfileLabel()}
              </span>
            </h1>
            <p className="text-sm text-gray-400">
              Manage your preferences, configurations, and tailored profile details.
            </p>
          </div>
          
          <div className="flex gap-4">
            <div className="px-5 py-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl text-center shadow-inner">
              <span className="block text-xl font-black text-emerald-600 dark:text-emerald-400">
                ₹{user.totalDonated.toLocaleString("en-IN")}
              </span>
              <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Total Contributed</span>
            </div>
            <Link 
              href="/donor/portfolio" 
              className="px-5 py-3 bg-gray-55 dark:bg-gray-850 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl text-center transition flex flex-col items-center justify-center"
            >
              <span className="text-xs font-bold text-gray-900 dark:text-white">View Portfolio</span>
              <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Go to Ledger</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Main Content Layout */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Left Column: Avatar & Quick Info Card */}
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm flex flex-col items-center text-center">
              <div className="w-20 h-20 rounded-full bg-emerald-600/10 border-2 border-emerald-500/35 text-emerald-500 font-black flex items-center justify-center text-2xl select-none mb-4">
                {(name || "U").charAt(0).toUpperCase()}
              </div>
              <h3 className="font-extrabold text-gray-900 dark:text-white truncate max-w-full text-base">{name}</h3>
              <p className="text-xs text-gray-400 mb-2 truncate max-w-full">{user.email}</p>
              
              <div className="w-full border-t border-gray-100 dark:border-gray-800 my-4"></div>
              
              <div className="w-full text-left space-y-3">
                <div>
                  <span className="block text-[9px] uppercase font-bold tracking-wider text-gray-400">Account Persona</span>
                  <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                    {getProfileLabel()}
                  </span>
                </div>
                <div>
                  <span className="block text-[9px] uppercase font-bold tracking-wider text-gray-400">Member Since</span>
                  <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
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
            <div className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white rounded-2xl p-6 shadow-md relative overflow-hidden">
              <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-white/5 rounded-full blur-xl"></div>
              <h4 className="font-black text-sm mb-2">Need Platform Help?</h4>
              <p className="text-xs text-emerald-100 leading-relaxed mb-4">
                Explore FAQs, learn how 80G tax deductions work, and understand our milestone tracking system.
              </p>
              <Link
                href="/help"
                className="inline-block bg-white hover:bg-emerald-55 text-emerald-800 font-bold px-4 py-2 rounded-xl text-xs transition"
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
                      ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/50"
                      : "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border border-red-100 dark:border-red-900/50"
                  }`}
                >
                  <span>{message.type === "success" ? "✅" : "⚠️"}</span>
                  <p>{message.text}</p>
                </div>
              )}

              {/* Profile Type Selector Card */}
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">Profile Registration Type</h2>
                  <p className="text-[11px] text-gray-400">Choose your profile registration type to unlock tailored capabilities and compliance tracking.</p>
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
                        className={`px-3 py-2.5 text-xs font-bold rounded-xl border text-center transition-all duration-200 ${
                          active
                            ? "bg-emerald-600 border-emerald-500 text-white shadow-sm font-extrabold"
                            : "bg-gray-55 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 1: Basic Information (Common to all profiles) */}
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">
                    {persona === "CSR_OFFICER" ? "Corporate Representative Info" : 
                     persona === "FOUNDATION" ? "Foundation Representative Info" : 
                     "Personal Information"}
                  </h2>
                  <p className="text-[11px] text-gray-400">
                    {persona === "CSR_OFFICER" || persona === "FOUNDATION" ? 
                     "Details of the primary contact person administering the portal." : 
                     "Update your base account info used for transparency records."}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor="name" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                      {persona === "CSR_OFFICER" || persona === "FOUNDATION" ? "Representative Name" : "Full Name"}
                    </label>
                    <input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all"
                      placeholder="Your name"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="email" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                      Email Address
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={user.email}
                      disabled
                      className="w-full px-3.5 py-2.5 bg-gray-100 dark:bg-gray-850 border border-gray-200 dark:border-gray-800 rounded-xl text-xs text-gray-400 dark:text-gray-500 cursor-not-allowed focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="phone" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                      Phone Number
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all"
                      placeholder="Phone number"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="city" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                      City
                    </label>
                    <input
                      id="city"
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all"
                      placeholder="Mumbai, Bangalore, etc."
                    />
                  </div>

                  <div className="sm:col-span-2 space-y-1.5">
                    <label htmlFor="billingAddress" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                      Billing Address
                    </label>
                    <textarea
                      id="billingAddress"
                      value={billingAddress}
                      onChange={(e) => setBillingAddress(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all min-h-[80px] resize-y"
                      placeholder="Required for generating standard 80G tax certificates"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: HNI Philanthropy Details (Only for HNI) */}
              {persona === "HNI" && (
                <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6 animate-fadeIn">
                  <div>
                    <h2 className="text-base font-bold text-gray-900 dark:text-white">Philanthropy Focus</h2>
                    <p className="text-[11px] text-gray-400">Configure wealth advisor contacts and target contribution thresholds.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="hniAdvisorName" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                        Advisor / Relationship Manager Name
                      </label>
                      <input
                        id="hniAdvisorName"
                        type="text"
                        value={hniAdvisorName}
                        onChange={(e) => setHniAdvisorName(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-gray-55 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all"
                        placeholder="Advisor Name"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="hniAdvisorEmail" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                        Advisor Email Address
                      </label>
                      <input
                        id="hniAdvisorEmail"
                        type="email"
                        value={hniAdvisorEmail}
                        onChange={(e) => setHniAdvisorEmail(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-gray-55 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all"
                        placeholder="advisor@firm.com"
                      />
                    </div>

                    <div className="sm:col-span-2 space-y-1.5">
                      <label htmlFor="hniAnnualBudget" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                        Annual Philanthropy Target (₹)
                      </label>
                      <input
                        id="hniAnnualBudget"
                        type="number"
                        value={hniAnnualBudget}
                        onChange={(e) => setHniAnnualBudget(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all"
                        placeholder="e.g. 500000"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Section 3: CSR Corporate Settings (Only for CSR_OFFICER) */}
              {persona === "CSR_OFFICER" && (
                <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6 animate-fadeIn">
                  <div>
                    <h2 className="text-base font-bold text-gray-900 dark:text-white">CSR Compliance Settings</h2>
                    <p className="text-[11px] text-gray-400">Company registration identifiers and annual CSR allocation details.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2 space-y-1.5">
                      <label htmlFor="companyName" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                        Company Registered Name
                      </label>
                      <input
                        id="companyName"
                        type="text"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all"
                        placeholder="ABC Private Limited"
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="gstNumber" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                        Company GSTIN
                      </label>
                      <input
                        id="gstNumber"
                        type="text"
                        value={gstNumber}
                        onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
                        className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all tracking-wider font-mono"
                        placeholder="27AAAAA1111A1Z1"
                        maxLength={15}
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="csrRegistrationNumber" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                        CSR Registration Number (CSR-1)
                      </label>
                      <input
                        id="csrRegistrationNumber"
                        type="text"
                        value={csrRegistrationNumber}
                        onChange={(e) => setCsrRegistrationNumber(e.target.value.toUpperCase())}
                        className="w-full px-3.5 py-2.5 bg-gray-55 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all tracking-wider font-mono"
                        placeholder="CSR00000000"
                        maxLength={15}
                      />
                    </div>

                    <div className="sm:col-span-2 space-y-1.5">
                      <label htmlFor="csrBudget" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                        Annual CSR Budget Allocation (₹)
                      </label>
                      <input
                        id="csrBudget"
                        type="number"
                        value={csrBudget}
                        onChange={(e) => setCsrBudget(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all"
                        placeholder="e.g. 2000000"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Section 4: Foundation / Trust Settings (Only for FOUNDATION) */}
              {persona === "FOUNDATION" && (
                <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6 animate-fadeIn">
                  <div>
                    <h2 className="text-base font-bold text-gray-900 dark:text-white">Foundation Legal Info</h2>
                    <p className="text-[11px] text-gray-400">Trust Deed registration, NGO 12A/80G status, and grant budgets.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2 space-y-1.5">
                      <label htmlFor="trustName" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                        Foundation / Trust Legal Name
                      </label>
                      <input
                        id="trustName"
                        type="text"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-gray-55 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all"
                        placeholder="e.g. Tata Trusts / Foundation"
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="trustRegistrationId" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                        Trust Deed / Registration ID
                      </label>
                      <input
                        id="trustRegistrationId"
                        type="text"
                        value={trustRegistrationId}
                        onChange={(e) => setTrustRegistrationId(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-gray-55 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all"
                        placeholder="Reg ID / Deed Number"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="trust12a80gRegNo" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                        12A / 80G Approval Number (if applicable)
                      </label>
                      <input
                        id="trust12a80gRegNo"
                        type="text"
                        value={trust12a80gRegNo}
                        onChange={(e) => setTrust12a80gRegNo(e.target.value.toUpperCase())}
                        className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all tracking-wider font-mono"
                        placeholder="12A/80G Number"
                      />
                    </div>

                    <div className="sm:col-span-2 space-y-1.5">
                      <label htmlFor="trustAnnualBudget" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                        Annual Grant Allocation Target (₹)
                      </label>
                      <input
                        id="trustAnnualBudget"
                        type="number"
                        value={trustAnnualBudget}
                        onChange={(e) => setTrustAnnualBudget(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all"
                        placeholder="e.g. 5000000"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Section 5: Tax KYC and Benefits (PAN Card for tax receipts - needed for all profile types) */}
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">
                    {persona === "CSR_OFFICER" ? "Company Tax Details" : 
                     persona === "FOUNDATION" ? "Trust/Foundation Tax Details" : 
                     "Tax Deductions (80G Benefit)"}
                  </h2>
                  <p className="text-[11px] text-gray-400">
                    {persona === "CSR_OFFICER" ? "Provide the company's PAN for corporate tax audit purposes." : 
                     persona === "FOUNDATION" ? "Provide the Trust's PAN for tax reporting and audit compliance." : 
                     "Verify your PAN details to receive automated 80G tax utilization certificates."}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="panNumber" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                    {persona === "CSR_OFFICER" ? "Company PAN Number" : 
                     persona === "FOUNDATION" ? "Trust PAN Number" : 
                     "PAN Card Number"}
                  </label>
                  <input
                    id="panNumber"
                    type="text"
                    value={panNumber}
                    onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                    className="w-full px-3.5 py-2.5 bg-gray-55 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all tracking-wider font-mono"
                    placeholder="ABCDE1234F"
                    maxLength={10}
                  />
                </div>
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
                  className="border border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 bg-transparent text-gray-700 dark:text-gray-300 font-bold py-2.5 px-6 rounded-xl text-xs transition focus:outline-none"
                  disabled={loading}
                >
                  Discard Changes
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-2.5 px-6 rounded-xl text-xs shadow-md shadow-emerald-500/10 transition flex items-center justify-center gap-2 focus:outline-none disabled:opacity-50"
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
