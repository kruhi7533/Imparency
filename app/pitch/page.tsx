"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { FaHandHoldingHeart, FaDownload, FaArrowRight, FaChartPie, FaMobileAlt, FaGlobe, FaHandshake, FaRupeeSign, FaBuilding, FaCheck } from 'react-icons/fa';

export default function PitchDeckPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = '/api/pitch/generate';
    a.download = 'ImpactBridge_Pitch_Deck.pptx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/pitch/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, organization })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit');
      
      // Trigger download on success
      handleDownload();
      
      // Clear form
      setName('');
      setEmail('');
      setOrganization('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen font-sans">
      
      {/* 1. HERO SECTION */}
      <section className="bg-slate-900 text-white pt-24 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="flex items-center justify-center gap-3 mb-6">
            <FaHandHoldingHeart className="w-10 h-10 text-teal-400" />
            <span className="text-2xl font-bold tracking-tight">ImpactBridge</span>
          </div>
          
          <h1 className="text-5xl md:text-6xl font-serif font-bold mb-6 text-slate-50">
            Every Rupee. Proven.
          </h1>
          
          <p className="text-xl md:text-2xl text-slate-300 mb-10 max-w-2xl mx-auto leading-relaxed">
            Download our investor & donor pitch deck to learn how we're building India's most transparent donation platform.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
            <button 
              onClick={handleDownload}
              className="w-full sm:w-auto px-8 py-4 bg-teal-600 hover:bg-teal-500 text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors text-lg"
            >
              <FaDownload />
              Download Pitch Deck (Free)
            </button>
            <a 
              href="https://docs.google.com/presentation/d/placeholder" 
              target="_blank" rel="noopener noreferrer"
              className="w-full sm:w-auto px-8 py-4 bg-transparent border border-slate-600 hover:bg-slate-800 text-slate-300 font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors text-lg"
            >
              View on Google Slides <FaArrowRight />
            </a>
          </div>

          <div className="flex items-center justify-center gap-6 text-slate-400 text-sm font-medium">
            <span>12 Slides</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span>Last updated: {new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span>PDF + PPTX</span>
          </div>
        </div>
      </section>

      {/* 2. WHAT'S INSIDE */}
      <section className="bg-slate-50 py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-slate-900 text-center mb-12">What's in the deck?</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center mb-4 text-xl">
                <FaChartPie />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">The Opportunity</h3>
              <p className="text-slate-600 text-sm">₹85,000 Cr addressable market with a massive 68% donor trust gap waiting to be solved.</p>
            </div>
            
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
              <div className="w-12 h-12 bg-teal-100 text-teal-600 rounded-lg flex items-center justify-center mb-4 text-xl">
                <FaMobileAlt />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">The Technology</h3>
              <p className="text-slate-600 text-sm">How we use WhatsApp, Gemini AI verification, and real-time dashboards to prove impact.</p>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
              <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center mb-4 text-xl">
                <FaGlobe />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">For Foreign Donors</h3>
              <p className="text-slate-600 text-sm">Our streamlined FCRA compliance, 501c3 tax receipts, and international payment rails.</p>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
              <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-lg flex items-center justify-center mb-4 text-xl">
                <FaHandshake />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">The Ask</h3>
              <p className="text-slate-600 text-sm">Three clear partnership tiers for seed funders, campaign sponsors, and impact partners.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. DESIGNED FOR */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-slate-900 text-center mb-4">Designed for every type of donor</h2>
          <p className="text-center text-slate-600 mb-12 max-w-2xl mx-auto">The pitch deck outlines our specialized products for different donor segments, ensuring compliance, trust, and ease of use.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-200">
              <FaRupeeSign className="text-4xl text-emerald-600 mb-6" />
              <h3 className="text-xl font-bold text-slate-900 mb-3">Indian Donors & HNIs</h3>
              <ul className="space-y-3 text-slate-600">
                <li className="flex items-start gap-2"><FaCheck className="text-emerald-500 mt-1 shrink-0" /> Automated 80G tax deductions</li>
                <li className="flex items-start gap-2"><FaCheck className="text-emerald-500 mt-1 shrink-0" /> Zero-fee UPI payments</li>
                <li className="flex items-start gap-2"><FaCheck className="text-emerald-500 mt-1 shrink-0" /> Vernacular WhatsApp updates</li>
              </ul>
            </div>

            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-200">
              <FaGlobe className="text-4xl text-blue-600 mb-6" />
              <h3 className="text-xl font-bold text-slate-900 mb-3">Foreign Donors & Diaspora</h3>
              <ul className="space-y-3 text-slate-600">
                <li className="flex items-start gap-2"><FaCheck className="text-blue-500 mt-1 shrink-0" /> FCRA compliance baked-in</li>
                <li className="flex items-start gap-2"><FaCheck className="text-blue-500 mt-1 shrink-0" /> USD/GBP/EUR payment gateways</li>
                <li className="flex items-start gap-2"><FaCheck className="text-blue-500 mt-1 shrink-0" /> 501c3 tax receipts (US donors)</li>
              </ul>
            </div>

            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-200">
              <FaBuilding className="text-4xl text-indigo-600 mb-6" />
              <h3 className="text-xl font-bold text-slate-900 mb-3">Corporate CSR Teams</h3>
              <ul className="space-y-3 text-slate-600">
                <li className="flex items-start gap-2"><FaCheck className="text-indigo-500 mt-1 shrink-0" /> Enterprise audit trails</li>
                <li className="flex items-start gap-2"><FaCheck className="text-indigo-500 mt-1 shrink-0" /> Automated compliance reporting</li>
                <li className="flex items-start gap-2"><FaCheck className="text-indigo-500 mt-1 shrink-0" /> Milestone-based fund tracking</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 4. DOWNLOAD SECTION */}
      <section className="bg-slate-900 py-24 px-6 border-t border-slate-800">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-white mb-3">Ready to make an impact?</h2>
            <p className="text-slate-400">Enter your details to receive the latest version of the ImpactBridge pitch deck instantly.</p>
          </div>

          <form onSubmit={handleSubmit} className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl mb-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Full Name</label>
                <input 
                  type="text" required
                  value={name} onChange={e => setName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  placeholder="Jane Doe"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Email Address</label>
                <input 
                  type="email" required
                  value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  placeholder="jane@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Organization <span className="text-slate-500">(Optional)</span></label>
                <input 
                  type="text"
                  value={organization} onChange={e => setOrganization(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  placeholder="Company or Fund Name"
                />
              </div>

              {error && <p className="text-red-400 text-sm py-1">{error}</p>}

              <button 
                type="submit" disabled={loading}
                className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-3 rounded-lg transition-colors mt-2 disabled:opacity-70 flex justify-center items-center gap-2"
              >
                {loading ? "Processing..." : "Get the Deck"}
              </button>
            </div>
            
            <p className="text-xs text-slate-500 text-center mt-4">
              We'll never spam. Unsubscribe anytime.
            </p>
          </form>

          <div className="text-center">
            <button 
              onClick={handleDownload}
              className="text-slate-400 hover:text-white text-sm underline decoration-slate-600 underline-offset-4 transition-colors"
            >
              Skip form — download directly
            </button>
          </div>
        </div>
      </section>

      {/* 5. FOOTER */}
      <footer className="bg-slate-950 py-10 px-6 border-t border-slate-900">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <FaHandHoldingHeart className="text-teal-500 w-5 h-5" />
            <span className="text-white font-bold tracking-wide">ImpactBridge</span>
            <span className="text-slate-500 text-sm ml-2">© {new Date().getFullYear()}</span>
          </div>
          
          <div className="flex items-center gap-6">
            <a href="mailto:hello@impactbridge.in" className="text-slate-400 hover:text-white text-sm transition-colors">
              hello@impactbridge.in
            </a>
            <Link href="/" className="text-slate-400 hover:text-white text-sm transition-colors">
              Back to Platform
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
