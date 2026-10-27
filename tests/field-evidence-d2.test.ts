import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * D2 (acceptance v2): field evidence → verification. Cases:
 *  NGO-012/013  photo sync stored; structured error per failing stage (never a
 *               bare 500); clientId replay
 *  NGO-014 / NEG-008 / NEG-009 / ADM-013 / AI-006
 *               duplicate + bad-GPS photos are FLAGGED; approving one is a
 *               noted override; return/reject reopens the task (rework loop)
 *  ADM-012      admin queue list API: admin only, filters, signed links
 *  NEG-015      signed, expiring, viewer-bound photo links; revocation on
 *               rejection / consent withdrawal reaches already-issued links
 */

vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })) }));
const prismaMock = vi.hoisted(() => {
  const m: any = {
    donorTeamMember: { findUnique: vi.fn() },
    nGOProfile: { findUnique: vi.fn() },
    nGOTeamMember: { findFirst: vi.fn() },
    contract: { findFirst: vi.fn() },
    fieldTask: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    fieldEvidence: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), groupBy: vi.fn() },
    milestoneProof: { findMany: vi.fn() },
    beneficiaryFeedback: { findUnique: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  };
  return m;
});
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/storage", async (orig) => ({
  ...(await orig<any>()),
  uploadPrivateFile: vi.fn(),
  readPrivateFile: vi.fn(),
  deletePrivateFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/fraud-alerts", () => ({ createFraudAlert: vi.fn() }));
