import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What these tests protect.
 *
 * Admin validation is the governance gate: VALIDATED is what lets a
 * requirement be matched against real organisations. Matching compares the
 * sector and the state against the lists in lib/requirements/form-options.ts,
 * so a requirement validated with a sector those lists cannot read scores zero
 * against every candidate. The run then comes back empty, and an empty run
 * reads as "no NGO fits this" — the extractor's bad guess is laundered into a
 * fact about the sector.
 *
 * The gate has to refuse the unreadable value without refusing the many
 * legitimate compound ones ("Education & skilling", "Maharashtra, Goa"), which
 * is the boundary these tests pin.
 */

const db = vi.hoisted(() => ({
  sponsorRequirement: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/storage", () => ({ readPrivateFile: vi.fn(), uploadPrivateFile: vi.fn(), deletePrivateFile: vi.fn() }));
vi.mock("@/lib/requirements/extraction", () => ({ runExtraction: vi.fn() }));
vi.mock("@/lib/requirements/commit", () => ({ commitRequirementChange: vi.fn(async () => ({ id: "req-1", status: "VALIDATED" })) }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));

import { approveRequirement } from "@/lib/requirements/workflow";
import { RequirementWorkflowError } from "@/lib/requirements/errors";
import { namesKnownOption, SECTOR_OPTIONS, INDIAN_STATES } from "@/lib/requirements/form-options";

const ADMIN = { id: "admin-1", role: "ADMIN" as const, name: "Admin", email: "admin@impactbridge.example" };

const field = (value: unknown) => ({ value, confidence: 0.9, source: "AI_EXTRACTED" });

function requirement(fields: Record<string, unknown>) {
  return {
    id: "req-1",
    sponsorId: "donor-1",
    status: "PENDING_ADMIN_REVIEW",
    extractedFields: fields,
  };
}

async function refusal(p: Promise<unknown>): Promise<RequirementWorkflowError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(RequirementWorkflowError);
    return err as RequirementWorkflowError;
  }
  throw new Error("expected the approval to be refused");
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: any) => fn({}));
});

describe("namesKnownOption", () => {
  it("accepts an exact option", () => {
    expect(namesKnownOption("Education", SECTOR_OPTIONS)).toBe(true);
    expect(namesKnownOption("Maharashtra", INDIAN_STATES)).toBe(true);
  });

  it("accepts the compound values the extractor and the form actually produce", () => {
    // These are correct requirements, not defects. Equality would reject them.
    expect(namesKnownOption("Education & skilling", SECTOR_OPTIONS)).toBe(true);
    expect(namesKnownOption("Maharashtra, Goa", INDIAN_STATES)).toBe(true);
    expect(namesKnownOption("Water and Sanitation", SECTOR_OPTIONS)).toBe(true);
    expect(namesKnownOption("women empowerment programme", SECTOR_OPTIONS)).toBe(true);
    expect(namesKnownOption("Pan-India", INDIAN_STATES)).toBe(true);
  });

  it("refuses text that names no option", () => {
    expect(namesKnownOption("N/A", SECTOR_OPTIONS)).toBe(false);
    expect(namesKnownOption("Not specified in the document", SECTOR_OPTIONS)).toBe(false);
    expect(namesKnownOption("", SECTOR_OPTIONS)).toBe(false);
    expect(namesKnownOption("see attached annexure", INDIAN_STATES)).toBe(false);
  });

  it("matches on word boundaries, so a substring is not a state", () => {
    // "Goa" is inside "Goals". Matching on bare containment would accept it.
    expect(namesKnownOption("Goals", INDIAN_STATES)).toBe(false);
  });
});

describe("approveRequirement — the sector and state gate", () => {
  it("refuses a sector that names no known option, before committing anything", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValue(
      requirement({ sector: field("Not specified in the document"), state: field("Maharashtra") })
    );

    const err = await refusal(approveRequirement("req-1", ADMIN, null));

    expect(err.status).toBe(400);
    expect(err.message).toMatch(/CSR sector/i);
    // Refused at the gate: nothing was written and nothing became VALIDATED.
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a state that names no known option", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValue(
      requirement({ sector: field("Education"), state: field("Region 4") })
    );

    const err = await refusal(approveRequirement("req-1", ADMIN, null));

    expect(err.status).toBe(400);
    expect(err.message).toMatch(/target state/i);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("still refuses a missing sector with its own message", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValue(
      requirement({ sector: field(null), state: field("Maharashtra") })
    );

    const err = await refusal(approveRequirement("req-1", ADMIN, null));

    expect(err.status).toBe(400);
    expect(err.message).toMatch(/Add the CSR sector/i);
  });

  it("validates a requirement whose sector and state are compound but readable", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValue(
      requirement({ sector: field("Education & skilling"), state: field("Maharashtra, Goa") })
    );

    await expect(approveRequirement("req-1", ADMIN, "Checked against the certificate")).resolves.toMatchObject({
      status: "VALIDATED",
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("does not require a state — document extractions often miss it", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValue(
      requirement({ sector: field("Healthcare"), state: field(null) })
    );

    await expect(approveRequirement("req-1", ADMIN, null)).resolves.toMatchObject({ status: "VALIDATED" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("refuses a non-admin before looking at any field", async () => {
    const donor = { id: "donor-1", role: "DONOR" as const, name: "Asha", email: "asha@acme.example" };
    await refusal(approveRequirement("req-1", donor, null));
    expect(db.sponsorRequirement.findUnique).not.toHaveBeenCalled();
  });
});
