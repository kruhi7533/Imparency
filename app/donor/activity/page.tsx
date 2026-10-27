import { resolveDonorAccount } from "@/lib/donor-team";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { loadDonorActivity, type DonorActivityKind } from "@/lib/donor-activity";

export const dynamic = "force-dynamic";

/**
 * The donor's own activity history: CSR requirements, contracts and payments,
 * donations, and account verification — one timeline (lib/donor-activity.ts).
 */
const KIND_LABEL: Record<DonorActivityKind, { label: string; cls: string }> = {
  REQUIREMENT: { label: "CSR requirement", cls: "bg-blue-50 text-blue-700 ring-1 ring-blue-200" },
  CONTRACT: { label: "Contract", cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200" },
  DONATION: { label: "Donation", cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  ACCOUNT: { label: "Account", cls: "bg-violet-50 text-violet-700 ring-1 ring-violet-200" },
};

export default async function DonorActivityPage({ searchParams }: { searchParams: { kind?: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/donor/activity");
  if (session.user.role !== "DONOR") redirect("/unauthorized");

  const all = await loadDonorActivity((await resolveDonorAccount(session.user.id)).accountId, 200, session.user.id);
  const kind = searchParams.kind && searchParams.kind in KIND_LABEL ? (searchParams.kind as DonorActivityKind) : null;
  const items = kind ? all.filter((i) => i.kind === kind) : all;
  const chip = (active: boolean) =>
    `min-h-[40px] inline-flex items-center px-3 rounded-full text-xs font-semibold border ${active ? "bg-trust-600 border-trust-600 text-white" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900">Activity</h1>
      <p className="mt-1 text-sm text-gray-600">
        Everything that happened on your account — requirements, contracts and payments, donations and verification — newest
        first.
      </p>

      <nav aria-label="Filter activity" className="mt-6 flex flex-wrap gap-2">
        <Link href="/donor/activity" aria-current={kind === null ? "page" : undefined} className={chip(kind === null)}>
          All ({all.length})
        </Link>
        {(Object.keys(KIND_LABEL) as DonorActivityKind[]).map((k) => {
          const n = all.filter((i) => i.kind === k).length;
          if (n === 0) return null;
          return (
            <Link key={k} href={`/donor/activity?kind=${k}`} aria-current={kind === k ? "page" : undefined} className={chip(kind === k)}>
              {KIND_LABEL[k].label} ({n})
            </Link>
          );
        })}
      </nav>

      {items.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">No activity yet.</p>
      ) : (
        <ol className="mt-6 space-y-3">
          {items.map((i, idx) => (
            <li key={idx} className="rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${KIND_LABEL[i.kind].cls}`}>{KIND_LABEL[i.kind].label}</span>
                <time dateTime={i.at.toISOString()} className="text-xs text-gray-500">
                  {i.at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                </time>
                <span className="text-xs text-gray-500">· {i.actor}</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-gray-900">
                {i.href ? (
                  <Link href={i.href} className="hover:text-trust-700 hover:underline">
                    {i.title}
                  </Link>
                ) : (
                  i.title
                )}
              </p>
              {i.detail && <p className="mt-1 text-sm text-gray-600 break-words">{i.detail}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
