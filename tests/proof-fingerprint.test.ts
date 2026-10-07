import { describe, it, expect } from "vitest";
import {
  hashBuffer,
  classifyDuplicate,
  duplicateSeverity,
  buildDuplicateDescription,
  type PriorProofMatch,
} from "@/lib/proof-fingerprint";

const ORG_A = "ngo-a";
const ORG_B = "ngo-b";
const PROJECT_1 = "project-1";
const PROJECT_2 = "project-2";
const MILESTONE_1 = "milestone-1";
const MILESTONE_2 = "milestone-2";

const CONTEXT = { milestoneId: MILESTONE_1, projectId: PROJECT_1, ngoId: ORG_A };

function match(overrides: Partial<PriorProofMatch> = {}): PriorProofMatch {
  return {
    proofId: "proof-earlier",
    milestoneId: MILESTONE_1,
    milestoneTitle: "Install 10 handpumps",
    projectId: PROJECT_1,
    ngoId: ORG_A,
    orgName: "Org A",
    ...overrides,
  };
}

describe("hashBuffer", () => {
  it("is stable for the same bytes and different for different bytes", () => {
    const a = Buffer.from("a photograph of a handpump");
    const b = Buffer.from("a photograph of a handpump");
    const c = Buffer.from("a photograph of a different handpump");

    expect(hashBuffer(a)).toBe(hashBuffer(b));
    expect(hashBuffer(a)).not.toBe(hashBuffer(c));
  });

  it("matches the known SHA-256 of a known input", () => {
    // Pinned against a value computed outside this codebase, so the test fails
    // if the algorithm or encoding is ever quietly changed — a test comparing
    // hashBuffer to itself would not.
    expect(hashBuffer(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("hashes an empty buffer rather than throwing", () => {
    expect(hashBuffer(Buffer.alloc(0))).toHaveLength(64);
  });

  it("is sensitive to a single changed byte", () => {
    const original = Buffer.from([1, 2, 3, 4]);
    const altered = Buffer.from([1, 2, 3, 5]);
    expect(hashBuffer(original)).not.toBe(hashBuffer(altered));
  });
});

describe("classifyDuplicate", () => {
  it("is NONE when nothing collides", () => {
    const result = classifyDuplicate([], CONTEXT);
    expect(result.verdict).toBe("NONE");
    expect(result.matches).toEqual([]);
  });

  it("is RESUBMISSION for the same milestone — the false positive that matters most", () => {
    // An organisation re-uploading after a rejection, or fixing a typo in a
    // description, legitimately sends the same photographs again. If this ever
    // starts alerting, admins learn to ignore PROOF_DUPLICATE_MEDIA entirely
    // and the check is worth less than nothing.
    const result = classifyDuplicate([match()], CONTEXT);
    expect(result.verdict).toBe("RESUBMISSION");
    expect(duplicateSeverity(result.verdict)).toBeNull();
  });

  it("is REUSED_IN_PROJECT for a different milestone on the same project", () => {
    const result = classifyDuplicate([match({ milestoneId: MILESTONE_2 })], CONTEXT);
    expect(result.verdict).toBe("REUSED_IN_PROJECT");
    expect(duplicateSeverity(result.verdict)).toBe("MEDIUM");
  });

  it("is CROSS_PROJECT for a different project in the same organisation", () => {
    const result = classifyDuplicate(
      [match({ milestoneId: MILESTONE_2, projectId: PROJECT_2 })],
      CONTEXT
    );
    expect(result.verdict).toBe("CROSS_PROJECT");
    expect(duplicateSeverity(result.verdict)).toBe("HIGH");
  });

  it("is CROSS_PROJECT for another organisation's evidence", () => {
    const result = classifyDuplicate(
      [match({ milestoneId: MILESTONE_2, projectId: PROJECT_2, ngoId: ORG_B, orgName: "Org B" })],
      CONTEXT
    );
    expect(result.verdict).toBe("CROSS_PROJECT");
    expect(duplicateSeverity(result.verdict)).toBe("HIGH");
  });

  it("is CROSS_PROJECT even when another organisation reused the SAME project id", () => {
    // Defensive: project ids are uuids and cannot really collide across orgs,
    // but the check is `ngoId !== context.ngoId || projectId !== ...`, and an
    // implementation that only compared projectId would silently let a
    // cross-org hit read as a same-project resubmission. That is the one
    // misreading of this function with a security consequence.
    const result = classifyDuplicate(
      [match({ ngoId: ORG_B, orgName: "Org B" })],
      CONTEXT
    );
    expect(result.verdict).toBe("CROSS_PROJECT");
  });

  it("reports the most serious verdict when several kinds collide at once", () => {
    const result = classifyDuplicate(
      [
        match(), // resubmission
        match({ proofId: "proof-other-milestone", milestoneId: MILESTONE_2 }), // same project
        match({
          proofId: "proof-other-org",
          milestoneId: "milestone-x",
          projectId: PROJECT_2,
          ngoId: ORG_B,
          orgName: "Org B",
        }),
      ],
      CONTEXT
    );

    expect(result.verdict).toBe("CROSS_PROJECT");
    // Only the matches that justify the verdict — a batch that is partly a
    // resubmission is still the serious thing, and listing the innocent match
    // alongside it in the alert would dilute what the admin should open.
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].proofId).toBe("proof-other-org");
  });

  it("keeps every match that justifies the verdict, not just the first", () => {
    const result = classifyDuplicate(
      [
        match({ proofId: "p1", milestoneId: MILESTONE_2 }),
        match({ proofId: "p2", milestoneId: "milestone-3" }),
      ],
      CONTEXT
    );
    expect(result.verdict).toBe("REUSED_IN_PROJECT");
    expect(result.matches.map((m) => m.proofId)).toEqual(["p1", "p2"]);
  });
});

describe("duplicateSeverity", () => {
  it("raises nothing for NONE or RESUBMISSION", () => {
    expect(duplicateSeverity("NONE")).toBeNull();
    expect(duplicateSeverity("RESUBMISSION")).toBeNull();
  });
});

describe("buildDuplicateDescription", () => {
  it("names the colliding proof id, so createFraudAlert's dedupe cannot merge two findings", () => {
    // createFraudAlert dedupes on (type, entityId, description, resolved) —
    // two genuinely different duplicate findings on one milestone must produce
    // two different descriptions or the second is silently dropped.
    const first = buildDuplicateDescription(
      classifyDuplicate([match({ proofId: "proof-aaa", milestoneId: MILESTONE_2 })], CONTEXT),
      "Install 10 handpumps"
    );
    const second = buildDuplicateDescription(
      classifyDuplicate([match({ proofId: "proof-bbb", milestoneId: MILESTONE_2 })], CONTEXT),
      "Install 10 handpumps"
    );

    expect(first).toContain("proof-aaa");
    expect(second).toContain("proof-bbb");
    expect(first).not.toBe(second);
  });

  it("names the other organisation on a cross-organisation hit", () => {
    const description = buildDuplicateDescription(
      classifyDuplicate(
        [match({ projectId: PROJECT_2, ngoId: ORG_B, orgName: "Org B" })],
        CONTEXT
      ),
      "Install 10 handpumps"
    );
    expect(description).toContain("Org B");
    expect(description).toContain("different project");
  });

  it("survives a cross-org hit with no organisation name", () => {
    const description = buildDuplicateDescription(
      classifyDuplicate(
        [match({ projectId: PROJECT_2, ngoId: ORG_B, orgName: null })],
        CONTEXT
      ),
      "Install 10 handpumps"
    );
    expect(description).toContain("different project");
    expect(description).not.toContain("submitted by");
  });

  it("counts the remaining matches instead of listing all of them", () => {
    const description = buildDuplicateDescription(
      classifyDuplicate(
        [
          match({ proofId: "p1", milestoneId: MILESTONE_2 }),
          match({ proofId: "p2", milestoneId: "milestone-3" }),
          match({ proofId: "p3", milestoneId: "milestone-4" }),
        ],
        CONTEXT
      ),
      "Install 10 handpumps"
    );
    expect(description).toContain("p1");
    expect(description).toContain("2 other earlier proofs");
  });

  it("uses the singular for exactly one other match", () => {
    const description = buildDuplicateDescription(
      classifyDuplicate(
        [
          match({ proofId: "p1", milestoneId: MILESTONE_2 }),
          match({ proofId: "p2", milestoneId: "milestone-3" }),
        ],
        CONTEXT
      ),
      "Install 10 handpumps"
    );
    expect(description).toContain("1 other earlier proof");
    expect(description).not.toContain("proofs)");
  });
});
