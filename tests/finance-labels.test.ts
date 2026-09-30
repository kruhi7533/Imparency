import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    donation: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    project: { findMany: vi.fn() },
  },
}));

import prisma from "@/lib/prisma";
import { donorDisplayName, loadFinanceLabels, shortId } from "@/lib/finance-labels";

const db = prisma as any;

/**
 * What these tests protect.
 *
 * Names are resolved for DISPLAY and never stored on a ledger or exception
 * row — that separation is the privacy rule, and it only holds if this lookup
 * stays a read. The other risk is volume: resolving per row would put an N+1
 * behind the finance page, so the batching is asserted too.
 */

beforeEach(() => {
  vi.clearAllMocks();
  db.donation.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
  db.project.findMany.mockResolvedValue([]);
});

describe("loadFinanceLabels", () => {
  it("resolves a donation to both of its ends", async () => {
    db.donation.findMany.mockResolvedValue([
      { id: "don_1", donorId: "user_1", projectId: "proj_1" },
    ]);
    db.user.findMany.mockResolvedValue([{ id: "user_1", name: "Asha Mehta", email: "a@example.org" }]);
    db.project.findMany.mockResolvedValue([
      { id: "proj_1", title: "Clean Water", ngoId: "ngo_1", ngo: { orgName: "Jal Trust" } },
    ]);

    const labels = await loadFinanceLabels({ donationIds: ["don_1"] });

    expect(labels.donations.get("don_1")).toEqual({ donorId: "user_1", projectId: "proj_1" });
    expect(labels.donors.get("user_1")).toBe("Asha Mehta");
    expect(labels.projects.get("proj_1")).toMatchObject({ title: "Clean Water", orgName: "Jal Trust" });
  });

  it("issues one query per table however many rows are shown", async () => {
    db.donation.findMany.mockResolvedValue([
      { id: "don_1", donorId: "user_1", projectId: "proj_1" },
      { id: "don_2", donorId: "user_2", projectId: "proj_1" },
    ]);

    await loadFinanceLabels({
      donationIds: ["don_1", "don_2"],
      donorIds: ["user_3", "user_3"],
      projectIds: ["proj_2"],
    });

    expect(db.donation.findMany).toHaveBeenCalledTimes(1);
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    expect(db.project.findMany).toHaveBeenCalledTimes(1);
    // De-duplicated, and the ids reached through the donations are included.
    expect(db.user.findMany.mock.calls[0][0].where.id.in.sort()).toEqual([
      "user_1",
      "user_2",
      "user_3",
    ]);
  });

  it("queries nothing when there is nothing to resolve", async () => {
    const labels = await loadFinanceLabels({ donorIds: [null, undefined, ""] });
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(labels.donors.size).toBe(0);
  });

  it("never asks for more than the fields it shows", async () => {
    await loadFinanceLabels({ donorIds: ["user_1"] });
    // A finance view has no business pulling a donor's PAN or address.
    expect(db.user.findMany.mock.calls[0][0].select).toEqual({ id: true, name: true, email: true });
  });
});

describe("donorDisplayName", () => {
  it("prefers the name", () => {
    expect(donorDisplayName({ name: "Asha Mehta", email: "a@example.org" })).toBe("Asha Mehta");
  });

  it("falls back to the local part only, never the whole address", () => {
    // Enough to tell two donors apart; not a mailing list.
    expect(donorDisplayName({ name: null, email: "asha@example.org" })).toBe("asha…");
    expect(donorDisplayName({ name: "  ", email: "asha@example.org" })).not.toContain("@");
  });

  it("degrades to a placeholder rather than rendering blank", () => {
    expect(donorDisplayName({})).toBe("Unknown donor");
  });
});

describe("shortId", () => {
  it("keeps enough of a uuid to search with", () => {
    expect(shortId("f7da6928-b098-46e4-9d60-55918909c1e7")).toBe("f7da6928…");
    expect(shortId(null)).toBe("—");
  });
});
