"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RULE_KINDS, RULES, type RuleKind } from "@/lib/matching/rules";

/**
 * Revise an opportunity's criteria after creation.
 *
 * This is what closes the "donor says this shortlist isn't what I want" loop:
 * the runner already re-reads OpportunityCriterion fresh on every run — it
 * simply never had anywhere to write a change TO before this existed. Edit
 * here, then press Run (or Requeue on an existing job) and the next result
 * reflects what changed.
 *
 * Past runs are unaffected. Each MatchingJob freezes the criteria it actually
 * judged against in its own criteriaSnapshot, so an edit here never rewrites
 * what a rejected organisation was told and why.
 */

interface DraftCriterion {
  kind: RuleKind;
  value: string;
  values: string;
  required: boolean;
}

interface ExistingCriterion {
  kind: string;
  value: string | null;
  values: string[];
  required: boolean;
}

function isRuleKind(k: string): k is RuleKind {
  return (RULE_KINDS as readonly string[]).includes(k);
}

export default function CriteriaEditor({
  opportunityId,
  initial,
  disabled,
}: {
  opportunityId: string;
  initial: ExistingCriterion[];
  /** True once the opportunity is CLOSED or REJECTED — nothing left to revise. */
  disabled: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [criteria, setCriteria] = useState<DraftCriterion[]>(() =>
    initial.filter((c) => isRuleKind(c.kind)).map((c) => ({
      kind: c.kind as RuleKind,
      value: c.value ?? "",
      values: c.values.join(", "),
      required: c.required,
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unused = RULE_KINDS.filter((k) => !criteria.some((c) => c.kind === k));

  function update(index: number, patch: Partial<DraftCriterion>) {
    setCriteria((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function addCriterion(kind: RuleKind) {
    setCriteria((prev) => [...prev, { kind, value: "", values: "", required: true }]);
  }

  function cancel() {
    setCriteria(
      initial.filter((c) => isRuleKind(c.kind)).map((c) => ({
        kind: c.kind as RuleKind,
        value: c.value ?? "",
        values: c.values.join(", "),
        required: c.required,
      }))
    );
    setError(null);
    setEditing(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/matching/opportunities/${opportunityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      if (!res.ok) throw new Error(body.error || "Could not save these criteria");
      setEditing(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (disabled) return null;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
      >
        Revise criteria
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-white dark:bg-gray-900 p-4">
      <p className="text-xs text-gray-500 dark:text-gray-500">
        Saving replaces the full criteria list. Past matching runs keep the criteria they actually
        judged against — this only changes what the NEXT run evaluates.
      </p>

      <div className="mt-3 space-y-2">
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
        {criteria.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No criteria — saving now would clear this opportunity down to nothing evaluated.
          </p>
        )}
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

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save criteria"}
        </button>
        <button
          type="button"
          onClick={cancel}
          className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm text-gray-600 dark:text-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
