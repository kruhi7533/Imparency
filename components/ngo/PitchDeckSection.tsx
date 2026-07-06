"use client";

import React, { useState, useEffect } from 'react';
import { FaFilePowerpoint, FaSync, FaShareAlt, FaCheck, FaSpinner, FaHandHoldingHeart } from 'react-icons/fa';
import { useSession } from 'next-auth/react';

export default function PitchDeckSection() {
  const { data: session } = useSession();
  type DownloadState = 'idle' | 'loading' | 'success' | 'error';
  type RegenState = 'idle' | 'loading' | 'success' | 'error';

  const [dlState, setDlState] = useState<DownloadState>('idle');
  const [regenState, setRegenState] = useState<RegenState>('idle');
  const [shared, setShared] = useState(false);
  const [meta, setMeta] = useState<{ generatedAt: string | null, fileSizeKb: number | null, leadCount: number } | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('organization');
  const [audience, setAudience] = useState<'indian' | 'foreign'>('indian');
  const [projects, setProjects] = useState<{id: string, title: string}[]>([]);

  useEffect(() => {
    fetch('/api/ngo/projects')
      .then(res => res.json())
      .then(data => {
        if (data.projects) setProjects(data.projects);
      })
      .catch(console.error);
  }, []);
  useEffect(() => {
    let query = selectedProjectId !== 'organization' ? `?projectId=${selectedProjectId}&` : '?';
    query += `audience=${audience}`;
    fetch(`/api/pitch/meta${query}`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) setMeta(data);
      })
      .catch(console.error);
  }, [regenState, selectedProjectId, audience]);

  useEffect(() => {
    if (dlState === 'success') {
      const t = setTimeout(() => setDlState('idle'), 3000);
      return () => clearTimeout(t);
    }
  }, [dlState]);

  useEffect(() => {
    if (regenState === 'success') {
      const t = setTimeout(() => setRegenState('idle'), 3000);
      return () => clearTimeout(t);
    }
  }, [regenState]);

  const canRegenerate = session?.user?.role === 'NGO' || session?.user?.role === 'ADMIN';

  async function downloadDeck() {
    setDlState('loading');
    try {
      let query = selectedProjectId !== 'organization' ? `?projectId=${selectedProjectId}&` : '?';
      query += `audience=${audience}&t=${Date.now()}`;
      const res = await fetch(`/api/pitch/generate${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const projSuffix = selectedProjectId !== 'organization' ? `_${selectedProjectId}` : '';
      const audSuffix = audience === 'foreign' ? '_foreign' : '_indian';
      a.download = `ImpactBridge_Pitch_Deck${projSuffix}${audSuffix}.pptx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDlState('success');
    } catch (err) {
      console.error('[pitch] Download failed:', err);
      setDlState('error');
    }
  }

  async function regenerateDeck() {
    setRegenState('loading');
    try {
      let query = selectedProjectId !== 'organization' ? `?projectId=${selectedProjectId}&` : '?';
      query += `audience=${audience}`;
      const res = await fetch(`/api/pitch/generate${query}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Regeneration failed');
      setRegenState('success');
    } catch (err) {
      console.error('[pitch] Regeneration failed:', err);
      setRegenState('error');
    }
  }

  function shareLink() {
    const projSuffix = selectedProjectId !== 'organization' ? `_${selectedProjectId}` : '';
    const audSuffix = audience === 'foreign' ? '_foreign' : '_indian';
    const fileName = `ImpactBridge_Pitch_Deck${projSuffix}${audSuffix}.pptx`;
    const url = window.location.origin + '/downloads/' + fileName;
    navigator.clipboard.writeText(url);
    setShared(true);
    setTimeout(() => setShared(false), 2000);
  }

  const slides = [
    { num: 1,  title: "Cover",                  desc: "Headline and key metrics" },
    { num: 2,  title: "The problem",             desc: "Why trust in NGOs is broken" },
    { num: 3,  title: "Our solution",            desc: "ImpactBridge's four pillars" },
    { num: 4,  title: "How it works",            desc: "5-step pipeline" },
    { num: 5,  title: "Transparency workflow",   desc: "Allocated → Utilized timeline" },
    { num: 6,  title: "Market opportunity",      desc: "₹85,000 Cr addressable market" },
    { num: 7,  title: "For foreign donors",      desc: "FCRA, 501c3, USD payments" },
    { num: 8,  title: "Technology stack",        desc: "Flutter, Firebase, Gemini, Twilio" },
    { num: 9,  title: "Traction & roadmap",      desc: "Current state + 2-year plan" },
    { num: 10, title: "Impact model",            desc: "Revenue streams + projections" },
    { num: 11, title: "The ask",                 desc: "Three funding tiers" },
    { num: 12, title: "Close",                   desc: "Contact and call to action" },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg mt-8">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-800 bg-slate-800/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-teal-500/20 text-teal-400 rounded-lg">
            <FaFilePowerpoint className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">Donor Pitch Deck</h3>
            <p className="text-sm text-slate-400 mt-0.5">Share ImpactBridge's story with potential donors — foreign or Indian</p>
          </div>
        </div>
        
        {meta && meta.leadCount > 0 && (
          <div className="ml-auto hidden sm:flex bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-full items-center">
            {meta.leadCount} {meta.leadCount === 1 ? 'download' : 'downloads'}
          </div>
        )}

        <button 
          onClick={shareLink}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors border border-slate-700 shrink-0"
        >
          {shared ? <FaCheck className="text-emerald-400" /> : <FaShareAlt />}
          {shared ? "Link copied!" : "Share Link"}
        </button>
      </div>

      {/* Body */}
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Left Column */}
        <div className="flex flex-col">
          {/* Thumbnail */}
          <div className="aspect-video w-full rounded-lg bg-[#0A1628] border border-slate-800 flex flex-col items-center justify-between shadow-inner relative overflow-hidden mb-3 p-6">
            <div className="absolute inset-0 bg-slate-900/40 mix-blend-multiply pointer-events-none" />
            
            {/* Top: logo row */}
            <div className="w-full flex items-center justify-between z-10">
              <span className="text-white font-bold tracking-wide flex items-center gap-2">
                <FaHandHoldingHeart className="text-teal-400" /> ImpactBridge
              </span>
              <span className="text-[10px] font-bold text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded-full uppercase tracking-wider border border-teal-500/20">NGO</span>
            </div>

            {/* Middle: headline */}
            <div className="z-10 text-center w-full my-auto">
              <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight font-serif leading-tight">
                Every Rupee.<br/>Proven.
              </h2>
            </div>

            {/* Bottom: 3 mini stats */}
            <div className="w-full grid grid-cols-3 gap-2 z-10 mt-auto pt-4 border-t border-slate-700/50">
              <div className="text-center">
                <div className="text-teal-400 font-bold text-lg leading-none">100%</div>
                <div className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold mt-1">Tracked</div>
              </div>
              <div className="text-center border-l border-r border-slate-700/50">
                <div className="text-teal-400 font-bold text-lg leading-none">AI+GPS</div>
                <div className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold mt-1">Verified</div>
              </div>
              <div className="text-center">
                <div className="text-teal-400 font-bold text-lg leading-none">80G</div>
                <div className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold mt-1">Tax receipt</div>
              </div>
            </div>
          </div>
          
          <div className="text-center mb-6">
            <p className="text-sm font-medium text-slate-400">
              12 slides · {meta?.fileSizeKb ? `${meta.fileSizeKb} KB` : 'PPTX'} · Updated automatically
              {meta?.generatedAt && (
                <> · Last generated: {new Date(meta.generatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
              )}
            </p>
          </div>

          <div className="space-y-3 mt-auto">
            {projects.length > 0 && (
              <div className="mb-2">
                <select 
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-300 font-medium text-sm rounded-lg focus:ring-teal-500 focus:border-teal-500 block p-2.5 transition-colors cursor-pointer mb-2"
                >
                  <option value="organization">Organizational Deck (Generic)</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>Campaign: {p.title}</option>
                  ))}
                </select>
                
                <select 
                  value={audience}
                  onChange={(e) => setAudience(e.target.value as 'indian' | 'foreign')}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-300 font-medium text-sm rounded-lg focus:ring-teal-500 focus:border-teal-500 block p-2.5 transition-colors cursor-pointer"
                >
                  <option value="indian">Audience: Indian Donors (₹ INR)</option>
                  <option value="foreign">Audience: Foreign/NRI Donors ($ USD)</option>
                </select>
              </div>
            )}

            <button
              onClick={downloadDeck}
              disabled={dlState === 'loading'}
              className="w-full flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              {dlState === 'loading' && <><FaSpinner className="animate-spin" /> Generating deck...</>}
              {dlState === 'success' && <><FaCheck /> Downloaded!</>}
              {dlState === 'error' && "Download failed — retry"}
              {dlState === 'idle' && "Download Pitch Deck (.pptx)"}
            </button>

            {canRegenerate && (
              <div className="flex flex-col items-center">
                <button
                  onClick={regenerateDeck}
                  disabled={regenState === 'loading' || dlState === 'loading'}
                  className="w-full flex items-center justify-center gap-2 bg-transparent hover:bg-slate-800 border border-slate-700 disabled:border-slate-800 disabled:text-slate-600 text-slate-300 font-medium py-2 px-4 rounded-lg transition-colors text-sm"
                >
                  {regenState === 'loading' ? (
                    <><FaSpinner className="animate-spin" /> Regenerating...</>
                  ) : regenState === 'success' ? (
                    <><FaCheck className="text-emerald-400" /> Deck updated!</>
                  ) : regenState === 'error' ? (
                    "Regeneration failed — retry"
                  ) : (
                    <><FaSync /> Regenerate Deck</>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="flex flex-col">
          <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Slide Overview</h4>
          
          <div className="flex items-center flex-wrap gap-2 mb-4">
            <span className="text-xs text-slate-500 mr-1">Designed for:</span>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-300 bg-slate-800 border border-slate-700 px-2 py-1 rounded-md">Indian donors</span>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-300 bg-slate-800 border border-slate-700 px-2 py-1 rounded-md">Foreign / NRI donors</span>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-300 bg-slate-800 border border-slate-700 px-2 py-1 rounded-md">CSR teams</span>
          </div>

          <div className="flex-1 bg-slate-950/50 border border-slate-800/50 rounded-lg p-2">
            <div className="space-y-1">
              {slides.map((slide) => (
                <React.Fragment key={slide.num}>
                  <div className="flex items-start gap-3 p-2.5 rounded hover:bg-slate-800/50 transition-colors">
                    <div className="flex items-center justify-center min-w-6 h-6 rounded bg-slate-800 text-teal-400 text-xs font-bold shrink-0 mt-0.5">
                      {slide.num}
                    </div>
                    <div>
                      <h5 className="text-sm font-medium text-slate-200 flex items-center gap-2">
                        {slide.title}
                        {(slide.num === 5 || slide.num === 11) && (
                          <span title="Most impactful slide" className="text-amber-500 text-sm cursor-help">★</span>
                        )}
                      </h5>
                      <p className="text-xs text-slate-400 mt-0.5 leading-snug">{slide.desc}</p>
                    </div>
                  </div>
                  {slide.num === 7 && (
                    <div className="flex items-center my-2 opacity-50">
                      <div className="flex-1 h-px bg-slate-700"></div>
                      <div className="mx-2 text-[10px] uppercase font-bold text-slate-400 tracking-wider">Technical & Financial</div>
                      <div className="flex-1 h-px bg-slate-700"></div>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
