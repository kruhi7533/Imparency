import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Week 7 — field tasks, offline evidence capture, beneficiary consent, review.
 *
 * Mandatory categories (CLAUDE.md):
 *  - tenant isolation: another NGO's task/photo is 404; FIELD_STAFF cannot
 *    assign; a donor sees a photo only through a funding contract;
 *  - approval gate: no donor visibility without APPROVED + consent; review
 *    decisions are terminal and audited;
 *  - idempotency: an offline capture synced twice is stored once.
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    nGOProfile: { findUnique: vi.fn() },
    nGOTeamMember: { findFirst: vi.fn() },
    project: { findUnique: vi.fn() },
    contract: { findFirst: vi.fn() },
    fieldTask: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    fieldEvidence: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    milestoneProof: { findMany: vi.fn() },
    beneficiaryFeedback: { findUnique: vi.fn(), create: vi.fn() },
    $transaction: vi.fn((cb: any) => cb(prismaMock)),
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  uploadPrivateFile: vi.fn().mockResolvedValue("field-evidence/00000000-0000-0000-0000-000000000000.jpg"),
  readPrivateFile: vi.fn().mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
  deletePrivateFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/fraud-alerts", () => ({ createFraudAlert: vi.fn() }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { uploadPrivateFile, deletePrivateFile } from "@/lib/storage";
import { logAdminAction } from "@/lib/admin-log";
import { createFraudAlert } from "@/lib/fraud-alerts";
import { checkReview, isShareableWithDonor, parseCapture, sniffImage, DONOR_VISIBLE_EVIDENCE_WHERE } from "@/lib/field-evidence";
import { syncOutcome } from "@/lib/field-queue";
import { GET as LIST_TASKS, POST as CREATE_TASK } from "@/app/api/ngo/field-tasks/route";
import { POST as SYNC } from "@/app/api/field/evidence/route";
import { GET as PHOTO } from "@/app/api/field/evidence/[id]/photo/route";
import { PATCH as REVIEW } from "@/app/api/admin/field-evidence/[id]/route";

const prismaMock = prisma as any;
const session = (id: string, role: string) => (getServerSession as any).mockResolvedValue({ user: { id, role } });
const json = (body: unknown, method = "POST") =>
  new Request("http://test", { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

const NOW = new Date("2026-10-05T10:00:00Z");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/** u-owner owns ngo-a; u-field/u-admin are ngo-a team; u-other owns ngo-b. */
function ngoDirectory() {
  const team: Record<string, string> = { "u-field": "FIELD_STAFF", "u-admin": "ADMIN", "u-field2": "FIELD_STAFF" };
  prismaMock.nGOProfile.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where.userId === "u-owner" ? { id: "ngo-a" } : where.userId === "u-other" ? { id: "ngo-b" } : null),
  );
  prismaMock.nGOTeamMember.findFirst.mockImplementation(({ where }: any) => {
    const role = team[where.userId];
    if (!role || (where.ngoId && where.ngoId !== "ngo-a")) return Promise.resolve(null);
    return Promise.resolve({ ngoId: "ngo-a", role, id: "tm" });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((cb: any) => cb(prismaMock));
  ngoDirectory();
});

// ─── Pure rules ──────────────────────────────────────────────────────────────

describe("parseCapture", () => {
  const base = { clientId: "client-123456", taskId: "t1", capturedAt: "2026-10-05T09:00:00Z", latitude: "19.07", longitude: "72.87" };

  it("accepts a normal capture", () => {
    const r = parseCapture(base, NOW);
    expect(r.ok && r.value).toMatchObject({ latitude: 19.07, longitude: 72.87, containsPeople: true, feedback: null });
  });

  it("accepts a capture with no GPS (indoors, denied permission)", () => {
    const r = parseCapture({ ...base, latitude: "", longitude: "" }, NOW);
    expect(r.ok && r.value.latitude).toBeNull();
  });

  it.each([
    [{ clientId: "short" }, 400],
    [{ taskId: "" }, 400],
    [{ longitude: "" }, 400],
    [{ latitude: "91" }, 400],
    [{ latitude: "abc" }, 400],
    [{ capturedAt: "2026-10-05T11:00:00Z" }, 400],
    [{ capturedAt: "2026-08-01T00:00:00Z" }, 422],
  ])("rejects %j", (patch, status) => {
    expect(parseCapture({ ...base, ...patch }, NOW)).toMatchObject({ ok: false, status });
  });

  it("without consent to record, keeps no feedback text or rating and no share consent", () => {
    const r = parseCapture(
      { ...base, hasFeedback: "true", consentMethod: "VERBAL", consentToRecord: "false", consentToSharePhoto: "true", rating: "5", feedbackText: "great" },
      NOW,
    );
    expect(r.ok && r.value.feedback).toMatchObject({ consentToRecord: false, consentToSharePhoto: false, rating: null, feedbackText: null });
  });

  it("keeps feedback with consent, and derives a separate feedback clientId", () => {
    const r = parseCapture(
      { ...base, hasFeedback: "true", consentMethod: "THUMBPRINT", consentToRecord: "true", consentToSharePhoto: "true", rating: "4", feedbackText: "ok" },
      NOW,
    );
    expect(r.ok && r.value.feedback).toMatchObject({ clientId: "client-123456:feedback", consentToSharePhoto: true, rating: 4 });
  });

  it("rejects a bad consent method or rating", () => {
    expect(parseCapture({ ...base, hasFeedback: "true", consentMethod: "EMAIL" }, NOW).ok).toBe(false);
    expect(parseCapture({ ...base, hasFeedback: "true", consentMethod: "VERBAL", consentToRecord: "true", rating: "6" }, NOW).ok).toBe(false);
  });
});

describe("sniffImage", () => {
  it("identifies JPEG/PNG/WebP by bytes and refuses anything else", () => {
    expect(sniffImage(JPEG)?.mime).toBe("image/jpeg");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))?.mime).toBe("image/png");
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))?.mime).toBe("image/webp");
    expect(sniffImage(new Uint8Array(Buffer.from("%PDF-1.7")))).toBeNull();
  });
});

