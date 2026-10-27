import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { effectiveAdminRole } from "@/lib/admin-roles";

export const runtime = "nodejs";

/**
 * The platform's admin team with each admin's sub-role. SUPER and AUDITOR may
 * read it (the sub-role gate in verifySessionRole refuses FINANCE/SUPPORT).
 * Read-only: changes go through PATCH /api/admin/users/[id], which is logged.
 */
export async function GET() {
  const { authorized, response } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;
  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, adminRole: true, createdAt: true },
    });
    return NextResponse.json({
      admins: admins.map((a) => ({ ...a, adminRole: effectiveAdminRole(a.adminRole), createdAt: a.createdAt.toISOString() })),
    });
  } catch {
    console.error("[admin/users] GET failed");
    return NextResponse.json({ error: "Could not load the admin team." }, { status: 500 });
  }
}
