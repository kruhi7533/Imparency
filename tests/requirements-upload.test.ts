import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

const db = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), create: vi.fn() },
  sponsorRequirement: { create: vi.fn() },
  requirementAuditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/storage", () => ({
  uploadPrivateFile: vi.fn(async () => "requirements/1b4e28ba-2fa1-11d2-883f-0016d3cca427.pdf"),
  deletePrivateFile: vi.fn(),
}));
vi.mock("@/src/agents/requirements-agent/repositories/requirement.repository", () => ({
  SponsorRequirementRepository: { findByHash: vi.fn() },
}));
vi.mock("@/src/agents/requirements-agent/services/llm/llm.service", () => ({
  LlmUnavailableError: class LlmUnavailableError extends Error {},
}));
vi.mock("@/lib/requirements/extraction", () => ({ runExtraction: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { uploadPrivateFile } from "@/lib/storage";
import { SponsorRequirementRepository } from "@/src/agents/requirements-agent/repositories/requirement.repository";
import { LlmUnavailableError } from "@/src/agents/requirements-agent/services/llm/llm.service";
import { runExtraction } from "@/lib/requirements/extraction";
import { POST } from "@/app/api/requirements/upload/route";

const repo = SponsorRequirementRepository as any;
const PDF = "%PDF-1.4 identical CSR document bytes";
const HASH = crypto.createHash("sha256").update(Buffer.from(PDF)).digest("hex");
const KEY = "requirements/1b4e28ba-2fa1-11d2-883f-0016d3cca427.pdf";

const created = (over: Record<string, unknown> = {}) => ({
  id: "req-new",
  sponsorId: "sponsor-B",
  fileName: "csr.pdf",
  fileHash: HASH,
  storageKey: KEY,
  mimeType: "application/pdf",
  fileSize: PDF.length,
  status: "UPLOADED",
  version: 1,
  extractedFields: {},
  modelVersion: "gemini-3.6-flash",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

function uploadRequest(content = PDF, name = "csr.pdf"): Request {
  const form = new FormData();
  form.append("file", new File([content], name, { type: "application/pdf" }));
  return new Request("http://localhost/api/requirements/upload", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as any).mockResolvedValue({ user: { id: "sponsor-B", role: "DONOR", email: "b@example.com" } });
  db.user.findFirst.mockResolvedValue({ id: "sponsor-B" });
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.sponsorRequirement.create.mockResolvedValue(created());
  db.requirementAuditLog.create.mockResolvedValue({});
  repo.findByHash.mockResolvedValue(null);
  (runExtraction as any).mockResolvedValue(created({ status: "AI_EXTRACTED", rawText: "text" }));
});

describe("POST /api/requirements/upload", () => {
  it("stores the file privately under a generated key and never returns the key", async () => {
    const res = await POST(uploadRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(uploadPrivateFile).toHaveBeenCalledWith(expect.any(Buffer), ".pdf", "requirements");
    expect(db.sponsorRequirement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sponsorId: "sponsor-B", storageKey: KEY, mimeType: "application/pdf", fileHash: HASH, status: "UPLOADED" }),
    });
    expect(db.requirementAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "CSR_UPLOADED" }) });
    expect(runExtraction).toHaveBeenCalledWith(expect.objectContaining({ startedBy: { id: null, role: "SYSTEM" }, isRerun: false }));
    expect(data.requirement.status).toBe("AI_EXTRACTED");
    expect(JSON.stringify(data)).not.toContain(KEY);
  });

  it("checks duplicates only among the uploader's own records", async () => {
    repo.findByHash.mockResolvedValue(created({ id: "req-B-old", status: "DONOR_REVIEW" }));
    const data = await (await POST(uploadRequest())).json();

    expect(repo.findByHash).toHaveBeenCalledWith(HASH, "sponsor-B");
    expect(data.isDuplicate).toBe(true);
    expect(data.message).toBe("An identical CSR document has already been uploaded.");
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("rejects a file whose content does not match its extension", async () => {
    const res = await POST(uploadRequest("<html><script>alert(1)</script></html>", "csr.pdf"));
    expect(res.status).toBe(400);
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("only donors can upload", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "ngo-user", role: "NGO" } });
    expect((await POST(uploadRequest())).status).toBe(403);
    (getServerSession as any).mockResolvedValue(null);
    expect((await POST(uploadRequest())).status).toBe(401);
  });

  it("returns a retryable 503 with the requirement id when Gemini is overloaded", async () => {
    (runExtraction as any).mockRejectedValue(new LlmUnavailableError("The AI service (Google Gemini) is temporarily overloaded"));
    const res = await POST(uploadRequest());
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data).toMatchObject({ retryable: true, requirementId: "req-new" });
    expect(data.error).toMatch(/temporarily overloaded/);
  });
});