describe("isShareableWithDonor (the donor visibility gate)", () => {
  const consent = { consentToSharePhoto: true, withdrawnAt: null };
  it.each([
    ["approved, no people, no consent record", { status: "APPROVED", containsPeople: false }, null, true],
    ["approved, people, consented", { status: "APPROVED", containsPeople: true }, consent, true],
    ["approved, people, no consent record", { status: "APPROVED", containsPeople: true }, null, false],
    ["approved, people, consent refused", { status: "APPROVED", containsPeople: true }, { ...consent, consentToSharePhoto: false }, false],
    ["approved, people, consent withdrawn", { status: "APPROVED", containsPeople: true }, { ...consent, withdrawnAt: new Date() }, false],
    ["pending review, consented", { status: "PENDING_REVIEW", containsPeople: false }, consent, false],
    ["resubmit requested", { status: "RESUBMIT_REQUESTED", containsPeople: false }, null, false],
  ])("%s", (_label, evidence: any, feedback: any, expected) => {
    expect(isShareableWithDonor(evidence, feedback)).toBe(expected);
  });

  it("the Prisma where-clause encodes the same rule", () => {
    expect(DONOR_VISIBLE_EVIDENCE_WHERE).toEqual({
      status: "APPROVED",
      OR: [{ containsPeople: false }, { feedback: { is: { consentToSharePhoto: true, withdrawnAt: null } } }],
    });
  });
});

describe("checkReview", () => {
  it("decides only pending evidence; repeats are no-ops; reversals 409", () => {
    expect(checkReview("PENDING_REVIEW", "APPROVE", null)).toMatchObject({ ok: true, noop: false, target: "APPROVED" });
    expect(checkReview("APPROVED", "APPROVE", null)).toMatchObject({ ok: true, noop: true });
    expect(checkReview("APPROVED", "REJECT", "looks fake")).toMatchObject({ ok: false, status: 409 });
  });
  it("needs a reason to reject or request resubmission", () => {
    expect(checkReview("PENDING_REVIEW", "REQUEST_RESUBMIT", "")).toMatchObject({ ok: false, status: 400 });
    expect(checkReview("PENDING_REVIEW", "REJECT", "blurry photo")).toMatchObject({ ok: true });
  });
});

