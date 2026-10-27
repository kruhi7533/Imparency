import Link from "next/link";
import { NGO_RESPONSE_STATUS_LABELS } from "@/lib/requirements/response-status";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/requirements/access";
import { listOpportunitiesForNgo, type NgoOpportunity } from "@/lib/requirements/opportunities";
import { RequirementWorkflowError } from "@/lib/requirements/errors";
import { formatBudgetRange } from "@/components/requirements/api";

export const dynamic = "force-dynamic";

/** CSR opportunities this NGO was invited to — sanitized briefs only, never the donor's document. */
export default async function NgoOpportunitiesPage() {
  const actor = await getActor();
  if (!actor || actor.role !== "NGO") redirect("/login?callbackUrl=/ngo/opportunities");

  let opportunities: NgoOpportunity[] = [];
  let notice: string | null = null;
  try {
    opportunities = await listOpportunitiesForNgo(actor);
  } catch (err) {
    if (!(err instanceof RequirementWorkflowError)) throw err;
    notice = err.message;
  }

  return (
    <div className="py-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <Link href="/ngo/dashboard" className="text-xs font-bold text-trust-700 hover:underline">
            ← NGO Dashboard
          </Link>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900 mt-1">CSR Opportunities</h1>
          <p className="text-sm text-gray-600 mt-1">
            Funding opportunities from verified CSR donors whose requirements your projects matched. You see a summary brief; the
            donor&apos;s own documents stay private.
          </p>
        </div>

        {notice && <p className="text-sm text-amber-700">{notice}</p>}

        {opportunities.length === 0 && !notice ? (
          <p className="text-sm text-gray-500 border border-gray-200 rounded-2xl py-12 text-center">
            No CSR opportunities yet. When a donor&apos;s validated requirement matches one of your active projects and they invite you,
            it will appear here.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {opportunities.map(({ brief, open, response }) => (
              <div key={brief.id} className="border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] rounded-2xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-bold text-gray-900">{brief.title}</h2>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${open ? "text-emerald-700 border-emerald-200" : "text-gray-600 border-gray-300"}`}>
                    {open ? "Open" : "Closed"}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-gray-500">Sector</dt>
                    <dd className="text-gray-900">{brief.sector ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Location</dt>
                    <dd className="text-gray-900">{[brief.district, brief.state].filter(Boolean).join(", ") || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Funding range</dt>
                    <dd className="text-gray-900">{formatBudgetRange(brief.budgetMin, brief.budgetMax)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Duration</dt>
                    <dd className="text-gray-900">{brief.durationMonths ? `${brief.durationMonths} months` : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">FCRA</dt>
                    <dd className="text-gray-900">{brief.fcraRequired ? "Required" : "Not required"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Your response</dt>
                    <dd className="text-gray-900">{response ? NGO_RESPONSE_STATUS_LABELS[response.status as keyof typeof NGO_RESPONSE_STATUS_LABELS] ?? response.status : "Not yet responded"}</dd>
                  </div>
                </dl>
                <div className="flex gap-2">
                  <Link href={`/ngo/opportunities/${brief.id}`} className="px-3 py-1.5 rounded-lg bg-white border border-gray-300 text-gray-800 text-xs font-semibold hover:bg-gray-50">
                    View Opportunity
                  </Link>
                  {open && !response && (
                    <Link href={`/ngo/opportunities/${brief.id}#respond`} className="px-3 py-1.5 rounded-lg bg-trust-600 hover:bg-trust-700 text-white text-xs font-bold">
                      Express Interest
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
