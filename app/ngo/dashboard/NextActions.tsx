import Link from "next/link";
import { BellRing, CheckCircle2 } from "lucide-react";
import { getNgoAttentionCounts } from "@/lib/ngo-attention";

/**
 * "What do I need to do next?" for a verified NGO — every row is a live count
 * of work waiting on this organisation, linking to the screen that clears it.
 * Nothing here is decorative: a row with a zero count is not shown.
 */
export default async function NextActions({ ngoId }: { ngoId: string }) {
  const c = await getNgoAttentionCounts(ngoId);

  const rows = [
    { count: c.invitationsOpen, label: "CSR invitation(s) waiting for your proposal", href: "/ngo/match-inbox", cta: "Respond" },
    { count: c.paymentsToConfirm, label: "payment(s) to confirm as received", href: "/ngo/contracts", cta: "Confirm" },
    { count: c.evidenceReturned, label: "field photo(s) returned for a retake", href: "/ngo/field", cta: "Recapture" },
    { count: c.reportsReturned, label: "impact report(s) returned with reviewer notes", href: "/ngo/reporting", cta: "Revise" },
    { count: c.funderRequests, label: "funder request(s) to renew or discuss next steps", href: "/ngo/reporting", cta: "Reply" },
  ].filter((r) => r.count > 0);

  return (
    <section
      aria-labelledby="next-actions"
      className="mb-6 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-6"
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-full ${rows.length ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}`}
          aria-hidden="true"
        >
          {rows.length ? <BellRing className="h-[18px] w-[18px]" /> : <CheckCircle2 className="h-[18px] w-[18px]" />}
        </span>
        <h2 id="next-actions" className="text-base font-semibold text-gray-900">
          Needs your attention
        </h2>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">You&apos;re all caught up — nothing is waiting on your organisation.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between gap-4 py-3">
              <span className="text-sm text-gray-700">
                <span className="mr-2 inline-flex min-w-[1.75rem] justify-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-700 ring-1 ring-amber-200">
                  {r.count}
                </span>
                {r.label}
              </span>
              <Link
                href={r.href}
                className="shrink-0 rounded-lg bg-trust-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-trust-700"
              >
                {r.cta} →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
