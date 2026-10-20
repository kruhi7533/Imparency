/**
 * Four-eyes (maker-checker) for decisions where one person proposing AND
 * approving would defeat the point of having two steps (roadmap row 9).
 *
 * The two-step entities already record both people (e.g. Allocation
 * proposedById / decidedById), so this is a rule over existing facts, not a
 * parallel ApprovalRequest table that could disagree with them.
 *
 * ON by default. A pilot with a single admin can switch it off with
 * FOUR_EYES=off — an explicit, deploy-time decision written down in
 * docs/RUNBOOK.md, never a silent fallback. Rejecting your own proposal stays
 * allowed: withdrawing intent needs no second person.
 */

export function fourEyesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.FOUR_EYES ?? "on").trim().toLowerCase() !== "off";
}

export type FourEyesCheck = { ok: true } | { ok: false; status: 403; error: string };

export function checkFourEyes(
  args: { makerId: string | null | undefined; checkerId: string; what: string },
  env: Record<string, string | undefined> = process.env
): FourEyesCheck {
  if (!fourEyesEnabled(env)) return { ok: true };
  if (args.makerId && args.makerId === args.checkerId) {
    return {
      ok: false,
      status: 403,
      error: `You proposed this ${args.what}, so a different admin must approve it (four-eyes rule).`,
    };
  }
  return { ok: true };
}
