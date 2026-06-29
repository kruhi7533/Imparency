"use client";

import { useTransition, useState } from "react";
import { addTeamMember, removeTeamMember } from "./actions";
import { Shield, Trash2, UserPlus, AlertCircle } from "lucide-react";

export default function TeamSettingsClient({ teamMembers, currentUserRole }: { teamMembers: any[], currentUserRole: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canManage = currentUserRole === "OWNER" || currentUserRole === "ADMIN";

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    const formData = new FormData(e.currentTarget);
    
    startTransition(async () => {
      const result = await addTeamMember(formData);
      if (result.error) {
        setError(result.error);
      } else if (result.invited) {
        setSuccess(result.message || "Invite sent!");
        (e.target as HTMLFormElement).reset();
      } else {
        setSuccess("Team member added successfully!");
        (e.target as HTMLFormElement).reset();
      }
    });
  };

  const handleRemove = (userId: string) => {
    if (!confirm("Are you sure you want to remove this team member?")) return;
    setError("");
    setSuccess("");
    
    startTransition(async () => {
      const result = await removeTeamMember(userId);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess("Team member removed successfully!");
      }
    });
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white">Team Management</h2>
        <p className="text-gray-500 mt-1">Manage who has access to your NGO Dashboard.</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl flex items-center gap-3 text-sm font-semibold border border-red-100 dark:border-red-900/50">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center gap-3 text-sm font-semibold border border-emerald-100 dark:border-emerald-900/50">
          <Shield className="w-5 h-5 shrink-0" />
          {success}
        </div>
      )}

      {canManage && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 mb-8 shadow-sm">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-emerald-500" /> Add New Member
          </h3>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1 w-full">
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 uppercase tracking-wide">
                User Email
              </label>
              <input 
                name="email" 
                type="email" 
                required
                placeholder="colleague@example.com"
                className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition shadow-sm"
              />
            </div>
            <div className="w-full sm:w-48">
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 uppercase tracking-wide">
                Role
              </label>
              <select 
                name="role" 
                className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition shadow-sm appearance-none"
              >
                <option value="FIELD_STAFF">Field Staff</option>
                <option value="FINANCE">Finance</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <button 
              type="submit" 
              disabled={isPending}
              className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-emerald-500/30 transition-all flex items-center justify-center whitespace-nowrap"
            >
              {isPending ? "Adding..." : "Add Member"}
            </button>
          </form>
          <p className="text-xs text-gray-500 mt-3">
            Note: The user must already have an Imparency account with this email address.
          </p>
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-50/50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-6 py-4 font-semibold">Team Member</th>
                <th className="px-6 py-4 font-semibold">Role</th>
                <th className="px-6 py-4 font-semibold">Added On</th>
                {canManage && <th className="px-6 py-4 font-semibold text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {teamMembers.map((member) => (
                <tr key={member.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-bold flex items-center justify-center text-xs">
                        {member.user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-bold text-gray-900 dark:text-white">{member.user.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{member.user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide ${
                      member.role === 'OWNER' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' :
                      member.role === 'ADMIN' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                      member.role === 'FINANCE' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
                      'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                    }`}>
                      {member.role.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                    {new Date(member.createdAt).toLocaleDateString()}
                  </td>
                  {canManage && (
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => handleRemove(member.user.id)}
                        disabled={isPending || (member.role === 'OWNER' && currentUserRole !== 'OWNER')}
                        className="text-gray-400 hover:text-red-500 transition disabled:opacity-20 disabled:hover:text-gray-400 p-2"
                        title="Remove Member"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
