import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * WEEK5 SPEC-1 — the funder gate. Uses the real lib/matching/funder.ts rule so
 * the requirement workflow and the funder-led engine cannot drift apart.
 */

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  sponsorRequirement: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  requirementAuditLog: { create: vi.fn() },
  requirementRevision: { create: vi.fn() },
  requirementMatch: { count: vi.fn(), createMany: vi.fn() },
  gapReport: { create: vi.fn() },
  project: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/storage", () => ({ readPrivateFile: vi.fn(), uploadPrivateFile: vi.fn(), deletePrivateFile: vi.fn() }));
vi.mock("@/lib/requirements/extraction", () => ({ runExtraction: vi.fn() }));

import { createRequirementFromForm } from "@/lib/requirements/workflow";
import { runMatching } from "@/src/agents/gap-diagnoser/services/gapAnalysisService";
import { RequirementWorkflowError } from "@/lib/requirements/errors";

const DONOR = { id: "donor-1", role: "DONOR" as const, name: "Asha", email: "asha@acme.example" };
const ADMIN = { id: "admin-1", role: "ADMIN" as const, name: "Admin", email: "admin@impactbridge.example" };

const FORM = {
  title: "FY27 Digital Literacy",
  fields: { summary: "Computer labs for government schools.", sector: "Education", state: "Maharashtra" },
};

function funder(over: Record<string, unknown> = {}) {
  return {
    id: "donor-1",
    name: "Asha",
    email: "asha@acme.example",
    companyName: "Acme Industries",
    role: "DONOR",
    donorPersona: "CSR_OFFICER",
    panStatus: "VERIFIED",
    orgVerificationStatus: "VERIFIED",
    ...over,
  };
}

async function rejection(p: Promise<unknown>): Promise<RequirementWorkflowError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(RequirementWorkflowError);
    return err as RequirementWorkflowError;
  }
  throw new Error("expected the call to be refused");
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.sponsorRequirement.create.mockImplementation(async ({ data }: any) => ({ id: "req-new", version: 1, ...data }));
  db.requirementAuditLog.create.mockResolvedValue({});
});

describe("createRequirementFromForm — funder gate", () => {
  it("NOT_SUBMITTED organisation → 403 telling the donor to submit its details", async () => {
    db.user.findUnique.mockResolvedValue(funder({ orgVerificationStatus: "NOT_SUBMITTED" }));
    const err = await rejection(createRequirementFromForm(DONOR, FORM));
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/not submitted/i);
    expect(db.sponsorRequirement.create).not.toHaveBeenCalled();
  });

  it("PENDING organisation → 403 saying it is in the queue, not 'go verify it'", async () => {
    db.user.findUnique.mockResolvedValue(funder({ orgVerificationStatus: "PENDING" }));
    const err = await rejection(createRequirementFromForm(DONOR, FORM));
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/waiting in the verification queue/i);
  });

  it("VERIFIED institutional funder → succeeds", async () => {
    db.user.findUnique.mockResolvedValue(funder());
    const created = await createRequirementFromForm(DONOR, FORM);
    expect(created.id).toBe("req-new");
    expect(db.sponsorRequirement.create).toHaveBeenCalledTimes(1);
  });

  it("INDIVIDUAL persona with a verified PAN → 403 NOT_INSTITUTIONAL", async () => {
    db.user.findUnique.mockResolvedValue(funder({ donorPersona: "INDIVIDUAL" }));
    const err = await rejection(createRequirementFromForm(DONOR, FORM));
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/individual donor/i);
  });
});

describe("runMatching — the gate follows the requirement's owner", () => {
  const validated = { id: "req-1", sponsorId: "donor-1", status: "VALIDATED", version: 4, extractedFields: {} };

  it("owner NOT_SUBMITTED, caller ADMIN → still refused", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValue(validated);
    db.user.findUnique.mockResolvedValue(funder({ orgVerificationStatus: "NOT_SUBMITTED" }));
    const err = await rejection(runMatching("req-1", ADMIN));
    expect(err.status).toBe(403);
    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "donor-1" } }));
    expect(db.sponsorRequirement.updateMany).not.toHaveBeenCalled();
  });

  it("owner VERIFIED, caller ADMIN → passes the gate (not blocked by the admin's own persona)", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValue(validated);
    db.user.findUnique.mockResolvedValue(funder());
    // Stop right after the gate: the MATCHING transition is the first write.
    db.sponsorRequirement.updateMany.mockRejectedValue(new Error("past the gate"));
    await expect(runMatching("req-1", ADMIN)).rejects.toThrow("past the gate");
    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "donor-1" } }));
  });
});
