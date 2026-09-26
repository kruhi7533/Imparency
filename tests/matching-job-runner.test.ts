import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    matchingJob: { updateMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    opportunityCriterion: { findMany: vi.fn() },
    nGOProfile: { findMany: vi.fn() },
    matchCandidate: { upsert: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    extractedField: { findMany: vi.fn() },
    project: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));

import prisma from "@/lib/prisma";
import { runMatchingJob } from "@/lib/matching/runner";

const db = prisma as any;

/**
 * What these tests protect.
 *
 * 1. **Idempotency.** Re-running a job must not double-write candidates, and —
 *    the part that is easy to get wrong — must not overwrite a decision an
 *    admin has already made. The machine's proposal and the human's decision
 *    live in different columns precisely so a re-run can refresh one without
 *    touching the other.
 * 2. **A job is never left stuck.** Every exit path moves the row out of
 *    RUNNING, and every transition is a compare-and-swap so two runners cannot
 *    both claim the same job.
 */

function profileRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    verificationStatus: "VERIFIED",
    isSuspended: false,
    causeCategories: ["Education"],
    foundedYear: 2010,
    healthScore: 80,
    compliance: { fcraStatus: "NONE", fcraExpiryDate: null },
    ...overrides,
  };
}

/**
 * `nGOProfile.findMany` serves two different callers — the runner's pool query
 * (`select: { id }`) and gather's profile query. Routing on the select keeps
 * them independently controllable, which is what lets the "one organisation
 * cannot be evaluated" case be expressed at all.
 */
function mockNgoQueries(pool: { id: string }[], profiles: ReturnType<typeof profileRow>[]) {
  db.nGOProfile.findMany.mockImplementation((args: any) =>
    Promise.resolve(args?.select?.verificationStatus ? profiles : pool)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Happy path: the claim succeeds.
  db.matchingJob.updateMany.mockResolvedValue({ count: 1 });
  db.matchingJob.update.mockResolvedValue({});
  db.matchingJob.findUnique.mockResolvedValue({ opportunityId: "opp_1" });
  db.opportunityCriterion.findMany.mockResolvedValue([
    { kind: "VERIFIED_STATUS", value: null, values: [], required: true },
  ]);
  mockNgoQueries(
    [{ id: "ngo_1" }, { id: "ngo_2" }],
    [profileRow("ngo_1"), profileRow("ngo_2")]
  );
  db.extractedField.findMany.mockResolvedValue([
    { ngoId: "ngo_1", fieldKey: "panNumber", status: "VALIDATED" },
    { ngoId: "ngo_2", fieldKey: "panNumber", status: "VALIDATED" },
  ]);
  db.project.findMany.mockResolvedValue([]);
  db.matchCandidate.upsert.mockResolvedValue({});
  db.matchCandidate.deleteMany.mockResolvedValue({ count: 0 });
});

describe("runMatchingJob — idempotency", () => {
  it("upserts on the (jobId, ngoId) key and never plain-creates a candidate", async () => {
    await runMatchingJob("job_1");

    expect(db.matchCandidate.create).not.toHaveBeenCalled();
    expect(db.matchCandidate.upsert).toHaveBeenCalledTimes(2);
    expect(db.matchCandidate.upsert.mock.calls[0][0].where).toEqual({
      jobId_ngoId: { jobId: "job_1", ngoId: "ngo_1" },
    });
  });

  it("never writes decision fields, so a re-run cannot reset an admin's shortlist", async () => {
    await runMatchingJob("job_1");

    for (const [arg] of db.matchCandidate.upsert.mock.calls) {
      expect(arg.update).not.toHaveProperty("decision");
      expect(arg.update).not.toHaveProperty("decidedById");
      expect(arg.update).not.toHaveProperty("decidedAt");
      expect(arg.update).not.toHaveProperty("decisionNote");
      // The create side may only ever propose.
      expect(arg.create).not.toHaveProperty("decision");
    }
  });

  it("produces identical counts across two runs over the same pool", async () => {
    const first = await runMatchingJob("job_1");
    db.matchingJob.updateMany.mockResolvedValue({ count: 1 });
    const second = await runMatchingJob("job_1");
    expect(second).toEqual(first);
  });
});

