import React from "react";
import Link from "next/link";

export default function Home() {
  const causes = [
    { name: "Education", icon: "📚", count: 12, desc: "Sponsor books, classrooms, and teacher training programs." },
    { name: "Healthcare", icon: "🏥", count: 8, desc: "Support mobile clinics, surgery funds, and medical equipment." },
    { name: "Environment", icon: "🌱", count: 5, desc: "Fund reforestation, waste management, and solar clean-tech." },
    { name: "Women Empowerment", icon: "👩", count: 9, desc: "Provide vocational skills, micro-loans, and legal advocacy." },
    { name: "Rural Development", icon: "🚜", count: 7, desc: "Build check dams, clean water wells, and village infrastructure." },
    { name: "Hunger relief", icon: "🍲", count: 14, desc: "Support community kitchens and nutritious food distribution." },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans selection:bg-emerald-500 selection:text-white">
      
      {/* Background Gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[600px] bg-gradient-to-b from-emerald-500/10 via-transparent to-transparent blur-3xl pointer-events-none -z-10" />



      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16 text-center space-y-8">
        <div className="space-y-4 max-w-4xl mx-auto">
          <h1 className="text-5xl sm:text-7xl font-black tracking-tight leading-[1.08]">
            Transparency you can <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">audit in real time</span>
          </h1>
          <p className="text-gray-400 text-lg sm:text-xl max-w-2xl mx-auto font-medium">
            ImpactBridge connects verified NGOs with donors using sequential milestone-based funding, AI-agent validations, and automated 80G tax receipt generation.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
          <Link
            href="/discover"
            className="w-full sm:w-auto bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-extrabold px-8 py-4 rounded-xl text-base shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all hover:-translate-y-0.5"
          >
            Find a Cause to Fund
          </Link>
          <Link
            href="/ngo/register"
            className="w-full sm:w-auto border border-gray-800 hover:border-gray-700 bg-gray-900/50 hover:bg-gray-900 text-white font-extrabold px-8 py-4 rounded-xl text-base transition-all hover:-translate-y-0.5"
          >
            Register your NGO
          </Link>
        </div>

        {/* Global Platform Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-12 max-w-4xl mx-auto">
          {[
            { value: "100%", label: "Milestone Transparency" },
            { value: "₹24.8L+", label: "Total Impact Donated" },
            { value: "50+", label: "Verified NGO Members" },
            { value: "< 5s", label: "Instant 80G Tax Receipts" },
          ].map((stat, i) => (
            <div key={i} className="p-6 bg-gray-900/40 border border-gray-900 rounded-2xl">
              <div className="text-3xl font-black text-white">{stat.value}</div>
              <div className="text-xs text-gray-500 font-bold mt-1 uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it Works / Trust Stepper */}
      <section className="border-t border-gray-900 bg-gray-900/20 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center space-y-3 mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">The ImpactBridge Trust Protocol</h2>
            <p className="text-gray-400 text-sm max-w-xl mx-auto">
              How we protect donor funds and guarantee that every rupee creates verified real-world impact.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Onboard & Audit",
                desc: "NGOs register with legal certificate documentation and PAN. Admins verify credentials before enabling any campaign building.",
              },
              {
                step: "02",
                title: "Sequential Milestones",
                desc: "NGOs launch campaigns with sequential milestones. Budget allocations are validated automatically to match target totals.",
              },
              {
                step: "03",
                title: "AI-Audited Outcomes",
                desc: "NGOs submit receipts and photo evidence. Gemini AI reviews proof speed and validity to release subsequent funding blocks.",
              },
            ].map((item, idx) => (
              <div key={idx} className="bg-gray-900/35 border border-gray-900 rounded-2xl p-8 relative overflow-hidden group hover:border-gray-800 transition">
                <span className="absolute -right-4 -bottom-6 text-8xl font-black text-gray-900/30 font-mono select-none group-hover:text-emerald-500/5 transition">
                  {item.step}
                </span>
                <div className="w-10 h-10 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl flex items-center justify-center font-bold mb-5">
                  {idx + 1}
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{item.title}</h3>
                <p className="text-gray-400 text-xs leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Causes grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 space-y-12">
        <div className="flex justify-between items-end">
          <div className="space-y-2">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Explore Causes</h2>
            <p className="text-gray-400 text-sm max-w-md">
              Find non-profits operating in key developmental cause sectors.
            </p>
          </div>
          <Link href="/discover" className="text-emerald-400 hover:text-emerald-300 font-bold text-sm flex items-center gap-1">
            See all sectors <span>→</span>
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {causes.map((cause) => (
            <Link
              key={cause.name}
              href={`/discover?causes=${encodeURIComponent(cause.name)}`}
              className="bg-gray-900/30 border border-gray-900 hover:border-gray-800 rounded-2xl p-6 transition-all hover:-translate-y-1 hover:shadow-lg hover:shadow-emerald-500/5 group"
            >
              <div className="flex justify-between items-start mb-4">
                <span className="text-3xl p-3 bg-gray-900 border border-gray-800 rounded-2xl group-hover:bg-emerald-950/20 group-hover:border-emerald-900/50 transition">
                  {cause.icon}
                </span>
                <span className="text-[10px] font-bold text-gray-500 uppercase">
                  {cause.count} Campaigns
                </span>
              </div>
              <h3 className="text-base font-bold text-white mb-1 group-hover:text-emerald-400 transition">{cause.name}</h3>
              <p className="text-xs text-gray-400 leading-relaxed">{cause.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-900 bg-gray-950 py-12 text-center text-xs text-gray-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
          <div className="flex justify-center items-center gap-2">
            <span className="text-base font-black bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
              ImpactBridge
            </span>
            <span className="mx-2">•</span>
            <span>© 2026 Trust donation network. All rights reserved.</span>
          </div>
          <div className="flex justify-center gap-6 text-[10px] font-bold text-gray-500">
            <Link href="/discover" className="hover:text-white transition">Discover</Link>
            <Link href="/ngo/register" className="hover:text-white transition">Join as NGO</Link>
            <Link href="/admin/dashboard" className="hover:text-white transition">Admin Panel</Link>
          </div>
        </div>
      </footer>

    </div>
  );
}
