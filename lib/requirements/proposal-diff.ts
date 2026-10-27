/**
 * DON-008 — field-by-field comparison of two versions of an NGO proposal, for
 * the donor's side-by-side "V1 vs V2" view. Pure (client-safe).
 *
 * Text fields get a word-level diff (LCS), so the donor sees exactly which
 * words were added or removed rather than two walls of text.
 */

export interface ProposalSnapshot {
  version: number;
  proposedBudget: number | null;
  proposedDurationMonths: number | null;
  implementationPlan: string | null;
  expectedOutcomes: string | null;
  complianceNotes: string | null;
  milestones: unknown;
}

export type DiffToken = { op: "same" | "added" | "removed"; text: string };

export interface FieldDiff {
  key: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
  /** Word-level diff for text fields; absent for scalar fields. */
  tokens?: DiffToken[];
}

const MAX_WORDS = 1500;

/** Word-level LCS diff. Falls back to whole-text replace for very long inputs. */
export function diffWords(a: string, b: string): DiffToken[] {
  const x = a.split(/(\s+)/).filter((t) => t !== "");
  const y = b.split(/(\s+)/).filter((t) => t !== "");
  if (x.length > MAX_WORDS || y.length > MAX_WORDS) {
    return [
      ...(a ? [{ op: "removed" as const, text: a }] : []),
      ...(b ? [{ op: "added" as const, text: b }] : []),
    ];
  }
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffToken[] = [];
  const push = (op: DiffToken["op"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push("same", x[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("removed", x[i++]);
    } else {
      push("added", y[j++]);
    }
  }
  while (i < n) push("removed", x[i++]);
  while (j < m) push("added", y[j++]);
  return out;
}

const inr = (n: number | null) => (n === null ? "—" : `₹${n.toLocaleString("en-IN")}`);

function milestonesText(m: unknown): string {
  if (!Array.isArray(m) || m.length === 0) return "";
  return m
    .map((x: any, i: number) => `${i + 1}. ${x?.title ?? ""}${x?.amount ? ` — ${inr(Number(x.amount))}` : ""}${x?.durationMonths ? ` (${x.durationMonths} mo)` : ""}`)
    .join("\n");
}

/** Every compared field, in display order, changed or not. */
export function diffProposals(older: ProposalSnapshot, newer: ProposalSnapshot): FieldDiff[] {
  const scalar = (key: string, label: string, before: string, after: string): FieldDiff => ({
    key,
    label,
    before,
    after,
    changed: before !== after,
  });
  const text = (key: string, label: string, before: string, after: string): FieldDiff => ({
    key,
    label,
    before,
    after,
    changed: before !== after,
    tokens: diffWords(before, after),
  });
  return [
    scalar("proposedBudget", "Proposed budget", inr(older.proposedBudget), inr(newer.proposedBudget)),
    scalar(
      "proposedDurationMonths",
      "Duration",
      older.proposedDurationMonths ? `${older.proposedDurationMonths} months` : "—",
      newer.proposedDurationMonths ? `${newer.proposedDurationMonths} months` : "—"
    ),
    text("milestones", "Milestones", milestonesText(older.milestones), milestonesText(newer.milestones)),
    text("implementationPlan", "Implementation plan", older.implementationPlan ?? "", newer.implementationPlan ?? ""),
    text("expectedOutcomes", "Expected outcomes", older.expectedOutcomes ?? "", newer.expectedOutcomes ?? ""),
    text("complianceNotes", "Compliance", older.complianceNotes ?? "", newer.complianceNotes ?? ""),
  ];
}
