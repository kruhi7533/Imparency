import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * checkPANUsage was exported but never called by anything — dead code sitting
 * in the fraud module, which is a bad place for dead code because it reads like
 * a check that is running when it is not. It is now wired into the donor
 * profile route, the only path that writes User.panNumber.
 *
 * This is a genuinely different check from the NGO duplicate-identity check in
 * lib/verification-triage.ts: that one looks at NGOProfile, this one at User.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  fraudAlert: { create: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/fraud-investigator/trigger", () => ({ maybeInvestigate: vi.fn() }));

import { checkPANUsage } from "@/lib/fraud-alerts";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.fraudAlert.create.mockResolvedValue({ id: "alert-1" });
});

describe("checkPANUsage", () => {
  it("raises a HIGH alert when another account already uses this PAN", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "other-user" }]);

    await checkPANUsage("ABCDE1234F", "donor-1");

    expect(prismaMock.fraudAlert.create).toHaveBeenCalledTimes(1);
    const created = prismaMock.fraudAlert.create.mock.calls[0][0].data;
    expect(created.type).toBe("DUPLICATE_PAN_REGISTRATION");
    expect(created.severity).toBe("HIGH");
    expect(created.entityType).toBe("DONOR");
    // The alert must point at the donor being edited, not the other account.
    expect(created.entityId).toBe("donor-1");
  });

  it("excludes the donor's own account from the duplicate check", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);

    await checkPANUsage("ABCDE1234F", "donor-1");

    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ not: "donor-1" });
    expect(prismaMock.fraudAlert.create).not.toHaveBeenCalled();
  });

  it("does nothing when the PAN is empty", async () => {
    await checkPANUsage("", "donor-1");
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    expect(prismaMock.fraudAlert.create).not.toHaveBeenCalled();
  });

  it("never throws — a fraud check must not break a profile update", async () => {
    prismaMock.user.findMany.mockRejectedValue(new Error("db down"));
    await expect(checkPANUsage("ABCDE1234F", "donor-1")).resolves.toBeUndefined();
  });
});
