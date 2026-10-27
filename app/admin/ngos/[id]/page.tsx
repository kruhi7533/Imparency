import { breakGlassPageGate } from "@/app/admin/break-glass/BreakGlassGate";
import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { computeCompliance, deriveFcraStatus, hasVerifiedImpactProof } from "@/lib/ngo-compliance";
import { buildNgoRiskAndFraudView } from "@/lib/risk-compliance-view";
import { deriveComplianceEvidence } from "@/lib/compliance-evidence";
import { assessVerificationStanding } from "@/lib/verification-standing";
import TrustInsight from "./TrustInsight";
import RequestReverification from "./RequestReverification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

const STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  VERIFIED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
};

const SEVERITY_BADGE: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-blue-100 text-blue-700",
};

const MILESTONE_BADGE: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  PROOF_SUBMITTED: "bg-amber-100 text-amber-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  VERIFIED: "bg-emerald-100 text-emerald-700",
};

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold text-gray-500">{label}</p>
      <p className="text-sm text-gray-900 mt-0.5">{value ?? "—"}</p>
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${className}`}>{children}</span>;
}

export default async function NgoDetailPage({ params }: { params: { id: string } }) {
  const breakGlass = await breakGlassPageGate({ orgType: "NGO", orgId: params.id });
  if (breakGlass) return breakGlass;
  const ngo = await prisma.nGOProfile.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { email: true } },
      compliance: true,
      riskReviews: { orderBy: { createdAt: "desc" }, take: 20 },
      projects: {
        orderBy: { createdAt: "desc" },
        include: {
          milestones: {
            orderBy: { sequenceOrder: "asc" },
            select: { id: true, title: true, status: true, targetAmount: true, deadline: true, sequenceOrder: true },
          },
        },
      },
    },
  });
  if (!ngo) notFound();

  const [openAlerts, resolvedAlerts, adminActions, hasImpact, extractedFields] = await Promise.all([
    prisma.fraudAlert.findMany({
      where: { entityType: "NGO", entityId: ngo.id, resolved: false },
      orderBy: { createdAt: "desc" },
    }),
    prisma.fraudAlert.findMany({
      where: { entityType: "NGO", entityId: ngo.id, resolved: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.adminActionLog.findMany({
      where: { entityType: { in: ["NGO", "FCRA"] }, entityId: ngo.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { admin: { select: { name: true, email: true } } },
    }),
    hasVerifiedImpactProof(ngo.id),
    // Loaded so this page can answer "does the evidence support the status"
    // without depending on the reversal sweep having run. See
    // lib/verification-standing.ts.
    prisma.extractedField.findMany({
      where: { ngoId: ngo.id },
      select: { fieldKey: true, status: true },
    }),
  ]);

  const compliance = computeCompliance(ngo.compliance ?? null, hasImpact);
  const evidence = deriveComplianceEvidence(extractedFields);
  const standing = assessVerificationStanding({
    verificationStatus: ngo.verificationStatus,
    noExtraction: evidence.noExtraction,
    outstandingCount: evidence.outstanding.length,
    openHighDefects: openAlerts.filter((a) => a.severity === "HIGH").length,
  });
  const fcraBadge = ngo.compliance?.fcraExpiryDate
    ? deriveFcraStatus(ngo.compliance.fcraExpiryDate) ?? ngo.compliance.fcraStatus
    : ngo.compliance?.fcraStatus ?? "NONE";

  const raisedTotal = ngo.projects.reduce((sum, p) => sum + Number(p.raisedAmount), 0);
  const allMilestones = ngo.projects.flatMap((p) => p.milestones);
  const completedMilestones = allMilestones.filter((m) => ["COMPLETED", "VERIFIED"].includes(m.status)).length;
  const ongoingProjects = ngo.projects.filter((p) => p.status === "ACTIVE");

  return (
    <div className="py-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <Link href="/admin/dashboard" className="text-xs font-bold text-emerald-600 hover:underline">
          ← Back to NGO Verification
        </Link>

        {/* Does the evidence support the status? Above the header on purpose:
            a green VERIFIED badge with nothing behind it is the thing this
            page used to say, and a footnote would not have corrected it. */}
        {standing.level !== "OK" && (
          <div
            className={`rounded-2xl border p-4 ${
              standing.alarming
                ? "border-red-200 bg-red-50"
                : "border-amber-200 bg-amber-50"
            }`}
          >
            <p className={`text-sm font-bold ${standing.alarming ? "text-red-700" : "text-amber-700"}`}>
              {standing.alarming ? "⚠ " : ""}
              {standing.headline}
            </p>
            <p className={`text-sm mt-1 ${standing.alarming ? "text-red-600" : "text-amber-700"}`}>
              {standing.detail}
            </p>
            {standing.level === "UNSUPPORTED" && (
              <Link href="/admin/document-review" className="text-xs font-bold underline mt-2 inline-block text-red-700">
                Run extraction in Document Review →
              </Link>
            )}
          </div>
        )}

        {/* Header */}
        <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900">{ngo.orgName}</h1>
                <Badge className={STATUS_BADGE[ngo.verificationStatus] ?? "bg-gray-100 text-gray-600"}>
                  {ngo.verificationStatus}
                </Badge>
                {ngo.isSuspended && <Badge className="bg-red-100 text-red-700">SUSPENDED</Badge>}
              </div>
              <p className="text-sm text-gray-500 mt-1">{ngo.user.email}</p>
              <a href={`/ngo/${ngo.id}`} className="text-xs text-emerald-600 hover:underline mt-1 inline-block">
                View public profile ↗
              </a>
            </div>
            <div className="flex gap-6 text-right">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase">Health Score</p>
                <p className="text-2xl font-bold text-emerald-600">{ngo.healthScore != null ? Number(ngo.healthScore).toFixed(0) : "N/A"}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase">Compliance</p>
                <p className="text-2xl font-bold text-blue-600">{compliance.score}/100</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase">Raised</p>
                <p className="text-2xl font-bold text-gray-900">₹{raisedTotal.toLocaleString("en-IN")}</p>
              </div>
            </div>
          </div>
          {ngo.isSuspended && ngo.suspensionReason && (
            <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              Suspended: {ngo.suspensionReason}
            </p>
          )}
          {ngo.adminNote && (
            <p className="mt-3 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
              Admin note: {ngo.adminNote}
            </p>
          )}
        </div>

        <TrustInsight ngoId={ngo.id} />

        <RequestReverification
          ngoId={ngo.id}
          verificationStatus={ngo.verificationStatus}
          dueAt={ngo.reverificationRequiredAt ? (ngo.reverificationDueAt ?? ngo.reverificationRequiredAt).toISOString() : null}
          reason={ngo.reverificationReason ?? null}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Registration details */}
          <Section title="Registration">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Registration No." value={ngo.registrationNumber} />
              <Field label="PAN" value={ngo.panNumber} />
              <Field label="Founded" value={ngo.foundedYear} />
              <Field label="Website" value={ngo.website ? <a href={ngo.website} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">{ngo.website}</a> : "—"} />
              <Field label="Address" value={ngo.address} />
              <Field label="Causes" value={ngo.causeCategories.join(", ") || "—"} />
              <Field label="Applied" value={fmtDate(ngo.createdAt)} />
            </div>
          </Section>

          {/* Compliance */}
          <Section title="Compliance">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Registration" value={ngo.compliance?.registrationVerified ? "Verified" : "Pending"} />
              <Field label="PAN" value={ngo.compliance?.panVerified ? "Verified" : "Pending"} />
              <Field label="80G" value={ngo.compliance?.eightyGVerified ? "Verified" : "Pending"} />
              <Field label="12A" value={ngo.compliance?.a12Verified ? "Verified" : "Not submitted"} />
              <Field
                label="FCRA"
                value={
                  <Link href="/admin/fcra-review" className="text-emerald-600 hover:underline">
                    {String(fcraBadge)} {ngo.compliance?.fcraNumber ? `(${ngo.compliance.fcraNumber})` : ""}
                  </Link>
                }
              />
              <Field label="FCRA Expiry" value={fmtDate(ngo.compliance?.fcraExpiryDate ?? null)} />
            </div>
          </Section>

          {/* Projects & Milestones */}
          <Section title={`Projects (${ngo.projects.length})`}>
            {ngo.projects.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No projects submitted yet.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {ngo.projects.map((p) => (
                  <div key={p.id} className="flex justify-between items-center text-sm p-2 border-b border-gray-100 last:border-b-0">
                    <div>
                      <p className="font-semibold text-gray-800">{p.title}</p>
                      <p className="text-xs text-gray-500">
                        {p.status} · {p.milestones.filter((m) => ["COMPLETED", "VERIFIED"].includes(m.status)).length}/{p.milestones.length} milestones done
                      </p>
                    </div>
                    <p className="font-bold text-gray-700">₹{Number(p.raisedAmount).toLocaleString("en-IN")}</p>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-3">{completedMilestones}/{allMilestones.length} milestones completed platform-wide for this NGO.</p>
          </Section>

          {/* Fraud alerts & risk reviews */}
          <Section title="Risk & Fraud">
            {(() => {
              // What to show (empty-state vs. the two lists, and each open
              // review's display strings) is decided in
              // lib/risk-compliance-view.ts — see buildNgoRiskAndFraudView's
              // docstring for the bug this replaced. This component only lays
              // out the result.
              const view = buildNgoRiskAndFraudView(openAlerts.length, ngo.riskReviews);
              if (view.isEmpty) {
                return <p className="text-xs text-emerald-600 font-semibold">No open fraud alerts or risk reviews.</p>;
              }
              return (
                <div className="space-y-2">
                  {view.openReviews.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-sm p-2 border-b border-gray-100">
                      <div>
                        <p className="font-semibold text-gray-800">
                          Open risk review
                          {r.reasonLabel ? ` — ${r.reasonLabel}` : ""}
                        </p>
                        <p className="text-xs text-gray-500">
                          Opened {fmtDate(r.createdAt as Date)}
                          {r.recommendedActionLabel ? ` · Recommended: ${r.recommendedActionLabel}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge className={SEVERITY_BADGE[r.riskLevel] ?? "bg-gray-100 text-gray-600"}>{r.riskLevel}</Badge>
                        <Link href={r.caseHref} className="text-xs text-emerald-600 hover:underline">
                          View case →
                        </Link>
                      </div>
                    </div>
                  ))}
                  {openAlerts.map((a) => (
                    <div key={a.id} className="flex items-center justify-between text-sm p-2 border-b border-gray-100">
                      <div>
                        <p className="font-semibold text-gray-800">{a.type}</p>
                        <p className="text-xs text-gray-500">{a.description}</p>
                      </div>
                      <Badge className={SEVERITY_BADGE[a.severity] ?? "bg-gray-100 text-gray-600"}>{a.severity}</Badge>
                    </div>
                  ))}
                </div>
              );
            })()}
            {(openAlerts.length > 0 || resolvedAlerts.length > 0 || ngo.riskReviews.length > 0) && (
              <Link href="/admin/risk-compliance" className="text-xs text-emerald-600 hover:underline mt-3 inline-block">
                Open Risk &amp; Compliance queue ↗
              </Link>
            )}
          </Section>
        </div>

        {/* Admin action history */}
        <Section title="Admin Action History">
          {adminActions.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No admin actions recorded for this NGO yet.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {adminActions.map((a) => (
                <div key={a.id} className="text-sm p-2 border-b border-gray-100 last:border-b-0">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-800">{a.action}</span>
                    <span className="text-xs text-gray-500">{fmt(a.createdAt)}</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    by {a.admin ? a.admin.name || a.admin.email : "the platform (automated)"}
                    {a.note ? ` — ${a.note}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Ongoing projects & their milestones */}
        <Section title={`Ongoing Projects & Milestones (${ongoingProjects.length})`}>
          {ongoingProjects.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No active projects right now.</p>
          ) : (
            <div className="space-y-5">
              {ongoingProjects.map((p) => {
                const doneCount = p.milestones.filter((m) => ["COMPLETED", "VERIFIED"].includes(m.status)).length;
                return (
                  <div key={p.id} className="border border-gray-100 rounded-xl p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-gray-900">{p.title}</p>
                        <p className="text-xs text-gray-500">
                          ₹{Number(p.raisedAmount).toLocaleString("en-IN")} raised of ₹{Number(p.targetAmount).toLocaleString("en-IN")} · {doneCount}/{p.milestones.length} milestones done
                        </p>
                      </div>
                    </div>
                    {p.milestones.length === 0 ? (
                      <p className="text-xs text-gray-500 italic mt-3">No milestones defined yet.</p>
                    ) : (
                      <div className="mt-3 space-y-1.5">
                        {p.milestones.map((m) => (
                          <div key={m.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-gray-50">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-gray-500 font-mono">{m.sequenceOrder}.</span>
                              <span className="text-gray-800 font-semibold truncate">{m.title}</span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-gray-500">Due {fmtDate(m.deadline)}</span>
                              <span className="text-gray-500">₹{Number(m.targetAmount).toLocaleString("en-IN")}</span>
                              <Badge className={MILESTONE_BADGE[m.status] ?? "bg-gray-100 text-gray-600"}>{m.status.replace("_", " ")}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
