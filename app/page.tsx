import React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileCheck2,
  HandCoins,
  HeartPulse,
  IndianRupee,
  Layers,
  Megaphone,
  ShieldCheck,
  Sprout,
  Soup,
  Tractor,
  Users,
} from "lucide-react";
import QuickDonateSelector from "@/components/home/QuickDonateSelector";
import CountUpStat from "@/components/home/CountUpStat";
import LiveActivityFeed from "@/components/home/LiveActivityFeed";
import Reveal from "@/components/home/Reveal";
import NgoMarquee from "@/components/home/NgoMarquee";
import HeroCtas from "@/components/home/HeroCtas";
import HeroVisual from "@/components/home/HeroVisual";
import FeaturedCampaigns from "@/components/home/FeaturedCampaigns";
import ImpactStories from "@/components/home/ImpactStories";
import EmergencyReliefSection from "@/components/home/EmergencyReliefSection";
import { getPlatformStats } from "@/lib/platform-stats";
import { getHomeHighlights } from "@/lib/home-highlights";

export const revalidate = 60;

const CARD = "bg-white rounded-2xl border border-gray-200/80 shadow-[0_1px_2px_rgba(16,24,40,0.04)]";
const EYEBROW = "text-xs font-semibold uppercase tracking-[0.16em] text-trust-700";

const AVATAR_TINTS = [
  "bg-trust-100 text-trust-800",
  "bg-emerald-100 text-emerald-800",
  "bg-amber-100 text-amber-800",
  "bg-violet-100 text-violet-800",
];

