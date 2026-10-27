import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { TeamRole } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { resolveNgoActor } from "@/lib/field-evidence";
import { loadNgoActivity, type ActivityKind } from "@/lib/ngo-activity";

export const dynamic = "force-dynamic";

/**
 * The organisation's activity history: verification, project approvals,
 * compliance, contracts and payments, proof and evidence reviews, outcome
 * decisions and funding — one timeline (lib/ngo-activity.ts).
 *
 * Owners, admins and finance. Field staff are not shown it: it carries
 * contract and payment history they have no other screen for.
 */
const VIEWERS: TeamRole[] = [TeamRole.OWNER, TeamRole.ADMIN, TeamRole.FINANCE];

const KIND_LABEL: Record<ActivityKind, { label: string; cls: string }> = {
  VERIFICATION: { label: "Verification", cls: "bg-purple-100 text-purple-800" },
  PROJECT: { label: "Project", cls: "bg-blue-100 text-blue-800" },
  COMPLIANCE: { label: "Compliance", cls: "bg-indigo-100 text-indigo-800" },
  CONTRACT: { label: "Contract", cls: "bg-amber-100 text-amber-800" },
  PROOF: { label: "Milestone proof", cls: "bg-emerald-100 text-emerald-800" },
  FIELD: { label: "Field evidence", cls: "bg-teal-100 text-teal-800" },
  OUTCOME: { label: "Outcome", cls: "bg-rose-100 text-rose-800" },
  FUNDING: { label: "Funding", cls: "bg-green-100 text-green-800" },
};

export default async function NgoActivityPage({ searchParams }: { searchParams: { kind?: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/ngo/activity");
  if (session.user.role !== "NGO") redirect("/unauthorized");

  const actor = await resolveNgoActor(session.user.id);
  if (!actor) redirect("/ngo/register");

  if (!VIEWERS.includes(actor.teamRole)) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900">Activity</h1>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          The organisation&apos;s activity history is available to owners, admins and finance members. Your field tasks are in the{" "}
          <Link href="/ngo/field" className="text-trust-700 underline">
            Field App
          </Link>
          .
        </p>
      </main>
    );
  }

  const all = await loadNgoActivity(actor.ngoId);
  const kind = searchParams.kind && searchParams.kind in KIND_LABEL ? (searchParams.kind as ActivityKind) : null;
  const items = kind ? all.filter((i) => i.kind === kind) : all;

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900">Activity</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Every decision taken on or by your organisation — verification, approvals, contracts and payments, evidence reviews,
        outcome decisions and funding — newest first.
      </p>

      <nav aria-label="Filter activity" className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/ngo/activity"
          aria-current={kind === null ? "page" : undefined}
          className={`px-3 py-2 rounded-full text-xs font-bold ${kind === null ? "bg-trust-600 text-white" : "bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"}`}
        >
          All ({all.length})
        </Link>
        {(Object.keys(KIND_LABEL) as ActivityKind[]).map((k) => {
          const n = all.filter((i) => i.kind === k).length;
          if (n === 0) return null;
          return (
            <Link
              key={k}
              href={`/ngo/activity?kind=${k}`}
              aria-current={kind === k ? "page" : undefined}
              className={`px-3 py-2 rounded-full text-xs font-bold ${kind === k ? "bg-trust-600 text-white" : "bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"}`}
            >
              {KIND_LABEL[k].label} ({n})
            </Link>
          );
        })}
      </nav>

      {items.length === 0 ? (
        <p className="mt-10 text-sm text-gray-500">No activity recorded yet.</p>
      ) : (
        <ol className="mt-6 space-y-3">
          {items.map((i, idx) => (
            <li key={idx} className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${KIND_LABEL[i.kind].cls}`}>{KIND_LABEL[i.kind].label}</span>
                <time dateTime={i.at.toISOString()} className="text-xs text-gray-500">
                  {i.at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                </time>
                <span className="text-xs text-gray-500">· {i.actor}</span>
              </div>
              <p className="mt-1 text-sm font-bold text-gray-900 dark:text-white">
                {i.href ? (
                  <Link href={i.href} className="hover:underline">
                    {i.title}
                  </Link>
                ) : (
                  i.title
                )}
              </p>
              {i.detail && <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 break-words">{i.detail}</p>}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
