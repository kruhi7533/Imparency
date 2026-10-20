import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * CSR policy on the donor profile (roadmap row 6). Focus areas come from the
 * matching sector list — an unknown one is refused, never silently dropped —
 * and the summary is bounded.
 */

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  donorEvent: { create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { PUT } from "@/app/api/donor/profile/route";

const put = (body: Record<string, unknown>) =>
  PUT(new Request("http://localhost", { method: "PUT", body: JSON.stringify({ name: "Acme CSR", donorPersona: "CSR_OFFICER", ...body }) }));

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as any).mockResolvedValue({ user: { id: "acme", role: "DONOR" } });
  db.user.findUnique.mockResolvedValue({ orgVerificationStatus: "NOT_SUBMITTED", companyName: null, cin: null, trustRegistrationId: null, donorPersona: "CSR_OFFICER" });
  db.user.update.mockImplementation(async ({ data }: any) => ({ id: "acme", ...data }));
});

describe("PUT /api/donor/profile — CSR policy", () => {
  it("saves a trimmed summary and de-duplicated focus areas", async () => {
    const res = await put({ csrPolicySummary: "  Education and health in Assam.  ", csrFocusAreas: ["Education", "Healthcare", "Education"] });
    expect(res.status).toBe(200);
    const data = db.user.update.mock.calls[0][0].data;
    expect(data.csrPolicySummary).toBe("Education and health in Assam.");
    expect(data.csrFocusAreas).toEqual(["Education", "Healthcare"]);
  });

  it("refuses a focus area outside the matching sector list", async () => {
    const res = await put({ csrFocusAreas: ["Education", "Space tourism"] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Space tourism");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("refuses an over-long summary; an empty one clears it", async () => {
    expect((await put({ csrPolicySummary: "x".repeat(4001) })).status).toBe(400);
    await put({ csrPolicySummary: "   " });
    expect(db.user.update.mock.calls[0][0].data.csrPolicySummary).toBeNull();
  });
});
