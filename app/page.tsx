import React from "react";
import Link from "next/link";
import { BookOpen, HeartPulse, Sprout, Users, Tractor, Soup, CheckCircle2 } from "lucide-react";
import QuickDonateSelector from "@/components/home/QuickDonateSelector";
import CountUpStat from "@/components/home/CountUpStat";
import LiveActivityFeed from "@/components/home/LiveActivityFeed";
import TiltCard from "@/components/home/TiltCard";
import SmoothScroll from "@/components/home/SmoothScroll";
import Reveal from "@/components/home/Reveal";
import NgoMarquee from "@/components/home/NgoMarquee";
import BridgeArt from "@/components/home/BridgeArt";
import HeroField from "@/components/home/HeroField";
import ImpactStories from "@/components/home/ImpactStories";
import { getPlatformStats } from "@/lib/platform-stats";

export const revalidate = 60;

export default async function Home() {
  const stats = await getPlatformStats();

  const causes = [
    { name: "Education", icon: BookOpen, desc: "Sponsor books, classrooms, and teacher training programs." },
    { name: "Healthcare", icon: HeartPulse, desc: "Support mobile clinics, surgery funds, and medical equipment." },
    { name: "Environment", icon: Sprout, desc: "Fund reforestation, waste management, and solar clean-tech." },
    { name: "Women Empowerment", icon: Users, desc: "Provide vocational skills, micro-loans, and legal advocacy." },
    { name: "Rural Development", icon: Tractor, desc: "Build check dams, clean water wells, and village infrastructure." },
    { name: "Hunger", icon: Soup, desc: "Support community kitchens and nutritious food distribution." },
  ];

  const latest = stats.recentActivity[0];

  return (
    <div className="relative isolate min-h-screen bg-gray-950 text-white font-sans selection:bg-trust-500 selection:text-white">

      <SmoothScroll />

      {/* Hero atmosphere — navy radial wash + faint ledger rules, so the
          opening viewport reads as brand paper, not a black void */}
      <div
        aria-hidden
        className="absolute top-0 inset-x-0 h-[95vh] pointer-events-none -z-10 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(60,98,186,0.28),transparent_70%)]"
      />
      <div
        aria-hidden
        className="absolute top-0 inset-x-0 h-[85vh] pointer-events-none -z-10 bg-[repeating-linear-gradient(to_bottom,transparent,transparent_55px,rgba(142,169,224,0.05)_55px,rgba(142,169,224,0.05)_56px)] [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />
      {/* The living sea — 3D particle water under the bridge, faded at both
          edges so it stays atmosphere, never noise behind the headline */}
      <div
        aria-hidden
        className="absolute top-0 inset-x-0 h-[95vh] pointer-events-none -z-10 [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_72%,transparent)]"
      >
        <HeroField />
      </div>

      {/* Hero — full-viewport statement */}
      <section className="min-h-[85vh] flex items-center">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full text-center space-y-10">
          <h1 className="font-display font-semibold text-5xl sm:text-7xl lg:text-8xl tracking-tight leading-[1.25] sm:leading-[1.2]">
            <Reveal>Transparency you can</Reveal>
            <Reveal delay={0.12}>
              <span className="italic text-gold-300">audit in real time</span>
            </Reveal>
          </h1>
          <Reveal delay={0.24}>
            <p className="text-gray-400 text-lg sm:text-xl max-w-2xl mx-auto">
              Every campaign here is split into milestones. NGOs get funds one
              step at a time, and the next instalment is released only after
              their receipts and photos pass review. Your 80G tax receipt
              arrives on its own — no forms, no follow-up emails.
            </p>
          </Reveal>

          <Reveal delay={0.34}>
            <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
              <Link
                href="/discover"
                className="w-full sm:w-auto bg-trust-600 hover:bg-trust-500 text-white font-semibold px-8 py-4 rounded-lg text-base transition"
              >
                Browse campaigns
              </Link>
              <Link
                href="/ngo/register"
                className="w-full sm:w-auto border border-gray-800 hover:border-gray-700 bg-gray-900/50 hover:bg-gray-900 text-white font-semibold px-8 py-4 rounded-lg text-base transition"
              >
                Register your NGO
              </Link>
            </div>
          </Reveal>

          {/* A fragment of the real audit trail, sitting quietly in the hero */}
          <Reveal delay={0.44}>
            <p className="font-mono text-[11px] uppercase tracking-widest text-gold-400/90">
              {latest
                ? `Last verified donation · ₹${latest.amount.toLocaleString("en-IN")} · ${latest.projectTitle}`
                : "Awaiting the first verified donation"}
            </p>
          </Reveal>
        </div>
      </section>

      {/* The bridge, drawn as line-art — an honest diagram of the product,
          not a stock photo and not AI imagery */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        <BridgeArt />
      </section>

      {/* Verified NGOs marquee — the "partners strip", except every name is real */}
      <NgoMarquee names={stats.verifiedNgoNames} />

      {/* The ledger so far — oversized real numbers, live from the database */}
      <section id="numbers" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-28 space-y-16">
        <p className="font-mono text-[11px] uppercase tracking-widest text-gold-400 text-center">
          The ledger so far
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-12">
          <CountUpStat
            value={stats.totalDonated}
            format="compact-inr"
            label="Donated so far"
            emptyLabel="Just getting started"
            accent
          />
          <CountUpStat
            value={stats.verifiedNgoCount}
            label="Verified NGOs"
            emptyLabel="Onboarding our first NGOs"
            index={1}
          />
          <CountUpStat
            value={stats.activeProjectCount}
            label="Active Campaigns"
            emptyLabel="First campaigns coming soon"
            index={2}
          />
          <CountUpStat
            value={stats.completedMilestoneCount}
            label="Milestones Verified"
            emptyLabel="No milestones cleared yet"
            index={3}
          />
        </div>

        {/* Live activity — real, recent donations, not a vanity metric */}
        <LiveActivityFeed activity={stats.recentActivity} />
      </section>

      {/* How it Works / Trust Stepper */}
      <section id="protocol" className="border-t border-gray-900 bg-gray-900/20 py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center space-y-3 mb-16">
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">How the money actually moves</h2>
            <p className="text-gray-400 text-sm max-w-xl mx-auto">
              No lump-sum transfers. Three checkpoints stand between a donation and the last rupee spent.
            </p>
          </div>

          {/* Milestone stepper — the same sequential-release shape donors see on every campaign */}
          <div className="grid grid-cols-1 md:grid-cols-3 max-w-xl md:max-w-none mx-auto">
            {[
              {
                step: "01",
                title: "NGOs are vetted before they can raise a rupee",
                desc: "Registration certificate and PAN are checked by our team. An NGO can't publish a campaign until it passes.",
              },
              {
                step: "02",
                title: "Budgets are split into milestones",
                desc: "A ₹5 lakh campaign isn't a ₹5 lakh transfer. It's a series of smaller releases, each tied to a specific piece of work with its own budget and deadline.",
              },
              {
                step: "03",
                title: "Proof unlocks the next release",
                desc: "The NGO uploads receipts and photos when a milestone is done. The evidence is screened by AI and reviewed by a person — only then does the next instalment move.",
              },
            ].map((item, idx, arr) => {
              const isLast = idx === arr.length - 1;
              return (
                <div
                  key={idx}
                  className={`relative pl-12 pb-14 md:pl-0 md:pb-0 md:pt-14 md:pr-10 text-left border-l-2 md:border-l-0 md:border-t-2 ${
                    isLast ? "border-l-transparent md:border-t-gray-700" : "border-l-gray-700 md:border-t-gray-700"
                  }`}
                >
                  <span className="absolute -left-[19px] top-0 md:left-0 md:top-0 md:-translate-y-1/2 w-9 h-9 rounded-full bg-gray-900 border-2 border-gray-700 flex items-center justify-center">
                    {isLast ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" strokeWidth={2} />
                    ) : (
                      <span className="font-mono text-xs text-trust-300">{item.step}</span>
                    )}
                  </span>
                  <h3 className="text-lg font-semibold text-white mb-2">{item.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed max-w-xs">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Impact stories — what a rupee becomes, drawn in the same line-art
          voice as the bridge: a first day of school, a girl who stays in it,
          care reaching a village, the country it all compounds into */}
      <section id="stories" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-28 space-y-14">
        <div className="text-center space-y-3">
          <p className="font-mono text-[11px] uppercase tracking-widest text-gold-400">
            Impact stories
          </p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
            What a rupee <span className="italic text-gold-300">turns into</span>
          </h2>
        </div>
        <ImpactStories />
      </section>

      {/* Causes grid */}
      <section id="causes" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-28 space-y-12">
        <div className="flex justify-between items-end">
          <div className="space-y-2">
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Explore Causes</h2>
            <p className="text-gray-400 text-sm max-w-md">
              Six sectors. Every NGO in them has already been verified.
            </p>
          </div>
          <Link href="/discover" className="text-trust-300 hover:text-trust-200 font-bold text-sm flex items-center gap-1">
            See all sectors <span>→</span>
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {causes.map((cause, causeIdx) => {
            const count = stats.causeCategoryCounts[cause.name] ?? 0;
            const Icon = cause.icon;
            return (
              <Link key={cause.name} href={`/discover?causes=${encodeURIComponent(cause.name)}`} className="group block">
                <TiltCard
                  maxTilt={5}
                  index={causeIdx}
                  className="bg-gray-900/60 border border-gray-800 group-hover:border-gray-700 rounded-xl p-6 transition-colors"
                >
                  <div className="flex justify-between items-start mb-4">
                    <span className="p-3 bg-gray-950 border border-gray-800 rounded-lg group-hover:border-trust-700/60 transition">
                      <Icon className="w-6 h-6 text-trust-300" strokeWidth={1.75} />
                    </span>
                    <span className="font-mono text-[11px] text-gray-400 uppercase tracking-widest">
                      {count > 0 ? `${count} Campaigns` : "New sector"}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-white mb-1 group-hover:text-trust-300 transition">{cause.name}</h3>
                  <p className="text-xs text-gray-400 leading-relaxed">{cause.desc}</p>
                </TiltCard>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Quick Donate Section */}
      <section id="give" className="border-t border-gray-900 bg-gradient-to-b from-gold-950/20 to-gray-950 py-28">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-10">

          {/* Heading */}
          <div className="space-y-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
              Ready to give?
            </span>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-white">
              Start with what you have
            </h2>
            <p className="text-gray-400 text-sm max-w-lg mx-auto">
              Pick an amount and we'll show you campaigns where it covers something concrete.
            </p>
          </div>

          {/* Amount selector — QuickDonateSelector component */}
          <QuickDonateSelector />

        </div>
      </section>

      {/* Closing statement — the gold disc is our moon */}
      <section className="relative border-t border-gray-900 py-32 sm:py-40 text-center overflow-hidden">
        <div
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2 -bottom-64 w-[560px] h-[560px] rounded-full border border-gold-500/25 bg-gradient-to-b from-gold-500/10 to-transparent pointer-events-none"
        />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <h2 className="font-display font-semibold text-4xl sm:text-6xl tracking-tight leading-[1.1]">
            <Reveal>Every rupee,</Reveal>
            <Reveal delay={0.12}>
              <span className="italic text-gold-300">watched over.</span>
            </Reveal>
          </h2>
          <Reveal delay={0.24}>
            <p className="text-gray-400 text-base sm:text-lg max-w-xl mx-auto">
              Give once and follow it to the ground — milestone by milestone, receipt by receipt.
            </p>
          </Reveal>
          <Reveal delay={0.34}>
            <Link
              href="/login?callbackUrl=/discover"
              className="inline-block bg-trust-600 hover:bg-trust-500 text-white font-semibold px-10 py-4 rounded-lg text-base transition"
            >
              Make your first donation
            </Link>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-900 bg-gray-950 py-12 text-center text-xs text-gray-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
          <div className="flex justify-center items-center gap-2">
            <span className="font-display italic text-base font-semibold text-white">
              ImpactBridge<span className="text-gold-400">.</span>
            </span>
            <span className="mx-2">•</span>
            <span>© {new Date().getFullYear()} ImpactBridge</span>
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
