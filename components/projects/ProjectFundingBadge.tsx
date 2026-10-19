import type { ProjectFunding } from "@/lib/project-funding";

const inr = (v: string) => `₹${Number(v).toLocaleString("en-IN")}`;

/**
 * One wording for a project's funding, everywhere it is shown (NGO, donor and
 * admin). Derived from reconciled contract money; nothing renders when no
 * signed contract funds the project.
 */
export function ProjectFundingBadge({ funding, fundedAt }: { funding: ProjectFunding | undefined; fundedAt?: Date | string | null }) {
  if (!funding || Number(funding.committed) === 0) return null;
  if (funding.funded) {
    return (
      <span
        className="inline-flex items-center px-3 py-0.5 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-700"
        title={`${inr(funding.reconciled)} of ${inr(funding.committed)} committed has been received and reconciled.`}
      >
        Funded ✓{fundedAt ? ` · ${new Date(fundedAt).toLocaleDateString("en-IN")}` : ""}
        {funding.state === "OVERFUNDED" ? " (more than committed — check)" : ""}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center px-3 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700"
      title="Only money the NGO has confirmed receiving counts."
    >
      {funding.state === "UNFUNDED" ? `Awaiting funds · ${inr(funding.committed)} committed` : `Partly funded · ${inr(funding.reconciled)} of ${inr(funding.committed)}`}
    </span>
  );
}
