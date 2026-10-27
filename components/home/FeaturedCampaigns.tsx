"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BadgeCheck, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import ProjectCoverImage from "@/app/components/ProjectCoverImage";
import { formatCompactINR } from "@/lib/format-currency";
import type { FeaturedCampaign } from "@/lib/home-highlights";

/**
 * Featured campaigns — the platform's best-funded live projects, as a
 * scroll-snap row with arrow buttons (no scroll-jacking: the row is an
 * ordinary horizontal scroller that also works with touch and keyboard).
 */
export default function FeaturedCampaigns({ campaigns }: { campaigns: FeaturedCampaign[] }) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const update = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    update();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);

  const scrollBy = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.querySelector("li");
    const step = card ? card.getBoundingClientRect().width + 24 : el.clientWidth;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * step, behavior: reduce ? "auto" : "smooth" });
  };

  const arrowCls =
    "flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 transition hover:border-trust-300 hover:text-trust-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-300 disabled:hover:text-gray-700";

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-trust-700">Featured campaigns</p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-gray-900">
            Support high-impact projects
          </h2>
        </div>
        {campaigns.length > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className={arrowCls} onClick={() => scrollBy(-1)} disabled={!canPrev} aria-label="Previous campaigns">
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <button type="button" className={arrowCls} onClick={() => scrollBy(1)} disabled={!canNext} aria-label="Next campaigns">
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </div>
        )}
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
          <p className="font-medium text-gray-900">No live campaigns right now</p>
          <p className="mt-1 text-sm text-gray-500">
            Campaigns appear here as soon as a verified NGO publishes one.
          </p>
          <Link href="/discover" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-trust-700 hover:text-trust-800">
            Discover NGOs <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      ) : (
        <ul
          ref={trackRef}
          aria-label="Featured campaigns"
          className="relative -mx-4 flex snap-x snap-mandatory gap-6 overflow-x-auto scroll-px-4 px-4 pb-4 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:scroll-px-0 sm:px-0"
        >
          {campaigns.map((c) => {
            const pct = c.target > 0 ? Math.min(100, Math.round((c.raised / c.target) * 100)) : 0;
            return (
              <li
                key={c.id}
                className="w-[85%] shrink-0 snap-start sm:w-[calc((100%-24px)/2)] lg:w-[calc((100%-48px)/3)]"
              >
                <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition duration-200 motion-safe:hover:-translate-y-0.5 hover:shadow-lg hover:shadow-gray-900/[0.06]">
                  <div className="relative aspect-[16/10] overflow-hidden bg-gray-100">
                    <ProjectCoverImage
                      src={c.coverImage}
                      alt={c.title}
                      causeCategory={c.causeCategory}
                      className="h-full w-full object-cover transition duration-500 motion-safe:group-hover:scale-[1.03]"
                    />
                    <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-gray-800 shadow-sm">
                        {c.causeCategory}
                      </span>
                      {c.ngoVerified && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="line-clamp-2 text-base font-semibold leading-snug text-gray-900">{c.title}</h3>
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-600">
                      <span className="truncate">{c.ngoName}</span>
                      {c.ngoVerified && <BadgeCheck className="h-4 w-4 shrink-0 text-trust-600" aria-label="Verified NGO" />}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-500">
                      <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{c.location}</span>
                    </p>

                    <div className="mt-auto pt-5">
                      <div
                        className="h-2 w-full overflow-hidden rounded-full bg-gray-100"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${pct}% funded`}
                      >
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-2 flex items-baseline justify-between text-sm">
                        <span className="text-gray-600">
                          <span className="font-semibold text-gray-900 tabular-nums">{formatCompactINR(c.raised)}</span>{" "}
                          raised of {formatCompactINR(c.target)}
                        </span>
                        <span className="font-semibold text-emerald-700 tabular-nums">{pct}%</span>
                      </div>
                      <Link
                        href={`/projects/${c.id}`}
                        className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-trust-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-trust-700"
                      >
                        View details <ArrowRight className="h-4 w-4" aria-hidden />
                        <span className="sr-only">: {c.title}</span>
                      </Link>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
