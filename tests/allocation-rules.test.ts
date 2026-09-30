import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  ALLOCATION_TRANSITIONS,
  checkAllocation,
  committedTotal,
  isAllocationAction,
  isTerminal,
  remainingBudget,
  requiresNote,
} from "@/lib/allocation";

/**
 * What these tests protect.
 *
 * This is the gate that decides whether money may be committed, so the failures
 * that matter are the ones that let a commitment through when it should not:
 * funding a plan nobody approved, funding one twice, funding more than an
 * opportunity actually has, or funding more than was asked for.
 *
 * The subtle one is the budget arithmetic. PENDING allocations must count
 * against the budget — if they did not, two drafts against the same remaining
 * amount would both pass, and the conflict would only appear after both
 * organisations had been told they were funded.
 */

const dec = (v: string) => new Prisma.Decimal(v);

const ok = {
  proposalStatus: "APPROVED" as const,
  hasAllocation: false,
  budget: dec("500000.00"),
  committed: dec("0"),
  amount: dec("100000.00"),
  requested: dec("100000.00"),
};

describe("what may be funded", () => {
  it("allows a full commitment against an approved proposal", () => {
    const check = checkAllocation(ok);
    expect(check.ok).toBe(true);
    expect(check.remaining?.toFixed(2)).toBe("500000.00");
  });

  it("refuses a proposal that has not been approved", () => {
    // The decision to fund must follow the decision to accept the plan.
    for (const status of ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "REJECTED", "WITHDRAWN"] as const) {
      const check = checkAllocation({ ...ok, proposalStatus: status });
      expect(check.ok).toBe(false);
      expect(check.refusal).toBe("PROPOSAL_NOT_APPROVED");
    }
  });

  it("refuses a second allocation on the same proposal", () => {
    const check = checkAllocation({ ...ok, hasAllocation: true });
    expect(check.refusal).toBe("ALREADY_ALLOCATED");
  });

  it("refuses zero and negative amounts", () => {
    expect(checkAllocation({ ...ok, amount: dec("0") }).refusal).toBe("AMOUNT_NOT_POSITIVE");
    expect(checkAllocation({ ...ok, amount: dec("-1") }).refusal).toBe("AMOUNT_NOT_POSITIVE");
  });

  it("allows funding LESS than was asked for", () => {
    // Partial funding is a real decision, and the whole reason the allocation
    // carries its own amount rather than copying the proposal's.
    expect(checkAllocation({ ...ok, amount: dec("40000.00") }).ok).toBe(true);
  });

  it("refuses funding MORE than was asked for", () => {
    // Money against a plan that was never reviewed.
    const check = checkAllocation({ ...ok, amount: dec("100000.01") });
    expect(check.refusal).toBe("EXCEEDS_REQUESTED_AMOUNT");
  });
});

describe("the budget", () => {
  it("refuses when the opportunity has no budget recorded", () => {
    // Null is not "unlimited" — every "is there enough left" answer would be
    // invented.
    const check = checkAllocation({ ...ok, budget: null });
    expect(check.refusal).toBe("NO_BUDGET_RECORDED");
    expect(check.remaining).toBeNull();
  });

  it("allows committing exactly what is left", () => {
    const check = checkAllocation({
      ...ok,
      budget: dec("500000.00"),
      committed: dec("400000.00"),
      amount: dec("100000.00"),
    });
    expect(check.ok).toBe(true);
    expect(check.remaining?.toFixed(2)).toBe("100000.00");
  });

  it("refuses one paisa over", () => {
    const check = checkAllocation({
      ...ok,
      budget: dec("500000.00"),
      committed: dec("400000.00"),
      amount: dec("100000.01"),
      requested: dec("200000.00"),
    });
    expect(check.refusal).toBe("EXCEEDS_REMAINING_BUDGET");
    expect(check.message).toContain("100000.00");
  });

  it("counts PENDING allocations against the budget, not just approved ones", () => {
    // Otherwise a second draft is written against money the first is already
    // claiming, and both pass.
    const total = committedTotal([
      { status: "APPROVED", amount: dec("100000.00") },
      { status: "PENDING", amount: dec("50000.00") },
    ]);
    expect(total.toFixed(2)).toBe("150000.00");
  });

  it("frees the budget a rejected allocation was holding", () => {
    const total = committedTotal([
      { status: "APPROVED", amount: dec("100000.00") },
      { status: "REJECTED", amount: dec("250000.00") },
    ]);
    expect(total.toFixed(2)).toBe("100000.00");
  });

  it("computes what is left without routing money through a float", () => {
    const remaining = remainingBudget(dec("0.30"), dec("0.10"));
    expect(remaining?.toFixed(2)).toBe("0.20");
  });

  it("has no remaining figure at all when there is no budget", () => {
    expect(remainingBudget(null, dec("0"))).toBeNull();
    expect(remainingBudget(undefined, dec("0"))).toBeNull();
  });
});

describe("the state machine", () => {
  it("only moves out of PENDING", () => {
    expect(ALLOCATION_TRANSITIONS.APPROVE.from).toBe("PENDING");
    expect(ALLOCATION_TRANSITIONS.REJECT.from).toBe("PENDING");
  });

  it("treats both decided states as terminal", () => {
    // A commitment that can be silently withdrawn is not a commitment.
    expect(isTerminal("APPROVED")).toBe(true);
    expect(isTerminal("REJECTED")).toBe(true);
    expect(isTerminal("PENDING")).toBe(false);
  });

  it("requires a reason to refuse, but not to agree", () => {
    expect(requiresNote("REJECT")).toBe(true);
    expect(requiresNote("APPROVE")).toBe(false);
  });

  it("rejects an unknown action rather than guessing", () => {
    expect(isAllocationAction("APPROVE")).toBe(true);
    expect(isAllocationAction("UNDO")).toBe(false);
    expect(isAllocationAction(null)).toBe(false);
  });
});
