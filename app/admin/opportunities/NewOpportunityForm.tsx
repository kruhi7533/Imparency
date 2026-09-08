"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RULE_KINDS, RULES, type RuleKind } from "@/lib/matching/rules";

/**
 * Manual intake for a funding opportunity.
 *
 * Criteria are picked from the rule table rather than typed, so an opportunity
 * can never declare a rule the engine does not implement. Local useState and
 * router.refresh(), matching the rest of the console — no state library.
 */

interface DraftCriterion {
  kind: RuleKind;
  value: string;
  values: string;
  required: boolean;
}

export interface FunderAccount {
  id: string;
  name: string | null;
  email: string;
  companyName: string | null;
  donorPersona: string | null;
}

export default function NewOpportunityForm({
  funderAccounts,
}: {
  funderAccounts: FunderAccount[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [funderName, setFunderName] = useState("");
  const [funderUserId, setFunderUserId] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState<DraftCriterion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const unused = RULE_KINDS.filter((k) => !criteria.some((c) => c.kind === k));

  function addCriterion(kind: RuleKind) {
    setCriteria((prev) => [...prev, { kind, value: "", values: "", required: true }]);
  }

  function update(index: number, patch: Partial<DraftCriterion>) {
    setCriteria((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/matching/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          funderName,
          funderUserId: funderUserId || null,
          description,
          criteria: criteria.map((c) => ({
            kind: c.kind,
            value: c.value || null,
            values: c.values
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
            required: c.required,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not create the opportunity");

      setOpen(false);
      setTitle("");
      setFunderName("");
      setFunderUserId("");
      setDescription("");
      setCriteria([]);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
      >
        New opportunity
      </button>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <h2 className="text-sm font-bold text-gray-900 dark:text-white">New opportunity</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Created as a draft. It cannot be matched against until you open it, and only the criteria you
        add here are evaluated — anything you leave out is never considered.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white"
        />
        <input
          value={funderName}
          onChange={(e) => setFunderName(e.target.value)}
          placeholder="Funder"
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white"
        />
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What this opportunity funds"
        rows={2}
        className="mt-3 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white"
      />

      <div className="mt-3">
        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400">
          Funder account (optional)
        </label>
        <select
          value={funderUserId}
          onChange={(e) => setFunderUserId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white"
        >
          <option value="">No account — funder is offline</option>
          {funderAccounts.map((f) => (
            <option key={f.id} value={f.id}>
              {f.companyName || f.name || f.email}
              {f.donorPersona ? ` · ${f.donorPersona.replace("_", " ").toLowerCase()}` : ""}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
          {funderAccounts.length === 0
            ? "No institutional donor accounts exist yet, so no funder can be notified. The name above is still recorded."
            : "Link an account and the funder is notified whenever an organisation is shortlisted. Leave it unset and the funder name is a label only — nobody is told."}
        </p>
      </div>

      <div className="mt-5 space-y-2">
        {criteria.map((c, i) => {
          const rule = RULES[c.kind];
          return (
            <div
              key={c.kind}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2"
            >
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 min-w-[180px]">
                {rule.label}
              </span>
              {rule.param === "scalar" && (
                <input
                  value={c.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                  placeholder={rule.paramHint ?? "Value"}
                  className="w-28 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1 text-sm text-gray-900 dark:text-white"
                />
              )}
              {rule.param === "set" && (
                <input
                  value={c.values}
                  onChange={(e) => update(i, { values: e.target.value })}
                  placeholder={rule.paramHint ?? "Comma-separated"}
                  className="flex-1 min-w-[200px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1 text-sm text-gray-900 dark:text-white"
                />
              )}
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                <input
                  type="checkbox"
                  checked={c.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                />
                Required
              </label>
              <button
                type="button"
                onClick={() => setCriteria((prev) => prev.filter((_, x) => x !== i))}
                className="ml-auto text-xs font-semibold text-red-500 hover:text-red-600"
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>

      {unused.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {unused.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => addCriterion(k)}
              className="rounded-full border border-gray-200 dark:border-gray-700 px-3 py-1 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              + {RULES[k].label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          disabled={saving || !title.trim() || !funderName.trim()}
          onClick={submit}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create draft"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm text-gray-600 dark:text-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
