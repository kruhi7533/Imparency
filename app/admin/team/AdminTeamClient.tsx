"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ADMIN_ROLES, ADMIN_ROLE_LABEL, type AdminRoleName } from "@/lib/admin-roles";

interface Row {
  id: string;
  name: string;
  email: string;
  adminRole: AdminRoleName;
}

export default function AdminTeamClient({ admins, canManage, selfId }: { admins: Row[]; canManage: boolean; selfId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function change(id: string, adminRole: string) {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not change the role.");
      setNotice("Role updated. It takes effect within a minute.");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm">
      {error && <div role="alert" className="m-4 p-3 text-sm rounded-lg bg-red-50 text-red-700">{error}</div>}
      {notice && <div role="status" className="m-4 p-3 text-sm rounded-lg bg-emerald-50 text-emerald-700">{notice}</div>}
      {admins.length === 0 ? (
        <p className="p-6 text-sm text-gray-500">No admin accounts.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-400 border-b border-gray-100 dark:border-gray-800">
              <th className="px-4 py-3">Admin</th>
              <th className="px-4 py-3">Sub-role</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-semibold text-gray-900 dark:text-white">{a.name}</div>
                  <div className="text-xs text-gray-500">{a.email}</div>
                </td>
                <td className="px-4 py-3">
                  {canManage && a.id !== selfId ? (
                    <select
                      aria-label={`Sub-role for ${a.name}`}
                      value={a.adminRole}
                      disabled={busy === a.id}
                      onChange={(e) => change(a.id, e.target.value)}
                      className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800"
                    >
                      {ADMIN_ROLES.map((r) => (
                        <option key={r} value={r}>{ADMIN_ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-gray-700 dark:text-gray-300">
                      {ADMIN_ROLE_LABEL[a.adminRole]}
                      {a.id === selfId && <span className="text-xs text-gray-400"> (you)</span>}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
