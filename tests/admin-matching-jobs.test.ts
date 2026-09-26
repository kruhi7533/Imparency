import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    fundingOpportunity: { findUnique: vi.fn() },
    matchingJob: { findFirst: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn(), requestMeta: vi.fn(() => ({})) }));
vi.mock("@/lib/matching/runner", () => ({
  runMatchingJob: vi.fn(),
  STRANDED_AFTER_MS: 300000,
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { runMatchingJob } from "@/lib/matching/runner";
import { POST } from "@/app/api/admin/matching/jobs/route";

const db = prisma as any;
const session = getServerSession as any;
const runner = runMatchingJob as any;

/**
 * What these tests protect.
 *
 * Starting a matching run is an admin-only action with two preconditions that
 * both exist to stop a meaningless run reaching a funder: the opportunity must
 * be open, and it must actually declare criteria. An opportunity with no
 * criteria would otherwise return every organisation on the platform.
 */

function req(body: Record<string, unknown> = { opportunityId: "opp_1" }) {
  return new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
}

function opportunity(overrides: Record<string, unknown> = {}) {
  return { id: "opp_1", status: "OPEN", _count: { criteria: 3 }, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  db.fundingOpportunity.findUnique.mockResolvedValue(opportunity());
  db.matchingJob.findFirst.mockResolvedValue(null);
  db.matchingJob.create.mockResolvedValue({ id: "job_1" });
  runner.mockResolvedValue({
    evaluatedCount: 3,
    eligibleCount: 1,
    ineligibleCount: 1,
    unknownCount: 1,
  });
});

describe("who may start a matching run", () => {
  it("refuses an unauthenticated caller and creates no job", async () => {
    session.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(db.matchingJob.create).not.toHaveBeenCalled();
  });

  it("refuses an NGO caller and creates no job", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "NGO" } });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(db.matchingJob.create).not.toHaveBeenCalled();
  });

  it("refuses a DONOR caller and creates no job", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "DONOR" } });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(db.matchingJob.create).not.toHaveBeenCalled();
  });
});

describe("preconditions", () => {
  it("runs the engine and returns the counts on the happy path", async () => {
    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toMatchObject({ jobId: "job_1", status: "COMPLETED", eligibleCount: 1 });
    expect(runner).toHaveBeenCalledWith("job_1");
  });

  it("404s an opportunity that does not exist", async () => {
    db.fundingOpportunity.findUnique.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(db.matchingJob.create).not.toHaveBeenCalled();
  });

  it("409s an opportunity that is not open", async () => {
    db.fundingOpportunity.findUnique.mockResolvedValue(opportunity({ status: "DRAFT" }));
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(db.matchingJob.create).not.toHaveBeenCalled();
  });

  it("refuses to match an opportunity that declares no criteria", async () => {
    // Otherwise every organisation on the platform comes back as a result.
    db.fundingOpportunity.findUnique.mockResolvedValue(opportunity({ _count: { criteria: 0 } }));
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(db.matchingJob.create).not.toHaveBeenCalled();
  });

  it("409s when a run is already in flight", async () => {
    db.matchingJob.findFirst.mockResolvedValue({ id: "job_running" });
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(db.matchingJob.create).not.toHaveBeenCalled();
  });

  it("400s a request with no opportunityId", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });
});

describe("when the run fails", () => {
  it("reports the failure rather than a phantom success", async () => {
    runner.mockResolvedValue(null);
    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.status).toBe("FAILED");
  });
});
