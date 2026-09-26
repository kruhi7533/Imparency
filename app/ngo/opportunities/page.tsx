import Link from "next/link";
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
    <div className="min-h-screen bg-gray-950 py-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <Link href="/ngo/dashboard" className="text-xs font-bold text-emerald-500 hover:underline">
            ← NGO Dashboard
          </Link>
          <h1 className="text-2xl font-extrabold text-white mt-1">CSR Opportunities</h1>
          <p className="text-sm text-gray-400 mt-1">
            Funding opportunities from verified CSR donors whose requirements your projects matched. You see a summary brief; the
            donor&apos;s own documents stay private.
          </p>
        </div>

        {notice && <p className="text-sm text-amber-300">{notice}</p>}

        {opportunities.length === 0 && !notice ? (
          <p className="text-sm text-gray-500 border border-gray-800 rounded-2xl py-12 text-center">
            No CSR opportunities yet. When a donor&apos;s validated requirement matches one of your active projects and they invite you,
            it will appear here.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {opportunities.map(({ brief, open, response }) => (
              <div key={brief.id} className="border border-gray-800 bg-gray-900/40 rounded-2xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-bold text-white">{brief.title}</h2>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${open ? "text-emerald-300 border-emerald-500/30" : "text-gray-400 border-gray-700"}`}>
                    {open ? "Open" : "Closed"}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-gray-500">Sector</dt>
                    <dd className="text-gray-100">{brief.sector ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Location</dt>
                    <dd className="text-gray-100">{[brief.district, brief.state].filter(Boolean).join(", ") || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Funding range</dt>
                    <dd className="text-gray-100">{formatBudgetRange(brief.budgetMin, brief.budgetMax)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Duration</dt>
                    <dd className="text-gray-100">{brief.durationMonths ? `${brief.durationMonths} months` : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">FCRA</dt>
                    <dd className="text-gray-100">{brief.fcraRequired ? "Required" : "Not required"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Your response</dt>
                    <dd className="text-gray-100">{response ? response.status.replace(/_/g, " ").toLowerCase() : "Not yet responded"}</dd>
                  </div>
                </dl>
                <div className="flex gap-2">
                  <Link href={`/ngo/opportunities/${brief.id}`} className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-100 text-xs font-semibold hover:bg-gray-700">
                    View Opportunity
                  </Link>
                  {open && !response && (
                    <Link href={`/ngo/opportunities/${brief.id}#respond`} className="px-3 py-1.5 rounded-lg bg-emerald-500 text-gray-950 text-xs font-bold">
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
