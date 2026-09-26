import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    nGOProfile: { findUnique: vi.fn() },
    nGOFollower: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/ngo/[id]/follow/route";

const db = prisma as any;
const params = { params: { id: "ngo-1" } };
const call = () => POST(new Request("http://test/api/ngo/ngo-1/follow", { method: "POST" }), params);

describe("POST /api/ngo/[id]/follow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue({ user: { id: "donor-1" } });
    db.nGOProfile.findUnique.mockResolvedValue({ id: "ngo-1" });
  });

  it("rejects unauthenticated requests", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
  });

  it("follows when no follow row exists", async () => {
    db.nGOFollower.findUnique.mockResolvedValue(null);
    const res = await call();
    expect(await res.json()).toEqual({ success: true, followed: true });
    expect(db.nGOFollower.create).toHaveBeenCalledWith({ data: { donorId: "donor-1", ngoId: "ngo-1" } });
  });

  it("unfollows when a follow row exists", async () => {
    db.nGOFollower.findUnique.mockResolvedValue({ donorId: "donor-1", ngoId: "ngo-1" });
    const res = await call();
    expect(await res.json()).toEqual({ success: true, followed: false });
    expect(db.nGOFollower.delete).toHaveBeenCalled();
  });

  it("maps a stale session user id (FK violation) to a 401 with a re-login message", async () => {
    db.nGOFollower.findUnique.mockResolvedValue(null);
    db.nGOFollower.create.mockRejectedValue(Object.assign(new Error("FK"), { code: "P2003" }));
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/sign in again/i);
  });
});
