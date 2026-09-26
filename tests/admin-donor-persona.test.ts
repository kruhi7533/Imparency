import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn(), requestMeta: vi.fn(() => ({})) }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { logAdminAction } from "@/lib/admin-log";
import { POST } from "@/app/api/admin/donors/[id]/persona/route";

const db = prisma as any;
const session = getServerSession as any;
const logMock = logAdminAction as any;

/**
 * Persona now gates whether a donor can fund an opportunity
 * (checkFunderEligibility requires CSR_OFFICER, FOUNDATION or GOVERNMENT).
 * Getting this wrong is not cosmetic, so the route needs the same rigor as
 * any other admin mutation: role guard, valid-enum guard, and an audit trail.
 */

function donor(overrides: Record<string, unknown> = {}) {
  return { id: "donor_1", role: "DONOR", donorPersona: null, ...overrides };
}

const ctx = { params: { id: "donor_1" } };
const req = (body: Record<string, unknown>) =>
  new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  db.user.findUnique.mockResolvedValue(donor());
  db.user.update.mockResolvedValue({});
});

describe("who may set a persona", () => {
  it("refuses an unauthenticated caller", async () => {
    session.mockResolvedValue(null);
    const res = await POST(req({ persona: "FOUNDATION" }), ctx);
    expect(res.status).toBe(401);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("refuses a non-admin caller", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "NGO" } });
    const res = await POST(req({ persona: "FOUNDATION" }), ctx);
    expect(res.status).toBe(403);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe("what may be set", () => {
  it("sets a valid persona and logs the change", async () => {
    const res = await POST(req({ persona: "FOUNDATION" }), ctx);
    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "donor_1" },
      data: { donorPersona: "FOUNDATION" },
    });
    expect(logMock.mock.calls[0][0].newValue).toEqual({ donorPersona: "FOUNDATION" });
  });

  it("rejects a value outside the enum", async () => {
    const res = await POST(req({ persona: "BILLIONAIRE" }), ctx);
    expect(res.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("404s a non-donor account", async () => {
    db.user.findUnique.mockResolvedValue(null);
    const res = await POST(req({ persona: "FOUNDATION" }), ctx);
    expect(res.status).toBe(404);
  });

  it("is a no-op, with no write and no log, when the persona is unchanged", async () => {
    db.user.findUnique.mockResolvedValue(donor({ donorPersona: "FOUNDATION" }));
    const res = await POST(req({ persona: "FOUNDATION" }), ctx);
    expect(res.status).toBe(200);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });
});
