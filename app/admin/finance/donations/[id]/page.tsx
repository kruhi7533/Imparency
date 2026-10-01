import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import { buildMoneyTimeline, loadDonationCaseFile } from "@/lib/finance-case-file";
import { netAmount } from "@/lib/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One transaction, end to end: the donor's intent, the money, the documents
 * issued against it, what the organisation delivered, and everything anyone
 * did to any of it afterwards.
 *
 * The question this answers is the one an admin is actually asked — "what
 * happened with this payment?" — and which no single page could answer before.
 * The facts lived in seven tables and four screens, none reachable from a
 * ledger row.
 *
 * Strictly read-only. A page relied on as evidence must not also be a place
 * where evidence can be changed; corrections belong on the pages that own each
 * record, where they are audited.
 */

const KIND_STYLE: Record<string, { dot: string; label: string }> = {
  INTENT: { dot: "bg-gray-400", label: "Intent" },
  MONEY_IN: { dot: "bg-emerald-500", label: "Money in" },
  MONEY_OUT: { dot: "bg-red-500", label: "Money out" },
  DOCUMENT: { dot: "bg-blue-500", label: "Document" },
  DELIVERY: { dot: "bg-violet-500", label: "Delivery" },
  PROBLEM: { dot: "bg-amber-500", label: "Problem" },
  ADMIN: { dot: "bg-gray-300 dark:bg-gray-600", label: "System" },
};

