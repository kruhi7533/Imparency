"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Grant {
  id: string;
  adminId: string;
  adminName: string;
  orgType: string;
  orgId: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  active: boolean;
}

const orgHref = (g: { orgType: string; orgId: string }) => (g.orgType === "NGO" ? `/admin/ngos/${g.orgId}` : `/admin/donors/${g.orgId}`);

export default function BreakGlassClient({
  role,
  selfId,
  grants,
  prefill,
}: {
  role: string;
  selfId: string;
  grants: Grant[];
  prefill: { orgType: "NGO" | "DONOR"; orgId: string };
}) {
  const router = useRouter();
  const [orgType, setOrgType] = useState(prefill.orgType);
  const [orgId, setOrgId] = useState(prefill.orgId);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/break-glass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgType, orgId: orgId.trim(), reason, minutes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not open the grant.");
      setNotice(`Access granted until ${new Date(data.grant.expiresAt).toLocaleTimeString()}.`);
      setReason("");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/admin/break-glass/${id}/revoke`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || "Could not revoke.");
    else {
      setNotice("Grant revoked.");
      router.refresh();
    }
  }

  const active = grants.filter((g) => g.active);
  const ended = grants.filter((g) => !g.active);

  return (
    <div className="space-y-6">
      {error && <div role="alert" className="p-3 text-sm rounded-lg bg-red-50 text-red-700">{error}</div>}
      {notice && <div role="status" className="p-3 text-sm rounded-lg bg-emerald-50 text-emerald-700">{notice}</div>}

      {role === "SUPPORT" ? (
        <form onSubmit={submit} className="bg-white border border-gray-200/80 rounded-2xl p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-3">
          <h2 className="text-base font-bold text-gray-900">Request access</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="text-xs font-semibold text-gray-600">
              Organisation type
              <select value={orgType} onChange={(e) => setOrgType(e.target.value as any)} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white">
                <option value="NGO">NGO</option>
                <option value="DONOR">Donor organisation</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-600">
              Organisation id
              <input required value={orgId} onChange={(e) => setOrgId(e.target.value)} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white font-mono" />
            </label>
            <label className="text-xs font-semibold text-gray-600">
              Duration (minutes, max 60)
              <input type="number" min={5} max={60} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white" />
            </label>
          </div>
          <label className="block text-xs font-semibold text-gray-600">
            Reason (required — ticket number and what you need to do)
            <textarea required minLength={15} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white" />
          </label>
          <button disabled={busy} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-bold disabled:opacity-50">
            {busy ? "Opening…" : "Open break-glass grant"}
          </button>
        </form>
      ) : (
        <p className="text-sm text-gray-500">
          {role === "SUPER" ? "Super admins already have full access and do not need grants. You can revoke any active grant below." : "Read-only view of grants."}
        </p>
      )}

      <section className="bg-white border border-gray-200/80 rounded-2xl p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <h2 className="text-base font-bold text-gray-900">Active grants ({active.length})</h2>
        {active.length === 0 ? (
          <p className="text-sm text-gray-500 mt-2">No active grants.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {active.map((g) => (
              <li key={g.id} className="py-3 flex flex-wrap items-start justify-between gap-3 text-sm">
                <div>
                  <a href={orgHref(g)} className="font-semibold text-emerald-700 hover:underline">{g.orgType} · <span className="font-mono">{g.orgId}</span></a>
                  <div className="text-xs text-gray-500">{g.adminName} · until {new Date(g.expiresAt).toLocaleString()}</div>
                  <div className="text-xs text-gray-600 mt-1">“{g.reason}”</div>
                </div>
                {(g.adminId === selfId || role === "SUPER") && (
                  <button onClick={() => revoke(g.id)} className="text-xs font-bold text-red-600 hover:underline">Revoke</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white border border-gray-200/80 rounded-2xl p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <h2 className="text-base font-bold text-gray-900">Ended grants</h2>
        {ended.length === 0 ? (
          <p className="text-sm text-gray-500 mt-2">None yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 text-sm">
            {ended.map((g) => (
              <li key={g.id} className="py-2 text-xs text-gray-500">
                {g.orgType} <span className="font-mono">{g.orgId}</span> · {g.adminName} · {g.revokedAt ? `revoked ${new Date(g.revokedAt).toLocaleString()}` : `expired ${new Date(g.expiresAt).toLocaleString()}`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
