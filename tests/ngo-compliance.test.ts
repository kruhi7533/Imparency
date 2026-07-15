import { describe, it, expect } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import {
  computeCompliance,
  deriveFcraStatus,
  COMPLIANCE_WEIGHTS,
} from "@/lib/ngo-compliance";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

describe("computeCompliance", () => {
  const fullCompliance = {
    panVerified: true,
    registrationVerified: true,
    a12Verified: true,
    eightyGVerified: true,
    fcraStatus: "ACTIVE" as const,
  };

  it("weights sum to exactly 100", () => {
    const total = Object.values(COMPLIANCE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it("scores 100 when everything is verified", () => {
    const result = computeCompliance(fullCompliance, true);
    expect(result.score).toBe(100);
  });

  it("scores 0 with no compliance record", () => {
    const result = computeCompliance(null, false);
    expect(result.score).toBe(0);
    expect(result.fcraBadge).toBe("NONE");
  });

  it("scores each factor independently", () => {
    const result = computeCompliance(
      { ...fullCompliance, panVerified: false },
      true
    );
    expect(result.score).toBe(100 - COMPLIANCE_WEIGHTS.pan);
    expect(result.breakdown.pan).toBe(0);
    expect(result.breakdown.registration).toBe(COMPLIANCE_WEIGHTS.registration);
  });

  it("impact proof contributes its weight", () => {
    const withProof = computeCompliance(fullCompliance, true);
    const withoutProof = computeCompliance(fullCompliance, false);
    expect(withProof.score - withoutProof.score).toBe(COMPLIANCE_WEIGHTS.impact);
  });

  it("FCRA status does not affect the score, only the badge", () => {
    const active = computeCompliance(fullCompliance, true);
    const none = computeCompliance(
      { ...fullCompliance, fcraStatus: "NONE" as const },
      true
    );
    expect(active.score).toBe(none.score);
    expect(active.fcraBadge).toBe("ACTIVE");
    expect(none.fcraBadge).toBe("NONE");
  });
});

describe("deriveFcraStatus", () => {
  it("returns null when there is no expiry date", () => {
    expect(deriveFcraStatus(null)).toBeNull();
    expect(deriveFcraStatus(undefined)).toBeNull();
  });

  it("returns EXPIRED for past dates", () => {
    expect(deriveFcraStatus(daysFromNow(-1))).toBe("EXPIRED");
  });

  it("returns EXPIRING_SOON within the 90-day window", () => {
    expect(deriveFcraStatus(daysFromNow(89))).toBe("EXPIRING_SOON");
    expect(deriveFcraStatus(daysFromNow(1))).toBe("EXPIRING_SOON");
  });

  it("returns ACTIVE beyond 90 days", () => {
    expect(deriveFcraStatus(daysFromNow(91))).toBe("ACTIVE");
    expect(deriveFcraStatus(daysFromNow(365))).toBe("ACTIVE");
  });
});
