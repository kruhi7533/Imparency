import { RULES, isRuleKind } from "./rules";

/**
 * Shared between creating an opportunity and revising one afterwards, so the
 * two paths cannot drift into accepting different things. Both call this
 * before writing anything — a half-written opportunity with some criteria
 * silently rejected is worse than refusing the whole request.
 */

export interface CriterionBody {
  kind?: string;
  value?: string | null;
  values?: string[];
  required?: boolean;
}

export interface CriterionRow {
  kind: string;
  value: string | null;
  values: string[];
  required: boolean;
}

export type ValidateCriteriaResult =
  | { ok: true; rows: CriterionRow[] }
  | { ok: false; error: string };

export function validateCriteria(criteria: CriterionBody[]): ValidateCriteriaResult {
  const rows: CriterionRow[] = [];
  const seen = new Set<string>();

  for (const c of criteria) {
    if (!c.kind || !isRuleKind(c.kind)) {
      return { ok: false, error: `Unknown criterion "${c.kind ?? ""}".` };
    }
    if (seen.has(c.kind)) {
      return { ok: false, error: `Criterion "${c.kind}" is declared more than once.` };
    }
    seen.add(c.kind);

    const rule = RULES[c.kind];
    if (rule.param === "scalar" && !String(c.value ?? "").trim()) {
      return { ok: false, error: `"${rule.label}" needs a value.` };
    }
    if (rule.param === "set" && (!Array.isArray(c.values) || c.values.length === 0)) {
      return { ok: false, error: `"${rule.label}" needs at least one value.` };
    }

    rows.push({
      kind: rule.kind,
      value: rule.param === "scalar" ? String(c.value ?? "").trim() : null,
      values: rule.param === "set" ? (c.values ?? []).map((v) => v.trim()).filter(Boolean) : [],
      required: c.required !== false,
    });
  }

  return { ok: true, rows };
}

/** Money, parsed as a string into Decimal — never through a float. */
export function parseAmount(
  raw: unknown
): { ok: true; amount: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { ok: true, amount: null };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "Amount must be a positive number." };
  }
  return { ok: true, amount: String(raw).trim() };
}
