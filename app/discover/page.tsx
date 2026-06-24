"use client";

import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { MapPin, Briefcase, IndianRupee } from "lucide-react";

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
  healthScore: number | null;
  description: string;
  activeProjectsCount: number;
  totalRaised: number;
  followersCount: number;
  isFollowed?: boolean;
  logo_url?: string | null;
  cover_image_url?: string | null;
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
  const [showMobileFilters, setShowMobileFilters] = useState(false);

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
    if (score >= 80) return "text-emerald-400 border-emerald-500/25";
    if (score >= 50) return "text-amber-400 border-amber-500/25";
    return "text-red-400 border-red-500/25";
  };

  const getBannerColorClass = (cause: string) => {
    switch (cause) {
      case "Education":
        return "from-blue-600 to-indigo-500 text-blue-100";
      case "Healthcare":
        return "from-rose-500 to-coral-400 text-rose-100";
      case "Environment":
        return "from-emerald-600 to-teal-500 text-emerald-100";
      case "Women Empowerment":
        return "from-purple-600 to-fuchsia-500 text-purple-100";
      case "Rural Development":
        return "from-indigo-600 to-violet-500 text-indigo-100";
      case "Hunger":
        return "from-amber-500 to-orange-500 text-amber-100";
      default:
        return "from-gray-600 to-slate-500 text-gray-100";
    }
  };

  const getAvatarColorClass = (name: string) => {
    const colors = [
      "bg-teal-600 text-teal-50 border-teal-500/30",
      "bg-blue-600 text-blue-50 border-blue-500/30",
      "bg-amber-600 text-amber-50 border-amber-500/30",
      "bg-purple-600 text-purple-50 border-purple-500/30",
      "bg-indigo-600 text-indigo-50 border-indigo-500/30",
      "bg-emerald-600 text-emerald-50 border-emerald-500/30",
      "bg-rose-600 text-rose-50 border-rose-500/30",
    ];
    if (!name) return colors[0];
    const charCodeSum = name.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return colors[charCodeSum % colors.length];
  };

  const getInitials = (name: string) => name.charAt(0).toUpperCase();

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
        
        {/* Mobile Filter Button */}
        <div className="lg:hidden flex justify-between items-center bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-4 rounded-xl shadow-sm mb-6">
          <span className="text-xs font-bold text-gray-500">Filter & Sort</span>
          <button
            onClick={() => setShowMobileFilters(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2 px-4 rounded-lg shadow-sm transition"
          >
            Show Filters
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          
          {/* Desktop Filter Sidebar */}
          <aside className="hidden lg:block space-y-6">
            
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

          {/* Mobile Filter Drawer Overlay */}
          {showMobileFilters && (
            <div className="fixed inset-0 bg-black/55 z-50 lg:hidden flex justify-end">
              <div className="bg-white dark:bg-gray-900 w-80 h-full p-6 overflow-y-auto space-y-6 shadow-xl relative animate-in slide-in-from-right duration-250">
                <button
                  onClick={() => setShowMobileFilters(false)}
                  className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg font-bold"
                >
                  ✕
                </button>
                <h2 className="text-base font-black text-gray-900 dark:text-white pb-3 border-b border-gray-100 dark:border-gray-800">
                  Filters
                </h2>
                
                {/* Sort Filter */}
                <div className="space-y-2">
                  <h3 className="text-xs font-extrabold text-gray-400 uppercase tracking-wider">Sort Results</h3>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-755 rounded-lg bg-white dark:bg-gray-900 dark:text-white text-xs focus:outline-none"
                  >
                    <option value="healthScore">NGO Health Score</option>
                    <option value="newest">Newest Registered</option>
                  </select>
                </div>

                {/* Location Filter */}
                <div className="space-y-2">
                  <h3 className="text-xs font-extrabold text-gray-400 uppercase tracking-wider">Filter by Location</h3>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="City or State..."
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-755 rounded-lg bg-transparent dark:text-white text-xs focus:outline-none"
                  />
                </div>

                {/* Cause Categories Checkbox Filter */}
                <div className="space-y-3">
                  <h3 className="text-xs font-extrabold text-gray-400 uppercase tracking-wider">Focus Sectors</h3>
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

                <div className="pt-4">
                  <button
                    onClick={() => setShowMobileFilters(false)}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-2.5 rounded-xl text-xs shadow-md transition"
                  >
                    Apply Filters
                  </button>
                </div>
              </div>
            </div>
          )}

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
                <div 
                  className="grid gap-6"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
                >
                  {ngos.map((ngo) => {
                    const primaryCause = ngo.causeCategories[0] || "General";
                    return (
                      <div
                        key={ngo.id}
                        className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm hover:shadow-md hover:border-emerald-500/30 hover:translate-y-[-3px] transition-all duration-200 flex flex-col justify-between overflow-hidden cursor-pointer group h-full"
                        onClick={() => window.location.href = `/ngo/${ngo.id}`}
                      >
                        <div>
                          {/* Banner Header Section */}
                          <div className="relative h-32 w-full overflow-hidden shrink-0">
                            {ngo.cover_image_url ? (
                              <img src={ngo.cover_image_url} alt={ngo.orgName} className="w-full h-full object-cover" />
                            ) : (
                              <div className={`w-full h-full bg-gradient-to-r ${getBannerColorClass(primaryCause)}`} />
                            )}
                            {/* Subtle banner gradient overlay */}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                            
                            {/* Health Score Overlay Badge */}
                            <div className="absolute top-3 right-3 z-10">
                              {ngo.healthScore !== null && ngo.healthScore !== undefined ? (
                                <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm border ${getHealthBadgeClass(ngo.healthScore)}`}>
                                  Health: {ngo.healthScore.toFixed(0)}
                                </span>
                              ) : (
                                <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm border border-gray-700 text-gray-300">
                                  Score Pending
                                </span>
                              )}
                            </div>

                            {/* Overlapping Logo */}
                            <div className="absolute -bottom-7 left-5 z-20">
                              {ngo.logo_url ? (
                                <img 
                                  src={ngo.logo_url} 
                                  alt={ngo.orgName} 
                                  className="w-14 h-14 rounded-full object-cover border-[3px] border-white dark:border-gray-900 shadow-md bg-white dark:bg-gray-950" 
                                />
                              ) : (
                                <div className={`w-14 h-14 rounded-full flex items-center justify-center font-black text-sm border-[3px] border-white dark:border-gray-900 shadow-md z-20 ${getAvatarColorClass(ngo.orgName)}`}>
                                  {getInitials(ngo.orgName)}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Card Content Body */}
                          <div className="px-5 pt-9 pb-1">
                            <h4 className="text-base font-black text-gray-900 dark:text-white group-hover:text-emerald-500 transition-colors duration-150 line-clamp-1">
                              {ngo.orgName}
                            </h4>
                            
                            {/* Location */}
                            <div className="flex items-center gap-1 text-[10px] text-gray-400 font-bold mt-1">
                              <MapPin className="w-3 h-3 text-gray-400" />
                              <span>{ngo.address.split(",").slice(-2).join(",").trim()}</span>
                            </div>
                            
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 line-clamp-2 leading-relaxed h-[40px] overflow-hidden">
                              {ngo.description}
                            </p>

                            {/* Cause Categories */}
                            <div className="flex flex-wrap gap-1 mt-4">
                              {ngo.causeCategories.slice(0, 3).map((c) => (
                                <span key={c} className="text-[9px] font-extrabold px-2 py-0.5 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-md border border-gray-150 dark:border-gray-750">
                                  {c}
                                </span>
                              ))}
                              {ngo.causeCategories.length > 3 && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 bg-gray-100 dark:bg-gray-850 text-gray-400 rounded">
                                  +{ngo.causeCategories.length - 3}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Stat Metrics & Actions */}
                        <div className="px-5 pb-5">
                          <hr className="border-gray-100 dark:border-gray-800 my-4" />
                          <div className="flex justify-between items-center mt-auto">
                            <div className="text-[10px] text-gray-500 dark:text-gray-400 space-y-1">
                              <div className="flex items-center gap-1 font-semibold">
                                <Briefcase className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                <span>Campaigns: <strong className="text-gray-700 dark:text-gray-300 font-extrabold">{ngo.activeProjectsCount}</strong></span>
                              </div>
                              <div className="flex items-center gap-1 font-semibold">
                                <IndianRupee className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                <span>Total Raised: <strong className="text-gray-700 dark:text-gray-300 font-extrabold">₹{ngo.totalRaised.toLocaleString()}</strong></span>
                              </div>
                            </div>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleFollowToggle(ngo.id);
                              }}
                              className={`px-4 py-2 rounded-xl text-xs font-bold transition duration-150 ${
                                ngo.isFollowed
                                  ? "bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-300"
                                  : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-500/10"
                              }`}
                            >
                              {ngo.isFollowed ? "Following" : "Follow"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