vi.mock("@/lib/contract-donor-updates", () => ({ notifyContractDonorsEvidenceApproved: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { uploadPrivateFile, readPrivateFile, deletePrivateFile, StorageError } from "@/lib/storage";
import { logAdminAction } from "@/lib/admin-log";
import { checkReview, evidenceFlags, sniffImage } from "@/lib/field-evidence";
import { signEvidencePhotoPath, verifyEvidencePhotoSignature, PHOTO_URL_TTL_SECONDS } from "@/lib/evidence-photo-url";
import { syncOutcome } from "@/lib/field-queue";
import { POST as SYNC } from "@/app/api/field/evidence/route";
import { GET as PHOTO } from "@/app/api/field/evidence/[id]/photo/route";
import { PATCH as REVIEW } from "@/app/api/admin/field-evidence/[id]/route";
import { GET as QUEUE } from "@/app/api/admin/field-evidence/route";

const session = (id: string, role: string) => (getServerSession as any).mockResolvedValue({ user: { id, role } });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const HEIC = new Uint8Array([0, 0, 0, 0x18, ...Array.from(Buffer.from("ftypheic")), 0, 0, 0, 0]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
  prismaMock.$transaction.mockImplementation((cb: any) => cb(prismaMock));
  prismaMock.nGOProfile.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where.userId === "u-owner" ? { id: "ngo-a" } : where.userId === "u-other" ? { id: "ngo-b" } : null),
  );
  prismaMock.nGOTeamMember.findFirst.mockImplementation(({ where }: any) =>
    Promise.resolve(where.userId === "u-field" ? { ngoId: "ngo-a", role: "FIELD_STAFF" } : null),
  );
  prismaMock.donorTeamMember.findUnique.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

// ─── Sync: stages report their own error code ────────────────────────────────

const TASK = {
  id: "t1",
  title: "Photograph kits",
  ngoId: "ngo-a",
  projectId: "p1",
  milestoneId: null,
  assignedToId: "u-field",
  status: "OPEN",
  project: { id: "p1", latitude: 19.07, longitude: 72.87 },
};

function captureRequest(extra: Record<string, string> = {}, photo: Uint8Array | null = JPEG, type = "image/png") {
  const fd = new FormData();
  const fields = { clientId: "client-abcdef12", taskId: "t1", capturedAt: new Date(Date.now() - 3_600_000).toISOString(), ...extra };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  // Client claims PNG for JPEG bytes: the server must sniff, not trust.
  if (photo) fd.set("photo", new Blob([photo as BlobPart], { type }), "x.png");
  return new Request("http://test/api/field/evidence", { method: "POST", body: fd });
}

describe("POST /api/field/evidence — photo path", () => {
  beforeEach(() => {
    prismaMock.fieldTask.findUnique.mockResolvedValue(TASK);
    prismaMock.fieldEvidence.findUnique.mockResolvedValue(null);
    prismaMock.beneficiaryFeedback.findUnique.mockResolvedValue(null);
    prismaMock.fieldEvidence.findMany.mockResolvedValue([]);
    prismaMock.milestoneProof.findMany.mockResolvedValue([]);
    prismaMock.fieldEvidence.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "ev-1", status: "PENDING_REVIEW", ...data }));
    (uploadPrivateFile as any).mockResolvedValue("field-evidence/00000000-0000-0000-0000-000000000000.jpg");
  });

  it("NGO-013: a valid photo with on-site GPS is stored, persisted and reported with its checks", async () => {
    session("u-field", "NGO");
    const res = await SYNC(captureRequest({ latitude: "19.0761", longitude: "72.8778" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.evidence).toMatchObject({ id: "ev-1", status: "PENDING_REVIEW", locationStatus: "MATCH", duplicateVerdict: "NONE", duplicateCheck: "DONE" });
    expect(prismaMock.fieldEvidence.create.mock.calls[0][0].data.photoMime).toBe("image/jpeg");
  });

  it("storage failure → 503 STORAGE_UPLOAD_FAILED (retryable), nothing persisted", async () => {
    session("u-field", "NGO");
    (uploadPrivateFile as any).mockRejectedValue(new StorageError("STORAGE_UPLOAD_FAILED", "x", { retryable: true }));
    const res = await SYNC(captureRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "STORAGE_UPLOAD_FAILED", retryable: true });
    expect(prismaMock.fieldEvidence.create).not.toHaveBeenCalled();
    // The field app keeps a 503 queued and retries it.
    expect(syncOutcome(503)).toBe("retry");
  });

  it("unconfigured storage (the staging EROFS case) → 503 STORAGE_NOT_CONFIGURED with no internals", async () => {
    session("u-field", "NGO");
    (uploadPrivateFile as any).mockRejectedValue(new StorageError("STORAGE_NOT_CONFIGURED", "EROFS /var/task/storage"));
    const res = await SYNC(captureRequest());
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.code).toBe("STORAGE_NOT_CONFIGURED");
    expect(JSON.stringify(body)).not.toMatch(/EROFS|\/var\/task/);
  });

  it("duplicate lookup failure does not cost the capture: 201, duplicateCheck FAILED, verdict null (shown as unchecked)", async () => {
    session("u-field", "NGO");
    prismaMock.milestoneProof.findMany.mockRejectedValue(new Error("db down"));
    const res = await SYNC(captureRequest());
    expect(res.status).toBe(201);
    expect((await res.json()).evidence).toMatchObject({ duplicateCheck: "FAILED", duplicateVerdict: null });
    expect(evidenceFlags({ duplicateVerdict: null, duplicateOfId: null, locationStatus: "MATCH" })).toEqual(["DUPLICATE_CHECK_UNAVAILABLE"]);
  });

  it("transaction failure → 500 EVIDENCE_SAVE_FAILED and the uploaded file is cleaned up", async () => {
    session("u-field", "NGO");
    prismaMock.$transaction.mockRejectedValue(new Error("connection reset"));
    const res = await SYNC(captureRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ code: "EVIDENCE_SAVE_FAILED", retryable: true });
    expect(JSON.stringify(body)).not.toMatch(/connection reset/);
    expect(deletePrivateFile).toHaveBeenCalledWith("field-evidence/00000000-0000-0000-0000-000000000000.jpg");
  });

  it("a failure AFTER commit never deletes the stored photo", async () => {
    session("u-field", "NGO");
    const { createFraudAlert } = await import("@/lib/fraud-alerts");
    // A prior row on another NGO's project carrying this photo's hash.
    const { createHash } = await import("crypto");
    prismaMock.fieldEvidence.findMany.mockResolvedValue([
      { id: "ev-0", ngoId: "ngo-b", projectId: "p9", milestoneId: null, taskId: "t9", photoSha256: createHash("sha256").update(Buffer.from(JPEG)).digest("hex"), task: { title: "x", milestone: null } },
    ]);
    (createFraudAlert as any).mockRejectedValue(new Error("alert table down"));
    const res = await SYNC(captureRequest());
    expect(res.status).toBe(201);
    expect((await res.json()).evidence.duplicateVerdict).toBe("CROSS_PROJECT");
    expect(deletePrivateFile).not.toHaveBeenCalled();
  });

  it("type is sniffed: a text file named .jpg is 415 UNSUPPORTED_MEDIA_TYPE; HEIC is accepted", async () => {
    session("u-field", "NGO");
    const bad = await SYNC(captureRequest({}, new Uint8Array(Buffer.from("not an image at all")), "image/jpeg"));
    expect(bad.status).toBe(415);
    expect((await bad.json()).code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(sniffImage(HEIC)).toEqual({ mime: "image/heic", ext: ".heic" });
    const ok = await SYNC(captureRequest({ clientId: "client-heic0001" }, HEIC, "image/heic"));
    expect(ok.status).toBe(201);
    expect(uploadPrivateFile).toHaveBeenLastCalledWith(expect.any(Buffer), ".heic", "field-evidence");
  });

  it("over 8 MB is 413 PHOTO_TOO_LARGE before anything is stored", async () => {
    session("u-field", "NGO");
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(JPEG);
    const res = await SYNC(captureRequest({}, big));
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("PHOTO_TOO_LARGE");
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("ownership: another NGO's task is 404 TASK_NOT_FOUND; a teammate's task is 403 TASK_NOT_ASSIGNED", async () => {
    session("u-other", "NGO");
    let res = await SYNC(captureRequest());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("TASK_NOT_FOUND");
    prismaMock.nGOTeamMember.findFirst.mockResolvedValue({ ngoId: "ngo-a", role: "FIELD_STAFF" });
    session("u-field2", "NGO");
    res = await SYNC(captureRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("TASK_NOT_ASSIGNED");
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("NGO-012: replaying a synced clientId returns the same record and stores nothing new", async () => {
    session("u-field", "NGO");
    prismaMock.fieldEvidence.findUnique.mockResolvedValue({
      id: "ev-1", ngoId: "ngo-a", status: "PENDING_REVIEW", locationStatus: "MATCH", duplicateOfId: null, duplicateVerdict: "NONE",
    });
    const res = await SYNC(captureRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ replayed: true, evidence: { id: "ev-1" } });
    expect(uploadPrivateFile).not.toHaveBeenCalled();
    expect(prismaMock.fieldEvidence.create).not.toHaveBeenCalled();
  });
});

// ─── Flags and review ────────────────────────────────────────────────────────

describe("flags: AI flags, human decides", () => {
  it("duplicate image and GPS mismatch are flags; RESUBMISSION and NO_GPS_DATA are not", () => {
    expect(evidenceFlags({ duplicateVerdict: "CROSS_PROJECT", locationStatus: "MATCH" })).toEqual(["DUPLICATE_IMAGE"]);
    expect(evidenceFlags({ duplicateVerdict: "REUSED_IN_PROJECT", locationStatus: "MISMATCH" })).toEqual(["DUPLICATE_IMAGE", "GPS_MISMATCH"]);
    expect(evidenceFlags({ duplicateVerdict: "RESUBMISSION", locationStatus: "NO_GPS_DATA" })).toEqual([]);
    expect(evidenceFlags({ duplicateVerdict: "NONE", locationStatus: "NO_GPS_DATA" })).toEqual([]);
  });

  it("approving a flagged photo needs a written override; clean approval does not", () => {
    expect(checkReview("PENDING_REVIEW", "APPROVE", null, ["GPS_MISMATCH"])).toMatchObject({ ok: false, code: "OVERRIDE_NOTE_REQUIRED" });
    expect(checkReview("PENDING_REVIEW", "APPROVE", "Site moved; confirmed by phone", ["GPS_MISMATCH"])).toMatchObject({ ok: true, override: ["GPS_MISMATCH"] });
    expect(checkReview("PENDING_REVIEW", "APPROVE", null, ["DUPLICATE_CHECK_UNAVAILABLE"])).toMatchObject({ ok: true, override: [] });
    expect(checkReview("PENDING_REVIEW", "APPROVE", null, [])).toMatchObject({ ok: true });
  });
});

describe("PATCH /api/admin/field-evidence/[id] — flagged evidence and the rework loop", () => {
  const EV = {
    id: "ev-1", status: "PENDING_REVIEW", taskId: "t1", projectId: "p1", containsPeople: false,
    duplicateVerdict: "CROSS_PROJECT", duplicateOfId: "ev-0", locationStatus: "MISMATCH",
    feedback: null, task: { project: { title: "P" }, milestone: null },
  };
  const patch = (body: unknown) =>
    REVIEW(new Request("http://test", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }), { params: { id: "ev-1" } });

  beforeEach(() => {
    prismaMock.fieldEvidence.findUnique.mockResolvedValue(EV);
    prismaMock.fieldEvidence.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.fieldTask.updateMany.mockResolvedValue({ count: 1 });
  });

  it("approve over flags without a note is refused and nothing moves", async () => {
    session("admin-1", "ADMIN");
    const res = await patch({ decision: "APPROVE" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "OVERRIDE_NOTE_REQUIRED", flags: ["DUPLICATE_IMAGE", "GPS_MISMATCH"] });
    expect(prismaMock.fieldEvidence.updateMany).not.toHaveBeenCalled();
  });

  it("approve over flags with a note is allowed and the override is audited (codes only)", async () => {
    session("admin-1", "ADMIN");
    const res = await patch({ decision: "APPROVE", note: "Same kit photographed for two donors' projects by design" });
    expect(res.status).toBe(200);
    const audit = (logAdminAction as any).mock.calls[0][0];
    expect(audit.metadata).toMatchObject({ overriddenFlags: ["DUPLICATE_IMAGE", "GPS_MISMATCH"] });
  });

  it("return (REQUEST_RESUBMIT) and reject both reopen the task for a new capture", async () => {
    session("admin-1", "ADMIN");
    expect((await patch({ decision: "REQUEST_RESUBMIT", note: "Retake on site please" })).status).toBe(200);
    expect(prismaMock.fieldTask.updateMany.mock.calls[0][0]).toEqual({ where: { id: "t1", status: "SUBMITTED" }, data: { status: "OPEN" } });
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((cb: any) => cb(prismaMock));
    prismaMock.fieldEvidence.findUnique.mockResolvedValue(EV);
    prismaMock.fieldEvidence.updateMany.mockResolvedValue({ count: 1 });
    expect((await patch({ decision: "REJECT", note: "Reused photo from another project" })).status).toBe(200);
    expect(prismaMock.fieldTask.updateMany.mock.calls[0][0]).toEqual({ where: { id: "t1", status: "SUBMITTED" }, data: { status: "OPEN" } });
  });
});

// ─── Admin queue ─────────────────────────────────────────────────────────────

describe("GET /api/admin/field-evidence (ADM-012)", () => {
  const ROW = {
    id: "ev-1", ngoId: "ngo-a", projectId: "p1", taskId: "t1", status: "PENDING_REVIEW", photoMime: "image/jpeg",
    duplicateVerdict: "CROSS_PROJECT", duplicateOfId: "ev-0", locationStatus: "MATCH", distanceKm: 0.2, accuracyM: 12,
    note: null, containsPeople: true, capturedAt: new Date("2026-10-01T10:00:00Z"), syncedAt: new Date("2026-10-01T12:00:00Z"),
    reviewNote: null, reviewedAt: null,
    task: { title: "Kits", status: "SUBMITTED", project: { title: "P", location: "Nagpur", ngo: { orgName: "Akshar" } } },
    feedback: { consentToRecord: true, consentToSharePhoto: false, withdrawnAt: null, rating: 4, feedbackText: "ok" },
  };
  const get = (qs = "") => QUEUE(new Request(`http://test/api/admin/field-evidence${qs}`));

  beforeEach(() => {
    prismaMock.fieldEvidence.findMany.mockResolvedValue([ROW]);
    prismaMock.fieldEvidence.groupBy.mockResolvedValue([{ status: "PENDING_REVIEW", _count: { _all: 1 } }]);
  });

  it("is admin-only", async () => {
    session("u-owner", "NGO");
    expect((await get()).status).toBe(403);
    expect(prismaMock.fieldEvidence.findMany).not.toHaveBeenCalled();
  });

  it("defaults to the pending queue, returns flags and a signed link for THIS admin", async () => {
    session("admin-1", "ADMIN");
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(prismaMock.fieldEvidence.findMany.mock.calls[0][0].where).toEqual({ AND: [{ status: "PENDING_REVIEW" }] });
    expect(body.items[0]).toMatchObject({ id: "ev-1", flags: ["DUPLICATE_IMAGE"], offline: true, consentToShare: false });
    const url = new URL(body.items[0].photoUrl, "http://test");
    expect(verifyEvidencePhotoSignature("ev-1", "admin-1", url.searchParams.get("exp"), url.searchParams.get("sig")).ok).toBe(true);
    expect(verifyEvidencePhotoSignature("ev-1", "someone-else", url.searchParams.get("exp"), url.searchParams.get("sig")).ok).toBe(false);
    expect(body.counts.PENDING_REVIEW).toBe(1);
  });

  it("filters by status, flag, ngo and project; rejects unknown filters", async () => {
    session("admin-1", "ADMIN");
    await get("?status=ALL&flag=gps&ngoId=ngo-a&projectId=p1");
    expect(prismaMock.fieldEvidence.findMany.mock.calls[0][0].where).toEqual({
      AND: [{ ngoId: "ngo-a" }, { projectId: "p1" }, { locationStatus: "MISMATCH" }],
    });
    expect((await get("?status=DELETED")).status).toBe(400);
    expect((await get("?flag=evil")).status).toBe(400);
  });
});

// ─── NEG-015: signed, expiring, revocable photo links ───────────────────────

describe("signed photo links", () => {
  const T0 = new Date("2026-10-27T10:00:00Z");

  it("valid for the issuing viewer until expiry, then LINK_EXPIRED", () => {
    const { url } = signEvidencePhotoPath("ev-1", "donor-a", T0);
    const p = new URL(url, "http://x").searchParams;
    expect(verifyEvidencePhotoSignature("ev-1", "donor-a", p.get("exp"), p.get("sig"), T0)).toEqual({ ok: true });
    const later = new Date(T0.getTime() + (PHOTO_URL_TTL_SECONDS + 1) * 1000);
    expect(verifyEvidencePhotoSignature("ev-1", "donor-a", p.get("exp"), p.get("sig"), later)).toEqual({ ok: false, code: "LINK_EXPIRED" });
  });

  it("bound to evidence id and viewer; tampering with exp is invalid", () => {
    const { url } = signEvidencePhotoPath("ev-1", "donor-a", T0);
    const p = new URL(url, "http://x").searchParams;
    expect(verifyEvidencePhotoSignature("ev-2", "donor-a", p.get("exp"), p.get("sig"), T0).ok).toBe(false);
    expect(verifyEvidencePhotoSignature("ev-1", "donor-b", p.get("exp"), p.get("sig"), T0).ok).toBe(false);
    expect(verifyEvidencePhotoSignature("ev-1", "donor-a", String(Number(p.get("exp")) + 3600), p.get("sig"), T0).ok).toBe(false);
    expect(verifyEvidencePhotoSignature("ev-1", "donor-a", null, null, T0)).toEqual({ ok: false, code: "LINK_INVALID" });
  });
});

describe("GET /api/field/evidence/[id]/photo — revocation reaches issued links", () => {
  const EV = {
    ngoId: "ngo-a", projectId: "p1", photoKey: "field-evidence/x.jpg", photoMime: "image/jpeg",
    status: "APPROVED", containsPeople: true, feedback: { consentToSharePhoto: true, withdrawnAt: null as Date | null },
  };
  const at = (url: string) => PHOTO(new Request(`http://test${url}`), { params: { id: "ev-1" } });

  beforeEach(() => {
    prismaMock.fieldEvidence.findUnique.mockResolvedValue(EV);
    prismaMock.contract.findFirst.mockResolvedValue({ id: "c1" });
    (readPrivateFile as any).mockResolvedValue(Buffer.from(JPEG));
  });

  it("unsigned request redirects to a short-lived link; bytes only come from the signed one", async () => {
    session("donor-a", "DONOR");
    const first = await at("/api/field/evidence/ev-1/photo");
    expect(first.status).toBe(302);
    expect(first.headers.get("Cache-Control")).toContain("no-store");
    const loc = first.headers.get("Location")!;
    expect(loc).toMatch(/\?exp=\d+&sig=/);
    expect(readPrivateFile).not.toHaveBeenCalled();
    const second = await at(loc);
    expect(second.status).toBe(200);
    expect(second.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("consent withdrawn after the link was issued → 404 on the same link", async () => {
    session("donor-a", "DONOR");
    const { url } = signEvidencePhotoPath("ev-1", "donor-a");
    prismaMock.fieldEvidence.findUnique.mockResolvedValue({ ...EV, feedback: { consentToSharePhoto: true, withdrawnAt: new Date() } });
    expect((await at(url)).status).toBe(404);
    expect(readPrivateFile).not.toHaveBeenCalled();
  });

  it("evidence rejected after the link was issued → 404 on the same link", async () => {
    session("donor-a", "DONOR");
    const { url } = signEvidencePhotoPath("ev-1", "donor-a");
    prismaMock.fieldEvidence.findUnique.mockResolvedValue({ ...EV, status: "REJECTED" });
    expect((await at(url)).status).toBe(404);
  });

  it("an expired link is 403 LINK_EXPIRED; someone else's link is 403 LINK_INVALID", async () => {
    session("donor-a", "DONOR");
    const old = signEvidencePhotoPath("ev-1", "donor-a", new Date(Date.now() - (PHOTO_URL_TTL_SECONDS + 5) * 1000));
    const expired = await at(old.url);
    expect(expired.status).toBe(403);
    expect((await expired.json()).code).toBe("LINK_EXPIRED");
    const foreign = signEvidencePhotoPath("ev-1", "donor-b");
    const res = await at(foreign.url);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("LINK_INVALID");
  });

  it("signed-out requests never reach storage", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const { url } = signEvidencePhotoPath("ev-1", "donor-a");
    expect((await at(url)).status).toBe(401);
    expect(readPrivateFile).not.toHaveBeenCalled();
  });
});
