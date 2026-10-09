import { describe, it, expect } from "vitest";
import {
  OUTCOME_TRANSITIONS,
  OUTCOME_ACTIONS,
  isOutcomeAction,
  isAdminOnly,
  canApply,
  isTerminal,
  isEditable,
  requiresNote,
  countsTowardReportedImpact,
  explainRefusal,
  type OutcomeAction,
} from "@/lib/outcome-workflow";
import { OutcomeClaimStatus } from "@prisma/client";

/**
 * The approval state machine — one of CLAUDE.md's mandatory test kinds.
 *
 * What this pins is not the happy path but the two properties the module
 * exists for: an APPROVED number cannot be edited or re-decided (only
 * withdrawn, with a reason), and no adverse decision is possible without a
 * written reason.
 */

const ALL_STATUSES = Object.values(OutcomeClaimStatus);

describe("isOutcomeAction", () => {
  it("accepts every real action", () => {
    for (const a of OUTCOME_ACTIONS) expect(isOutcomeAction(a)).toBe(true);
  });

  /**
   * The prototype-chain hole. `in` would let these through and then index the
   * transition table to a function, producing a transition whose `from` is
   * undefined. Found in isGrievanceAction during Week 7; pinned here so it
   * cannot be reintroduced by someone copying an older route.
   */
  it.each(["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"])(
    "rejects the inherited property %p",
    (candidate) => {
      expect(isOutcomeAction(candidate)).toBe(false);
    }
  );

  it.each([null, undefined, 42, {}, [], "approve", "APPROVE "])("rejects %p", (v) => {
    expect(isOutcomeAction(v)).toBe(false);
  });
});

describe("who may do what", () => {
  it("keeps deciding with admins and filing with the organisation", () => {
    expect(isAdminOnly("APPROVE")).toBe(true);
    expect(isAdminOnly("REQUEST_EVIDENCE")).toBe(true);
    expect(isAdminOnly("REJECT")).toBe(true);
    // The NGO's own actions — an admin withdrawing on its behalf would make
    // the audit trail claim a retraction the organisation never made.
    expect(isAdminOnly("SUBMIT")).toBe(false);
    expect(isAdminOnly("WITHDRAW")).toBe(false);
  });
});

describe("transitions", () => {
  it("DRAFT can only be submitted", () => {
    const legal = OUTCOME_ACTIONS.filter((a) => canApply(a, OutcomeClaimStatus.DRAFT));
    expect(legal).toEqual(["SUBMIT"]);
  });

  it("SUBMITTED is the only state an admin can decide from", () => {
    const legal = OUTCOME_ACTIONS.filter((a) => canApply(a, OutcomeClaimStatus.SUBMITTED)).sort();
    expect(legal).toEqual(["APPROVE", "REJECT", "REQUEST_EVIDENCE", "WITHDRAW"]);
  });

  it("NEEDS_EVIDENCE returns the claim to the organisation to resubmit", () => {
    const legal = OUTCOME_ACTIONS.filter((a) => canApply(a, OutcomeClaimStatus.NEEDS_EVIDENCE));
    expect(legal).toEqual(["SUBMIT"]);
    expect(OUTCOME_TRANSITIONS.SUBMIT.to).toBe(OutcomeClaimStatus.SUBMITTED);
  });

  /** The headline rule: an approved number is withdrawable, never editable. */
  it("APPROVED allows only WITHDRAW", () => {
    const legal = OUTCOME_ACTIONS.filter((a) => canApply(a, OutcomeClaimStatus.APPROVED));
    expect(legal).toEqual(["WITHDRAW"]);
  });

  it("re-approving an approved claim is not possible", () => {
    expect(canApply("APPROVE", OutcomeClaimStatus.APPROVED)).toBe(false);
  });

  it.each([OutcomeClaimStatus.REJECTED, OutcomeClaimStatus.WITHDRAWN])(
    "%s is terminal — no action applies",
    (status) => {
      expect(isTerminal(status)).toBe(true);
      expect(OUTCOME_ACTIONS.filter((a) => canApply(a, status))).toEqual([]);
    }
  );

  it("APPROVED is not 'terminal', because WITHDRAW must remain available", () => {
    expect(isTerminal(OutcomeClaimStatus.APPROVED)).toBe(false);
  });

  it("no transition targets DRAFT — a claim never goes back to being unwritten", () => {
    for (const a of OUTCOME_ACTIONS) {
      expect(OUTCOME_TRANSITIONS[a].to).not.toBe(OutcomeClaimStatus.DRAFT);
    }
  });

  it("every action's from-set is non-empty and uses real statuses", () => {
    for (const a of OUTCOME_ACTIONS) {
      expect(OUTCOME_TRANSITIONS[a].from.length).toBeGreaterThan(0);
      for (const s of OUTCOME_TRANSITIONS[a].from) expect(ALL_STATUSES).toContain(s);
    }
  });
});

describe("notes", () => {
  it("requires a reason for every adverse or reversing decision", () => {
    expect(requiresNote("REJECT")).toBe(true);
    expect(requiresNote("REQUEST_EVIDENCE")).toBe(true);
    expect(requiresNote("WITHDRAW")).toBe(true);
  });

  it("does not require one to approve, or to submit", () => {
    // The claim, its citations and the triage findings already record what was
    // approved and on what basis.
    expect(requiresNote("APPROVE")).toBe(false);
    expect(requiresNote("SUBMIT")).toBe(false);
  });
});

describe("editability and reporting", () => {
  it("only lets a claim be edited while it is in the organisation's hands", () => {
    expect(isEditable(OutcomeClaimStatus.DRAFT)).toBe(true);
    expect(isEditable(OutcomeClaimStatus.NEEDS_EVIDENCE)).toBe(true);
    // Once submitted an admin may be reading it; once approved a funder may be.
    expect(isEditable(OutcomeClaimStatus.SUBMITTED)).toBe(false);
    expect(isEditable(OutcomeClaimStatus.APPROVED)).toBe(false);
    expect(isEditable(OutcomeClaimStatus.REJECTED)).toBe(false);
    expect(isEditable(OutcomeClaimStatus.WITHDRAWN)).toBe(false);
  });

  /** The §2 rule of the blueprint, as a single assertion. */
  it("counts ONLY approved claims toward reported impact", () => {
    const counted = ALL_STATUSES.filter(countsTowardReportedImpact);
    expect(counted).toEqual([OutcomeClaimStatus.APPROVED]);
  });
});

describe("explainRefusal", () => {
  it("tells an admin to withdraw rather than edit an approved number", () => {
    const msg = explainRefusal("REJECT", OutcomeClaimStatus.APPROVED);
    expect(msg).toContain("withdraw");
    expect(msg).toContain("corrected claim");
  });

  it("says a terminal claim needs a new one", () => {
    expect(explainRefusal("APPROVE", OutcomeClaimStatus.REJECTED)).toContain("new claim");
  });

  it("names the statuses the action would need", () => {
    expect(explainRefusal("APPROVE", OutcomeClaimStatus.DRAFT)).toContain("submitted");
  });

  it("produces a non-empty message for every illegal pairing", () => {
    for (const a of OUTCOME_ACTIONS as OutcomeAction[]) {
      for (const s of ALL_STATUSES) {
        if (canApply(a, s)) continue;
        expect(explainRefusal(a, s).length, `${a} from ${s}`).toBeGreaterThan(20);
      }
    }
  });
});
