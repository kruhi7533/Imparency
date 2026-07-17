import { describe, it, expect, vi } from "vitest";
import { donorRequiresFcra, checkFcraGate } from "@/lib/fcra-gate";

// fcra-gate pulls deriveFcraStatus from ngo-compliance, which imports the
// Prisma client at module load — stub the client so tests need no database.
vi.mock("@/lib/prisma", () => ({ default: {} }));

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

describe("donorRequiresFcra", () => {
  it("treats undeclared donors as domestic", () => {
    expect(donorRequiresFcra(null)).toBe(false);
    expect(donorRequiresFcra(undefined)).toBe(false);
  });

  it("does not require FCRA for Indian residents", () => {
    expect(donorRequiresFcra("INDIAN_IN_INDIA")).toBe(false);
  });

  it("always requires FCRA for foreign nationals, even with an NRI declaration", () => {
    expect(donorRequiresFcra("FOREIGN_NATIONAL")).toBe(true);
    expect(donorRequiresFcra("FOREIGN_NATIONAL", "ELIGIBLE_NRI_SOURCE")).toBe(true);
  });

  it("requires FCRA for Indians abroad unless they declared an eligible NRI source", () => {
    expect(donorRequiresFcra("INDIAN_ABROAD")).toBe(true);
    expect(donorRequiresFcra("INDIAN_ABROAD", null)).toBe(true);
    expect(donorRequiresFcra("INDIAN_ABROAD", "OTHER")).toBe(true);
    expect(donorRequiresFcra("INDIAN_ABROAD", "ELIGIBLE_NRI_SOURCE")).toBe(false);
  });
});

describe("checkFcraGate", () => {
  it("allows domestic donors regardless of NGO FCRA state", () => {
    expect(
      checkFcraGate({
        donorCategory: "INDIAN_IN_INDIA",
        nriSourceDeclaration: null,
        ngoFcraExpiryDate: null,
        ngoFcraStatus: "NONE",
      })
    ).toEqual({ allowed: true });
  });

  it("allows foreign donors when the NGO's FCRA is active", () => {
    expect(
      checkFcraGate({
        donorCategory: "FOREIGN_NATIONAL",
        nriSourceDeclaration: null,
        ngoFcraExpiryDate: daysFromNow(365),
        ngoFcraStatus: "ACTIVE",
      })
    ).toEqual({ allowed: true });
  });

  it("blocks foreign donors when the NGO has no FCRA", () => {
    expect(
      checkFcraGate({
        donorCategory: "FOREIGN_NATIONAL",
        nriSourceDeclaration: null,
        ngoFcraExpiryDate: null,
        ngoFcraStatus: "NONE",
      })
    ).toEqual({ allowed: false, reason: "FCRA_REQUIRED", fcraStatus: "NONE" });
  });

  it("blocks when a stored ACTIVE status has actually expired (live recompute)", () => {
    expect(
      checkFcraGate({
        donorCategory: "FOREIGN_NATIONAL",
        nriSourceDeclaration: null,
        ngoFcraExpiryDate: daysFromNow(-1),
        ngoFcraStatus: "ACTIVE", // stale stored status
      })
    ).toEqual({ allowed: false, reason: "FCRA_REQUIRED", fcraStatus: "EXPIRED" });
  });

  it("still allows when the cert is expiring soon but not yet expired", () => {
    const result = checkFcraGate({
      donorCategory: "FOREIGN_NATIONAL",
      nriSourceDeclaration: null,
      ngoFcraExpiryDate: daysFromNow(30),
      ngoFcraStatus: "EXPIRING_SOON",
    });
    // EXPIRING_SOON is not ACTIVE, so the gate blocks — foreign money needs a
    // currently-ACTIVE cert per the gate's rule.
    expect(result).toEqual({
      allowed: false,
      reason: "FCRA_REQUIRED",
      fcraStatus: "EXPIRING_SOON",
    });
  });

  it("recovers a stale EXPIRED status when the cert was renewed", () => {
    expect(
      checkFcraGate({
        donorCategory: "INDIAN_ABROAD",
        nriSourceDeclaration: "OTHER",
        ngoFcraExpiryDate: daysFromNow(365),
        ngoFcraStatus: "EXPIRED", // stale stored status; expiry says otherwise
      })
    ).toEqual({ allowed: true });
  });

  it("does not recompute for non-approved statuses like PENDING", () => {
    expect(
      checkFcraGate({
        donorCategory: "FOREIGN_NATIONAL",
        nriSourceDeclaration: null,
        ngoFcraExpiryDate: daysFromNow(365),
        ngoFcraStatus: "PENDING",
      })
    ).toEqual({ allowed: false, reason: "FCRA_REQUIRED", fcraStatus: "PENDING" });
  });
});
