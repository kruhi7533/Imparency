import { describe, it, expect, vi } from "vitest";

// evaluateReceiptEligibility is pure, but tax-receipt.ts imports the Prisma
// client, PDF generator, storage, and mailer at module load — stub them all
// so the test needs no database, S3, or SMTP.
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/receipt-generator", () => ({ generateTaxReceiptPDF: vi.fn() }));
vi.mock("@/lib/storage", () => ({ uploadFile: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendTaxReceiptEmail: vi.fn(),
  sendPanReceiptNudgeEmail: vi.fn(),
}));

import { evaluateReceiptEligibility } from "@/lib/tax-receipt";

describe("evaluateReceiptEligibility", () => {
  it("is eligible only with a present, verified PAN", () => {
    expect(
      evaluateReceiptEligibility({ panStatus: "VERIFIED", panNumber: "ABCDE1234F" })
    ).toEqual({ eligible: true });
  });

  it("is ineligible without a PAN number, whatever the status says", () => {
    expect(
      evaluateReceiptEligibility({ panStatus: "VERIFIED", panNumber: null })
    ).toEqual({ eligible: false, reason: "NO_PAN" });
  });

  it("is ineligible while PAN is pending or failed", () => {
    expect(
      evaluateReceiptEligibility({ panStatus: "PENDING", panNumber: "ABCDE1234F" })
    ).toEqual({ eligible: false, reason: "PAN_NOT_VERIFIED" });
    expect(
      evaluateReceiptEligibility({ panStatus: "FAILED", panNumber: "ABCDE1234F" })
    ).toEqual({ eligible: false, reason: "PAN_NOT_VERIFIED" });
  });
});
