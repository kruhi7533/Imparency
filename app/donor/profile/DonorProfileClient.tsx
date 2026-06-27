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
  const [isCorporate, setIsCorporate] = useState(user.isCorporate);
  const [companyName, setCompanyName] = useState(user.companyName);
  const [gstNumber, setGstNumber] = useState(user.gstNumber);

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
          isCorporate,
          companyName,
          gstNumber,
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      
      {/* Hero Header */}
      <section className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -z-10"></div>
        
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight flex items-center gap-2">
              <span>My Profile Settings</span>
              <span className="text-[10px] font-black tracking-wider px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-full uppercase">
                Donor Account
              </span>
            </h1>
            <p className="text-sm text-gray-400">
              Manage your personal preferences, KYC verification, and CSR configurations.
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
              className="px-5 py-3 bg-gray-50 dark:bg-gray-850 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl text-center transition flex flex-col items-center justify-center"
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
                  <span className="block text-[9px] uppercase font-bold tracking-wider text-gray-400">Account Type</span>
                  <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                    {isCorporate ? "Corporate Donor" : "Individual Donor"}
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
                className="inline-block bg-white hover:bg-emerald-50 text-emerald-800 font-bold px-4 py-2 rounded-xl text-xs transition"
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

              {/* Personal Information section */}
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">Personal Information</h2>
                  <p className="text-[11px] text-gray-400">Update your base account info used for transparency records.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor="name" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                      Full Name
                    </label>
                    <input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-gray-55 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all"
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
                      className="w-full px-3.5 py-2.5 bg-gray-55 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all"
                      placeholder="10-digit mobile number"
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
                      className="w-full px-3.5 py-2.5 bg-gray-55 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all"
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
                      className="w-full px-3.5 py-2.5 bg-gray-55 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all min-h-[80px] resize-y"
                      placeholder="Required for generating standard 80G tax certificates"
                    />
                  </div>
                </div>
              </div>

              {/* Tax KYC and Benefits */}
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">Tax Deductions (80G Benefit)</h2>
                  <p className="text-[11px] text-gray-400">Verify your PAN details to receive automated 80G tax utilization certificates.</p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="panNumber" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                    PAN Card Number
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

              {/* Corporate CSR Accounts */}
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-gray-900 dark:text-white font-sans">CSR Corporate Account</h2>
                    <p className="text-[11px] text-gray-400">Register as a company to download audit reports and compliance files.</p>
                  </div>
                  
                  {/* Styled Switch Toggle */}
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isCorporate}
                      onChange={(e) => setIsCorporate(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 dark:bg-gray-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                {isCorporate && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-gray-100 dark:border-gray-800 animate-fadeIn">
                    <div className="space-y-1.5">
                      <label htmlFor="companyName" className="block text-[10px] uppercase font-bold tracking-wider text-gray-400">
                        Company Registered Name
                      </label>
                      <input
                        id="companyName"
                        type="text"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-gray-55 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all"
                        placeholder="ABC Private Limited"
                        required={isCorporate}
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
                        className="w-full px-3.5 py-2.5 bg-gray-55 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all tracking-wider font-mono"
                        placeholder="27AAAAA1111A1Z1"
                        maxLength={15}
                        required={isCorporate}
                      />
                    </div>
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
                    setIsCorporate(user.isCorporate);
                    setCompanyName(user.companyName);
                    setGstNumber(user.gstNumber);
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
