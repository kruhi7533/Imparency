import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { ADMIN_ROLES, effectiveAdminRole, type AdminRoleName } from "@/lib/admin-roles";

export const runtime = "nodejs";

/**
 * Change an admin's sub-role. SUPER only (explicitly here, and by the central
 * policy for every restricted role). Nobody changes their own role, so there
 * is always at least one SUPER left — the one making the change.
 * Takes effect within a minute: the JWT re-reads adminRole (lib/auth.ts).
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;
  if (effectiveAdminRole(session.user.adminRole) !== "SUPER") {
    return NextResponse.json({ error: "Only a super admin manages admin roles." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const next = body?.adminRole;
  if (!(ADMIN_ROLES as readonly string[]).includes(next)) {
    return NextResponse.json({ error: "adminRole must be one of SUPER, FINANCE, AUDITOR, SUPPORT." }, { status: 400 });
  }
  if (params.id === session.user.id) {
    return NextResponse.json({ error: "You cannot change your own admin role." }, { status: 400 });
  }
  try {
    const target = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true, role: true, adminRole: true } });
    if (!target || target.role !== "ADMIN") return NextResponse.json({ error: "Admin not found." }, { status: 404 });
    const before = effectiveAdminRole(target.adminRole);
    if (before === next) return NextResponse.json({ ok: true, adminRole: before, changed: false });
    await prisma.user.update({ where: { id: target.id }, data: { adminRole: next as AdminRoleName } });
    await logAdminAction({
      adminId: session.user.id,
      action: "ADMIN_ROLE_CHANGED",
      entityType: "ADMIN_USER",
      entityId: target.id,
      oldValue: { adminRole: before },
      newValue: { adminRole: next },
      request,
    });
    return NextResponse.json({ ok: true, adminRole: next, changed: true });
  } catch {
    console.error("[admin/users/[id]] PATCH failed");
    return NextResponse.json({ error: "Could not change the role." }, { status: 500 });
  }
}