function IconBubble({ tint, children }: { tint: string; children: React.ReactNode }) {
  return (
    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${tint}`} aria-hidden>
      {children}
    </span>
  );
}

export default async function Home() {
  const [stats, highlights] = await Promise.all([getPlatformStats(), getHomeHighlights()]);

  const causes = [
    { name: "Education", icon: BookOpen, desc: "Sponsor books, classrooms, and teacher training programs." },
    { name: "Healthcare", icon: HeartPulse, desc: "Support mobile clinics, surgery funds, and medical equipment." },
    { name: "Environment", icon: Sprout, desc: "Fund reforestation, waste management, and solar clean-tech." },
    { name: "Women Empowerment", icon: Users, desc: "Provide vocational skills, micro-loans, and legal advocacy." },
    { name: "Rural Development", icon: Tractor, desc: "Build check dams, clean water wells, and village infrastructure." },
    { name: "Hunger", icon: Soup, desc: "Support community kitchens and nutritious food distribution." },
  ];

  const steps = [
    {
      icon: ShieldCheck,
      title: "NGOs are vetted first",
      desc: "Registration certificate and PAN are checked by our team. An NGO can't publish a campaign until it passes.",
    },
    {
      icon: Layers,
      title: "Budgets split into milestones",
      desc: "A ₹5 lakh campaign isn't a ₹5 lakh transfer — it's a series of releases, each tied to specific work and a deadline.",
    },
    {
      icon: HandCoins,
      title: "You give and follow it",
      desc: "Donate to a campaign and track every milestone it funds. Your 80G receipt arrives on its own.",
    },
    {
      icon: FileCheck2,
      title: "Proof unlocks the next release",
      desc: "Receipts and photos are screened and reviewed by a person — only then does the next instalment move.",
    },
  ];

  const latest = stats.recentActivity[0];
  const donorCount = highlights.donorCount;

  return (
    <div className="relative min-h-screen bg-canvas text-gray-900 font-sans selection:bg-trust-100 selection:text-trust-900">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-0 bg-[radial-gradient(ellipse_60%_55%_at_85%_30%,rgba(31,75,200,0.07),transparent_70%),radial-gradient(ellipse_45%_35%_at_8%_55%,rgba(16,185,129,0.05),transparent_70%)]"
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-16 sm:pt-16 lg:pt-20 lg:pb-24 grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-10 items-center">
          <div className="space-y-7 text-center lg:text-left">
            <Reveal as="div" variant="fade">
              <p className={EYEBROW}>Transparent · Accountable · Higher impact</p>
            </Reveal>
            <h1 className="font-display font-semibold text-[2.5rem] leading-[1.1] sm:text-6xl lg:text-[4.25rem] tracking-tight text-gray-900">
              <Reveal delay={0.06}>Real social impact,</Reveal>
              <Reveal delay={0.14}>
                built on <span className="text-trust-600">transparency.</span>
              </Reveal>
            </h1>
            <Reveal as="div" variant="fade" delay={0.22}>
              <p className="text-gray-600 text-base sm:text-lg leading-relaxed max-w-xl mx-auto lg:mx-0">
                Every campaign is split into milestones. NGOs receive funds one step at a time, and the next
                instalment is released only after their receipts and photos pass review.
              </p>
            </Reveal>

            <Reveal as="div" variant="fade" delay={0.3}>
              {/* Role-aware: visitors see both sides; signed-in users their own next step. */}
              <HeroCtas />
            </Reveal>

            {donorCount > 0 && (
              <Reveal as="div" variant="fade" delay={0.38}>
                <div className="flex items-center justify-center lg:justify-start gap-3">
                  <div className="flex -space-x-2.5" aria-hidden>
                    {highlights.donorInitials.map((ini, i) => (
                      <span
                        key={i}
                        className={`flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-semibold ring-2 ring-canvas ${AVATAR_TINTS[i % AVATAR_TINTS.length]}`}
                      >
                        {ini}
                      </span>
                    ))}
                  </div>
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-900 tabular-nums">{donorCount.toLocaleString("en-IN")}</span>{" "}
                    {donorCount === 1 ? "person is" : "people are"} already making an impact
                  </p>
                </div>
              </Reveal>
            )}
          </div>

          <HeroVisual
            image={highlights.heroImage}
            latestDonation={latest ? { amount: latest.amount, projectTitle: latest.projectTitle } : null}
            onTimePct={highlights.onTimeMilestonePct}
            approvedCount={highlights.approvedMilestoneCount}
            verifiedMilestones={stats.completedMilestoneCount}
          />
        </div>
      </section>

      {/* ── Stats strip — live from the database ─────────────── */}
      <section id="numbers" aria-label="Platform numbers" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-2">
        <div className={`${CARD} p-6 sm:p-8`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-0 lg:divide-x lg:divide-gray-200">
            <div className="lg:pr-6">
              <CountUpStat
                value={stats.verifiedNgoCount}
                label="Verified NGOs"
                emptyLabel="Onboarding our first NGOs"
                icon={<IconBubble tint="bg-trust-50 text-trust-600"><ShieldCheck className="h-5 w-5" /></IconBubble>}
              />
            </div>
            <div className="lg:px-6">
              <CountUpStat
                value={stats.totalDonated}
                format="compact-inr"
                label="Funds tracked"
                emptyLabel="Just getting started"
                accent
                index={1}
                icon={<IconBubble tint="bg-emerald-50 text-emerald-600"><IndianRupee className="h-5 w-5" /></IconBubble>}
              />
            </div>
            <div className="lg:px-6">
              <CountUpStat
                value={stats.activeProjectCount}
                label="Active campaigns"
                emptyLabel="First campaigns coming soon"
                index={2}
                icon={<IconBubble tint="bg-amber-50 text-amber-600"><Megaphone className="h-5 w-5" /></IconBubble>}
              />
            </div>
            <div className="lg:pl-6">
              <CountUpStat
                value={stats.completedMilestoneCount}
                label="Milestones verified"
                emptyLabel="No milestones cleared yet"
                index={3}
                icon={<IconBubble tint="bg-violet-50 text-violet-600"><CheckCircle2 className="h-5 w-5" /></IconBubble>}
              />
            </div>
          </div>

          {/* Live activity — real, recent donations, not a vanity metric */}
          <div className="mt-6 pt-6 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
            <span className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden /> Latest on the ledger
            </span>
            <div className="min-w-0 flex-1">
              <LiveActivityFeed activity={stats.recentActivity} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Featured campaigns ────────────────────────────────── */}
      <section id="campaigns" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 sm:pt-24">
        <FeaturedCampaigns campaigns={highlights.featured} />
        <div className="mt-6 text-center">
          <Link
            href="/discover"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-trust-700 hover:text-trust-800"
          >
            See all campaigns and NGOs <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>

      {/* Verified NGOs strip — every name is a real, verified organisation */}
      {stats.verifiedNgoNames.length > 0 && (
        <section aria-label="Verified NGOs on ImpactBridge" className="pt-16">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
            Verified NGOs raising on ImpactBridge
          </p>
          <NgoMarquee names={stats.verifiedNgoNames} />
        </section>
      )}

      {/* ── How it works ─────────────────────────────────────── */}
      <section id="how-it-works" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-24">
        <div className="text-center space-y-3 mb-14">
          <p className={EYEBROW}>How it works</p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-gray-900">
            How the money actually moves
          </h2>
          <p className="text-gray-600 text-sm sm:text-base max-w-xl mx-auto">
            No lump-sum transfers. Checkpoints stand between a donation and the last rupee spent.
          </p>
        </div>

        <ol className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-8">
          {/* Dashed connector behind the step numbers (desktop) */}
          <div
            aria-hidden
            className="hidden lg:block absolute top-7 left-[12.5%] right-[12.5%] border-t-2 border-dashed border-trust-200"
          />
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.title} className="relative text-center">
                <Reveal as="div" variant="fade" delay={i * 0.08}>
                  <div className="relative mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-white ring-1 ring-gray-200 shadow-sm">
                    <Icon className="h-6 w-6 text-trust-600" aria-hidden />
                    <span className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-trust-600 text-[11px] font-semibold text-white ring-2 ring-canvas">
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-gray-900">{s.title}</h3>
                  <p className="mt-2 text-sm text-gray-600 leading-relaxed max-w-[260px] mx-auto">{s.desc}</p>
                </Reveal>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ── Emergency relief (renders only while a verified crisis is active) ── */}
      <EmergencyReliefSection />

      {/* ── Causes — real campaign counts per sector ─────────── */}
      <section id="causes" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 sm:pb-24 space-y-10">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div className="space-y-2">
            <p className={EYEBROW}>Causes</p>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-gray-900">Explore causes</h2>
            <p className="text-gray-600 text-sm max-w-md">Six sectors. Every NGO in them has already been verified.</p>
          </div>
          <Link href="/discover" className="text-trust-700 hover:text-trust-800 font-semibold text-sm inline-flex items-center gap-1">
            See all sectors <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {causes.map((cause) => {
            const count = stats.causeCategoryCounts[cause.name] ?? 0;
            const Icon = cause.icon;
            return (
              <Link
                key={cause.name}
                href={`/discover?causes=${encodeURIComponent(cause.name)}`}
                className={`${CARD} group block p-6 transition duration-200 hover:border-trust-200 hover:shadow-lg hover:shadow-gray-900/[0.05] motion-safe:hover:-translate-y-0.5`}
              >
                <div className="flex justify-between items-start mb-4">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-trust-50">
                    <Icon className="w-5 h-5 text-trust-600" strokeWidth={1.75} aria-hidden />
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      count > 0 ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {count > 0 ? `${count} ${count === 1 ? "campaign" : "campaigns"}` : "New sector"}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-1 group-hover:text-trust-700 transition">{cause.name}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{cause.desc}</p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── Impact stories ───────────────────────────────────── */}
      <section id="stories" className="border-y border-gray-200/80 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-24 space-y-12">
          <div className="text-center space-y-3">
            <p className={EYEBROW}>Impact stories</p>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-gray-900">
              What a rupee <span className="italic text-trust-600">turns into</span>
            </h2>
          </div>
          <ImpactStories />
        </div>
      </section>

      {/* ── Quick donate ─────────────────────────────────────── */}
      <section id="give" className="py-20 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-8">
          <div className="space-y-3">
            <p className={EYEBROW}>Ready to give?</p>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-gray-900">
              Start with what you have
            </h2>
            <p className="text-gray-600 text-sm max-w-lg mx-auto">
              Pick an amount and we&apos;ll show you campaigns where it covers something concrete.
            </p>
          </div>
          <div className={`${CARD} p-6 sm:p-8`}>
            <QuickDonateSelector />
          </div>
        </div>
      </section>

      {/* ── Mission band ─────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 sm:pb-24">
        <div className="relative overflow-hidden rounded-3xl bg-trust-700 px-6 py-14 sm:px-12 sm:py-16 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border border-white/10"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -left-16 -bottom-28 h-72 w-72 rounded-full border border-white/10"
          />
          <div className="relative max-w-2xl mx-auto space-y-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-trust-100">Our mission</p>
            <blockquote className="font-display text-3xl sm:text-5xl font-semibold leading-tight tracking-tight text-white">
              &ldquo;Every rupee, watched over.&rdquo;
            </blockquote>
            <p className="text-trust-100 text-base sm:text-lg">
              Give once and follow it to the ground — milestone by milestone, receipt by receipt.
            </p>
            <Link
              href="/login?callbackUrl=/discover"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-trust-800 shadow-sm transition hover:bg-trust-50"
            >
              Make your first donation <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-gray-200/80 bg-white py-10 text-sm text-gray-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <span className="font-display text-lg font-semibold text-gray-900">
              ImpactBridge<span className="text-trust-600">.</span>
            </span>
            <span className="text-gray-300" aria-hidden>•</span>
            <span>© {new Date().getFullYear()} ImpactBridge</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-6 gap-y-2 font-medium">
            <Link href="/discover" className="hover:text-gray-900 transition">Discover</Link>
            <Link href="/login?mode=signup&role=DONOR" className="hover:text-gray-900 transition">Join as donor</Link>
            <Link href="/ngo/register" className="hover:text-gray-900 transition">Join as NGO</Link>
            <Link href="/help" className="hover:text-gray-900 transition">Help</Link>
            <Link href="/privacy-policy" className="hover:text-gray-900 transition">Privacy</Link>
            <Link href="/admin/dashboard" className="hover:text-gray-900 transition">Admin Panel</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
