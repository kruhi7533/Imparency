import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Editing and cancelling a field task. Tenant isolation (another NGO's task is
 * a 404), role (owners/admins only), and the state rule: only an OPEN task
 * changes, with a compare-and-swap so a concurrent evidence sync wins.
 */

const db = vi.hoisted(() => ({
  fieldTask: { findUnique: vi.fn(), updateMany: vi.fn() },
  milestone: { findFirst: vi.fn() },
  nGOProfile: { findUnique: vi.fn() },
  nGOTeamMember: { findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { parseTaskEdit } from "@/lib/field-evidence";
import { PATCH } from "@/app/api/ngo/field-tasks/[id]/route";

const ctx = { params: { id: "task-1" } };
const req = (body: unknown) => new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) });

describe("parseTaskEdit", () => {
  it("accepts CANCEL and partial EDITs, and only the keys that were sent", () => {
    expect(parseTaskEdit({ action: "CANCEL" })).toEqual({ ok: true, value: { action: "CANCEL" } });
    const r = parseTaskEdit({ action: "EDIT", dueDate: "" , instructions: "  Bring the register  " });
    expect(r).toEqual({ ok: true, value: { action: "EDIT", changes: { dueDate: null, instructions: "Bring the register" } } });
  });

  it("rejects an unknown action, an empty edit, a short title and a bad date", () => {
    expect(parseTaskEdit({ action: "DELETE" }).ok).toBe(false);
    expect(parseTaskEdit({ action: "EDIT" }).ok).toBe(false);
    expect(parseTaskEdit({ action: "EDIT", title: "ab" }).ok).toBe(false);
    expect(parseTaskEdit({ action: "EDIT", dueDate: "not a date" }).ok).toBe(false);
    expect(parseTaskEdit({ action: "EDIT", assignedToId: "" }).ok).toBe(false);
  });
});

describe("PATCH /api/ngo/field-tasks/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue({ user: { id: "owner-a", role: "NGO" } });
    db.nGOProfile.findUnique.mockImplementation(async ({ where }: any) =>
      where.userId === "owner-a" ? { id: "ngo-a" } : null
    );
    db.nGOTeamMember.findFirst.mockResolvedValue(null);
    db.fieldTask.findUnique.mockResolvedValue({ id: "task-1", ngoId: "ngo-a", projectId: "proj-1", status: "OPEN" });
    db.fieldTask.updateMany.mockResolvedValue({ count: 1 });
  });

  it("the owner cancels an OPEN task with a compare-and-swap on OPEN", async () => {
    expect((await PATCH(req({ action: "CANCEL" }), ctx)).status).toBe(200);
    expect(db.fieldTask.updateMany).toHaveBeenCalledWith({ where: { id: "task-1", status: "OPEN" }, data: { status: "CANCELLED" } });
  });

  it("the owner edits title and due date; nothing else is written", async () => {
    expect((await PATCH(req({ action: "EDIT", title: "Photograph all 5 schools", dueDate: "2026-11-01" }), ctx)).status).toBe(200);
    const { data } = db.fieldTask.updateMany.mock.calls[0][0];
    expect(data).toEqual({ title: "Photograph all 5 schools", dueDate: new Date("2026-11-01") });
  });

  it("tenant isolation: another NGO's task is 404 and untouched", async () => {
    db.fieldTask.findUnique.mockResolvedValue({ id: "task-1", ngoId: "ngo-b", projectId: "proj-9", status: "OPEN" });
    expect((await PATCH(req({ action: "CANCEL" }), ctx)).status).toBe(404);
    expect(db.fieldTask.updateMany).not.toHaveBeenCalled();
  });

  it("field staff and finance cannot change tasks", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "staff-1", role: "NGO" } });
    for (const role of ["FIELD_STAFF", "FINANCE"]) {
      db.nGOTeamMember.findFirst.mockResolvedValue({ ngoId: "ngo-a", role });
      expect((await PATCH(req({ action: "CANCEL" }), ctx)).status).toBe(403);
    }
    expect(db.fieldTask.updateMany).not.toHaveBeenCalled();
  });

  it("a task with evidence awaiting review (SUBMITTED), or already closed, is 409", async () => {
    for (const status of ["SUBMITTED", "COMPLETED", "CANCELLED"]) {
      db.fieldTask.findUnique.mockResolvedValue({ id: "task-1", ngoId: "ngo-a", projectId: "proj-1", status });
      expect((await PATCH(req({ action: "CANCEL" }), ctx)).status).toBe(409);
    }
    expect(db.fieldTask.updateMany).not.toHaveBeenCalled();
  });

  it("evidence synced between read and write: the CAS misses and it is 409", async () => {
    db.fieldTask.updateMany.mockResolvedValue({ count: 0 });
    expect((await PATCH(req({ action: "EDIT", title: "New title" }), ctx)).status).toBe(409);
  });

  it("reassigning to someone outside the NGO, or onto another project's milestone, is refused", async () => {
    expect((await PATCH(req({ action: "EDIT", assignedToId: "stranger" }), ctx)).status).toBe(400);
    db.milestone.findFirst.mockResolvedValue(null);
    expect((await PATCH(req({ action: "EDIT", milestoneId: "ms-other" }), ctx)).status).toBe(400);
    expect(db.milestone.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "ms-other", projectId: "proj-1" } }));
    expect(db.fieldTask.updateMany).not.toHaveBeenCalled();
  });

  it("reassigning to a team member of this NGO works", async () => {
    db.nGOTeamMember.findFirst.mockImplementation(async ({ where }: any) =>
      where.userId === "field-1" && where.ngoId === "ngo-a" ? { id: "m-1" } : null
    );
    expect((await PATCH(req({ action: "EDIT", assignedToId: "field-1" }), ctx)).status).toBe(200);
  });
});
