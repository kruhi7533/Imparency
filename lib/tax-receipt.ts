import prisma from "@/lib/prisma";
import { getFinancialYear, generateReceiptNumber, numberToIndianWords } from "@/lib/finance-utils";
import { generateTaxReceiptPDF, ReceiptData } from "@/lib/receipt-generator";
import { uploadFile } from "@/lib/storage";
import { sendTaxReceiptEmail, sendPanReceiptNudgeEmail } from "@/lib/email";

/**
 * 80G tax-receipt issuance, extracted from the Razorpay webhook so the webhook
 * and the donor "claim receipt" route share one implementation.
 *
 * Policy: a receipt is only issued once the donor's PAN is VERIFIED. This keeps
 * the platform from stamping legally-styled 80G documents against an unverified
 * (or absent) PAN.
 */

type DonorPanFields = { panStatus: string; panNumber: string | null };

export interface ReceiptEligibility {
  eligible: boolean;
  reason?: string;
}

/**
 * Pure check — is this donation eligible for a tax receipt right now?
 * Eligible ⇔ the donor's PAN is VERIFIED and present.
 */
export function evaluateReceiptEligibility(donor: DonorPanFields): ReceiptEligibility {
  if (!donor.panNumber) {
    return { eligible: false, reason: "NO_PAN" };
  }
  if (donor.panStatus !== "VERIFIED") {
    return { eligible: false, reason: "PAN_NOT_VERIFIED" };
  }
  return { eligible: true };
}

const formatDate = (date: Date): string => {
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

/**
 * Generate (or return the existing) 80G tax receipt for a SUCCESS donation.
 * Idempotent — a second call returns the already-issued receipt.
 *
 * Point-in-time: the receipt reflects the donation date (financial year and
 * receipt-number sequencing derive from `donation.createdAt`, not "now"), while
 * `issuedAt` records when the PDF was actually produced (they differ for
 * receipts claimed after PAN verification).
 */
export async function issueTaxReceipt(donationId: string) {
  const donation = await prisma.donation.findUnique({
    where: { id: donationId },
    include: {
      donor: true,
      project: { include: { ngo: true } },
      taxReceipt: true,
    },
  });

  if (!donation) throw new Error(`issueTaxReceipt: donation ${donationId} not found`);

  // Idempotency — never mint a second receipt for the same donation.
  if (donation.taxReceipt) return donation.taxReceipt;

  if (donation.status !== "SUCCESS") {
    throw new Error(`issueTaxReceipt: donation ${donationId} is not SUCCESS`);
  }

  const eligibility = evaluateReceiptEligibility(donation.donor);
  if (!eligibility.eligible) {
    throw new Error(`issueTaxReceipt: donation ${donationId} not eligible (${eligibility.reason})`);
  }

  // Financial year + sequence derive from the DONATION date (point-in-time).
  const financialYear = getFinancialYear(donation.createdAt);
  const existingCount = await prisma.taxReceipt.count({ where: { financialYear } });
  const receiptNumber = generateReceiptNumber(existingCount + 1, financialYear);
  const issuedAt = new Date();

  const receiptData: ReceiptData = {
    donorName: donation.donor.name,
    donorPan: donation.donor.panNumber!, // guaranteed by eligibility check
    donorAddress: donation.donor.city ?? "India",
    ngoName: donation.project.ngo.orgName,
    ngoPan: donation.project.ngo.panNumber,
    ngoRegistrationNumber: donation.project.ngo.registrationNumber,
    ngo80GNumber: `${donation.project.ngo.registrationNumber}/80G`,
    ngo80GValidityFrom: "AY 2022-23",
    ngo80GValidityTo: "AY 2026-27",
    ngoAddress: donation.project.ngo.address,
    donationId: donation.id,
    receiptNumber,
    amount: Number(donation.amount),
    amountInWords: numberToIndianWords(Number(donation.amount)),
    projectTitle: donation.project.title,
    financialYear,
    donationDate: formatDate(donation.createdAt),
    issuedAt: formatDate(issuedAt),
    paymentMode: "Online (Razorpay)",
  };

  const pdfBuffer = await generateTaxReceiptPDF(receiptData);
  const pdfUrl = await uploadFile(pdfBuffer, `receipt-${receiptNumber}.pdf`, "receipts");

  const receipt = await prisma.taxReceipt.create({
    data: { donationId: donation.id, receiptNumber, financialYear, pdfUrl },
  });

  await prisma.donation.update({
    where: { id: donation.id },
    data: { receiptUrl: pdfUrl },
  });

  await sendTaxReceiptEmail(
    donation.donor.email,
    donation.donor.name,
    donation.project.ngo.orgName,
    Number(donation.amount),
    receiptNumber,
    financialYear,
    pdfUrl
  );

  return receipt;
}

/**
 * When a donation succeeds but the donor's PAN isn't verified yet, we can't
 * issue an 80G receipt. Nudge the donor to add & verify their PAN so they can
 * claim it — and drop an in-app notification alongside the email.
 */
export async function queueReceiptClaim(donation: {
  id: string;
  donorId: string;
  amount: number | { toString(): string };
  donor: { email: string; name: string };
  project: { ngo: { orgName: string } };
}) {
  const amount = Number(donation.amount);

  await sendPanReceiptNudgeEmail(
    donation.donor.email,
    donation.donor.name,
    donation.project.ngo.orgName,
    amount
  );

  await prisma.notification.create({
    data: {
      userId: donation.donorId,
      type: "RECEIPT_PENDING_PAN",
      title: "Your 80G tax receipt is pending",
      body: `Your donation of ₹${amount.toLocaleString("en-IN")} to ${donation.project.ngo.orgName} was successful. Add and verify your PAN in your profile to generate your official 80G tax receipt.`,
    },
  });
}
