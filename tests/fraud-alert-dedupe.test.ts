import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  fraudAlert: { create: vi.fn(), findFirst: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
const investigate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/fraud-investigator/trigger", () => ({ maybeInvestigate: investigate }));

import { createFraudAlert } from "@/lib/fraud-alerts";

/**
 * What these tests protect.
 *
 * Verification triage re-raises its whole finding set on every re-verification,
 * so one NGO with three document defects was accumulating three more rows each
 * run — the admin inbox showed nine rows for three real problems. The fix is a
 * dedupe in createFraudAlert itself, and it has to cut in exactly one place:
 * the SAME unresolved problem. An NGO failing three different checks is three
 * problems, and collapsing those would hide two of them.
 */

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.fraudAlert.findFirst.mockResolvedValue(null);
  prismaMock.fraudAlert.create.mockResolvedValue({ id: "alert_1" });
});

describe("raising the same problem twice", () => {
  it("creates the alert when nothing like it is open", async () => {
    await createFraudAlert("VERIFICATION_DEFECT", "ngo_1", "NGO", "PAN mismatch.", "HIGH");

    expect(prismaMock.fraudAlert.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.fraudAlert.create.mock.calls[0][0].data).toMatchObject({
      type: "VERIFICATION_DEFECT",
      entityId: "ngo_1",
      description: "PAN mismatch.",
      resolved: false,
    });
  });

  it("does not raise a second row for an identical open alert", async () => {
    prismaMock.fraudAlert.findFirst.mockResolvedValue({ id: "existing" });

    await createFraudAlert("VERIFICATION_DEFECT", "ngo_1", "NGO", "PAN mismatch.", "HIGH");

    expect(prismaMock.fraudAlert.create).not.toHaveBeenCalled();
  });

  it("looks for the duplicate on type, entity, description AND unresolved", async () => {
    await createFraudAlert("VERIFICATION_DEFECT", "ngo_1", "NGO", "PAN mismatch.", "HIGH");

    expect(prismaMock.fraudAlert.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          type: "VERIFICATION_DEFECT",
          entityId: "ngo_1",
          description: "PAN mismatch.",
          resolved: false,
        },
      })
    );
  });

  it("raises again once the earlier alert has been resolved", async () => {
    // A problem that recurs after someone closed it is genuinely new — the
    // dedupe is scoped to UNRESOLVED alerts for exactly this reason.
    prismaMock.fraudAlert.findFirst.mockResolvedValue(null); // nothing open
    await createFraudAlert("VERIFICATION_DEFECT", "ngo_1", "NGO", "PAN mismatch.", "HIGH");

    expect(prismaMock.fraudAlert.create).toHaveBeenCalledTimes(1);
  });
});

describe("what must NOT be deduped", () => {
  it("keeps distinct defects on the same organisation as separate alerts", async () => {
    // Tejamma's real case: name, registration and PAN all mismatched. Three
    // things to fix, so three rows — keying without description would show one.
    const defects = [
      "Organisation name does not match the registration form.",
      "Registration number does not match the registration form.",
      "PAN number does not match the registration form.",
    ];

    for (const d of defects) {
      await createFraudAlert("VERIFICATION_DEFECT", "ngo_1", "NGO", d, "HIGH");
    }

    expect(prismaMock.fraudAlert.create).toHaveBeenCalledTimes(3);
    expect(
      prismaMock.fraudAlert.create.mock.calls.map((c: any) => c[0].data.description)
    ).toEqual(defects);
  });

  it("keeps the same defect on different organisations as separate alerts", async () => {
    for (const ngoId of ["ngo_1", "ngo_2"]) {
      await createFraudAlert("VERIFICATION_DEFECT", ngoId, "NGO", "PAN mismatch.", "HIGH");
    }
    expect(prismaMock.fraudAlert.create).toHaveBeenCalledTimes(2);
  });

  it("keeps different alert types on one organisation as separate alerts", async () => {
    await createFraudAlert("VERIFICATION_DEFECT", "ngo_1", "NGO", "Same text.", "HIGH");
    await createFraudAlert("DUPLICATE_PAN_REGISTRATION", "ngo_1", "NGO", "Same text.", "HIGH");
    expect(prismaMock.fraudAlert.create).toHaveBeenCalledTimes(2);
  });
});

describe("the investigator", () => {
  it("is triggered for a genuinely new alert", async () => {
    await createFraudAlert("VERIFICATION_DEFECT", "ngo_1", "NGO", "PAN mismatch.", "HIGH");
    expect(investigate).toHaveBeenCalledWith("NGO", "ngo_1", "HIGH", "alert_1");
  });

  it("is not re-triggered by a duplicate", async () => {
    // The original alert already opened an investigation; a second trigger
    // would spend model budget re-investigating the same finding.
    prismaMock.fraudAlert.findFirst.mockResolvedValue({ id: "existing" });
    await createFraudAlert("VERIFICATION_DEFECT", "ngo_1", "NGO", "PAN mismatch.", "HIGH");
    expect(investigate).not.toHaveBeenCalled();
  });
});

describe("failure handling", () => {
  it("never throws — a fraud check must not break the flow that raised it", async () => {
    prismaMock.fraudAlert.findFirst.mockRejectedValue(new Error("db down"));
    await expect(
      createFraudAlert("VERIFICATION_DEFECT", "ngo_1", "NGO", "PAN mismatch.", "HIGH")
    ).resolves.toBeUndefined();
  });
});
