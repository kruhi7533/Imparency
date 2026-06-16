"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

const CAUSE_CATEGORIES = [
  "Education",
  "Healthcare",
  "Environment",
  "Women Empowerment",
  "Rural Development",
  "Hunger",
];

interface NGOData {
  id: string;
  orgName: string;
  causeCategories: string[];
  address: string;
  healthScore: number;
  description: string;
  activeProjectsCount: number;
  totalRaised: number;
  followersCount: number;
  isFollowed?: boolean;
}

export default function DiscoverPage() {
  const { data: session } = useSession();

  const [ngos, setNgos] = useState<NGOData[]>([]);
  const [search, setSearch] = useState("");
  const [selectedPill, setSelectedPill] = useState("All");
  const [selectedCauses, setSelectedCauses] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [sortBy, setSortBy] = useState("healthScore");
  
  // Pagination states
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  // Trigger initial fetch and filter reset
  useEffect(() => {
    setPage(1);
    fetchNGOs(1, false);
  }, [search, selectedPill, selectedCauses, location, sortBy]);

  const fetchNGOs = async (pageNum: number, append: boolean) => {
    if (pageNum === 1) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError("");

    try {
      // Build query string
      const params = new URLSearchParams();
      params.append("page", pageNum.toString());
      params.append("limit", "9");
      params.append("sortBy", sortBy);
      
      if (search) params.append("search", search);
      if (location) params.append("location", location);
      
      // Combine pill filter with checkbox filters
      let activeCauses = [...selectedCauses];
      if (selectedPill !== "All") {
        activeCauses = Array.from(new Set([...activeCauses, selectedPill]));
      }
      if (activeCauses.length > 0) {
        params.append("causes", activeCauses.join(","));
      }

      const response = await fetch(`/api/ngo/discover?${params.toString()}`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to retrieve discovery list");
      }

      // If user is authenticated, retrieve follow status mapping
      let followedNGOIds: string[] = [];
      if (session?.user) {
        const followResponse = await fetch("/api/ngo/user-follows");
        if (followResponse.ok) {
          const followResult = await followResponse.json();
          followedNGOIds = followResult.followedNGOIds || [];
        }
      }

      const mappedNGOs = result.ngos.map((ngo: NGOData) => ({
        ...ngo,
        isFollowed: followedNGOIds.includes(ngo.id),
      }));

      if (append) {
        setNgos((prev) => [...prev, ...mappedNGOs]);
      } else {
        setNgos(mappedNGOs);
      }
      setTotalPages(result.pagination.totalPages);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    if (page < totalPages) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchNGOs(nextPage, true);
    }
  };

  const handleFollowToggle = async (ngoId: string) => {
    if (!session?.user) {
      // Redirect to login or show alert
      alert("Please login to follow NGOs");
      return;
    }

    try {
      const response = await fetch(`/api/ngo/${ngoId}/follow`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to update follow status");
      }

      const result = await response.json();
      
      setNgos((prev) =>
        prev.map((ngo) =>
          ngo.id === ngoId
            ? {
                ...ngo,
                isFollowed: result.followed,
                followersCount: result.followed ? ngo.followersCount + 1 : ngo.followersCount - 1,
              }
            : ngo
        )
      );
    } catch (err) {
      console.error(err);
    }
  };

  const handleCauseCheckboxChange = (cause: string) => {
    setSelectedCauses((prev) =>
      prev.includes(cause)
        ? prev.filter((c) => c !== cause)
        : [...prev, cause]
    );
  };

  // Get Health Score Badge color-coding classes
  const getHealthBadgeClass = (score: number) => {
    if (score >= 80) return "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/50";
    if (score >= 50) return "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900/50";
    return "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border-red-100 dark:border-red-900/50";
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      
      {/* Hero Section */}
      <section className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 py-16 px-4 sm:px-6 lg:px-8 text-center relative overflow-hidden">
        
        {/* Background decorative glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -z-10"></div>
        
        <div className="max-w-3xl mx-auto space-y-6">
          <h1 className="text-4xl sm:text-5xl font-black text-gray-900 dark:text-white tracking-tight">
            Find NGOs making <span className="text-emerald-600">real impact</span>
          </h1>
          <p className="text-base text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
            Browse verified, trust-first non-profits, view their real-time milestone progress, and build your personal impact footprint.
          </p>
          
          {/* Main search bar */}
          <div className="max-w-xl mx-auto relative flex items-center bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-2xl p-1.5 focus-within:ring-2 focus-within:ring-emerald-500 transition">
            <span className="pl-3 text-gray-400">🔍</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by organization name..."
              className="w-full bg-transparent border-0 focus:outline-none pl-2 pr-4 py-2 text-sm dark:text-white"
            />
          </div>
        </div>

        {/* Cause category horizontal pill list */}
        <div className="max-w-4xl mx-auto mt-10 overflow-x-auto no-scrollbar flex items-center justify-start sm:justify-center gap-2 px-4">
          <button
            onClick={() => setSelectedPill("All")}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition whitespace-nowrap border ${
              selectedPill === "All"
                ? "bg-emerald-600 border-emerald-600 text-white"
                : "bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400"
            }`}
          >
            All Causes
          </button>
          {CAUSE_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setSelectedPill(c)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition whitespace-nowrap border ${
                selectedPill === c
                  ? "bg-emerald-600 border-emerald-600 text-white"
                  : "bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </section>

      {/* Main Discover Layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          
          {/* Left Filter Sidebar */}
          <aside className="space-y-6">
            
            {/* Sort Filter */}
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Sort Results</h3>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="healthScore">NGO Health Score</option>
                <option value="newest">Newest Registered</option>
              </select>
            </div>

            {/* Location Filter */}
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Filter by Location</h3>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="City or State..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Cause Categories Checkbox Filter */}
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Focus Sectors</h3>
              <div className="space-y-2.5">
                {CAUSE_CATEGORIES.map((cause) => (
                  <label key={cause} className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-gray-600 dark:text-gray-400 select-none">
                    <input
                      type="checkbox"
                      checked={selectedCauses.includes(cause)}
                      onChange={() => handleCauseCheckboxChange(cause)}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 dark:bg-gray-800 dark:border-gray-700"
                    />
                    {cause}
                  </label>
                ))}
              </div>
            </div>

          </aside>

          {/* Right Main Grid */}
          <div className="lg:col-span-3 space-y-8">
            
            {loading ? (
              // Skeleton Screen Loaders
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 space-y-4 shadow-sm animate-pulse">
                    <div className="h-6 w-1/3 bg-gray-200 dark:bg-gray-800 rounded"></div>
                    <div className="h-10 w-full bg-gray-200 dark:bg-gray-800 rounded"></div>
                    <div className="h-4 w-1/2 bg-gray-200 dark:bg-gray-800 rounded"></div>
                    <div className="h-8 w-full bg-gray-200 dark:bg-gray-800 rounded mt-4"></div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900 rounded text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            ) : ngos.length === 0 ? (
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-12 text-center max-w-md mx-auto shadow-sm">
                <span className="text-4xl mb-4 block">🔍</span>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">No NGOs found</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Try adjusting your keywords, selecting other cause categories, or refining your location filters.
                </p>
              </div>
            ) : (
              <div className="space-y-10">
                
                {/* NGO Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {ngos.map((ngo) => (
                    <div
                      key={ngo.id}
                      className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 flex flex-col justify-between"
                    >
                      <div>
                        {/* Health Score Badge */}
                        <div className="flex justify-between items-center mb-3">
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 border rounded-full ${getHealthBadgeClass(ngo.healthScore)}`}>
                            Health: {ngo.healthScore.toFixed(0)}
                          </span>
                          <span className="text-[10px] font-semibold text-gray-400">{ngo.address.split(",").slice(-2).join(",").trim()}</span>
                        </div>

                        <Link href={`/ngo/${ngo.id}`} className="block group">
                          <h4 className="text-base font-extrabold text-gray-900 dark:text-white group-hover:text-emerald-600 transition line-clamp-1">
                            {ngo.orgName}
                          </h4>
                        </Link>
                        
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 line-clamp-3">
                          {ngo.description}
                        </p>

                        <div className="flex flex-wrap gap-1 mt-3">
                          {ngo.causeCategories.slice(0, 2).map((c) => (
                            <span key={c} className="text-[9px] font-bold px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded">
                              {c}
                            </span>
                          ))}
                          {ngo.causeCategories.length > 2 && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-400 rounded">
                              +{ngo.causeCategories.length - 2}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Stat Metrics */}
                      <div className="mt-5 border-t border-gray-100 dark:border-gray-800 pt-4 flex justify-between items-center">
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 space-y-0.5">
                          <div><strong>Active Campaigns:</strong> {ngo.activeProjectsCount}</div>
                          <div><strong>Total Raised:</strong> ₹{ngo.totalRaised.toLocaleString()}</div>
                        </div>

                        <button
                          onClick={() => handleFollowToggle(ngo.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                            ngo.isFollowed
                              ? "bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                              : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-500/10"
                          }`}
                        >
                          {ngo.isFollowed ? "Following" : "Follow"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Load More Button */}
                {page < totalPages && (
                  <div className="text-center pt-4">
                    <button
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="px-6 py-2.5 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50"
                    >
                      {loadingMore ? "Loading more non-profits..." : "Load More NGOs"}
                    </button>
                  </div>
                )}

              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