describe("runMatchingJob — who is even considered", () => {
  it("only ever matches verified, unsuspended, undeleted organisations", async () => {
    // Being matchable is a PRECONDITION, not a criterion. A pending or
    // suspended organisation cannot receive funding, so putting it in front of
    // a funder is noise — and it would surface organisations nobody has vetted.
    // Pending ones belong in /admin/verification instead.
    await runMatchingJob("job_1");

    const poolQuery = db.nGOProfile.findMany.mock.calls.find(
      (c: any) => !c[0]?.select?.verificationStatus
    )[0];
    expect(poolQuery.where).toEqual({
      isDeleted: false,
      isSuspended: false,
      verificationStatus: "VERIFIED",
    });
  });
});

describe("runMatchingJob — organisations that leave the pool", () => {
  it("removes undecided candidates the run no longer evaluates", async () => {
    await runMatchingJob("job_1");

    expect(db.matchCandidate.deleteMany).toHaveBeenCalledWith({
      where: {
        jobId: "job_1",
        decision: "PROPOSED",
        ngoId: { notIn: ["ngo_1", "ngo_2"] },
      },
    });
  });

  it("never removes a candidate a human has already decided on", async () => {
    // A suspended organisation drops out of the pool, but if an admin
    // shortlisted it the record of that decision must survive.
    await runMatchingJob("job_1");
    const where = db.matchCandidate.deleteMany.mock.calls[0][0].where;
    expect(where.decision).toBe("PROPOSED");
  });
});

describe("runMatchingJob — claiming", () => {
  it("claims by compare-and-swap on QUEUED", async () => {
    await runMatchingJob("job_1");
    expect(db.matchingJob.updateMany.mock.calls[0][0].where).toEqual({
      id: "job_1",
      status: "QUEUED",
    });
  });

  it("does nothing at all when the job is not claimable", async () => {
    db.matchingJob.updateMany.mockResolvedValue({ count: 0 });

    const result = await runMatchingJob("job_1");

    expect(result).toBeNull();
    expect(db.matchCandidate.upsert).not.toHaveBeenCalled();
    expect(db.nGOProfile.findMany).not.toHaveBeenCalled();
  });
});


/**
 * The COMPLETED write, found by what it does rather than by position.
 *
 * It used to be the last updateMany; superseding earlier runs now happens
 * after it, and an index-based lookup would silently start asserting against
 * the wrong write.
 */
function completionWrite() {
  return db.matchingJob.updateMany.mock.calls
    .map((c: any[]) => c[0])
    .find((a: any) => a.data?.status === 'COMPLETED');
}

/** The write that retires earlier runs for the same opportunity. */
function supersedeWrite() {
  return db.matchingJob.updateMany.mock.calls
    .map((c: any[]) => c[0])
    .find((a: any) => a.data?.supersededAt instanceof Date);
}

