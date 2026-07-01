"use client";

import React, { useState } from "react";
import Link from "next/link";

export default function HelpPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleAccordion = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  const faqs = [
    {
      question: "How do I get my 80G tax receipt?",
      answer: "Your receipt is automatically generated after a successful payment and emailed to you. You can also download it from Donation History under your donor dashboard."
    },
    {
      question: "Why did my payment fail?",
      answer: "Payment failures are usually temporary network or bank issues. Imparency retries automatically and sends a retry link to your email if the issue persists. Click the link to complete your donation within 24 hours."
    },
    {
      question: "How do I know my donation reached the NGO?",
      answer: "Every donation is tied to a project milestone. When the NGO submits verified proof of completion, you receive a personal impact report showing exactly how your funds were used."
    }
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans pb-16 relative">
      {/* Decorative glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -z-10 pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl -z-10 pointer-events-none" />

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 text-left">
        
        {/* Navigation Link */}
        <Link
          href="/discover"
          className="inline-flex items-center gap-1 text-xs font-bold text-gray-400 hover:text-emerald-400 transition mb-8"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Discovery
        </Link>

        {/* Page Header */}
        <header className="mb-10 space-y-1.5 border-b border-gray-900 pb-6">
          <h1 className="text-2xl font-black text-white">Help & Support</h1>
          <p className="text-gray-400 text-sm">Answers to common questions about milestone donations, 80G tax claims, and payment tracking.</p>
        </header>

        {/* Accordion List */}
        <section className="space-y-3 mb-10">
          {faqs.map((faq, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div
                key={idx}
                className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden transition hover:border-gray-750"
              >
                <button
                  onClick={() => toggleAccordion(idx)}
                  className="w-full py-4 px-5 text-left flex justify-between items-center gap-4 focus:outline-none"
                >
                  <span className="font-extrabold text-xs sm:text-sm text-white select-none leading-snug">
                    {faq.question}
                  </span>
                  <span className="text-gray-400 shrink-0">
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-180 text-emerald-450" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </button>
                
                <div
                  className={`transition-all duration-300 ease-in-out overflow-hidden ${
                    isOpen ? "max-h-40 border-t border-gray-850" : "max-h-0"
                  }`}
                >
                  <p className="p-5 text-xs text-gray-400 leading-relaxed font-medium bg-gray-900/50">
                    {faq.answer}
                  </p>
                </div>
              </div>
            );
          })}
        </section>

        {/* Contact support section */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-left space-y-1">
          <h3 className="font-bold text-white text-sm">Still need help?</h3>
          <p className="text-xs text-gray-500">
            Email us at{" "}
            <a href="mailto:support@imparency.in" className="text-emerald-400 hover:text-emerald-300 font-bold underline">
              support@imparency.in
            </a>
          </p>
        </section>

      </main>
    </div>
  );
}
