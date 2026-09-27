import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  sponsorRequirement: { create: vi.fn() },
  requirementAuditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/storage", () => ({ readPrivateFile: vi.fn(), uploadPrivateFile: vi.fn(), deletePrivateFile: vi.fn() }));
vi.mock("@/lib/requirements/extraction", () => ({ runExtraction: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/requirements/route";
import { applyEdits, withDonorProvenance, FORM_ENTRY_AGENT } from "@/lib/requirements/provenance";
import { serializeRequirement } from "@/lib/requirements/dto";

const VALID = {
  title: "FY27 Digital Literacy",
  fields: {
    summary: "Computer labs and teacher training for government schools.",
    sector: "Education",
    state: "Maharashtra",
    district: "Pune",
    budgetMin: 2500000,
    budgetMax: 5000000,
    primaryKPIs: ["Students trained", "Labs set up"],
    requiredDocuments: ["12A registration", "80G certificate"],
    contactEmail: "csr@company.com",
  },
};

function post(body: unknown): Request {
  return new Request("http://localhost/api/requirements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as any).mockResolvedValue({ user: { id: "donor-1", role: "DONOR", email: "d@example.com" } });
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.sponsorRequirement.create.mockImplementation(async ({ data }: any) => ({
    id: "req-form",
    storageKey: null,
    mimeType: "",
    fileSize: 0,
    fileHash: "",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
  }));
  db.requirementAuditLog.create.mockResolvedValue({});
});

describe("POST /api/requirements (structured form)", () => {
  it("creates a document-less requirement in DONOR_REVIEW with donor-entered fields", async () => {
    const res = await POST(post(VALID));
    const data = await res.json();

    expect(res.status).toBe(201);
    const { data: saved } = db.sponsorRequirement.create.mock.calls[0][0];
    expect(saved).toMatchObject({
      sponsorId: "donor-1",
      fileName: "FY27 Digital Literacy",
      status: "DONOR_REVIEW",
      extractedByAgent: FORM_ENTRY_AGENT,
      versionAuthorRole: "DONOR",
    });
    expect(saved.storageKey).toBeUndefined();
    expect(saved.extractedFields.sector).toEqual({ value: "Education", confidence: 1, source: "DONOR_ENTERED" });
    expect(saved.extractedFields.timeline).toEqual({ value: null, confidence: 0, source: "DONOR_ENTERED" });

    expect(db.requirementAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ requirementId: "req-form", action: "REQUIREMENT_CREATED_FROM_FORM", toStatus: "DONOR_REVIEW" }),
    });
    expect(data.requirement).toMatchObject({ id: "req-form", isFormEntry: true, hasDocument: false });
  });

  it("refuses non-donor accounts", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "ngo-1", role: "NGO" } });
    const res = await POST(post(VALID));
    expect(res.status).toBe(403);
    expect(db.sponsorRequirement.create).not.toHaveBeenCalled();
  });

  it("requires sign-in", async () => {
    (getServerSession as any).mockResolvedValue(null);
    expect((await POST(post(VALID))).status).toBe(401);
  });

  it("requires a title and the matching-critical fields", async () => {
    const noTitle = await POST(post({ ...VALID, title: " " }));
    expect(noTitle.status).toBe(400);

    const res = await POST(post({ title: "Valid title", fields: { summary: "Something useful here" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/CSR sector.*Target state/);
    expect(db.sponsorRequirement.create).not.toHaveBeenCalled();
  });

  it("rejects an inverted budget range, bad email, unknown fields and bad numbers", async () => {
    const cases = [
      { ...VALID.fields, budgetMin: 9, budgetMax: 1 },
      { ...VALID.fields, contactEmail: "not-an-email" },
      { ...VALID.fields, storageKey: "requirements/x.pdf" },
      { ...VALID.fields, budgetMax: -5 },
    ];
    for (const fields of cases) {
      const res = await POST(post({ title: VALID.title, fields }));
      expect(res.status).toBe(400);
    }
    expect(db.sponsorRequirement.create).not.toHaveBeenCalled();
  });
});

describe("form-entry provenance", () => {
  it("a donor revising their own entry keeps it DONOR_ENTERED; an admin edit becomes ADMIN_VERIFIED", () => {
    const fields = withDonorProvenance(VALID.fields);
    const donor = applyEdits(fields, { state: "Gujarat" }, "DONOR");
    expect(donor.fields.state).toEqual({ value: "Gujarat", confidence: 1, source: "DONOR_ENTERED" });

    const admin = applyEdits(fields, { state: "Goa" }, "ADMIN");
    expect(admin.fields.state.source).toBe("ADMIN_VERIFIED");
    expect(admin.fields.state.aiConfidence).toBeUndefined();
  });

  it("document uploads are not marked as form entries", () => {
    const dto = serializeRequirement({ id: "r", extractedByAgent: "RequirementsAnalystAgent", storageKey: "k", extractedFields: {} });
    expect(dto.isFormEntry).toBe(false);
  });
});
