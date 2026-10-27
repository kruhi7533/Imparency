import React from "react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { computeDonorTier } from "@/lib/engagement-utils";
import ReadMoreNarrative from "./components/ReadMoreNarrative";
import ReEngagementCard from "./components/ReEngagementCard";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  FileSignature,
  FileText,
  HandCoins,
  Newspaper,
  PartyPopper,
  Download,
  FolderHeart,
} from "lucide-react";
import { KpiCard, FadeIn, WelcomeHeader, DatePill } from "@/components/ui/DashboardKit";

export const dynamic = "force-dynamic";

export default async function DonorDashboardPage({
  searchParams,
}: {
  searchParams: { reEngagement?: string; payment?: string };
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "DONOR") {
    redirect("/login?callbackUrl=/donor/dashboard");
  }

  const userId = session.user.id;

  // Fetch donor user data along with their successful donations, followed NGOs, and impact reports.
  //
  // The re-engagement lookup goes in the same round trip: it keys off userId
  // and the URL, never off the donor row, so awaiting it separately only bought
  // a second trip to the database. Everything further down *does* depend on one
  // of these two results and has to stay ordered.
  const [donor, activeEvent] = await Promise.all([
    prisma.user.findUnique({
    where: { id: userId },
    include: {
      contracts: {
        select: {
          id: true,
          ngoId: true,
          title: true,
          contractNumber: true,
          totalGrantAmount: true,
          status: true,
          updatedAt: true,
          ngo: { select: { orgName: true } },
          payments: { select: { amount: true, status: true } },
          milestones: { select: { allocatedAmount: true, status: true } },
        },
        orderBy: { updatedAt: "desc" },
      },
      donations: {
        where: { status: "SUCCESS" },
        include: {
          project: {
            select: {
              ngoId: true,
            },
          },
        },
      },
      followers: true,
      impactReports: {
        include: {
          milestone: {
            select: {
              title: true,
              deadline: true,
              project: {
                select: {
                  id: true,
                  title: true,
                  coverImage: true,
                  ngo: {
                    select: {
                      orgName: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { sentAt: "desc" },
      },
    },
    }),
    // An explicit `?reEngagement=` in the URL pins one specific event (the
    // donor followed a link from an email); otherwise show the most recent
    // undismissed one.
    searchParams.reEngagement
      ? prisma.reEngagementEvent.findFirst({
          where: {
            id: searchParams.reEngagement,
            donorId: userId,
            dismissed: false,
          },
        })
      : prisma.reEngagementEvent.findFirst({
          where: {
            donorId: userId,
            dismissed: false,
          },
          orderBy: {
            emailSentAt: "desc",
          },
        }),
  ]);

  if (!donor) {
    redirect("/login");
  }

  // Funder reports on CSR contracts (published by the NGO after review).
  const publishedContractReports = await prisma.contractImpactReport
    .count({ where: { donorId: userId, status: "PUBLISHED" } })
    .catch(() => 0);

  // Calculate stats based on real database records
  // Summed from the donor's own SUCCESS donations rather than the cached
  // User.totalDonated column, which is not updated on every payment path.
  const donationsTotal = donor.donations.reduce((sum, d) => sum + Number(d.amount), 0);
  const totalAmount = Math.max(donationsTotal, Number(donor.totalDonated));
  const donationsCount = donor.donations.length;
  const followedCount = donor.followers.length;
  const tier = computeDonorTier(donationsCount, totalAmount);

  const getTierLabel = (tierName: string) => {
    switch (tierName) {
      case "MAJOR_DONOR":
        return "Major Donor";
      case "COMMITTED":
        return "Committed";
      default:
        return "Standard";
    }
  };

  // CSR / Corporate Governance metrics
  const isCsrOrCorporate = donor.donorPersona === "CSR_OFFICER" || donor.isCorporate;
  const csrBudgetNumber = donor.csrBudget ? Number(donor.csrBudget) : 0;
  const contractCommitments = (donor.contracts || [])
    .filter((c) => c.status === "ACTIVE" || c.status === "COMPLETED")
    .reduce((sum, c) => sum + Number(c.totalGrantAmount), 0);
  const totalUtilized = totalAmount + contractCommitments;

  // Contract money flow, from the same sources as /donor/contracts and
  // lib/contract-payments.ts: committed = signed grant value; reconciled = payments
  // the NGO confirmed it received; disbursed = milestones released.
  const liveContracts = donor.contracts.filter((c) => c.status === "ACTIVE" || c.status === "COMPLETED");
  const reconciledAmount = liveContracts
    .flatMap((c) => c.payments)
    .filter((p) => p.status === "RECONCILED")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const awaitingConfirmation = liveContracts
    .flatMap((c) => c.payments)
    .filter((p) => p.status === "PENDING_CONFIRMATION")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const disbursedAmount = liveContracts
    .flatMap((c) => c.milestones)
    .filter((m) => m.status === "DISBURSED")
    .reduce((sum, m) => sum + Number(m.allocatedAmount), 0);
  const contractsInProgress = donor.contracts.filter((c) => ["DRAFT", "PROPOSED", "UNDER_REVIEW"].includes(c.status)).length;
  const ngosSupported = new Set([
    ...donor.donations.map((d) => d.project.ngoId),
    ...liveContracts.map((c) => c.ngoId),
  ]).size;
  const latestReport = donor.impactReports[0];
  const showGrants = isCsrOrCorporate || donor.contracts.length > 0;
  const projectsBacked = new Set(donor.donations.map((d) => d.projectId)).size;
  const firstName = (donor.name ?? session.user.name ?? "there").split(" ")[0];
  const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const flowMax = Math.max(contractCommitments, reconciledAmount, disbursedAmount, 1);
  const flow = [
    { label: "Committed", value: contractCommitments, bar: "bg-trust-600", note: "signed grant value" },
    { label: "Reconciled", value: reconciledAmount, bar: "bg-emerald-500", note: "confirmed received by NGOs" },
    { label: "Disbursed", value: disbursedAmount, bar: "bg-violet-500", note: "milestones released" },
  ];
  const csrUtilizationPct =
    csrBudgetNumber > 0 ? Math.min(100, Math.round((totalUtilized / csrBudgetNumber) * 100)) : 0;

  // Find referred NGO details if the path is NGO_REFERRAL
  let referredNgoName = null;
  let referredNgoId = null;
  let referredNgoCategories: string[] = [];
  let referredNgoDescription = null;

  if (activeEvent && activeEvent.path === "NGO_REFERRAL") {
    const report = await prisma.impactReport.findUnique({
      where: { id: activeEvent.reportId },
      include: {
        donation: {
          include: {
            project: {
              include: {
                ngo: true,
              },
            },
          },
        },
      },
    });

    if (report) {
      const donatedNgoIds = donor.donations.map((d) => d.project.ngoId);
      const referredNGO = await prisma.nGOProfile.findFirst({
        where: {
          verificationStatus: "VERIFIED",
          isDeleted: false,
          id: { notIn: donatedNgoIds },
          causeCategories: {
            hasSome: report.donation.project.ngo.causeCategories,
          },
        },
        orderBy: { healthScore: "desc" },
        select: {
          id: true,
          orgName: true,
          causeCategories: true,
          description: true,
        },
      });

      if (referredNGO) {
        referredNgoName = referredNGO.orgName;
        referredNgoId = referredNGO.id;
        referredNgoCategories = referredNGO.causeCategories;
        referredNgoDescription = referredNGO.description;
      }
    }
  }

  const STATUS_PILL: Record<string, string> = {
    ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    COMPLETED: "bg-trust-50 text-trust-700 ring-trust-200",
    PROPOSED: "bg-amber-50 text-amber-700 ring-amber-200",
    UNDER_REVIEW: "bg-amber-50 text-amber-700 ring-amber-200",
    DRAFT: "bg-gray-100 text-gray-700 ring-gray-200",
    TERMINATED: "bg-red-50 text-red-700 ring-red-200",
    REJECTED: "bg-red-50 text-red-700 ring-red-200",
  };
  const recentContracts = donor.contracts.slice(0, 4);
  const recentReports = donor.impactReports.slice(0, 5);
  const card = "rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 text-left sm:px-6 lg:px-8">
      <WelcomeHeader
        name={firstName}
        subtitle={
          <>
            Your giving and verified impact at a glance
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-trust-50 px-2 py-0.5 align-middle text-[11px] font-semibold text-trust-700 ring-1 ring-trust-200">
              {getTierLabel(tier)} tier
            </span>
          </>
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            <DatePill />
            <Link
              href="/donor/portfolio"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50"
            >
              Detailed Portfolio <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        }
      />

      {/* Celebrations/Banner Alerts */}
      {searchParams.payment === "success" && (
        <div role="status" className="mb-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left">
          <PartyPopper className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
          <div>
            <h4 className="text-sm font-semibold text-emerald-900">Donation Successful!</h4>
            <p className="mt-0.5 text-sm text-emerald-800">
              Thank you for your generous contribution. Your payment was processed successfully and your impact metrics have been updated.
            </p>
          </div>
        </div>
      )}

      {/* Re-engagement CTA card */}
      {activeEvent && (
        <ReEngagementCard
          eventId={activeEvent.id}
          path={activeEvent.path}
          referredNgoName={referredNgoName}
          referredNgoId={referredNgoId}
          referredNgoCategories={referredNgoCategories}
          referredNgoDescription={referredNgoDescription}
        />
      )}

      {/* KPI row — all figures from this donor's own rows */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Donated"
          value={totalAmount}
          format="inr"
          tone="emerald"
          icon={<HandCoins className="h-5 w-5" />}
          sub={`${donationsCount} successful ${donationsCount === 1 ? "payment" : "payments"}`}
          href="/donor/donations"
        />
        {showGrants ? (
          <KpiCard
          label="Grants committed"
          value={contractCommitments}
          format="inr"
          tone="trust"
          icon={<FileSignature className="h-5 w-5" />}
          sub={
            liveContracts.length > 0 || contractsInProgress > 0
              ? `${liveContracts.length} active${contractsInProgress ? ` · ${contractsInProgress} in progress` : ""}`
              : "No signed contracts yet"
          }
          href="/donor/contracts"
        />
        ) : (
          <KpiCard
            label="Projects backed"
            value={projectsBacked}
            tone="trust"
            icon={<FolderHeart className="h-5 w-5" />}
            sub="with a successful donation"
            href="/donor/portfolio"
          />
        )}
        <KpiCard
          label="Impact reports"
          value={donor.impactReports.length + publishedContractReports}
          tone="violet"
          icon={<Newspaper className="h-5 w-5" />}
          sub={
            publishedContractReports > 0
              ? `${publishedContractReports} contract report${publishedContractReports === 1 ? "" : "s"} published`
              : latestReport
                ? `Latest ${new Date(latestReport.sentAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                : "Arrive after a milestone is verified"
          }
          href="/donor/impact"
        />
        <KpiCard
          label="NGOs supported"
          value={ngosSupported}
          tone="amber"
          icon={<Building2 className="h-5 w-5" />}
          sub={`${followedCount} followed`}
        />
      </div>

      {/* CSR Governance & Annual Budget Utilization */}
      {isCsrOrCorporate && (
        <FadeIn className={`${card} mb-6 p-5 sm:p-6`}>
          <div className="mb-4 flex flex-col justify-between gap-4 border-b border-gray-100 pb-4 md:flex-row md:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-trust-50 px-2.5 py-0.5 text-[11px] font-semibold text-trust-700 ring-1 ring-trust-200">
                  CSR / Corporate Profile
                </span>
                {donor.companyName && <span className="text-sm font-semibold text-gray-900">{donor.companyName}</span>}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-gray-600">
                {donor.gstNumber && (
                  <span>
                    GSTIN: <span className="font-mono font-semibold text-gray-800">{donor.gstNumber}</span>
                  </span>
                )}
                {donor.csrRegistrationNumber && (
                  <>
                    {donor.gstNumber && <span aria-hidden="true">·</span>}
                    <span>
                      MCA Form CSR-1: <span className="font-mono font-semibold text-gray-800">{donor.csrRegistrationNumber}</span>
                    </span>
                  </>
                )}
              </div>
            </div>

            <a
              href="/api/donations/csr-certificate"
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center rounded-lg bg-trust-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-trust-700"
            >
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Download CSR Utilization Certificate
            </a>
          </div>

          {csrBudgetNumber > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span className="text-gray-600">
                  Section 135 Budget Utilized: <span className="font-semibold text-gray-900">₹{totalUtilized.toLocaleString("en-IN")}</span> / ₹
                  {csrBudgetNumber.toLocaleString("en-IN")}
                </span>
                <span className="font-semibold text-emerald-700">{csrUtilizationPct}% Utilized</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div className="h-2 rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${csrUtilizationPct}%` }} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-600">
              Add your annual CSR budget in <Link href="/donor/profile" className="font-semibold text-trust-700 hover:underline">your profile</Link> to track Section 135 utilisation here.
            </p>
          )}
        </FadeIn>
      )}

      {/* Contract money flow + recent contracts */}
      {showGrants && (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <FadeIn className={`${card} p-5 sm:p-6 lg:col-span-3`}>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Grant money flow</h2>
                <p className="mt-0.5 text-xs text-gray-500">Committed vs reconciled vs disbursed, across active and completed contracts</p>
              </div>
            </div>
            {contractCommitments === 0 && reconciledAmount === 0 && disbursedAmount === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
                <p className="text-sm font-medium text-gray-800">No signed grants yet</p>
                <p className="mt-1 text-xs text-gray-600">Once a contract is active, its committed, reconciled and disbursed amounts appear here.</p>
                <Link href="/donor/contracts" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-trust-700 hover:underline">
                  Go to Contracts & Grants <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            ) : (
              <div
                role="img"
                aria-label={`Committed ${inr(contractCommitments)}, reconciled ${inr(reconciledAmount)}, disbursed ${inr(disbursedAmount)}.`}
                className="space-y-4"
              >
                {flow.map((f) => (
                  <div key={f.label}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium text-gray-800">
                        {f.label} <span className="text-xs font-normal text-gray-500">· {f.note}</span>
                      </span>
                      <span className="font-semibold tabular-nums text-gray-900">{inr(f.value)}</span>
                    </div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-3 rounded-full ${f.bar} transition-[width] duration-700 ease-out`}
                        style={{ width: `${Math.max(f.value > 0 ? 2 : 0, (f.value / flowMax) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
                {awaitingConfirmation > 0 && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
                    {inr(awaitingConfirmation)} recorded as paid is awaiting the NGO&apos;s confirmation.
                  </p>
                )}
              </div>
            )}
          </FadeIn>

          <FadeIn className={`${card} p-5 sm:p-6 lg:col-span-2`} delay={0.05}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900">Contracts</h2>
              <Link href="/donor/contracts" className="inline-flex items-center gap-1 text-xs font-semibold text-trust-700 hover:underline">
                View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
            {recentContracts.length === 0 ? (
              <p className="text-sm text-gray-600">No contracts yet. Select an NGO from a CSR requirement to draft one.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {recentContracts.map((c) => (
                  <li key={c.id}>
                    <Link href={`/donor/contracts/${c.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-gray-50">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-trust-50 text-trust-600" aria-hidden="true">
                        <FileText className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{c.title}</span>
                        <span className="block truncate text-xs text-gray-500">
                          {c.ngo.orgName} · {inr(Number(c.totalGrantAmount))}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${STATUS_PILL[c.status] ?? STATUS_PILL.DRAFT}`}>
                        {c.status.replace("_", " ").toLowerCase().replace(/^\w/, (x) => x.toUpperCase())}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </FadeIn>
        </div>
      )}

      {/* Impact reports feed */}
      <FadeIn className={`${card} p-5 sm:p-6`}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">Recent Impact Reports</h2>
          {donor.impactReports.length > 0 && (
            <Link href="/donor/impact" className="inline-flex items-center gap-1 text-xs font-semibold text-trust-700 hover:underline">
              View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>

        {recentReports.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-600">
            Impact reports will appear here after your first donation milestone is verified.
          </div>
        ) : (
          <ol className="relative space-y-5 border-l border-gray-200 pl-6">
            {recentReports.map((report) => (
              <li key={report.id} className="relative">
                <span
                  aria-hidden="true"
                  className="absolute -left-[37px] top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-4 ring-white"
                >
                  <BadgeCheck className="h-3.5 w-3.5" />
                </span>
                <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-start sm:gap-4">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900">
                      <Link href={`/projects/${report.milestone.project.id}`} className="hover:text-trust-700">
                        {report.milestone.project.title}
                      </Link>
                    </h3>
                    <p className="text-xs text-gray-600">
                      <span className="font-medium text-emerald-700">{report.milestone.project.ngo.orgName}</span>
                      <span aria-hidden="true"> · </span>
                      Milestone: {report.milestone.title}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-gray-500">
                    Reported on {new Date(report.sentAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </div>

                <div className="mt-2">
                  <ReadMoreNarrative narrative={report.aiGeneratedNarrative} limit={200} />
                </div>

                {(report.sdgTags.length > 0 || report.irisMetrics.length > 0) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {report.sdgTags.map((tag) => (
                      <span key={tag} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        {tag.startsWith("#") ? tag : `#${tag}`}
                      </span>
                    ))}
                    {report.irisMetrics.map((metric) => (
                      <span key={metric} className="rounded-full bg-trust-50 px-2 py-0.5 text-[10px] font-semibold text-trust-700 ring-1 ring-trust-200">
                        IRIS: {metric}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </FadeIn>
    </div>
  );
}