describe("syncOutcome (offline queue)", () => {
  it.each([
    [201, "done"],
    [200, "done"],
    ["network-error", "retry"],
    [500, "retry"],
    [503, "retry"],
    [401, "retry"],
    [429, "retry"],
    [400, "failed"],
    [403, "failed"],
    [404, "failed"],
    [409, "failed"],
    [415, "failed"],
  ] as const)("%s → %s", (status, outcome) => {
    expect(syncOutcome(status)).toBe(outcome);
  });
});

// ─── /api/ngo/field-tasks ────────────────────────────────────────────────────

describe("field tasks API", () => {
  const body = { projectId: "p1", title: "Photograph classroom", assignedToId: "u-field" };
  beforeEach(() => {
    prismaMock.project.findUnique.mockResolvedValue({ ngoId: "ngo-a", isDeleted: false, milestones: [{ id: "m1" }] });
    prismaMock.fieldTask.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "t1", ...data }));
  });

  it("an owner assigns a task to a team member", async () => {
    session("u-owner", "NGO");
    const res = await CREATE_TASK(json(body));
    expect(res.status).toBe(201);
    expect(prismaMock.fieldTask.create.mock.calls[0][0].data).toMatchObject({ ngoId: "ngo-a", assignedToId: "u-field", createdById: "u-owner" });
  });

  it("FIELD_STAFF cannot assign", async () => {
    session("u-field", "NGO");
    expect((await CREATE_TASK(json(body))).status).toBe(403);
  });

  it("another NGO's project is 404", async () => {
    session("u-other", "NGO");
    expect((await CREATE_TASK(json(body))).status).toBe(404);
    expect(prismaMock.fieldTask.create).not.toHaveBeenCalled();
  });

  it("cannot assign to someone outside the NGO", async () => {
    session("u-owner", "NGO");
    expect((await CREATE_TASK(json({ ...body, assignedToId: "u-other" }))).status).toBe(400);
  });

  it("cannot attach a milestone from another project", async () => {
    session("u-owner", "NGO");
    expect((await CREATE_TASK(json({ ...body, milestoneId: "m-foreign" }))).status).toBe(400);
  });

  it("field staff list only their own tasks; owners list all of their NGO's", async () => {
    prismaMock.fieldTask.findMany.mockResolvedValue([]);
    session("u-field", "NGO");
    await LIST_TASKS();
    expect(prismaMock.fieldTask.findMany.mock.calls[0][0].where).toMatchObject({ ngoId: "ngo-a", assignedToId: "u-field" });
    session("u-owner", "NGO");
    await LIST_TASKS();
    expect(prismaMock.fieldTask.findMany.mock.calls[1][0].where).toEqual({ ngoId: "ngo-a", status: { not: "CANCELLED" } });
  });
});

// ─── /api/field/evidence (sync) ──────────────────────────────────────────────

