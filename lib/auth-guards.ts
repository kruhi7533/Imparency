import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { adminApiDecision, isRestrictedAdmin } from "@/lib/admin-roles";

/** Request headers middleware.ts stamps (and overwrites any client value of). */
export const METHOD_HEADER = "x-ib-method";
export const PATH_HEADER = "x-ib-path";

async function currentRequestLine(): Promise<{ method: string; path: string } | null> {
  try {
    const { headers } = await import("next/headers");
    const h = headers();
    const method = h.get(METHOD_HEADER);
    const path = h.get(PATH_HEADER);
    return method && path ? { method, path } : null;
  } catch {
    return null;
  }
}

/**
 * Admin sub-role gate (lib/admin-roles.ts), applied to EVERY verifySessionRole
 * call made by an ADMIN session — whatever role the route asked for — so an
 * auditor cannot write through a route that only checks `role === "ADMIN"`
 * after a bare verifySessionRole(). Fails CLOSED for a restricted admin when
 * the request line is unknown. SUPER admins (adminRole null) skip it entirely.
 */
async function adminSubRoleGate(session: any): Promise<NextResponse | null> {
  const user = session.user;
  if (user.role !== "ADMIN" || !isRestrictedAdmin(user.adminRole)) return null;
  const line = await currentRequestLine();
  if (!line) {
    return NextResponse.json({ error: "Forbidden", code: "ADMIN_ROLE_FORBIDDEN" }, { status: 403 });
  }
  const decision = adminApiDecision(user.adminRole, line.method, line.path);
  if (decision.kind === "allow") return null;
  if (decision.kind === "deny") {
    return NextResponse.json({ error: decision.reason, code: "ADMIN_ROLE_FORBIDDEN" }, { status: 403 });
  }
  const { recordGrantUse } = await import("@/lib/break-glass");
  const grantId = await recordGrantUse(user.id, decision.org, line);
  if (!grantId) {
    return NextResponse.json(
      { error: "This organisation needs a break-glass grant. Request one at /admin/break-glass.", code: "BREAK_GLASS_REQUIRED" },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Validates the current session and checks if the user has the required role.
 * If unauthorized or forbidden, returns a Next.js JSON response ready to be returned from the API route.
 * Otherwise, returns the session data.
 */
export async function verifySessionRole(requiredRole?: Role): Promise<
  | { authorized: true; response: null; session: any }
  | { authorized: false; response: NextResponse; session: null }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      session: null,
    };
  }

  if (requiredRole && session.user.role !== requiredRole) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      session: null,
    };
  }

  const gated = await adminSubRoleGate(session);
  if (gated) return { authorized: false, response: gated, session: null };

  return {
    authorized: true,
    response: null,
    session,
  };
}
