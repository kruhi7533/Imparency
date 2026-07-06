import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import PanActions from "./PanActions";
import RiskInsight from "./RiskInsight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmt = (d: Date) =>
  d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
      <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-400 mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold text-gray-400">{label}</p>
      <p className="text-sm text-gray-900 dark:text-white mt-0.5">{value ?? "—"}</p>
    </div>
  );
}

export default async function DonorDetailPage({ params }: { params: { id: string } }) {
  const donor = await prisma.user.findUnique({
    where: { id: params.id },
    include: {
      donations: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          project: { select: { title: true, ngo: { select: { orgName: true } } } },
          taxReceipt: { select: { id: true, receiptNumber: true } },
        },
      },
      followers: { include: { ngo: { select: { orgName: true } } }, take: 20 },
    },
  });
  if (!donor || donor.role !== "DONOR") notFound();

  const [alerts, donorEvents, adminActions] = await Promise.all([
    prisma.fraudAlert.findMany({
      where: { entityType: "DONOR", entityId: donor.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.donorEvent.findMany({
      where: { donorId: donor.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.adminActionLog.findMany({
      where: { entityType: "DONOR", entityId: donor.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { admin: { select: { name: true, email: true } } },
    }),
  ]);

  // Timeline = read model composed over the append-only sources. The write
  // models stay separate; only the feed merges them chronologically.
  const timeline = [
    ...donorEvents.map((e) => ({
      at: e.createdAt,
      kind: "EVENT" as const,
      label: e.eventType.replace(/_/g, " "),
      detail: `${e.source}${e.oldValue ? ` · from ${JSON.stringify(e.oldValue)}` : ""}${e.newValue ? ` → ${JSON.stringify(e.newValue)}` : ""}`,
    })),
    ...adminActions.map((a) => ({
      at: a.createdAt,
      kind: "ADMIN" as const,
      label: a.action.replace(/_/g, " "),
      detail: `by ${a.admin.name || a.admin.email}${a.note ? ` — "${a.note}"` : ""}`,
    })),
    ...alerts.map((al) => ({
      at: al.createdAt,
      kind: "ALERT" as const,
      label: `${al.severity} ALERT: ${al.type.replace(/_/g, " ")}`,
      detail: al.resolved ? `resolved${al.resolutionNote ? ` — "${al.resolutionNote}"` : ""}` : "open",
    })),
    ...donor.donations
      .filter((d) => d.status === "SUCCESS")
      .map((d) => ({
        at: d.createdAt,
        kind: "DONATION" as const,
        label: `Donated ₹${Number(d.amount).toLocaleString("en-IN")}`,
        detail: `to "${d.project.title}" (${d.project.ngo.orgName})`,
      })),
    { at: donor.createdAt, kind: "EVENT" as const, label: "JOINED", detail: "Account created" },
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const openAlerts = alerts.filter((a) => !a.resolved);
  const successDonations = donor.donations.filter((d) => d.status === "SUCCESS");
  const failedDonations = donor.donations.filter((d) => d.status === "FAILED");
  const withheldReceipts = successDonations.filter((d) => !d.taxReceipt);
  const panNeedsReview =
    donor.panNumber &&
    (donor.panStatus === "PROVIDER_ERROR" ||
      donor.panStatus === "FAILED" ||
      donor.panVerifiedVia === "MOCK" ||
      donor.panNameMatch === false);

  const KIND_DOT: Record<string, string> = {
    EVENT: "bg-blue-400",
    ADMIN: "bg-purple-400",
    ALERT: "bg-red-400",
    DONATION: "bg-emerald-400",
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link href="/admin/donors" className="text-xs font-bold text-emerald-600 hover:underline">
              ← All donors
            </Link>
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white mt-1">{donor.name}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{donor.email}</p>
          </div>
          {openAlerts.length > 0 && (
            <span className="px-3 py-1.5 rounded-full text-sm font-bold bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {openAlerts.length} open alert{openAlerts.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Identity */}
          <Section title="Identity">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Persona" value={donor.donorPersona ?? "—"} />
              <Field label="Tier" value={donor.donorTier} />
              <Field label="Corporate" value={donor.isCorporate ? donor.companyName || "Yes" : "No"} />
              <Field label="City" value={donor.city} />
              <Field label="Phone" value={donor.phone} />
              <Field label="Joined" value={fmt(donor.createdAt)} />
            </div>
          </Section>

          {/* PAN / Compliance */}
          <Section title="Compliance">
            <div className="grid grid-cols-2 gap-4">
              <Field label="PAN" value={donor.panNumber ?? "Not provided"} />
              <Field
                label="PAN Status"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-bold">{donor.panStatus}</span>
                    {donor.panVerifiedVia && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                          donor.panVerifiedVia === "MOCK"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        }`}
                      >
                        via {donor.panVerifiedVia}
                      </span>
                    )}
                  </span>
                }
              />
              <Field label="Registered name (provider)" value={donor.panRegisteredName} />
              <Field
                label="Name match"
                value={donor.panNameMatch === null ? "—" : donor.panNameMatch ? "✓ Matches" : "✗ MISMATCH"}
              />
              <Field label="FCRA category" value={donor.donorCategory ?? "Undeclared"} />
              <Field
                label="Declared"
                value={donor.donorCategoryDeclaredAt ? `${fmt(donor.donorCategoryDeclaredAt)} (v${donor.donorDeclarationVersion})` : "—"}
              />
            </div>

            {panNeedsReview && (
              <div className="mt-4 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 p-4">
                <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
                  This PAN needs manual review
                  {donor.panVerifiedVia === "MOCK" && " (verified in MOCK mode — no real provider check ran)"}
                  {donor.panNameMatch === false && " (provider name does not match profile name)"}
                  {donor.panStatus === "PROVIDER_ERROR" && " (verification provider was unavailable)"}
                </p>
                <PanActions donorId={donor.id} />
              </div>
            )}
          </Section>
        </div>

        {/* Activity */}
        <Section title={`Donations (${donor.donations.length} shown)`}>
          <div className="flex gap-6 mb-4 text-sm">
            <span className="text-gray-500">Lifetime: <b className="text-gray-900 dark:text-white">₹{Number(donor.totalDonated).toLocaleString("en-IN")}</b></span>
            <span className="text-gray-500">Successful: <b className="text-emerald-600">{successDonations.length}</b></span>
            <span className="text-gray-500">Failed: <b className="text-red-600">{failedDonations.length}</b></span>
            <span className="text-gray-500">Receipts withheld: <b className={withheldReceipts.length ? "text-amber-600" : "text-gray-900 dark:text-white"}>{withheldReceipts.length}</b></span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs font-bold uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Project</th>
                  <th className="py-2 pr-4">NGO</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {donor.donations.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">{fmt(d.createdAt)}</td>
                    <td className="py-2 pr-4 text-gray-900 dark:text-white">{d.project.title}</td>
                    <td className="py-2 pr-4 text-gray-500">{d.project.ngo.orgName}</td>
                    <td className="py-2 pr-4 font-semibold text-gray-900 dark:text-white">₹{Number(d.amount).toLocaleString("en-IN")}</td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        d.status === "SUCCESS"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                          : d.status === "FAILED"
                            ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                            : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                      }`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="py-2">
                      {d.taxReceipt ? (
                        <a
                          href={`/api/receipts/${d.taxReceipt.id}/download`}
                          className="text-xs font-semibold text-emerald-600 hover:underline"
                        >
                          {d.taxReceipt.receiptNumber}
                        </a>
                      ) : d.status === "SUCCESS" ? (
                        <span className="text-xs text-amber-600 font-semibold">withheld (PAN)</span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {donor.donations.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-gray-400">No donations yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Risk */}
          <Section title={`Risk (${openAlerts.length} open / ${alerts.length} total)`}>
            {alerts.length === 0 ? (
              <p className="text-sm text-gray-400">No fraud alerts for this donor.</p>
            ) : (
              <ul className="space-y-3">
                {alerts.map((a) => (
                  <li key={a.id} className="text-sm">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold mr-2 ${
                      a.resolved
                        ? "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                        : a.severity === "HIGH"
                          ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                    }`}>
                      {a.resolved ? "RESOLVED" : a.severity}
                    </span>
                    <span className="text-gray-700 dark:text-gray-300">{a.description}</span>
                    <span className="text-xs text-gray-400 ml-2">{fmt(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <RiskInsight donorId={donor.id} />
          </Section>

          {/* Engagement */}
          <Section title="Engagement">
            <div className="grid grid-cols-2 gap-4">
              <Field label="NGOs followed" value={donor.followers.length} />
              <Field label="Volunteer interest" value={donor.volunteerInterest ? "Yes" : "No"} />
            </div>
            {donor.followers.length > 0 && (
              <p className="mt-3 text-xs text-gray-500">
                Following: {donor.followers.map((f) => f.ngo.orgName).join(", ")}
              </p>
            )}
          </Section>
        </div>

        {/* Timeline */}
        <Section title="Timeline">
          <ol className="space-y-3">
            {timeline.map((item, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${KIND_DOT[item.kind]}`} />
                <div>
                  <span className="font-bold text-gray-900 dark:text-white">{item.label}</span>
                  <span className="text-gray-500 dark:text-gray-400 ml-2">{item.detail}</span>
                  <span className="text-xs text-gray-400 ml-2 whitespace-nowrap">{fmt(item.at)}</span>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </div>
  );
}
