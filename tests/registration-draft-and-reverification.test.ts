import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * NGO-001 — registration save-and-resume (server-side DRAFT, prefill, submit
 * falls back to draft documents and moves to PENDING).
 * ADM-004 — admin-triggered "re-verification due" on a VERIFIED NGO.
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    ngoRegistrationDraft: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    nGOProfile: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    nGOTeamMember: { upsert: vi.fn() },
    consentAudit: { create: vi.fn() },
    nGOCompliance: { findUnique: vi.fn(), upsert: vi.fn(async () => ({ id: "comp-1" })), update: vi.fn() },
    notification: { create: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })) }));
vi.mock("@/lib/storage", () => ({ uploadFile: vi.fn(async (_b: Buffer, name: string) => `/api/documents/documents/${name}`) }));
vi.mock("@/lib/pan-verification", () => ({ verifyPan: vi.fn(async () => ({ valid: true, registeredName: null })), namesMatch: vi.fn(() => true) }));
vi.mock("@/lib/extraction-runner", () => ({ runAndStoreNgoExtraction: vi.fn(async () => {}) }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/verification-reversal", () => ({ REVERIFICATION_WINDOW_DAYS: 14 }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { uploadFile } from "@/lib/storage";
import { logAdminAction } from "@/lib/admin-log";
import { sanitizeDraftFields, draftDocUrl } from "@/lib/registration-draft";
import { GET as DRAFT_GET, PUT as DRAFT_PUT } from "@/app/api/ngo/register/draft/route";
import { POST as REGISTER } from "@/app/api/ngo/register/route";
import { POST as REQUEST_REVERIFY } from "@/app/api/admin/ngos/[id]/request-reverification/route";

const db = prisma as any;
const session = (id: string, role: string) => (getServerSession as any).mockResolvedValue({ user: { id, role } });
const pdf = (name: string) => new File([new TextEncoder().encode("%PDF-1.4") as any], name, { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  db.ngoRegistrationDraft.findUnique.mockResolvedValue(null);
  db.ngoRegistrationDraft.upsert.mockImplementation(({ create }: any) => Promise.resolve({ ...create, status: "DRAFT", updatedAt: new Date(), submittedAt: null }));
  db.nGOProfile.findUnique.mockResolvedValue(null);
  db.nGOProfile.findFirst.mockResolvedValue(null);
  db.nGOProfile.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "ngo-new", ...data }));
  db.ngoRegistrationDraft.update.mockResolvedValue({});
  db.nGOTeamMember.upsert.mockResolvedValue({});
  db.consentAudit.create.mockResolvedValue({});
  db.notification.create.mockResolvedValue({});
});

describe("draft helpers", () => {
  it("keeps only known fields and tolerates an incomplete form", () => {
    expect(sanitizeDraftFields({ orgName: "  Akshar ", evil: "x", causeCategories: '["Education"]' })).toEqual({ orgName: "Akshar", causeCategories: ["Education"] });
  });
  it("finds a saved document slot", () => {
    expect(draftDocUrl({ regFile: { url: "/api/documents/documents/a.pdf", name: "a.pdf" } }, "regFile")).toBe("/api/documents/documents/a.pdf");
    expect(draftDocUrl({}, "panFile")).toBeNull();
    expect(draftDocUrl(null, "panFile")).toBeNull();
  });
});

