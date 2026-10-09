import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cross-table duplicate evidence (Week 7 completion).
 *
 * Evidence enters through two doors — milestone proofs and field captures —
 * and before this each door only checked its own table. These tests pin the
 * shared candidate lookup, the per-proof queue verdicts (SPEC-2.3), and the
 * reviewer-facing labels.
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    milestoneProof: { findMany: vi.fn() },
    fieldEvidence: { findMany: vi.fn() },
  },
}));

import prisma from "@/lib/prisma";
import { findEvidenceCandidates, findPriorEvidence, verdictsForQueuedProofs, type EvidenceCandidate } from "@/lib/evidence-duplicates";
import { duplicateLabel, evidenceSlot } from "@/lib/proof-fingerprint";

const prismaMock = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.milestoneProof.findMany.mockResolvedValue([]);
  prismaMock.fieldEvidence.findMany.mockResolvedValue([]);
});

describe("evidenceSlot", () => {
  it("is the milestone when there is one, else the task", () => {
    expect(evidenceSlot("m1", "t1")).toBe("m1");
    expect(evidenceSlot(null, "t1")).toBe("task:t1");
  });
});

describe("findEvidenceCandidates", () => {
  it("queries nothing for no hashes", async () => {
    expect(await findEvidenceCandidates([])).toEqual([]);
    expect(prismaMock.milestoneProof.findMany).not.toHaveBeenCalled();
  });

  it("dedupes hashes and searches BOTH tables", async () => {
    await findEvidenceCandidates(["h1", "h1", "h2"]);
    expect(prismaMock.milestoneProof.findMany.mock.calls[0][0].where).toEqual({ contentHashes: { hasSome: ["h1", "h2"] } });
    expect(prismaMock.fieldEvidence.findMany.mock.calls[0][0].where).toEqual({ photoSha256: { in: ["h1", "h2"] } });
  });

  it("maps a field capture onto its milestone slot, or its task when it has none", async () => {
    prismaMock.fieldEvidence.findMany.mockResolvedValue([
      { id: "fe1", ngoId: "a", projectId: "p", milestoneId: "m1", taskId: "t1", photoSha256: "h1", task: { title: "T", milestone: { title: "M1" } } },
      { id: "fe2", ngoId: "a", projectId: "p", milestoneId: null, taskId: "t2", photoSha256: "h2", task: { title: "Task two", milestone: null } },
    ]);
    const out = await findPriorEvidence(["h1", "h2"]);
    expect(out.map((m) => [m.source, m.milestoneId, m.milestoneTitle])).toEqual([
      ["FIELD_EVIDENCE", "m1", "M1"],
      ["FIELD_EVIDENCE", "task:t2", "Task two"],
    ]);
  });
});

const proofCandidate = (id: string, hashes: string[], o: Partial<{ milestoneId: string; projectId: string; ngoId: string }> = {}): EvidenceCandidate => ({
  hashes,
  match: { proofId: id, source: "MILESTONE_PROOF", milestoneId: o.milestoneId ?? "m1", milestoneTitle: "M", projectId: o.projectId ?? "p1", ngoId: o.ngoId ?? "a" },
});
const fieldCandidate = (id: string, hash: string, o: Partial<{ milestoneId: string; projectId: string; ngoId: string }> = {}): EvidenceCandidate => ({
  hashes: [hash],
  match: { proofId: id, source: "FIELD_EVIDENCE", milestoneId: o.milestoneId ?? "m1", milestoneTitle: "M", projectId: o.projectId ?? "p1", ngoId: o.ngoId ?? "a" },
});

describe("verdictsForQueuedProofs", () => {
  const queued = { id: "q1", milestoneId: "m1", projectId: "p1", ngoId: "a", contentHashes: ["h1"] };

  it("never matches a proof against itself", () => {
    const v = verdictsForQueuedProofs([queued], [proofCandidate("q1", ["h1"])]);
    expect(v.q1.verdict).toBe("NONE");
  });

  it("gives no entry to an unfingerprinted proof — not checked is not clean", () => {
    const v = verdictsForQueuedProofs([{ ...queued, contentHashes: [] }], [proofCandidate("x", ["h1"])]);
    expect(v.q1).toBeUndefined();
  });

  it("only counts candidates that share a hash with THIS proof", () => {
    const v = verdictsForQueuedProofs([queued], [proofCandidate("other", ["h9"], { ngoId: "b", projectId: "pb" })]);
    expect(v.q1.verdict).toBe("NONE");
  });

  it("a field capture for the same milestone is a resubmission", () => {
    expect(verdictsForQueuedProofs([queued], [fieldCandidate("fe1", "h1")]).q1.verdict).toBe("RESUBMISSION");
  });

  it("another NGO's field capture is CROSS_PROJECT and outranks a resubmission", () => {
    const v = verdictsForQueuedProofs([queued], [fieldCandidate("fe1", "h1"), fieldCandidate("fe-b", "h1", { ngoId: "b", projectId: "pb" })]);
    expect(v.q1.verdict).toBe("CROSS_PROJECT");
    expect(v.q1.matches.map((m) => m.proofId)).toEqual(["fe-b"]);
  });

  it("a field capture with the same id as the proof is still a real match (different table)", () => {
    const v = verdictsForQueuedProofs([queued], [fieldCandidate("q1", "h1", { milestoneId: "m2" })]);
    expect(v.q1.verdict).toBe("REUSED_IN_PROJECT");
  });
});

describe("duplicateLabel", () => {
  it("never renders a resubmission as a warning", () => {
    expect(duplicateLabel("RESUBMISSION")?.tone).toBe("neutral");
    expect(duplicateLabel("REUSED_IN_PROJECT")?.tone).toBe("warn");
    expect(duplicateLabel("CROSS_PROJECT")?.tone).toBe("bad");
  });
  it("renders nothing for NONE or an unclassified row", () => {
    expect(duplicateLabel("NONE")).toBeNull();
    expect(duplicateLabel(null)).toBeNull();
  });
});
