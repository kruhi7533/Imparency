"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Donation {
  id: string;
  amount: string;
  status: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";
  createdAt: string;
  retryToken: string | null;
  retryTokenExpiresAt: string | null;
  project: {
    id: string;
    title: string;
    causeCategory: string;
    coverImage: string;
    ngo: {
      id: string;
      orgName: string;
    };
  };
  taxReceipt: {
    receiptNumber: string;
    financialYear: string;
    pdfUrl: string;
    issuedAt: string;
  } | null;
}

interface SummaryStats {
  totalDonated: number;
  successCount: number;
  pendingCount: number;
  failedCount: number;
}

export default function DonationsPage() {
  const router = useRouter();

  // Filters & List State
  const [statusFilter, setStatusFilter] = useState<"ALL" | "SUCCESS" | "PENDING" | "FAILED">("ALL");
  const [donations, setDonations] = useState<Donation[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  // Summary State
  const [summary, setSummary] = useState<SummaryStats>({
    totalDonated: 0,
    successCount: 0,
    pendingCount: 0,
    failedCount: 0,
  });
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Expired link local state tracker
  const [expiredDonationIds, setExpiredDonationIds] = useState<Record<string, string>>({});
  const [fetchError, setFetchError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // Deep links such as the sidebar's "Payment Tracking" (?status=FAILED) open
  // on that tab. Read once on mount — the tab is local state after that.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("status")?.toUpperCase();
    if (wanted === "SUCCESS" || wanted === "PENDING" || wanted === "FAILED") setStatusFilter(wanted);
  }, []);

  // Fetch summary once on mount
  useEffect(() => {
    async function fetchSummary() {
      try {
        const res = await fetch("/api/donor/donations/summary");
        if (res.ok) {
          const data = await res.json();
          setSummary(data);
        }
      } catch (err) {
        console.error("Failed to fetch summary stats", err);
      } finally {
        setSummaryLoading(false);
      }
    }
    fetchSummary();
  }, []);

  // Fetch paginated listing
  useEffect(() => {
    async function fetchDonations() {
      if (page === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const statusQuery = statusFilter !== "ALL" ? `&status=${statusFilter}` : "";
        const res = await fetch(`/api/donor/donations?page=${page}&limit=10${statusQuery}`);
        if (res.ok) {
          const data = await res.json();
          if (page === 1) {
            setDonations(data.donations);
          } else {
            setDonations((prev) => [...prev, ...data.donations]);
          }
          setHasMore(data.pagination.hasMore);
          setTotalCount(data.pagination.total);
          setFetchError(false);
        } else {
          setFetchError(true);
        }
      } catch (err) {
        console.error("Failed to fetch donations list", err);
        setFetchError(true);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    }
    fetchDonations();
  }, [statusFilter, page, retryKey]);

  const handleTabChange = (newStatus: "ALL" | "SUCCESS" | "PENDING" | "FAILED") => {
    setStatusFilter(newStatus);
    setPage(1);
    setDonations([]);
  };

  const handleLoadMore = () => {
    if (hasMore && !loadingMore) {
      setPage((prev) => prev + 1);
    }
  };

  const handleRetryClick = (
    donationId: string,
    retryToken: string | null,
    expiresAtStr: string | null,
    ngoId: string
  ) => {
    if (retryToken && expiresAtStr && new Date(expiresAtStr) > new Date()) {
      router.push(`/donor/retry/${retryToken}`);
    } else {
      setExpiredDonationIds((prev) => ({ ...prev, [donationId]: ngoId }));
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  // Skeleton Loader card component
  const DonationSkeleton = () => (
    <div className="bg-white border border-gray-200/80 rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-5 space-y-4 animate-pulse">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gray-200"></div>
          <div className="h-4 w-32 bg-gray-200 rounded"></div>
        </div>
        <div className="h-6 w-20 bg-gray-200 rounded"></div>
      </div>
      <div className="flex justify-between items-center">
        <div className="h-4 w-48 bg-gray-200 rounded"></div>
        <div className="h-5 w-24 bg-gray-200 rounded-full"></div>
      </div>
      <div className="flex justify-between items-end">
        <div className="h-4 w-20 bg-gray-200 rounded"></div>
        <div className="h-8 w-32 bg-gray-200 rounded-xl"></div>
      </div>
    </div>
  );

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto text-left">
      
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900">Donation History</h1>
        <p className="text-gray-600 text-sm mt-1">
          All your donations and payment records
        </p>
      </div>

      {/* Summary Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          {
            label: "Total Donated",
            value: summaryLoading ? "Loading..." : `Rs.${summary.totalDonated.toLocaleString("en-IN")}`,
            sub: "across all NGOs",
            color: "text-emerald-700",
          },
          {
            label: "Total Donations",
            value: summaryLoading ? "Loading..." : summary.successCount.toString(),
            sub: "successful payments",
            color: "text-gray-900",
          },
          {
            label: "Pending",
            value: summaryLoading ? "Loading..." : summary.pendingCount.toString(),
            sub: "currently pending",
            color: "text-amber-700",
          },
          {
            label: "Failed",
            value: summaryLoading ? "Loading..." : summary.failedCount.toString(),
            sub: "unsuccessful payments",
            color: "text-red-700",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white border border-gray-200/80 rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-5 relative overflow-hidden"
          >
            <div className="text-xs font-medium text-gray-600 mb-1">{stat.label}</div>
            <div className={`text-2xl font-semibold tabular-nums ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Status Filter Tabs */}
      <div className="flex gap-2 mb-6 flex-wrap border-b border-gray-200 pb-5">
        {[
          { id: "ALL", label: "All" },
          { id: "SUCCESS", label: "Successful" },
          { id: "PENDING", label: "Pending" },
          { id: "FAILED", label: "Failed" },
        ].map((tab) => {
          const isActive = statusFilter === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id as any)}
              className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
                isActive
                  ? "bg-trust-600 text-white shadow-sm"
                  : "bg-white text-gray-700 hover:text-gray-900 hover:bg-gray-50 border border-gray-300"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Donations List */}
      <div className="space-y-4">
        {loading && page === 1 ? (
          <>
            <DonationSkeleton />
            <DonationSkeleton />
            <DonationSkeleton />
          </>
        ) : fetchError ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-12 text-center flex flex-col items-center justify-center">
            <h3 className="font-extrabold text-red-800 text-sm mb-1.5">
              Couldn't load your donations right now.
            </h3>
            <p className="text-xs text-red-700 mb-4">
              This is on our end, not yours — your donation history hasn't gone anywhere. Please try again.
            </p>
            <button
              onClick={() => setRetryKey((k) => k + 1)}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-xl text-xs transition shadow-sm"
            >
              Try Again
            </button>
          </div>
        ) : donations.length > 0 ? (
          donations.map((donation) => {
            const amountValue = Number(donation.amount);
            const formattedDate = formatDate(donation.createdAt);

            // Status Badge Classes
            let badgeClass = "bg-gray-100 text-gray-700 border-gray-200";
            let statusText: string = donation.status;
            if (donation.status === "SUCCESS") {
              badgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
              statusText = "✓ Successful";
            } else if (donation.status === "PENDING") {
              badgeClass = "bg-amber-50 text-amber-700 border-amber-200";
              statusText = "⏳ Pending";
            } else if (donation.status === "FAILED") {
              badgeClass = "bg-red-50 text-red-700 border-red-200";
              statusText = "✗ Failed";
            } else if (donation.status === "REFUNDED") {
              badgeClass = "bg-gray-100 text-gray-700 border-gray-200";
              statusText = "↩ Refunded";
            }

            return (
              <div
                key={donation.id}
                className="bg-white border border-gray-200/80 rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-5 space-y-4 hover:border-gray-300 hover:shadow-md transition"
              >
                {/* Row 1: Logo Initial, NGO Name & Amount */}
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-black flex items-center justify-center text-sm select-none">
                      {donation.project.ngo.orgName.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-semibold text-sm text-gray-900 tracking-tight leading-none">
                      {donation.project.ngo.orgName}
                    </span>
                  </div>
                  <span className="text-base font-semibold tabular-nums text-gray-900">
                    Rs.{amountValue.toLocaleString("en-IN")}
                  </span>
                </div>

                {/* Row 2: Project Title & Status Badge */}
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600 truncate max-w-[65%]">
                    {donation.project.title}
                  </span>
                  <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border ${badgeClass}`}>
                    {statusText}
                  </span>
                </div>

                {/* Row 3: Date & Actions */}
                <div className="flex justify-between items-end">
                  <div className="space-y-1.5 text-left">
                    <span className="block text-[11px] text-gray-600 font-semibold">
                      {formattedDate}
                    </span>
                    {donation.status === "PENDING" &&
                      new Date().getTime() - new Date(donation.createdAt).getTime() > 30 * 60 * 1000 && (
                        <Link
                          href="/help"
                          className="block text-[10px] text-gray-600 hover:text-gray-900 underline font-medium"
                        >
                          Contact Support
                        </Link>
                      )}
                  </div>

                  {/* Action Elements */}
                  <div>
                    {donation.status === "SUCCESS" && (
                      <div className="text-right space-y-1">
                        {donation.taxReceipt ? (
                          <>
                            <a
                              href={donation.taxReceipt.pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-1.5 px-4 rounded-xl text-xs transition"
                            >
                              Download Receipt
                            </a>
                            <span className="block text-[10px] text-gray-500 font-mono">
                              #{donation.taxReceipt.receiptNumber}
                            </span>
                          </>
                        ) : (
                          <span className="block text-xs text-gray-600 italic font-semibold">
                            Receipt Pending
                          </span>
                        )}
                      </div>
                    )}

                    {donation.status === "FAILED" && (
                      <div className="text-right">
                        {expiredDonationIds[donation.id] ? (
                          <div className="space-y-1">
                            <span className="block text-[10px] text-gray-600 font-semibold">
                              Retry expired
                            </span>
                            <Link
                              href={`/ngo/${expiredDonationIds[donation.id]}`}
                              className="inline-flex items-center text-xs text-trust-700 hover:text-trust-800 font-bold underline"
                            >
                              Donate again &rarr;
                            </Link>
                          </div>
                        ) : (
                          <button
                            onClick={() =>
                              handleRetryClick(
                                donation.id,
                                donation.retryToken,
                                donation.retryTokenExpiresAt,
                                donation.project.ngo.id
                              )
                            }
                            className="bg-amber-600 hover:bg-amber-700 text-white font-bold py-1.5 px-4 rounded-xl text-xs transition-all shadow-sm"
                          >
                            Retry Payment
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          // Empty State
          <div className="bg-white border border-gray-200/80 rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-12 text-center flex flex-col items-center justify-center">
            <h3 className="font-semibold text-gray-900 text-sm mb-1.5">
              {statusFilter === "ALL" && "No donations yet. Discover NGOs →"}
              {statusFilter === "SUCCESS" && "No successful donations yet."}
              {statusFilter === "PENDING" && "No pending payments."}
              {statusFilter === "FAILED" && "No failed payments — great!"}
            </h3>
            {statusFilter === "ALL" && (
              <Link
                href="/discover"
                className="mt-4 bg-trust-600 hover:bg-trust-700 text-white font-semibold py-2 px-4 rounded-lg text-xs transition shadow-sm"
              >
                Discover NGOs &rarr;
              </Link>
            )}
          </div>
        )}

        {/* Load More Button */}
        {hasMore && (
          <div className="pt-6 text-center space-y-2">
            <p className="text-[10px] text-gray-600 font-bold uppercase tracking-wider">
              Showing {donations.length} of {totalCount} donations
            </p>
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="bg-white hover:bg-gray-50 text-gray-800 font-semibold px-6 py-2.5 rounded-lg text-xs border border-gray-300 transition disabled:opacity-50 inline-flex items-center gap-2"
            >
              {loadingMore ? "Loading..." : "Load More"}
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
