import { NextRequest, NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role, DonorCategory } from "@prisma/client";
import { DECLARATION_VERSION } from "@/lib/fcra-gate";

const VALID_CATEGORIES = new Set<DonorCategory>([
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

  await prisma.user.update({
    where: { id: auth.session.user.id },
    data: {
      donorCategory,
      donorCategoryDeclaredAt: new Date(),
      donorDeclarationVersion: DECLARATION_VERSION,
      nriSourceDeclaration:
        donorCategory === "INDIAN_ABROAD" ? nriSourceDeclaration : null,
    },
  });

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