describe("save and resume", () => {
  it("saves a partial draft (no required fields) and its documents to private storage", async () => {
    session("u-ngo", "NGO");
    const fd = new FormData();
    fd.append("orgName", "Akshar Trust");
    fd.append("regFile", pdf("reg.pdf"));
    const res = await DRAFT_PUT(new Request("http://t", { method: "PUT", body: fd }));
    expect(res.status).toBe(200);
    expect(uploadFile).toHaveBeenCalledWith(expect.any(Buffer), "reg.pdf", "documents", { private: true });
    const args = db.ngoRegistrationDraft.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ userId: "u-ngo" });
    expect(args.create.fields).toMatchObject({ orgName: "Akshar Trust" });
    const j = await res.json();
    expect(j.draft.documents.regFile).toEqual({ name: "reg.pdf" }); // no storage path to the client
  });
  it("resume returns the caller's own draft for prefill", async () => {
    session("u-ngo", "NGO");
    db.ngoRegistrationDraft.findUnique.mockResolvedValue({ status: "DRAFT", fields: { orgName: "Akshar Trust" }, documents: {}, updatedAt: new Date(), submittedAt: null });
    const j = await (await DRAFT_GET()).json();
    expect(j.draft.fields.orgName).toBe("Akshar Trust");
    expect(db.ngoRegistrationDraft.findUnique.mock.calls[0][0].where).toEqual({ userId: "u-ngo" });
  });
  it("a resubmitting NGO gets its existing profile for prefill", async () => {
    session("u-ngo", "NGO");
    db.nGOProfile.findUnique.mockResolvedValue({ orgName: "Akshar", registrationNumber: "R1", panNumber: "P1", address: "A", website: null, foundedYear: 2001, description: "D", causeCategories: ["Education"], verificationStatus: "REJECTED", updatedAt: new Date() });
    const j = await (await DRAFT_GET()).json();
    expect(j.profile.fields).toMatchObject({ orgName: "Akshar", foundedYear: "2001" });
  });
  it("a non-NGO cannot use drafts", async () => {
    session("u-donor", "DONOR");
    expect((await DRAFT_GET()).status).toBe(403);
  });
  it("submit uses the draft's documents, creates a PENDING profile and marks the draft SUBMITTED", async () => {
    session("u-ngo", "NGO");
    db.ngoRegistrationDraft.findUnique.mockResolvedValue({
      id: "d-1",
      status: "DRAFT",
      documents: {
        regFile: { url: "/api/documents/documents/reg.pdf", name: "reg.pdf" },
        panFile: { url: "/api/documents/documents/pan.pdf", name: "pan.pdf" },
        taxFile: { url: "/api/documents/documents/80g.pdf", name: "80g.pdf" },
      },
    });
    const fd = new FormData();
    for (const [k, v] of Object.entries({ orgName: "Akshar Trust", registrationNumber: "R-1", panNumber: "AAATA1234A", address: "Pune", foundedYear: "2001", description: "Education", causeCategories: '["Education"]', dataProcessingConsent: "true" })) fd.append(k, v);
    const res = await REGISTER(new Request("http://t", { method: "POST", body: fd }));
    expect(res.status).toBe(200);
    const created = db.nGOProfile.create.mock.calls[0][0].data;
    expect(created.verificationStatus).toBe("PENDING");
    expect(created.documents).toEqual(["/api/documents/documents/reg.pdf", "/api/documents/documents/pan.pdf", "/api/documents/documents/80g.pdf"]);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(db.ngoRegistrationDraft.update.mock.calls[0][0]).toMatchObject({ where: { id: "d-1" }, data: { status: "SUBMITTED", profileId: "ngo-new" } });
  });
  it("without a draft, a submission missing a document is still refused (existing behaviour)", async () => {
    session("u-ngo", "NGO");
    const fd = new FormData();
    for (const [k, v] of Object.entries({ orgName: "A", registrationNumber: "R", panNumber: "P", address: "x", foundedYear: "2001", description: "d", causeCategories: '["Education"]', dataProcessingConsent: "true" })) fd.append(k, v);
    const res = await REGISTER(new Request("http://t", { method: "POST", body: fd }));
    expect(res.status).toBe(400);
  });
});

describe("ADM-004 request re-verification", () => {
  const req = (body: unknown) => new Request("http://t", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  beforeEach(() => {
    db.nGOProfile.findUnique.mockResolvedValue({ id: "ngo-a", userId: "u-ngo", verificationStatus: "VERIFIED", reverificationRequiredAt: null, reverificationDueAt: null, isDeleted: false });
    db.nGOProfile.updateMany.mockResolvedValue({ count: 1 });
  });
  it("admin-only", async () => {
    session("u-ngo", "NGO");
    expect((await REQUEST_REVERIFY(req({ reason: "Annual review of documents" }), { params: { id: "ngo-a" } })).status).toBe(403);
  });
  it("sets the re-verification fields (status stays VERIFIED), logs ids only, notifies the NGO", async () => {
    session("admin-1", "ADMIN");
    const res = await REQUEST_REVERIFY(req({ reason: "Annual review: upload current 80G", dueInDays: 7 }), { params: { id: "ngo-a" } });
    expect(res.status).toBe(200);
    const call = db.nGOProfile.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: "ngo-a", verificationStatus: "VERIFIED", reverificationRequiredAt: null });
    expect(call.data.reverificationReason).toBe("Annual review: upload current 80G");
    expect(call.data).not.toHaveProperty("verificationStatus");
    expect(call.data.reverificationDueAt.getTime() - call.data.reverificationRequiredAt.getTime()).toBe(7 * 86400000);
    const log = (logAdminAction as any).mock.calls[0][0];
    expect(log).toMatchObject({ adminId: "admin-1", action: "NGO_REVERIFICATION_REQUESTED", entityType: "NGO", entityId: "ngo-a" });
    expect(JSON.stringify(log)).not.toContain("80G"); // free-text reason stays on the row, not in the log
    expect(db.notification.create.mock.calls[0][0].data.userId).toBe("u-ngo");
  });
  it("is idempotent while already due", async () => {
    session("admin-1", "ADMIN");
    db.nGOProfile.findUnique.mockResolvedValue({ id: "ngo-a", userId: "u-ngo", verificationStatus: "VERIFIED", reverificationRequiredAt: new Date(), reverificationDueAt: new Date(), isDeleted: false });
    const res = await REQUEST_REVERIFY(req({ reason: "Annual review of documents" }), { params: { id: "ngo-a" } });
    expect((await res.json()).alreadyDue).toBe(true);
    expect(db.nGOProfile.updateMany).not.toHaveBeenCalled();
  });
  it("only a VERIFIED NGO, and a reason is required", async () => {
    session("admin-1", "ADMIN");
    expect((await REQUEST_REVERIFY(req({ reason: "short" }), { params: { id: "ngo-a" } })).status).toBe(400);
    db.nGOProfile.findUnique.mockResolvedValue({ id: "ngo-a", userId: "u", verificationStatus: "PENDING", reverificationRequiredAt: null, isDeleted: false });
    expect((await REQUEST_REVERIFY(req({ reason: "Annual review of documents" }), { params: { id: "ngo-a" } })).status).toBe(409);
  });
});