describe("runMatchingJob — never stuck", () => {
  it("moves the job to FAILED, gated on RUNNING, when the run throws", async () => {
    db.nGOProfile.findMany.mockRejectedValue(new Error("connection lost"));

    const result = await runMatchingJob("job_1");

    expect(result).toBeNull();
    const failWrite = db.matchingJob.updateMany.mock.calls.at(-1)[0];
    expect(failWrite.where).toEqual({ id: "job_1", status: "RUNNING" });
    expect(failWrite.data.status).toBe("FAILED");
    expect(failWrite.data.finishedAt).toBeInstanceOf(Date);
    expect(failWrite.data.errorMessage).toContain("connection lost");
  });

  it("completes the job even when one organisation cannot be evaluated", async () => {
    // ngo_missing is in the pool but has no gathered input — e.g. it was
    // deleted between the two queries. It must be recorded as UNKNOWN, not
    // silently dropped and not fatal to the run.
    mockNgoQueries([{ id: "ngo_1" }, { id: "ngo_missing" }], [profileRow("ngo_1")]);

    const counts = await runMatchingJob("job_1");

    expect(counts).toEqual({
      evaluatedCount: 2,
      eligibleCount: 1,
      ineligibleCount: 0,
      unknownCount: 1,
    });
    expect(completionWrite().data.status).toBe("COMPLETED");
  });

  it("finishes by compare-and-swap on RUNNING", async () => {
    await runMatchingJob("job_1");
    const finish = completionWrite();
    expect(finish.where).toEqual({ id: "job_1", status: "RUNNING" });
    expect(finish.data.status).toBe("COMPLETED");
  });
});

describe("runMatchingJob — superseding earlier runs", () => {
  it("retires every earlier run for the same opportunity", async () => {
    // Re-matching after a criteria revision used to leave the old run's
    // undecided candidates PROPOSED, so one opportunity appeared in the
    // decision queue once per run.
    await runMatchingJob("job_1");

    const supersede = supersedeWrite();
    expect(supersede).toBeDefined();
    expect(supersede.where).toEqual({
      opportunityId: "opp_1",
      id: { not: "job_1" },
      supersededAt: null,
    });
    expect(supersede.data.supersededAt).toBeInstanceOf(Date);
  });

  it("never supersedes the run that just completed", async () => {
    await runMatchingJob("job_1");
    expect(supersedeWrite().where.id).toEqual({ not: "job_1" });
  });

  it("leaves earlier runs standing when this one fails", async () => {
    // A stale answer beats none: a failed re-run must not retire the results
    // that are still the best available.
    db.nGOProfile.findMany.mockRejectedValue(new Error("connection lost"));

    await runMatchingJob("job_1");

    expect(supersedeWrite()).toBeUndefined();
  });

  it("supersedes only after the job is marked COMPLETED", async () => {
    await runMatchingJob("job_1");

    const calls = db.matchingJob.updateMany.mock.calls.map((c: any[]) => c[0]);
    const completedAt = calls.findIndex((a: any) => a.data?.status === "COMPLETED");
    const supersededAt = calls.findIndex((a: any) => a.data?.supersededAt instanceof Date);
    expect(completedAt).toBeGreaterThanOrEqual(0);
    expect(supersededAt).toBeGreaterThan(completedAt);
  });
});

describe("runMatchingJob — snapshot", () => {
  it("freezes the criteria the run was judged against", async () => {
    await runMatchingJob("job_1");
    expect(db.matchingJob.update).toHaveBeenCalledWith({
      where: { id: "job_1" },
      data: {
        criteriaSnapshot: [{ kind: "VERIFIED_STATUS", value: null, values: [], required: true }],
      },
    });
  });
});

// gatherEligibilityInputs is exercised through the runner above; this pins the
// one conversion that is easy to regress.
describe("gathered input", () => {
  it("passes a null healthScore through as null rather than coercing it to 0", async () => {
    mockNgoQueries([{ id: "ngo_1" }], [profileRow("ngo_1", { healthScore: null })]);
    const { gatherEligibilityInputs } = await import("@/lib/matching/gather");

    const map = await gatherEligibilityInputs(["ngo_1"], new Date());
    expect(map.get("ngo_1")?.healthScore).toBeNull();
  });

  it("reports an organisation with no extracted fields as noExtraction", async () => {
    mockNgoQueries([{ id: "ngo_1" }], [profileRow("ngo_1")]);
    db.extractedField.findMany.mockResolvedValue([]);
    const { gatherEligibilityInputs } = await import("@/lib/matching/gather");

    const map = await gatherEligibilityInputs(["ngo_1"], new Date());
    expect(map.get("ngo_1")?.evidence.noExtraction).toBe(true);
  });
});
