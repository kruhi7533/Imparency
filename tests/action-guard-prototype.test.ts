import { describe, it, expect } from "vitest";
import { isProposalAction, PROPOSAL_TRANSITIONS } from "@/lib/proposal-workflow";
import { isAllocationAction, ALLOCATION_TRANSITIONS } from "@/lib/allocation";
import { isGrievanceAction, GRIEVANCE_TRANSITIONS } from "@/lib/grievance-workflow";

/**
 * What these tests protect.
 *
 * Every admin action table in this repo is a plain object keyed by action name,
 * and each has a type guard in front of it. Written with `in`, that guard walks
 * the PROTOTYPE CHAIN: `"toString" in TABLE` is true, so the guard passes, the
 * route indexes the table, and gets `Function.prototype.toString` back. The
 * transition's `from` is then undefined, the compare-and-swap matches no row,
 * and the admin gets a 500 where the only correct answer was "that is not an
 * action" — a 400.
 *
 * It is a whole class of bug rather than one instance: the same shape is
 * repeated per workflow, so these are pinned together. A new action table with
 * an `in` guard should fail here on the day it is added.
 */

/**
 * Inherited from Object.prototype / Function.prototype. Every one of these is
 * truthy under `in` against any plain object, and none is an action.
 */
const INHERITED_KEYS = [
  "toString",
  "valueOf",
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "__proto__",
  "__defineGetter__",
];

const GUARDS = [
  { name: "proposal", guard: isProposalAction, table: PROPOSAL_TRANSITIONS, real: "APPROVE" },
  { name: "allocation", guard: isAllocationAction, table: ALLOCATION_TRANSITIONS, real: "APPROVE" },
  { name: "grievance", guard: isGrievanceAction, table: GRIEVANCE_TRANSITIONS, real: "TRIAGE" },
] as const;

describe.each(GUARDS)("$name action guard", ({ guard, table, real }) => {
  it("accepts the table's own actions", () => {
    for (const action of Object.keys(table)) {
      expect(guard(action)).toBe(true);
    }
    expect(guard(real)).toBe(true);
  });

  it("refuses inherited property names", () => {
    for (const key of INHERITED_KEYS) {
      expect(guard(key), `${key} must not pass as an action`).toBe(false);
    }
  });

  it("refuses non-strings and unknown names", () => {
    expect(guard(null)).toBe(false);
    expect(guard(undefined)).toBe(false);
    expect(guard(42)).toBe(false);
    expect(guard({})).toBe(false);
    expect(guard([])).toBe(false);
    expect(guard("DEFINITELY_NOT_AN_ACTION")).toBe(false);
  });

  /**
   * The consequence, stated directly: this is what the route would have done
   * with a value the old guard let through.
   */
  it("never lets a caller reach a transition with no `from`", () => {
    for (const key of INHERITED_KEYS) {
      if (guard(key)) {
        throw new Error(`${key} passed the guard`);
      }
      // And the reason it must not: the table does yield something for it.
      const leaked = (table as Record<string, unknown>)[key];
      if (leaked !== undefined) {
        expect((leaked as { from?: unknown }).from).toBeUndefined();
      }
    }
  });
});
