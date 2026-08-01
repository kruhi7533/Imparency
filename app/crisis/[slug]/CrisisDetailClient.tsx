"use client";

import { useState } from "react";
import Link from "next/link";
import CrisisProgressBar from "@/components/crisis/CrisisProgressBar";
import CrisisDonateModal from "@/components/crisis/CrisisDonateModal";

interface Campaign {
  id: string; title: string; coverImage: string; targetAmount: number; raisedAmount: number;
  ngo: { orgName: string };
}
interface Initiative {
  id: string; organizerName: string; description: string; location: string;
  requiredFunds: number; raisedAmount: number; images: string[];
}
interface Update {
  id: string; type: string; title: string; body: string; mediaUrls: string[];
  fundsUtilized: number | null; beneficiariesReached: number | null;
  postedByOrgName: string | null; createdAt: string;
}
interface CrisisEventDetail {
  id: string; title: string; slug: string; disasterType: string; description: string;
  affectedLocation: string; severity: string; coverImage: string; galleryImages: string[];
  status: string; totalRaised: number; totalDonors: number; totalNgos: number; totalCampaigns: number;
  expectedEndDate: string | null;
  campaigns: Campaign[]; initiatives: Initiative[]; updates: Update[];
}

type Tab = "overview" | "campaigns" | "initiatives" | "updates";

