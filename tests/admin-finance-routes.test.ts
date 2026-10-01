import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    financeException: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/reconciliation", () => ({ runReconciliation: vi.fn() }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { logAdminAction } from "@/lib/admin-log";
import { runReconciliation } from "@/lib/reconciliation";
import { POST as reconcile } from "@/app/api/admin/finance/reconcile/route";
import { PATCH as resolveException } from "@/app/api/admin/finance/exceptions/[id]/route";

const db = prisma as any;
const session = getServerSession as any;
const reconciler = runReconciliation as any;
const audit = logAdminAction as any;

/**
 * What these tests protect.
 *
 * Two admin surfaces onto the money: one that says the books were checked, and
 * one that says a discrepancy has been answered for. Both are claims an
 * auditor will later rely on, so both must be admin-only, both must be
 * audited, and neither may be made twice for the same thing.
 */

function req(body?: unknown) {
  return new Request("http://localhost/api/admin/finance", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  reconciler.mockResolvedValue({
    runId: "run_1",
    projectsChecked: 3,
    donorsChecked: 2,
    donationsChecked: 5,
    opened: 1,
    recurred: 0,
    autoResolved: 0,
  });
  db.financeException.findUnique.mockResolvedValue({
    id: "exc_1",
    status: "OPEN",
    type: "PROJECT_TOTAL_MISMATCH",
  });
  db.financeException.updateMany.mockResolvedValue({ count: 1 });
});

describe("running reconciliation", () => {
  it("refuses an unauthenticated caller and runs nothing", async () => {
    session.mockResolvedValue(null);
    const res = await reconcile(req());
    expect(res.status).toBe(401);
    expect(reconciler).not.toHaveBeenCalled();
  });

  it("refuses a non-admin", async () => {
    session.mockResolvedValue({ user: { id: "ngo_1", role: "NGO" } });
    const res = await reconcile(req());
    expect(res.status).toBe(403);
    expect(reconciler).not.toHaveBeenCalled();
  });

  it("logs the run with counts only, never entity ids", async () => {
    const res = await reconcile(req());

    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: "admin_1",
        action: "RECONCILIATION_RUN",
        entityType: "RECONCILIATION_RUN",
        entityId: "run_1",
        metadata: expect.objectContaining({ projectsChecked: 3, opened: 1, failed: false }),
      }),
    );
  });

  it("answers 5xx for a failed run so it cannot be read as a clean bill of health", async () => {
    reconciler.mockResolvedValue({
      runId: "run_2",
      projectsChecked: 0,
      donorsChecked: 0,
      donationsChecked: 0,
      opened: 0,
      recurred: 0,
      autoResolved: 0,
      error: "Reconciliation run failed",
    });

    const res = await reconcile(req());

    expect(res.status).toBe(500);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ failed: true }) }),
    );
  });
});

describe("resolving a finance exception", () => {
  const params = { params: { id: "exc_1" } };

  it("refuses a non-admin before touching the row", async () => {
    session.mockResolvedValue({ user: { id: "donor_1", role: "DONOR" } });
    const res = await resolveException(req({ note: "handled" }), params);
    expect(res.status).toBe(403);
    expect(db.financeException.updateMany).not.toHaveBeenCalled();
  });

  it("requires a note — closing a money discrepancy silently is hiding it", async () => {
    const res = await resolveException(req({ note: "   " }), params);
    expect(res.status).toBe(400);
    expect(db.financeException.updateMany).not.toHaveBeenCalled();
  });

  it("404s on an exception that does not exist", async () => {
    db.financeException.findUnique.mockResolvedValue(null);
    const res = await resolveException(req({ note: "handled" }), params);
    expect(res.status).toBe(404);
  });

  it("resolves an open exception and audits who said so", async () => {
    const res = await resolveException(req({ note: "Refunded to the donor, ref RFD-9" }), params);

    expect(res.status).toBe(200);
    expect(db.financeException.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "exc_1", status: "OPEN" },
        data: expect.objectContaining({ resolvedById: "admin_1" }),
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "FINANCE_EXCEPTION_RESOLVED",
        entityType: "FINANCE_EXCEPTION",
        entityId: "exc_1",
        note: "Refunded to the donor, ref RFD-9",
      }),
    );
  });

  it("409s rather than overwriting a resolution another admin already wrote", async () => {
    // Compare-and-swap on OPEN: the loser of the race is told, not silently
    // ignored, and their note does not replace the first one.
    db.financeException.updateMany.mockResolvedValue({ count: 0 });

    const res = await resolveException(req({ note: "second opinion" }), params);

    expect(res.status).toBe(409);
    expect(audit).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const bad = new Request("http://localhost/api/admin/finance", {
      method: "POST",
      body: "not json",
    }) as any;
    const res = await resolveException(bad, params);
    expect(res.status).toBe(400);
  });
});