function rupees(value: { toString(): string } | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `₹${Number(value.toString()).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-0 border-gray-100 dark:border-gray-800">
      <span className="text-xs font-bold uppercase tracking-wide text-gray-400 shrink-0">{label}</span>
      <span className="text-sm text-gray-900 dark:text-white text-right break-all">{value}</span>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <h2 className="text-sm font-extrabold text-gray-900 dark:text-white">{title}</h2>
      {hint && <p className="mt-0.5 mb-2 text-xs text-gray-400">{hint}</p>}
      <div className={hint ? "" : "mt-2"}>{children}</div>
    </section>
  );
}

export default async function DonationCaseFilePage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/unauthorized");

  let caseFile;
  try {
    caseFile = await loadDonationCaseFile(params.id);
  } catch (err: any) {
    if (err?.code === "P2021" || err?.code === "P2022") {
      return <SchemaOutOfSync title="Transaction view failed to load" detail={err?.meta?.table || err?.message} />;
    }
    throw err;
  }
  if (!caseFile) notFound();

  const { donation, ledger, webhookEvents, exceptions, receiptEvents, milestones, adminActions } = caseFile;

  const ledgerNet = netAmount(ledger);
  const captured = ledger
    .filter((e) => e.entryType === "DONATION_CAPTURED")
    .reduce((sum, e) => sum + Number(e.amount.toString()), 0);
  const refunded = ledger
    .filter((e) => e.entryType === "DONATION_REFUNDED")
    .reduce((sum, e) => sum + Number(e.amount.toString()), 0);

  const timeline = buildMoneyTimeline({
    donation,
    ledger,
    webhookEvents,
    receipt: donation.taxReceipt,
    receiptEvents,
    proofs: milestones.flatMap((m) =>
      m.proofs.map((p) => ({
        submittedAt: p.submittedAt,
        milestoneTitle: m.title,
        documentCount: p.mediaUrls.length + p.documentUrls.length,
      })),
    ),
    impactReports: donation.impactReports,
    exceptions,
    adminActions,
  });

  const snapshot = (donation.complianceSnapshot ?? null) as Record<string, unknown> | null;
  const openExceptions = exceptions.filter((e) => e.status === "OPEN");

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <Link href="/admin/finance" className="text-xs font-bold text-gray-500 hover:underline">
            ← Finance
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold text-gray-900 dark:text-white">
            {rupees(donation.amount)} · {donation.donor.name ?? donation.donor.email}
            <span className="text-gray-400 font-bold"> → </span>
            {donation.project.ngo?.orgName ?? "Unknown organisation"}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {donation.project.title} · started {donation.createdAt.toLocaleString("en-IN")}
          </p>
        </div>

        {openExceptions.length > 0 && (
          <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 p-4">
            <p className="text-sm font-bold text-red-700 dark:text-red-400">
              {openExceptions.length} open finance exception{openExceptions.length === 1 ? "" : "s"} on this transaction
            </p>
            <ul className="mt-1 space-y-0.5">
              {openExceptions.map((e) => (
                <li key={e.id} className="text-sm text-red-700 dark:text-red-300">
                  {e.summary}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {/* ── The money ─────────────────────────────────────────────── */}
          <Card
            title="The money"
            hint="What was asked for, what arrived, and what went back."
          >
            <Row label="Requested" value={rupees(donation.amount)} />
            <Row label="Captured" value={captured ? rupees(captured) : "—"} />
            <Row label="Refunded" value={refunded ? rupees(refunded) : "—"} />
            <Row
              label="Net held"
              value={<strong>{rupees(ledgerNet)}</strong>}
            />
            <Row label="Status" value={donation.status} />
            {ledger.length === 0 && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                No ledger entry exists for this donation — the money is recorded only as a counter,
                with nothing to check it against.
              </p>
            )}
          </Card>

          {/* ── The payment ───────────────────────────────────────────── */}
          <Card title="The payment" hint="Provider references, for matching against a statement.">
            <Row label="Order" value={<span className="font-mono text-xs">{donation.razorpayOrderId}</span>} />
            <Row
              label="Payment"
              value={
                donation.razorpayPaymentId ? (
                  <span className="font-mono text-xs">{donation.razorpayPaymentId}</span>
                ) : (
                  "—"
                )
              }
            />
            <Row label="Attempts" value={donation.retryCount === 0 ? "First attempt succeeded" : `${donation.retryCount} failed`} />
            <Row
              label="Deliveries"
              value={
                webhookEvents.length === 0
                  ? "None recorded"
                  : webhookEvents.map((w) => w.eventType).join(", ")
              }
            />
          </Card>

          {/* ── Who gave ──────────────────────────────────────────────── */}
          <Card title="The donor" hint="Identity state, not identity documents.">
            <Row label="Name" value={donation.donor.name ?? "—"} />
            <Row label="Email" value={donation.donor.email} />
            <Row label="Category" value={donation.donor.donorCategory ?? "—"} />
            <Row
              label="PAN"
              value={`${donation.donor.panStatus ?? "—"}${donation.donor.panVerifiedVia ? ` · ${donation.donor.panVerifiedVia}` : ""}`}
            />
            <p className="mt-2 text-xs text-gray-400">
              The PAN number itself is not shown here. Whether it was verified is what governs the
              80G receipt; the number answers no finance question.
            </p>
          </Card>

          {/* ── Who received ──────────────────────────────────────────── */}
          <Card title="The organisation">
            <Row
              label="Organisation"
              value={
                donation.project.ngo ? (
                  <Link href={`/admin/ngos/${donation.project.ngoId}`} className="underline">
                    {donation.project.ngo.orgName}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <Row label="Verification" value={donation.project.ngo?.verificationStatus ?? "—"} />
            <Row label="Campaign" value={donation.project.title} />
          </Card>
        </div>

        {/* ── Documents ───────────────────────────────────────────────── */}
        <Card
          title="Documents"
          hint="Every document this transaction produced, and who has taken a copy."
        >
          {donation.taxReceipt ? (
            <div className="flex items-center justify-between gap-4 py-2">
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">
                  80G tax receipt {donation.taxReceipt.receiptNumber}
                </p>
                <p className="text-xs text-gray-400">
                  FY {donation.taxReceipt.financialYear} · issued{" "}
                  {donation.taxReceipt.issuedAt.toLocaleDateString("en-IN")} ·{" "}
                  {receiptEvents.length} recorded access
                  {receiptEvents.length === 1 ? "" : "es"}
                </p>
              </div>
              {/* Downloads through the audited route: every admin copy is
                  recorded as a ReceiptEvent, because taking a copy of a tax
                  document is itself a disclosure. */}
              <a
                href={`/api/receipts/${donation.taxReceipt.id}/download`}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs font-bold"
              >
                Download
              </a>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No 80G receipt issued.{" "}
              {donation.donor.panStatus === "VERIFIED"
                ? "The donor's PAN is verified, so this is worth checking."
                : "The donor's PAN is not verified, which is why one was withheld."}
            </p>
          )}

          {milestones.some((m) => m.proofs.length > 0) && (
            <div className="mt-4 space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
                Evidence filed against the milestones this funded
              </p>
              {milestones.map((milestone) =>
                milestone.proofs.map((proof) => (
                  <div key={proof.id} className="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{milestone.title}</p>
                    <p className="text-xs text-gray-400">
                      submitted {proof.submittedAt.toLocaleDateString("en-IN")} · {milestone.status}
                    </p>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{proof.description}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {proof.documentUrls.map((url, i) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-bold px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/20"
                        >
                          📄 Document {i + 1}
                        </a>
                      ))}
                      {proof.mediaUrls.map((url, i) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-bold px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100/50 dark:border-emerald-900/20"
                        >
                          🖼️ Image {i + 1}
                        </a>
                      ))}
                    </div>
                  </div>
                )),
              )}
            </div>
          )}
        </Card>

        {/* ── Compliance at the moment of payment ─────────────────────── */}
        <Card
          title="Compliance at the moment of payment"
          hint="An immutable snapshot taken when the payment was confirmed. Audits read this, not today's live state — it is what was true when the money was accepted."
        >
          {snapshot ? (
            <div className="grid gap-x-8 sm:grid-cols-2">
              {Object.entries(snapshot)
                .filter(([key]) => key !== "version")
                .map(([key, value]) => (
                  <Row
                    key={key}
                    label={key.replace(/([A-Z])/g, " $1").toLowerCase()}
                    value={value === null || value === undefined ? "—" : String(value)}
                  />
                ))}
            </div>
          ) : (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              No snapshot was captured for this payment. It cannot be reconstructed — the donor and
              organisation state it recorded has since moved on.
            </p>
          )}
        </Card>

        {/* ── What the money funded ───────────────────────────────────── */}
        {milestones.length > 0 && (
          <Card title="What this funded" hint="The milestones the donor chose to back.">
            <ul className="space-y-2">
              {milestones.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-gray-900 dark:text-white">{m.title}</span>
                  <span className="text-xs font-bold text-gray-400">
                    {rupees(m.targetAmount)} · {m.status}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* ── The story ───────────────────────────────────────────────── */}
        <Card
          title="Everything that happened"
          hint="Re-derived from the records themselves on every load, so it cannot drift from them."
        >
          <ol className="mt-2 space-y-3">
            {timeline.map((event, i) => {
              const style = KIND_STYLE[event.kind] ?? KIND_STYLE.ADMIN;
              return (
                <li key={`${event.at.toISOString()}-${i}`} className="flex gap-3">
                  <div className="flex flex-col items-center shrink-0 pt-1.5">
                    <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                    {i < timeline.length - 1 && (
                      <span className="w-px flex-1 bg-gray-200 dark:bg-gray-800 mt-1" />
                    )}
                  </div>
                  <div className="pb-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{event.title}</p>
                    {event.detail && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 break-all">{event.detail}</p>
                    )}
                    <p className="text-xs text-gray-400">{event.at.toLocaleString("en-IN")}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>

        <p className="text-xs text-gray-400">
          This page is read-only. Nothing on it can be edited here — corrections are made on the
          page that owns each record, where they are audited.
        </p>
      </div>
    </div>
  );
}
