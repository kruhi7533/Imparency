import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Week 7 donor — "approved notifications + opt-out".
 *
 *  - an opted-out funding donor receives nothing (no in-app row, no push);
 *  - the preference route only ever touches the caller's own row, only for
 *    DONOR sessions, and sets (never toggles) so a retry is harmless.
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    contract: { findMany: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/notification", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { sendPushNotification } from "@/lib/notification";
import { notifiableDonorIds, notifyContractDonors } from "@/lib/contract-donor-updates";
import { GET, PATCH } from "@/app/api/donor/notification-preferences/route";

const prismaMock = prisma as any;
const session = (id: string, role: string) => (getServerSession as any).mockResolvedValue({ user: { id, role } });
const patch = (body: unknown) =>
  PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  vi.clearAllMocks();
  (sendPushNotification as any).mockResolvedValue(undefined);
});

describe("notifiableDonorIds", () => {
  it("excludes opted-out donors in the query itself", async () => {
    prismaMock.contract.findMany.mockResolvedValue([{ donorId: "d1" }, { donorId: "d1" }]);
    expect(await notifiableDonorIds("p1")).toEqual(["d1"]);
    expect(prismaMock.contract.findMany.mock.calls[0][0].where).toEqual({
      projectId: "p1",
      status: { in: ["ACTIVE", "COMPLETED"] },
      donor: { projectUpdatesOptOut: false },
    });
  });

  it("sends nothing when every funding donor opted out", async () => {
    prismaMock.contract.findMany.mockResolvedValue([]);
    expect(await notifyContractDonors("p1", "t", "b")).toEqual({ notified: 0, failed: 0 });
    expect(sendPushNotification).not.toHaveBeenCalled();
  });
});

describe("/api/donor/notification-preferences", () => {
  it("GET reports the caller's preference", async () => {
    session("d1", "DONOR");
    prismaMock.user.findUnique.mockResolvedValue({ projectUpdatesOptOut: true });
    const res = await GET();
    expect(await res.json()).toEqual({ projectUpdates: false });
    expect(prismaMock.user.findUnique.mock.calls[0][0].where).toEqual({ id: "d1" });
  });

  it("PATCH sets the caller's own row only", async () => {
    session("d1", "DONOR");
    const res = await patch({ projectUpdates: false, userId: "someone-else" });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { projectUpdatesOptOut: true } });
  });

  it("PATCH is a set, not a toggle: repeating it changes nothing further", async () => {
    session("d1", "DONOR");
    await patch({ projectUpdates: true });
    await patch({ projectUpdates: true });
    expect(prismaMock.user.update.mock.calls.map((c: any) => c[0].data)).toEqual([
      { projectUpdatesOptOut: false },
      { projectUpdatesOptOut: false },
    ]);
  });

  it("rejects a non-boolean value", async () => {
    session("d1", "DONOR");
    expect((await patch({ projectUpdates: "no" })).status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("is DONOR-only", async () => {
    session("n1", "NGO");
    expect((await patch({ projectUpdates: false })).status).toBe(403);
    (getServerSession as any).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
});
