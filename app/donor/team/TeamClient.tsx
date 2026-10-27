"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

type Role = "ADMIN" | "APPROVER" | "FINANCE" | "VIEWER";

interface Team {
  orgName: string;
  owner: { userId: string; name: string | null; email: string | null } | null;
  members: Array<{ id: string; userId: string; role: Role; name: string | null; email: string | null; since: string }>;
  invites: Array<{ id: string; email: string; role: Role; expiresAt: string }>;
}

const ROLE_HELP: Record<Role, string> = {
  ADMIN: "Everything the owner can do, including managing the team.",
  APPROVER: "Runs matching, reviews and approves proposals, signs contracts, records payments. Cannot edit requirements.",
  FINANCE: "Records and releases contract payments and sees finance. Cannot approve proposals, sign contracts or edit requirements.",
  VIEWER: "Sees requirements, contracts and reports. Changes nothing.",
};

export default function TeamClient({
  team,
  myUserId,
  myRole,
  canManage,
}: {
  team: Team;
  myUserId: string;
  myRole: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("VIEWER");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isOwner = myRole === "OWNER";

  const call = async (key: string, url: string, init: RequestInit, ok: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setNotice(typeof ok === "string" ? ok : "Done.");
      router.refresh();
      return data;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = await call("invite", "/api/donor/team", { method: "POST", body: JSON.stringify({ email, role }) }, "");
    if (data) {
      setNotice(data.added ? "Added. They can sign in and see your organisation's CSR work now." : "Invitation sent. It expires in 7 days.");
      setEmail("");
    }
  };

  const input = "min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20";

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900">Team</h1>
        <p className="mt-1 text-sm text-gray-600">
          People who act for <strong className="text-gray-900">{team.orgName}</strong> on ImpactBridge. Requirements, contracts and
          verification belong to the organisation, not to any one person.
        </p>
      </div>

      <div role="status" aria-live="polite">
        {notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</p>}
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section aria-labelledby="members-h" className="rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-5">
        <h2 id="members-h" className="text-sm font-semibold text-gray-900">
          Members
        </h2>
        <ul className="mt-3 divide-y divide-gray-100">
          {team.owner && (
            <li className="py-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {team.owner.name || team.owner.email}
                  {team.owner.userId === myUserId ? " (you)" : ""}
                </p>
                <p className="text-xs text-gray-500">{team.owner.email}</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">Owner</span>
            </li>
          )}
          {team.members.map((m) => {
            const self = m.userId === myUserId;
            const canEditThis = canManage && !self && (isOwner || m.role !== "ADMIN");
            return (
              <li key={m.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {m.name || m.email}
                    {self ? " (you)" : ""}
                  </p>
                  <p className="text-xs text-gray-500">{m.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {canEditThis ? (
                    <>
                      <label className="sr-only" htmlFor={`role-${m.id}`}>
                        Role for {m.name || m.email}
                      </label>
                      <select
                        id={`role-${m.id}`}
                        value={m.role}
                        disabled={busy !== null}
                        onChange={(e) =>
                          call(`role:${m.id}`, `/api/donor/team/${m.id}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) }, "Role updated.")
                        }
                        className={input}
                      >
                        {isOwner && <option value="ADMIN">Admin</option>}
                        <option value="APPROVER">Approver</option>
                        <option value="FINANCE">Finance</option>
                        <option value="VIEWER">Viewer</option>
                      </select>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          if (window.confirm(`Remove ${m.name || m.email} from the team?`)) {
                            call(`rm:${m.id}`, `/api/donor/team/${m.id}`, { method: "DELETE" }, "Removed from the team.");
                          }
                        }}
                        className="min-h-[44px] px-3 text-xs font-semibold text-red-700 hover:underline"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="rounded-full bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700 ring-1 ring-gray-200">{m.role.toLowerCase()}</span>
                  )}
                  {self && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        if (window.confirm("Leave this organisation? You will lose access to its CSR work.")) {
                          call(`leave`, `/api/donor/team/${m.id}`, { method: "DELETE" }, "You left the organisation.");
                        }
                      }}
                      className="min-h-[44px] px-3 text-xs font-semibold text-red-700 hover:underline"
                    >
                      Leave
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {team.members.length === 0 && <p className="mt-2 text-xs text-gray-500">No other members yet.</p>}
      </section>

      {canManage && (
        <section aria-labelledby="invite-h" className="rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-5 space-y-3">
          <h2 id="invite-h" className="text-sm font-semibold text-gray-900">
            Add someone
          </h2>
          <form onSubmit={invite} className="flex flex-col sm:flex-row gap-2">
            <label className="sr-only" htmlFor="invite-email">
              Email address
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              className={`${input} flex-1`}
            />
            <label className="sr-only" htmlFor="invite-role">
              Role
            </label>
            <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={input}>
              {isOwner && <option value="ADMIN">Admin</option>}
              <option value="APPROVER">Approver</option>
              <option value="FINANCE">Finance</option>
              <option value="VIEWER">Viewer</option>
            </select>
            <button type="submit" disabled={busy !== null} className="min-h-[44px] px-4 rounded-lg bg-trust-600 hover:bg-trust-700 text-white text-sm font-semibold disabled:opacity-50">
              {busy === "invite" ? "Adding…" : "Add"}
            </button>
          </form>
          <p className="text-xs text-gray-500">{ROLE_HELP[role]}</p>

          {team.invites.length > 0 && (
            <div>
              <h3 className="mt-4 text-xs font-bold uppercase tracking-wider text-gray-500">Pending invitations</h3>
              <ul className="mt-2 space-y-2">
                {team.invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-700">
                    <span>
                      {i.email} · {i.role.toLowerCase()} · expires {new Date(i.expiresAt).toLocaleDateString("en-IN")}
                    </span>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => call(`inv:${i.id}`, `/api/donor/team/invites/${i.id}`, { method: "DELETE" }, "Invitation cancelled.")}
                      className="min-h-[40px] px-3 text-xs font-semibold text-red-700 hover:underline"
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="roles-h" className="rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-5">
        <h2 id="roles-h" className="text-sm font-semibold text-gray-900">
          What each role can do
        </h2>
        <dl className="mt-2 space-y-2 text-sm">
          {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
            <div key={r}>
              <dt className="font-semibold text-gray-900">{r.charAt(0) + r.slice(1).toLowerCase()}</dt>
              <dd className="text-gray-600">{ROLE_HELP[r]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