function captureRequest(extra: Record<string, string> = {}, photo: Uint8Array | null = JPEG) {
  const fd = new FormData();
  const fields = {
    clientId: "client-abcdef12",
    taskId: "t1",
    capturedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    latitude: "19.0760",
    longitude: "72.8777",
    note: "Classroom roof done",
    ...extra,
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (photo) fd.set("photo", new Blob([photo as BlobPart], { type: "image/jpeg" }), "x.jpg");
  return new Request("http://test", { method: "POST", body: fd });
}

describe("POST /api/field/evidence", () => {
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
  beforeEach(() => {
    prismaMock.fieldTask.findUnique.mockResolvedValue(TASK);
    prismaMock.fieldEvidence.findUnique.mockResolvedValue(null);
    prismaMock.beneficiaryFeedback.findUnique.mockResolvedValue(null);
    prismaMock.fieldEvidence.findMany.mockResolvedValue([]);
    prismaMock.milestoneProof.findMany.mockResolvedValue([]);
    prismaMock.fieldEvidence.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "ev-1", status: "PENDING_REVIEW", ...data }));
    prismaMock.beneficiaryFeedback.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "fb-1", ...data }));
  });

  it("the assignee syncs a capture: stored privately, GPS checked, task moves to SUBMITTED", async () => {
    session("u-field", "NGO");
    const res = await SYNC(captureRequest());
    expect(res.status).toBe(201);
    expect(uploadPrivateFile).toHaveBeenCalledWith(expect.any(Buffer), ".jpg", "field-evidence");
    const data = prismaMock.fieldEvidence.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ ngoId: "ngo-a", clientId: "client-abcdef12", locationStatus: "MATCH", photoMime: "image/jpeg" });
    expect(data.photoSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prismaMock.fieldTask.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { status: "SUBMITTED" } });
  });

  it("stores linked beneficiary feedback/consent in the same transaction", async () => {
    session("u-field", "NGO");
    const res = await SYNC(
      captureRequest({ hasFeedback: "true", consentMethod: "VERBAL", consentToRecord: "true", consentToSharePhoto: "true", beneficiaryRef: "HH-014" }),
    );
    expect(res.status).toBe(201);
    expect(prismaMock.beneficiaryFeedback.create.mock.calls[0][0].data).toMatchObject({
      evidenceId: "ev-1",
      ngoId: "ngo-a",
      consentToSharePhoto: true,
      beneficiaryRef: "HH-014",
    });
  });

  it("feedback alone (no photo) is accepted", async () => {
    session("u-field", "NGO");
    const res = await SYNC(captureRequest({ hasFeedback: "true", consentMethod: "WRITTEN", consentToRecord: "true" }, null));
    expect(res.status).toBe(201);
    expect(prismaMock.fieldEvidence.create).not.toHaveBeenCalled();
    expect(prismaMock.beneficiaryFeedback.create).toHaveBeenCalled();
  });

  it("replaying a synced capture returns the stored one and uploads nothing", async () => {
    session("u-field", "NGO");
    prismaMock.fieldEvidence.findUnique.mockResolvedValue({ id: "ev-1", ngoId: "ngo-a", status: "PENDING_REVIEW", locationStatus: "MATCH", duplicateOfId: null });
    const res = await SYNC(captureRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).replayed).toBe(true);
    expect(uploadPrivateFile).not.toHaveBeenCalled();
    expect(prismaMock.fieldEvidence.create).not.toHaveBeenCalled();
  });

  it("a concurrent duplicate sync loses on the unique key, cleans up its upload, and replays", async () => {
    session("u-field", "NGO");
    prismaMock.fieldEvidence.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "ev-1", ngoId: "ngo-a", status: "PENDING_REVIEW", locationStatus: "MATCH", duplicateOfId: null });
    prismaMock.fieldEvidence.create.mockRejectedValue({ code: "P2002" });
    const res = await SYNC(captureRequest());
    expect(res.status).toBe(200);
    expect(deletePrivateFile).toHaveBeenCalled();
  });

  const priorCapture = (o: { id?: string; ngoId?: string; projectId?: string; milestoneId?: string | null; taskId?: string }) => ({
    id: o.id ?? "ev-old",
    ngoId: o.ngoId ?? "ngo-a",
    projectId: o.projectId ?? "p1",
    milestoneId: o.milestoneId === undefined ? null : o.milestoneId,
    taskId: o.taskId ?? "t1",
    task: { title: "Earlier task", milestone: null },
  });

  it("flags a resubmitted photo and a GPS mismatch, without raising an alert for the resubmission", async () => {
    session("u-field", "NGO");
    prismaMock.fieldEvidence.findMany.mockResolvedValue([priorCapture({})]); // same task, no milestone
    await SYNC(captureRequest({ latitude: "28.61", longitude: "77.20" })); // Delhi, project is Mumbai
    expect(prismaMock.fieldEvidence.create.mock.calls[0][0].data).toMatchObject({
      duplicateOfId: "ev-old",
      duplicateVerdict: "RESUBMISSION",
      locationStatus: "MISMATCH",
    });
    expect(createFraudAlert).not.toHaveBeenCalled();
  });

  it("stores NONE when the photo is new, and searches both evidence tables", async () => {
    session("u-field", "NGO");
    await SYNC(captureRequest());
    const data = prismaMock.fieldEvidence.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ duplicateOfId: null, duplicateVerdict: "NONE" });
    expect(prismaMock.fieldEvidence.findMany.mock.calls[0][0].where).toEqual({ photoSha256: { in: [data.photoSha256] } });
    expect(prismaMock.milestoneProof.findMany.mock.calls[0][0].where).toEqual({ contentHashes: { hasSome: [data.photoSha256] } });
  });

  it("raises a HIGH alert when another NGO already used the photo", async () => {
    session("u-field", "NGO");
    prismaMock.fieldEvidence.findMany.mockResolvedValue([priorCapture({ id: "ev-b", ngoId: "ngo-b", projectId: "pb" })]);
    const res = await SYNC(captureRequest());
    expect(res.status).toBe(201);
    expect((await res.json()).evidence.duplicate).toBe(true);
    expect(createFraudAlert).toHaveBeenCalledTimes(1);
    const [type, entityId, entityType, description, severity] = (createFraudAlert as any).mock.calls[0];
    expect([type, entityId, entityType, severity]).toEqual(["PROOF_DUPLICATE_MEDIA", "ngo-a", "NGO", "HIGH"]);
    expect(description).toContain("field evidence ev-b");
  });

  it("raises a HIGH alert when a milestone proof on another project already used the photo", async () => {
    session("u-field", "NGO");
    prismaMock.milestoneProof.findMany.mockResolvedValue([
      { id: "proof-9", milestoneId: "m9", milestone: { title: "Handover", projectId: "p9", project: { ngoId: "ngo-a", ngo: { orgName: "Org A" } } } },
    ]);
    await SYNC(captureRequest());
    expect(prismaMock.fieldEvidence.create.mock.calls[0][0].data).toMatchObject({ duplicateVerdict: "CROSS_PROJECT", duplicateOfId: null });
    expect((createFraudAlert as any).mock.calls[0][4]).toBe("HIGH");
  });

  it("a failed duplicate lookup stores 'not checked' (null) and still saves the capture", async () => {
    session("u-field", "NGO");
    prismaMock.milestoneProof.findMany.mockRejectedValue(new Error("db blip"));
    const res = await SYNC(captureRequest());
    expect(res.status).toBe(201);
    expect(prismaMock.fieldEvidence.create.mock.calls[0][0].data.duplicateVerdict).toBeNull();
    expect(createFraudAlert).not.toHaveBeenCalled();
  });

  it("a failed sync raises no alert for a row that never committed", async () => {
    session("u-field", "NGO");
    prismaMock.fieldEvidence.findMany.mockResolvedValue([priorCapture({ id: "ev-b", ngoId: "ngo-b", projectId: "pb" })]);
    prismaMock.fieldEvidence.create.mockRejectedValue(new Error("write failed"));
    const res = await SYNC(captureRequest());
    expect(res.status).toBe(500);
    expect(createFraudAlert).not.toHaveBeenCalled();
  });

  it("another NGO's task is 404 and nothing is uploaded", async () => {
    session("u-other", "NGO");
    expect((await SYNC(captureRequest())).status).toBe(404);
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("field staff cannot submit against a task assigned to someone else", async () => {
    session("u-field2", "NGO");
    expect((await SYNC(captureRequest())).status).toBe(403);
  });

  it("a non-image upload is refused by its bytes", async () => {
    session("u-field", "NGO");
    expect((await SYNC(captureRequest({}, new Uint8Array(Buffer.from("%PDF-1.7 fake"))))).status).toBe(415);
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("a completed task takes no more evidence", async () => {
    session("u-field", "NGO");
    prismaMock.fieldTask.findUnique.mockResolvedValue({ ...TASK, status: "COMPLETED" });
    expect((await SYNC(captureRequest())).status).toBe(409);
  });
});

// ─── Photo access ────────────────────────────────────────────────────────────

describe("GET /api/field/evidence/[id]/photo", () => {
  const EV = {
    ngoId: "ngo-a",
    projectId: "p1",
    photoKey: "field-evidence/x.jpg",
    photoMime: "image/jpeg",
    status: "APPROVED",
    containsPeople: true,
    feedback: { consentToSharePhoto: true, withdrawnAt: null },
  };
  const get = () => PHOTO(new Request("http://test"), { params: { id: "ev-1" } });

  beforeEach(() => prismaMock.fieldEvidence.findUnique.mockResolvedValue(EV));

  it("the NGO's own team can read it", async () => {
    session("u-field", "NGO");
    expect((await get()).status).toBe(200);
  });

  it("another NGO gets 404", async () => {
    session("u-other", "NGO");
    expect((await get()).status).toBe(404);
  });

  it("a donor who funds the project sees approved + consented evidence", async () => {
    session("donor-a", "DONOR");
    prismaMock.contract.findFirst.mockResolvedValue({ id: "c1" });
    expect((await get()).status).toBe(200);
    expect(prismaMock.contract.findFirst.mock.calls[0][0].where).toMatchObject({ donorId: "donor-a", projectId: "p1" });
  });

  it("a donor who does not fund the project gets 404", async () => {
    session("donor-b", "DONOR");
    prismaMock.contract.findFirst.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });

  it("a funding donor still gets 404 without the beneficiary's consent", async () => {
    session("donor-a", "DONOR");
    prismaMock.contract.findFirst.mockResolvedValue({ id: "c1" });
    prismaMock.fieldEvidence.findUnique.mockResolvedValue({ ...EV, feedback: { consentToSharePhoto: false, withdrawnAt: null } });
    expect((await get()).status).toBe(404);
  });

  it("a funding donor gets 404 for unreviewed evidence", async () => {
    session("donor-a", "DONOR");
    prismaMock.contract.findFirst.mockResolvedValue({ id: "c1" });
    prismaMock.fieldEvidence.findUnique.mockResolvedValue({ ...EV, status: "PENDING_REVIEW" });
    expect((await get()).status).toBe(404);
  });
});

// ─── Admin review ────────────────────────────────────────────────────────────

describe("PATCH /api/admin/field-evidence/[id]", () => {
  const patch = (body: unknown) => REVIEW(json(body, "PATCH"), { params: { id: "ev-1" } });
  beforeEach(() => {
    prismaMock.fieldEvidence.findUnique.mockResolvedValue({
      id: "ev-1",
      status: "PENDING_REVIEW",
      taskId: "t1",
      projectId: "p1",
      containsPeople: false,
      feedback: null,
      task: { project: { title: "School" }, milestone: null },
    });
    prismaMock.fieldEvidence.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.contract.findMany = vi.fn().mockResolvedValue([]);
  });

  it("an NGO cannot review", async () => {
    session("u-owner", "NGO");
    expect((await patch({ decision: "APPROVE" })).status).toBe(403);
  });

  it("approve: compare-and-swap, task COMPLETED, audited with ids only", async () => {
    session("admin-1", "ADMIN");
    expect((await patch({ decision: "APPROVE" })).status).toBe(200);
    expect(prismaMock.fieldEvidence.updateMany.mock.calls[0][0].where).toEqual({ id: "ev-1", status: "PENDING_REVIEW" });
    expect(prismaMock.fieldTask.updateMany.mock.calls[0][0].data).toEqual({ status: "COMPLETED" });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "FIELD_EVIDENCE_REVIEWED", entityId: "ev-1", newValue: { status: "APPROVED" } }),
    );
    expect(JSON.stringify((logAdminAction as any).mock.calls[0][0].metadata)).not.toMatch(/@/);
  });

  it("request resubmission reopens the task", async () => {
    session("admin-1", "ADMIN");
    expect((await patch({ decision: "REQUEST_RESUBMIT", note: "GPS was off, retake on site" })).status).toBe(200);
    expect(prismaMock.fieldTask.updateMany.mock.calls[0][0]).toEqual({ where: { id: "t1", status: "SUBMITTED" }, data: { status: "OPEN" } });
  });

  it("a decided item cannot be reversed", async () => {
    session("admin-1", "ADMIN");
    prismaMock.fieldEvidence.findUnique.mockResolvedValue({ id: "ev-1", status: "APPROVED", taskId: "t1", projectId: "p1" });
    expect((await patch({ decision: "REJECT", note: "changed my mind" })).status).toBe(409);
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  it("losing a concurrent review is a 409 and is not audited", async () => {
    session("admin-1", "ADMIN");
    prismaMock.fieldEvidence.updateMany.mockResolvedValue({ count: 0 });
    expect((await patch({ decision: "APPROVE" })).status).toBe(409);
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});
