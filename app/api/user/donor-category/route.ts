import { NextRequest, NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role, DonorCategory } from "@prisma/client";
import { DECLARATION_VERSION } from "@/lib/fcra-gate";

const VALID_CATEGORIES = new Set<string>([
  "INDIAN_IN_INDIA",
  "INDIAN_ABROAD",
  "FOREIGN_NATIONAL",
]);

const VALID_NRI_SOURCES = new Set([
  "ELIGIBLE_NRI_SOURCE",
  "FOREIGN_SOURCE",
  "NOT_SURE",
]);

export async function POST(req: NextRequest) {
  const auth = await verifySessionRole(Role.DONOR);
  if (!auth.authorized) return auth.response;

  const body = await req.json();
  const { donorCategory, nriSourceDeclaration } = body;

  if (!VALID_CATEGORIES.has(donorCategory)) {
    return NextResponse.json({ error: "Invalid donorCategory" }, { status: 400 });
  }

  if (donorCategory === "INDIAN_ABROAD" && !VALID_NRI_SOURCES.has(nriSourceDeclaration)) {
    return NextResponse.json(
      { error: "nriSourceDeclaration is required for INDIAN_ABROAD donors" },
      { status: 400 }
    );
  }

  const donorId = auth.session.user.id;

  // Snapshot the previous declaration for the event log + gate-evasion check
  const previous = await prisma.user.findUnique({
    where: { id: donorId },
    select: { donorCategory: true, nriSourceDeclaration: true },
  });

  await prisma.user.update({
    where: { id: donorId },
    data: {
      donorCategory,
      donorCategoryDeclaredAt: new Date(),
      donorDeclarationVersion: DECLARATION_VERSION,
      nriSourceDeclaration:
        donorCategory === "INDIAN_ABROAD" ? nriSourceDeclaration : null,
    },
  });

  // Append-only declaration history (who initiated + old/new values)
  try {
    const { logDonorEvent } = await import("@/lib/donor-events");
    await logDonorEvent({
      donorId,
      eventType: "CATEGORY_DECLARED",
      oldValue: previous
        ? { donorCategory: previous.donorCategory, nriSourceDeclaration: previous.nriSourceDeclaration }
        : null,
      newValue: {
        donorCategory,
        nriSourceDeclaration: donorCategory === "INDIAN_ABROAD" ? nriSourceDeclaration : null,
      },
      initiatedBy: donorId,
      source: "USER",
    });
  } catch (evtErr) {
    console.error("Failed to log donor category event:", evtErr);
  }

  // Gate-evasion signal: a donor whose previous category required FCRA
  // re-declaring as domestic is the textbook pattern for dodging the FCRA
  // gate. Surface it for admin review — don't block (declaration is legally
  // the donor's to make; the admin decides whether it's credible).
  try {
    const { donorRequiresFcra } = await import("@/lib/fcra-gate");
    const requiredBefore = donorRequiresFcra(previous?.donorCategory, previous?.nriSourceDeclaration);
    const requiresNow = donorRequiresFcra(donorCategory, nriSourceDeclaration);
    if (requiredBefore && !requiresNow) {
      const { createFraudAlert } = await import("@/lib/fraud-alerts");
      await createFraudAlert(
        "DONOR_CATEGORY_DOWNGRADE",
        donorId,
        "DONOR",
        `Donor changed declaration from ${previous?.donorCategory} to ${donorCategory}, ` +
          `moving out of FCRA scope. Verify this is a genuine circumstance change and not gate evasion.`,
        "MEDIUM",
        "FRAUD_ALERT"
      );
    }
  } catch (alertErr) {
    console.error("Failed to run category downgrade check:", alertErr);
  }

  return NextResponse.json({ ok: true, donorCategory });
}

export async function GET(req: NextRequest) {
  const auth = await verifySessionRole(Role.DONOR);
  if (!auth.authorized) return auth.response;

  const user = await prisma.user.findUnique({
    where: { id: auth.session.user.id },
    select: {
      donorCategory: true,
      donorCategoryDeclaredAt: true,
      donorDeclarationVersion: true,
      nriSourceDeclaration: true,
    },
  });

  return NextResponse.json(user);
}