export default function CrisisDetailClient({
  event, isNgoViewer, viewerHasJoined, isSignedIn,
}: { event: CrisisEventDetail; isNgoViewer: boolean; viewerHasJoined: boolean; isSignedIn: boolean }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [showDonate, setShowDonate] = useState(false);
  const [donateTarget, setDonateTarget] = useState<{ type: "CRISIS_DIRECT" | "NGO_CAMPAIGN" | "INITIATIVE"; id?: string; label: string }>({
    type: "CRISIS_DIRECT",
    label: "General relief fund",
  });
  const [joined, setJoined] = useState(viewerHasJoined);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  const [updates, setUpdates] = useState(event.updates);
  const [showComposer, setShowComposer] = useState(false);
  const [updateTitle, setUpdateTitle] = useState("");
  const [updateBody, setUpdateBody] = useState("");
  const [updateType, setUpdateType] = useState("TEXT");
  const [postingUpdate, setPostingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState("");

  const openDonate = (target: typeof donateTarget) => {
    setDonateTarget(target);
    setShowDonate(true);
  };

  const handleJoin = async () => {
    setJoining(true);
    setJoinError("");
    try {
      const res = await fetch(`/api/crisis/${event.id}/join`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to join");
      setJoined(true);
    } catch (err: any) {
      setJoinError(err.message || "Something went wrong");
    } finally {
      setJoining(false);
    }
  };

  const handlePostUpdate = async () => {
    if (!updateTitle.trim() || !updateBody.trim()) {
      setUpdateError("Title and description are required.");
      return;
    }
    setPostingUpdate(true);
    setUpdateError("");
    try {
      const formData = new FormData();
      formData.append("type", updateType);
      formData.append("title", updateTitle.trim());
      formData.append("body", updateBody.trim());

      const res = await fetch(`/api/crisis/${event.id}/updates`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to post update");

      setUpdates([{ id: data.id, type: updateType, title: updateTitle.trim(), body: updateBody.trim(), mediaUrls: [], fundsUtilized: null, beneficiariesReached: null, postedByOrgName: null, createdAt: data.createdAt }, ...updates]);
      setUpdateTitle("");
      setUpdateBody("");
      setShowComposer(false);
    } catch (err: any) {
      setUpdateError(err.message || "Something went wrong");
    } finally {
      setPostingUpdate(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans">
      <div className="relative h-72 sm:h-96 w-full overflow-hidden">
        <img src={event.coverImage} alt={event.title} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/40 to-black/20" />
        <div className="absolute bottom-0 inset-x-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 bg-red-600 text-white text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> {event.status}
            </span>
            <span className="bg-black/50 border border-white/10 text-[11px] font-bold uppercase px-2.5 py-1 rounded-full text-gray-200">
              {event.disasterType.replace("_", " ")} · {event.severity}
            </span>
          </div>
          <h1 className="font-display text-3xl sm:text-5xl font-semibold text-white tracking-tight max-w-3xl">{event.title}</h1>
          <p className="text-sm text-gray-300 mt-2">{event.affectedLocation}</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="flex gap-1 border-b border-gray-800 mb-6 overflow-x-auto no-scrollbar">
              {([
                ["overview", "Overview"],
                ["campaigns", `Campaigns (${event.campaigns.length})`],
                ["initiatives", `Initiatives (${event.initiatives.length})`],
                ["updates", `Updates (${updates.length})`],
              ] as [Tab, string][]).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition ${
                    tab === t ? "border-red-500 text-white" : "border-transparent text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "overview" && (
              <div className="space-y-6">
                <p className="text-gray-300 leading-relaxed whitespace-pre-line">{event.description}</p>
                {event.galleryImages.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {event.galleryImages.map((url, i) => (
                      <img key={i} src={url} alt="" className="w-full h-24 object-cover rounded-lg" />
                    ))}
                  </div>
                )}
                {isNgoViewer && (
                  <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5">
                    <h3 className="font-display font-semibold text-white mb-2">NGO relief coordination</h3>
                    {joined ? (
                      <div>
                        <p className="text-sm text-emerald-400 font-semibold mb-2">✓ Your NGO has joined this relief effort.</p>
                        <a
                          href={`/ngo/crisis/${event.id}/new-campaign`}
                          className="inline-block bg-red-600 hover:bg-red-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition"
                        >
                          Create a relief campaign
                        </a>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs text-gray-400 mb-3">
                          Join to create a relief campaign under this crisis, or attach one you already run.
                        </p>
                        {joinError && <p className="text-xs text-red-400 mb-2">{joinError}</p>}
                        <button
                          onClick={handleJoin}
                          disabled={joining || event.status !== "ACTIVE"}
                          className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl transition"
                        >
                          {joining ? "Joining…" : "Join relief effort"}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === "campaigns" && (
              <div className="space-y-4">
                {event.campaigns.length === 0 ? (
                  <p className="text-sm text-gray-400">No NGO campaigns are attached to this crisis yet.</p>
                ) : (
                  event.campaigns.map((c) => (
                    <div key={c.id} className="flex gap-4 bg-gray-900/60 border border-gray-800 rounded-2xl p-4">
                      <img src={c.coverImage} alt="" className="w-20 h-20 rounded-xl object-cover flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-[10px] uppercase tracking-widest text-gold-400">{c.ngo.orgName}</p>
                        <h4 className="font-semibold text-white">{c.title}</h4>
                        <CrisisProgressBar totalRaised={c.raisedAmount} targetAmount={c.targetAmount} totalDonors={0} compact />
                      </div>
                      <button
                        onClick={() => openDonate({ type: "NGO_CAMPAIGN", id: c.id, label: c.title })}
                        className="self-center bg-red-600 hover:bg-red-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition flex-shrink-0"
                      >
                        Donate
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === "initiatives" && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <p className="text-xs text-gray-400">Individual and informal-group relief efforts, verified by our team.</p>
                  <Link href={`/relief/register?crisisEventId=${event.id}`} className="text-xs font-bold text-red-300 hover:text-red-200">
                    + Register an initiative
                  </Link>
                </div>
                {event.initiatives.length === 0 ? (
                  <p className="text-sm text-gray-400">No individual initiatives are published for this crisis yet.</p>
                ) : (
                  event.initiatives.map((i) => (
                    <div key={i.id} className="flex gap-4 bg-gray-900/60 border border-gray-800 rounded-2xl p-4">
                      {i.images[0] && <img src={i.images[0]} alt="" className="w-20 h-20 rounded-xl object-cover flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-white">{i.organizerName}</h4>
                        <p className="text-xs text-gray-400 mb-1">{i.location}</p>
                        <p className="text-xs text-gray-300 line-clamp-2">{i.description}</p>
                        <CrisisProgressBar totalRaised={i.raisedAmount} targetAmount={i.requiredFunds} totalDonors={0} compact />
                      </div>
                      <button
                        onClick={() => openDonate({ type: "INITIATIVE", id: i.id, label: i.organizerName })}
                        className="self-center bg-red-600 hover:bg-red-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition flex-shrink-0"
                      >
                        Donate
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === "updates" && (
              <div className="space-y-4">
                {joined && (
                  <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-4">
                    {!showComposer ? (
                      <button onClick={() => setShowComposer(true)} className="text-xs font-bold text-red-300 hover:text-red-200">
                        + Post a transparency update
                      </button>
                    ) : (
                      <div className="space-y-3">
                        {updateError && <p className="text-xs text-red-400">{updateError}</p>}
                        <select
                          value={updateType}
                          onChange={(e) => setUpdateType(e.target.value)}
                          className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-white"
                        >
                          <option value="TEXT">General update</option>
                          <option value="FUND_UTILIZATION">Fund utilization</option>
                          <option value="BENEFICIARY_UPDATE">Beneficiaries reached</option>
                          <option value="REPORT">Report</option>
                        </select>
                        <input
                          placeholder="Update title"
                          value={updateTitle}
                          onChange={(e) => setUpdateTitle(e.target.value)}
                          className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-white placeholder:text-gray-500"
                        />
                        <textarea
                          placeholder="What's happened on the ground?"
                          rows={3}
                          value={updateBody}
                          onChange={(e) => setUpdateBody(e.target.value)}
                          className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-white placeholder:text-gray-500"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handlePostUpdate}
                            disabled={postingUpdate}
                            className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl"
                          >
                            {postingUpdate ? "Posting…" : "Post update"}
                          </button>
                          <button onClick={() => setShowComposer(false)} className="text-xs text-gray-400 hover:text-white px-4 py-2">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {updates.length === 0 ? (
                  <p className="text-sm text-gray-400">No transparency updates have been posted yet.</p>
                ) : (
                  updates.map((u) => (
                    <div key={u.id} className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400">{u.type.replace("_", " ")}</span>
                        <span className="text-[10px] text-gray-500">{new Date(u.createdAt).toLocaleDateString("en-IN")}</span>
                      </div>
                      <h4 className="font-semibold text-white mb-1">{u.title}</h4>
                      {u.postedByOrgName && <p className="text-[11px] text-gray-500 mb-2">— {u.postedByOrgName}</p>}
                      <p className="text-sm text-gray-300 leading-relaxed">{u.body}</p>
                      {(u.fundsUtilized || u.beneficiariesReached) && (
                        <div className="flex gap-4 mt-3 text-xs text-gray-400">
                          {u.fundsUtilized && <span>₹{u.fundsUtilized.toLocaleString("en-IN")} utilized</span>}
                          {u.beneficiariesReached && <span>{u.beneficiariesReached.toLocaleString("en-IN")} beneficiaries reached</span>}
                        </div>
                      )}
                      {u.mediaUrls.length > 0 && (
                        <div className="grid grid-cols-4 gap-2 mt-3">
                          {u.mediaUrls.map((url, i) => (
                            <img key={i} src={url} alt="" className="w-full h-16 object-cover rounded-lg" />
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Sidebar — donate CTA + live totals */}
          <div className="lg:col-span-1">
            <div className="sticky top-6 bg-gray-900/60 border border-gray-800 rounded-2xl p-6 space-y-5">
              <CrisisProgressBar
                totalRaised={event.totalRaised}
                totalDonors={event.totalDonors}
                totalNgos={event.totalNgos}
                expectedEndDate={event.expectedEndDate}
              />
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-gray-950 rounded-xl py-3">
                  <div className="text-lg font-bold text-white">{event.totalCampaigns}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">Campaigns</div>
                </div>
                <div className="bg-gray-950 rounded-xl py-3">
                  <div className="text-lg font-bold text-white">{event.totalNgos}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">NGOs</div>
                </div>
              </div>
              <button
                onClick={() => openDonate({ type: "CRISIS_DIRECT", label: "General relief fund" })}
                disabled={event.status !== "ACTIVE"}
                className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl text-sm transition"
              >
                {event.status === "ACTIVE" ? "Donate to this crisis" : `This crisis is ${event.status.toLowerCase()}`}
              </button>
              <p className="text-[11px] text-gray-500 text-center">
                Direct donations go into a platform-held general fund, allocated to verified NGOs on the ground.
              </p>
            </div>
          </div>
        </div>
      </div>

      {showDonate && (
        <CrisisDonateModal
          crisisEventId={event.id}
          crisisTitle={event.title}
          target={donateTarget}
          isSignedIn={isSignedIn}
          onClose={() => setShowDonate(false)}
        />
      )}
    </div>
  );
}
