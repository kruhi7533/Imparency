"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

type Faq = { question: string; answer: string };

const DONOR_FAQS: Faq[] = [
  {
    question: "How do I get my 80G tax receipt?",
    answer: "Your receipt is automatically generated after a successful payment and emailed to you. You can also download it from Donation History under your donor dashboard."
  },
  {
    question: "Why did my payment fail?",
    answer: "Payment failures are usually temporary network or bank issues. ImpactBridge retries automatically and sends a retry link to your email if the issue persists. Click the link to complete your donation within 24 hours."
  },
  {
    question: "How do I know my donation reached the NGO?",
    answer: "Every donation is tied to a project milestone. When the NGO submits verified proof of completion, you receive a personal impact report showing exactly how your funds were used."
  }
];

const NGO_FAQS: Faq[] = [
  {
    question: "How do I submit proof for a milestone?",
    answer: "Open the milestone from your project in Delivery > Field app, then upload photos, documents, or WhatsApp-submitted evidence. Submissions move to Admin for verification before funds are marked as utilised."
  },
  {
    question: "Why is a milestone stuck in review?",
    answer: "Admin verifies every proof submission before it's marked complete. If evidence is missing or unclear, the milestone is returned with a note explaining what's needed — check Reporting for the specific reason."
  },
  {
    question: "How do I invite a team member or field worker?",
    answer: "Go to Organisation > Team to send an invite by email. Assign a role (Admin, Finance, or Field Staff) to control what they can see and act on — field staff only see the Field app."
  },
  {
    question: "How do CSR contracts and payments work?",
    answer: "Accepted CSR opportunities move to Contracts, where you can review terms, sign, and track disbursements. Payments are recorded against contract milestones and confirmed once funds are received."
  },
  {
    question: "Why is my organisation profile flagged as unverified?",
    answer: "Verification runs automatically on your registration documents. Missing or mismatched fields (like your 12A/80G details) are flagged for admin review under Organisation profile — resolve them there to clear the flag."
  }
];

const ADMIN_FAQS: Faq[] = [
  {
    question: "Where do I review flagged NGO documents?",
    answer: "Risk & Compliance lists every open RiskReview with the specific finding (name mismatch, missing field, fraud alert). Each one links to the source document and extracted fields."
  },
  {
    question: "How do I approve or return an outcome claim?",
    answer: "Open the claim under Metrics. A NEEDS_REVIEW triage can still be approved with a note; a BLOCKED claim cannot be approved until the underlying evidence issue is resolved."
  },
  {
    question: "Where is admin action logged?",
    answer: "Every admin route logs to the audit trail by id only (no names, emails, or amounts). You can review recent actions from Activity log."
  }
];

function faqsForRole(role?: string | null): { faqs: Faq[]; intro: string } {
  if (role === "NGO") {
    return {
      faqs: NGO_FAQS,
      intro: "Guides for submitting milestone proof, managing your team, and tracking CSR contracts and payments."
    };
  }
  if (role === "ADMIN") {
    return {
      faqs: ADMIN_FAQS,
      intro: "Reference for NGO verification, outcome claim review, and the admin audit trail."
    };
  }
  return {
    faqs: DONOR_FAQS,
    intro: "Answers to common questions about milestone donations, 80G tax claims, and payment tracking."
  };
}

export default function HelpPage() {
  const { data: session } = useSession();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleAccordion = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  const role = (session?.user as { role?: string } | undefined)?.role;
  const { faqs, intro } = faqsForRole(role);
  const backHref = role === "NGO" ? "/ngo/dashboard" : role === "ADMIN" ? "/admin/dashboard" : "/discover";
  const backLabel = role === "NGO" ? "Back to Dashboard" : role === "ADMIN" ? "Back to Dashboard" : "Back to Discovery";

  return (
    <div className="min-h-screen bg-canvas text-gray-800 font-sans pb-16 relative">

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 text-left">
        
        {/* Navigation Link */}
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs font-bold text-gray-600 hover:text-trust-700 transition mb-8"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          {backLabel}
        </Link>

        {/* Page Header */}
        <header className="mb-10 space-y-1.5 border-b border-gray-200 pb-6">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-gray-900">Help & Support</h1>
          <p className="text-gray-600 text-sm">{intro}</p>
        </header>

        {/* Accordion List */}
        <section className="space-y-3 mb-10">
          {faqs.map((faq, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div
                key={idx}
                className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:border-gray-300"
              >
                <button
                  onClick={() => toggleAccordion(idx)}
                  className="w-full py-4 px-5 text-left flex justify-between items-center gap-4 focus:outline-none"
                >
                  <span className="font-semibold text-sm text-gray-900 select-none leading-snug">
                    {faq.question}
                  </span>
                  <span className="text-gray-600 shrink-0">
                    <svg
                      className={`w-4 h-4 text-gray-600 transition-transform duration-200 ${isOpen ? "rotate-180 text-trust-600" : ""}`}
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
                    isOpen ? "max-h-96 border-t border-gray-200" : "max-h-0"
                  }`}
                >
                  <p className="p-5 text-sm text-gray-600 leading-relaxed bg-white">
                    {faq.answer}
                  </p>
                </div>
              </div>
            );
          })}
        </section>

        {/* Contact support section */}
        <section className="bg-white border border-gray-200 rounded-2xl p-5 text-left space-y-1 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h3 className="font-bold text-gray-900 text-sm">Still need help?</h3>
          <p className="text-xs text-gray-500">
            Email us at{" "}
            <a href="mailto:support@impactbridge.in" className="text-trust-700 hover:text-trust-800 font-semibold underline">
              support@impactbridge.in
            </a>
          </p>
        </section>

      </main>
    </div>
  );
}
