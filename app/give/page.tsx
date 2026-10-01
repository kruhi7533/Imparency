import React from "react";
import Link from "next/link";
import { ShieldCheck, Receipt, FileCheck2 } from "lucide-react";
import Reveal from "@/components/home/Reveal";
import CountUpStat from "@/components/home/CountUpStat";
import { getPlatformStats } from "@/lib/platform-stats";

export const revalidate = 60;

export const metadata = {
  title: "Give with proof — ImpactBridge",
  description:
    "What giving on ImpactBridge actually means: milestone-gated releases, evidence you can audit, and an 80G receipt that arrives on its own.",
};

/**
 * The donor counterpart to `/ngo/register`.
 *
 * Why it lives at `/give` and not `/donor/start`: `middleware.ts` matches
 * `/donor/:path*` and bounces anyone without the DONOR role to `/unauthorized`.
 * A page whose entire audience is signed-out visitors cannot sit behind that
 * guard, and loosening the matcher to carve out one public child would weaken a
 * tenancy boundary for a marketing page — the wrong trade.
 *
 * Every number here comes from `getPlatformStats()`. Nothing on this page is
 * illustrative: a donation platform inventing its own track record is the exact
 * failure this product exists to argue against.
 */
export default async function GivePage() {
  const stats = await getPlatformStats();

  const promises = [
    {
      icon: ShieldCheck,
      title: "Money moves in steps, not lump sums",
      body: "A ₹5 lakh campaign is not a ₹5 lakh transfer. It is split into milestones, each with its own budget and deadline, and the next instalment is released only after the previous one is proven.",
    },
    {
      icon: FileCheck2,
      title: "You can audit the evidence yourself",
      body: "NGOs upload receipts and photographs when a milestone is done. The evidence is screened automatically and reviewed by a person before any further money moves.",
    },
    {
      icon: Receipt,
      title: "Your 80G receipt arrives on its own",
      body: "No forms, no follow-up emails, no chasing anyone in April. The receipt is generated against your donation and kept in your account.",
    },
  ];

  return (
    <div className="relative isolate min-h-screen bg-gray-950 text-white font-sans selection:bg-trust-500 selection:text-white">
      {/* Same navy wash + ledger rules as the home hero, so this reads as the
          donor half of one site rather than a bolted-on landing page. */}
      <div
        aria-hidden
        className="absolute top-0 inset-x-0 h-[95vh] pointer-events-none -z-10 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(60,98,186,0.28),transparent_70%)]"
      />
      <div
        aria-hidden
        className="absolute top-0 inset-x-0 h-[85vh] pointer-events-none -z-10 bg-[repeating-linear-gradient(to_bottom,transparent,transparent_55px,rgba(142,169,224,0.05)_55px,rgba(142,169,224,0.05)_56px)] [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />

      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16 sm:pt-28 text-center space-y-7">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-widest text-gold-400">
            For donors
          </p>
        </Reveal>

        <h1 className="font-display text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.05]">
          <Reveal>Give once.</Reveal>
          <Reveal delay={0.12}>
            <span className="italic text-gold-300">Follow every rupee.</span>
          </Reveal>
        </h1>

        <Reveal delay={0.24}>
          <p className="text-gray-400 text-lg sm:text-xl max-w-2xl mx-auto">
            Most giving ends at the receipt. Here it starts there — you see the
            milestone your money was released against, the proof that cleared
            it, and the person who reviewed that proof.
          </p>
        </Reveal>

        <Reveal delay={0.34}>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 pt-2">
            <Link
              href="/login?signup=1&callbackUrl=/discover"
              className="w-full sm:w-auto bg-trust-600 hover:bg-trust-500 text-white font-semibold px-8 py-4 rounded-lg text-base transition"
            >
              Create a donor account
            </Link>
            <Link
              href="/discover"
              className="w-full sm:w-auto border border-gray-800 hover:border-gray-700 bg-gray-900/50 hover:bg-gray-900 text-white font-semibold px-8 py-4 rounded-lg text-base transition"
            >
              Discover NGOs first
            </Link>
          </div>
        </Reveal>

        <Reveal delay={0.44}>
          <p className="font-mono text-[11px] uppercase tracking-widest text-gray-600">
            No account needed to look around
          </p>
        </Reveal>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-widest text-gold-400 mb-10">
            What your money is actually bound by
          </p>
        </Reveal>

        <div className="grid gap-px bg-gray-900 border border-gray-900 rounded-xl overflow-hidden sm:grid-cols-3">
          {promises.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.1}>
              <div className="bg-gray-950 h-full p-7 space-y-3">
                <p.icon className="h-5 w-5 text-trust-300" aria-hidden />
                <h2 className="font-display text-lg font-semibold text-white">
                  {p.title}
                </h2>
                <p className="text-sm text-gray-400 leading-relaxed">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-24 space-y-10">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-widest text-gold-400 text-center">
            The ledger so far
          </p>
        </Reveal>
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
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-28 text-center space-y-6">
        <Reveal>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
            Start with what you have
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="text-gray-400">
            Pick a campaign, give what you want, and follow it milestone by
            milestone. You can stop at any time.
          </p>
        </Reveal>
        <Reveal delay={0.2}>
          <Link
            href="/login?signup=1&callbackUrl=/discover"
            className="inline-block bg-trust-600 hover:bg-trust-500 text-white font-semibold px-8 py-4 rounded-lg text-base transition"
          >
            Create a donor account
          </Link>
        </Reveal>
        <Reveal delay={0.3}>
          <p className="text-xs text-gray-600">
            Run an organisation instead?{" "}
            <Link href="/ngo/register" className="text-trust-300 hover:text-trust-200 underline">
              Register your NGO
            </Link>
          </p>
        </Reveal>
      </section>
    </div>
  );
}
