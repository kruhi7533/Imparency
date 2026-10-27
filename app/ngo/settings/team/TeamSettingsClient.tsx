"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Copy, Mail, RefreshCw, Shield, Trash2, UserPlus, XCircle } from "lucide-react";

/**
 * NGO-003 team page: members, and every invitation with its state. Talks only
 * to /api/ngo/team* — the server decides who may do what; this just hides
 * buttons the caller's role cannot use.
 */

type Role = "OWNER" | "ADMIN" | "PROGRAM_MANAGER" | "FINANCE" | "FIELD_STAFF";
type InviteState = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";

const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  PROGRAM_MANAGER: "Program Manager",
  FINANCE: "Finance",
  FIELD_STAFF: "Field Worker",
};
const ROLE_HINT: Record<Role, string> = {
  OWNER: "Everything",
  ADMIN: "Everything except ownership",
  PROGRAM_MANAGER: "Projects and assigning field tasks; no money",
  FINANCE: "Bank statements and payment confirmation",
  FIELD_STAFF: "Only the field tasks assigned to them",
};
const STATE_BADGE: Record<InviteState, string> = {
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  ACCEPTED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  EXPIRED: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  REVOKED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

interface Member { userId: string; name: string | null; email: string; role: Role; since: string }
interface Invite { id: string; email: string; role: Role; state: InviteState; expiresAt: string; lastSentAt: string | null; sendCount: number }
interface TeamData {
  orgName: string;
  members: Member[];
  invites: Invite[];
  me: { userId: string; role: Role; canManage: boolean; grantableRoles: Role[] };
}

export default function TeamSettingsClient() {
  const [data, setData] = useState<TeamData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [shareLink, setShareLink] = useState<{ email: string; url: string; note: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("FIELD_STAFF");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ngo/team", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load your team.");
      setData(json);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function call(url: string, init: RequestInit, ok: string) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Something went wrong.");
      setSuccess(ok);
      await load();
      return json;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  function handleDelivery(json: any, to: string) {
    if (!json) return;
    if (json.emailSent) {
      setShareLink(null);
      setSuccess(`Invitation emailed to ${to}.`);
    } else if (json.inviteUrl) {
      setCopied(false);
      setShareLink({ email: to, url: json.inviteUrl, note: json.emailNote });
      setSuccess(`Invitation created for ${to} — email NOT sent.`);
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const to = email.trim();
    const json = await call("/api/ngo/team/invites", { method: "POST", body: JSON.stringify({ email: to, role }) }, "Invitation created.");
    if (json) {
      setEmail("");
      handleDelivery(json, to);
    }
  }

  async function resend(inv: Invite) {
    const json = await call(`/api/ngo/team/invites/${inv.id}/resend`, { method: "POST" }, "Invitation resent.");
    handleDelivery(json, inv.email);
  }

  async function revoke(inv: Invite) {
    if (!confirm(`Revoke the invitation to ${inv.email}? The link stops working immediately.`)) return;
    await call(`/api/ngo/team/invites/${inv.id}/revoke`, { method: "POST" }, "Invitation revoked.");
  }

  async function changeRole(m: Member, next: string) {
    await call(`/api/ngo/team/members/${m.userId}`, { method: "PATCH", body: JSON.stringify({ role: next }) }, "Role updated.");
  }

  async function remove(m: Member) {
    if (!confirm(`Remove ${m.name || m.email} from the team?`)) return;
    await call(`/api/ngo/team/members/${m.userId}`, { method: "DELETE" }, "Member removed.");
  }

  if (loadError) {
    return (
      <div className="max-w-4xl mx-auto p-4 rounded-xl bg-red-50 text-red-700 text-sm flex items-center gap-2" role="alert">
        <AlertCircle className="w-4 h-4" /> {loadError}
        <button onClick={load} className="ml-auto underline font-semibold">Retry</button>
      </div>
    );
  }
  if (!data) {
    return <div className="max-w-4xl mx-auto text-sm text-gray-500">Loading team…</div>;
  }

  const { me } = data;
  const rank: Record<Role, number> = { OWNER: 4, ADMIN: 3, PROGRAM_MANAGER: 2, FINANCE: 2, FIELD_STAFF: 1 };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white">Team</h2>
        <p className="text-gray-500 mt-1">
          Who works on {data.orgName} and what each person can do. You are <strong>{ROLE_LABEL[me.role]}</strong>.
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl flex items-center gap-3 text-sm font-semibold border border-red-100 dark:border-red-900/50">
          <AlertCircle className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div role="status" className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-xl flex items-center gap-3 text-sm font-semibold border border-emerald-100 dark:border-emerald-900/50">
          <Shield className="w-5 h-5 shrink-0" /> {success}
        </div>
      )}
      {shareLink && (
        <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-xl text-sm">
          <p className="font-semibold text-amber-800 dark:text-amber-300">{shareLink.note}</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">Invite link for {shareLink.email} (single use, expires in 7 days):</p>
          <div className="mt-2 flex gap-2">
            <input readOnly value={shareLink.url} aria-label="Invite link" className="flex-1 font-mono text-xs bg-white dark:bg-gray-950 border border-amber-200 dark:border-amber-900 rounded-lg px-2 py-2" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shareLink.url);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
              className="px-3 py-2 rounded-lg bg-amber-600 text-white text-xs font-bold flex items-center gap-1"
            >
              <Copy className="w-3.5 h-3.5" /> {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" onClick={() => setShareLink(null)} className="px-2 text-xs text-amber-700 underline">Hide</button>
          </div>
        </div>
      )}

      {me.canManage && (
        <form onSubmit={invite} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 mb-8 shadow-sm">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-emerald-500" /> Invite a team member
          </h3>
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <label className="flex-1 w-full text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="colleague@example.org"
                className="mt-1.5 w-full normal-case font-normal bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white rounded-xl px-4 py-3 text-sm" />
            </label>
            <label className="w-full sm:w-56 text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
              Role
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}
                className="mt-1.5 w-full normal-case font-normal bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white rounded-xl px-4 py-3 text-sm">
                {me.grantableRoles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <button type="submit" disabled={busy} className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl">
              {busy ? "Sending…" : "Send invite"}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-3">{ROLE_LABEL[role]}: {ROLE_HINT[role]}. The link is single-use and expires in 7 days. You can only give roles up to your own.</p>
        </form>
      )}

      <section className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm mb-8">
        <h3 className="px-6 pt-5 text-base font-bold text-gray-900 dark:text-white">Members ({data.members.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
              <tr>
                <th className="px-6 py-3 font-semibold">Member</th>
                <th className="px-6 py-3 font-semibold">Role</th>
                {me.canManage && <th className="px-6 py-3 font-semibold text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {data.members.map((m) => {
                const editable = me.canManage && m.role !== "OWNER" && m.userId !== me.userId && rank[m.role] <= rank[me.role];
                return (
                  <tr key={m.userId}>
                    <td className="px-6 py-3">
                      <div className="font-bold text-gray-900 dark:text-white">{m.name || "Unnamed"}{m.userId === me.userId && <span className="text-xs text-gray-400 font-normal"> (you)</span>}</div>
                      <div className="text-xs text-gray-500">{m.email}</div>
                    </td>
                    <td className="px-6 py-3">
                      {editable ? (
                        <select aria-label={`Role for ${m.name || m.email}`} value={m.role} disabled={busy} onChange={(e) => changeRole(m, e.target.value)}
                          className="text-xs font-bold bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1">
                          {me.grantableRoles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      ) : (
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{ROLE_LABEL[m.role]}</span>
                      )}
                    </td>
                    {me.canManage && (
                      <td className="px-6 py-3 text-right">
                        {editable && (
                          <button onClick={() => remove(m)} disabled={busy} title="Remove member" aria-label={`Remove ${m.name || m.email}`} className="text-gray-400 hover:text-red-500 p-2">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {me.canManage && (
        <section className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
          <h3 className="px-6 pt-5 text-base font-bold text-gray-900 dark:text-white flex items-center gap-2"><Mail className="w-4 h-4" /> Invitations</h3>
          {data.invites.length === 0 ? (
            <p className="px-6 py-5 text-sm text-gray-500">No invitations yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {data.invites.map((inv) => (
                <li key={inv.id} className="px-6 py-3 flex flex-wrap items-center gap-3 text-sm">
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-semibold text-gray-900 dark:text-white">{inv.email}</div>
                    <div className="text-xs text-gray-500">
                      {ROLE_LABEL[inv.role]} · {inv.state === "PENDING" ? `expires ${new Date(inv.expiresAt).toLocaleDateString("en-IN")}` : inv.state === "EXPIRED" ? `expired ${new Date(inv.expiresAt).toLocaleDateString("en-IN")}` : ""}
                      {inv.sendCount > 1 ? ` · sent ${inv.sendCount}×` : ""}
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide ${STATE_BADGE[inv.state]}`}>{inv.state}</span>
                  {(inv.state === "PENDING" || inv.state === "EXPIRED") && rank[inv.role] <= rank[me.role] && (
                    <button onClick={() => resend(inv)} disabled={busy} className="text-xs font-bold text-emerald-700 hover:underline flex items-center gap-1">
                      <RefreshCw className="w-3.5 h-3.5" /> Resend
                    </button>
                  )}
                  {inv.state === "PENDING" && (
                    <button onClick={() => revoke(inv)} disabled={busy} className="text-xs font-bold text-red-600 hover:underline flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" /> Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
