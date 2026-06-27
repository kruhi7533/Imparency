"use client";

import React, { useState } from "react";
import Link from "next/link";

interface FAQItem {
  question: string;
  answer: string;
  category: "donations" | "tax" | "milestones" | "general";
}

export default function HelpPage() {
  const [activeCategory, setActiveCategory] = useState<"all" | "donations" | "tax" | "milestones" | "general">("all");
  const [openFAQIndex, setOpenFAQIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const faqs: FAQItem[] = [
    {
      category: "general",
      question: "What is ImpactBridge and how does it work?",
      answer: "ImpactBridge is a next-generation donation platform designed to bridge the trust gap between donors and NGOs. We break projects down into verifiable milestones. Funds are allocated based on proof submission audited by our automated AI verification system, ensuring every rupee goes directly to its intended impact."
    },
    {
      category: "donations",
      question: "How do I make a donation?",
      answer: "Navigate to the 'Discover NGOs' tab to explore active projects. Once you choose a project, click 'Donate Now', select or type the amount, and proceed with the secure Razorpay integration. If the project is a success, you can track its milestones in real-time."
    },
    {
      category: "tax",
      question: "Can I get tax deductions for my donations?",
      answer: "Yes! Donations made to eligible registered NGOs receive tax exemptions under Section 80G of the Income Tax Act in India. Ensure your PAN (Permanent Account Number) and billing address are updated in your Profile. Your 80G receipt will be generated automatically and can be downloaded from your Portfolio page."
    },
    {
      category: "milestones",
      question: "What are milestones and how are they verified?",
      answer: "NGOs structure their projects into sequential milestones (e.g., procurement, execution, final delivery). When a milestone is completed, the NGO uploads evidence (invoices, photos, PDFs). Our proprietary AI analyzes this documentation, assigns a verification score, and notifies donors of the project progress."
    },
    {
      category: "donations",
      question: "Is there a transaction fee on my donations?",
      answer: "ImpactBridge does not charge any direct platform fee. A minimal standard payment gateway processing fee (charged by Razorpay) is deducted at checkout. 100% of the remaining amount goes directly to the project."
    },
    {
      category: "tax",
      question: "What is a CSR corporate account?",
      answer: "Corporate entities must spend a portion of their profits on Corporate Social Responsibility (CSR) activities under Indian law. By enabling 'CSR Account' in your Profile settings, you gain access to an annual Utilization Certificate, compliance Excel/CSV export tables, and specialized board-room reports."
    },
    {
      category: "milestones",
      question: "What happens if an NGO fails a milestone audit?",
      answer: "If a milestone submission lacks clear proof or shows discrepancies, the AI validation score is marked low and the Admin rejects the proof. The NGO must submit correct and verified documents before moving to the next milestone and unlocking further funding."
    }
  ];

  const filteredFaqs = faqs.filter(faq => {
    const matchesCategory = activeCategory === "all" || faq.category === activeCategory;
    const matchesSearch = faq.question.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          faq.answer.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const categories = [
    { id: "all", name: "All FAQs" },
    { id: "general", name: "General Help" },
    { id: "donations", name: "Payments & Ledger" },
    { id: "tax", name: "80G & Tax Benefits" },
    { id: "milestones", name: "AI & Milestones" }
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      
      {/* Help Banner section */}
      <section className="bg-gradient-to-r from-gray-900 via-emerald-950 to-gray-900 py-16 px-4 sm:px-6 lg:px-8 text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full bg-grid-pattern opacity-10"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-3xl -z-10"></div>

        <div className="max-w-3xl mx-auto space-y-6">
          <h1 className="text-4xl font-black text-white tracking-tight sm:text-5xl">
            How can we help you today?
          </h1>
          <p className="text-sm text-emerald-200 max-w-xl mx-auto">
            Find answers to questions about milestone verifications, tax benefits, payment processing, and corporate compliance logs.
          </p>

          {/* Search Bar */}
          <div className="max-w-md mx-auto relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-gray-400 text-sm">🔍</span>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full pl-9 pr-4 py-3 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-2xl text-xs dark:text-white placeholder-gray-400 focus:outline-none transition-all shadow-sm"
              placeholder="Search help articles (e.g. 80G, AI score, Razorpay...)"
            />
          </div>
        </div>
      </section>

      {/* Main layout */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          
          {/* Left Sidebar: Categories Navigation */}
          <div className="lg:col-span-1 space-y-2">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-3 px-3">Help Categories</h3>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setActiveCategory(cat.id as any);
                  setOpenFAQIndex(null);
                }}
                className={`w-full text-left py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between ${
                  activeCategory === cat.id
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-900"
                }`}
              >
                <span>{cat.name}</span>
                {activeCategory === cat.id && <span className="text-[10px]">✨</span>}
              </button>
            ))}

            <div className="pt-8 px-3">
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl space-y-3">
                <span className="text-xl">📞</span>
                <h4 className="text-xs font-extrabold text-gray-900 dark:text-white">Direct Support</h4>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
                  Can't find what you're looking for? Reach out directly to our operations desk.
                </p>
                <a
                  href="mailto:support@impactbridge.org"
                  className="block text-center bg-white hover:bg-emerald-50 dark:bg-gray-900 dark:hover:bg-gray-800 text-emerald-800 dark:text-emerald-400 font-extrabold py-2 px-3 rounded-xl text-[10px] border border-emerald-100 dark:border-emerald-900/40 shadow-sm transition"
                >
                  Contact Support
                </a>
              </div>
            </div>
          </div>

          {/* Right Column: FAQ Accordion list */}
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Frequently Asked Questions</h2>
                <p className="text-xs text-gray-400">Select any question below to view detailed support guidance.</p>
              </div>

              {filteredFaqs.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-gray-200 dark:border-gray-800 rounded-2xl">
                  <span className="text-2xl mb-2 block">🔍</span>
                  <h4 className="text-xs font-bold text-gray-900 dark:text-white">No results found</h4>
                  <p className="text-[10px] text-gray-400 mt-1">Try searching for other keywords like "compliance" or "NGO".</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-850">
                  {filteredFaqs.map((faq, index) => {
                    const isOpen = openFAQIndex === index;
                    return (
                      <div key={index} className="py-4 first:pt-0 last:pb-0">
                        <button
                          onClick={() => setOpenFAQIndex(isOpen ? null : index)}
                          className="w-full flex justify-between items-center text-left py-2 focus:outline-none"
                        >
                          <span className="text-xs font-extrabold text-gray-900 dark:text-white hover:text-emerald-600 transition pr-4">
                            {faq.question}
                          </span>
                          <span className={`text-[10px] text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}>
                            ▼
                          </span>
                        </button>
                        
                        <div className={`overflow-hidden transition-all duration-300 ${
                          isOpen ? "max-h-[300px] mt-2 opacity-100" : "max-h-0 opacity-0"
                        }`}>
                          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed pl-1 bg-gray-50/50 dark:bg-gray-950/20 p-3 rounded-xl border border-gray-100/50 dark:border-gray-850/50">
                            {faq.answer}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
