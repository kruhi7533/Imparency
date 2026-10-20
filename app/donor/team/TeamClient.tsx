"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

type Role = "ADMIN" | "APPROVER" | "VIEWER";

interface Team {
  orgName: string;
  owner: { userId: string; name: string | null; email: string | null } | null;
  members: Array<{ id: string; userId: string; role: Role; name: string | null; email: string | null; since: string }>;
  invites: Array<{ id: string; email: string; role: Role; expiresAt: string }>;
}

const ROLE_HELP: Record<Role, string> = {
  ADMIN: "Everything the owner can do, including managing the team.",
  APPROVER: "Runs matching, reviews and approves proposals, signs contracts, records payments. Cannot edit requirements.",
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

  const input = "min-h-[44px] rounded-lg border border-gray-700 bg-gray-950 px-3 text-sm text-gray-100";

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-white">Team</h1>
        <p className="mt-1 text-sm text-gray-400">
          People who act for <strong className="text-gray-200">{team.orgName}</strong> on ImpactBridge. Requirements, contracts and
          verification belong to the organisation, not to any one person.
        </p>
      </div>

      <div role="status" aria-live="polite">
        {notice && <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">{notice}</p>}
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      <section aria-labelledby="members-h" className="rounded-2xl border border-gray-800 bg-gray-900/50 p-5">
        <h2 id="members-h" className="text-sm font-bold text-white">
          Members
        </h2>
        <ul className="mt-3 divide-y divide-gray-800">
          {team.owner && (
            <li className="py-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-gray-100">
                  {team.owner.name || team.owner.email}
                  {team.owner.userId === myUserId ? " (you)" : ""}
                </p>
                <p className="text-xs text-gray-400">{team.owner.email}</p>
              </div>
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300">Owner</span>
            </li>
          )}
          {team.members.map((m) => {
            const self = m.userId === myUserId;
            const canEditThis = canManage && !self && (isOwner || m.role !== "ADMIN");
            return (
              <li key={m.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-gray-100">
                    {m.name || m.email}
                    {self ? " (you)" : ""}
                  </p>
                  <p className="text-xs text-gray-400">{m.email}</p>
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
                        className="min-h-[44px] px-3 text-xs font-bold text-red-300 hover:underline"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="rounded-full bg-gray-800 px-3 py-1 text-xs font-bold text-gray-300">{m.role.toLowerCase()}</span>
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
                      className="min-h-[44px] px-3 text-xs font-bold text-red-300 hover:underline"
                    >
                      Leave
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {team.members.length === 0 && <p className="mt-2 text-xs text-gray-400">No other members yet.</p>}
      </section>

      {canManage && (
        <section aria-labelledby="invite-h" className="rounded-2xl border border-gray-800 bg-gray-900/50 p-5 space-y-3">
          <h2 id="invite-h" className="text-sm font-bold text-white">
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
              <option value="VIEWER">Viewer</option>
            </select>
            <button type="submit" disabled={busy !== null} className="min-h-[44px] px-4 rounded-lg bg-emerald-500 text-gray-950 text-sm font-bold disabled:opacity-50">
              {busy === "invite" ? "Adding…" : "Add"}
            </button>
          </form>
          <p className="text-xs text-gray-400">{ROLE_HELP[role]}</p>

          {team.invites.length > 0 && (
            <div>
              <h3 className="mt-4 text-xs font-bold uppercase tracking-wider text-gray-400">Pending invitations</h3>
              <ul className="mt-2 space-y-2">
                {team.invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-300">
                    <span>
                      {i.email} · {i.role.toLowerCase()} · expires {new Date(i.expiresAt).toLocaleDateString("en-IN")}
                    </span>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => call(`inv:${i.id}`, `/api/donor/team/invites/${i.id}`, { method: "DELETE" }, "Invitation cancelled.")}
                      className="min-h-[40px] px-3 text-xs font-bold text-red-300 hover:underline"
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

      <section aria-labelledby="roles-h" className="rounded-2xl border border-gray-800 p-5">
        <h2 id="roles-h" className="text-sm font-bold text-white">
          What each role can do
        </h2>
        <dl className="mt-2 space-y-2 text-sm">
          {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
            <div key={r}>
              <dt className="font-bold text-gray-200">{r.charAt(0) + r.slice(1).toLowerCase()}</dt>
              <dd className="text-gray-400">{ROLE_HELP[r]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
