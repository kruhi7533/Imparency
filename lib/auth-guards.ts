import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";

/**
 * Validates the current session and checks if the user has the required role.
 * If unauthorized or forbidden, returns a Next.js JSON response ready to be returned from the API route.
 * Otherwise, returns the session data.
 */
export async function verifySessionRole(requiredRole?: Role) {
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

  return {
    authorized: true,
    response: null,
    session,
  };
}
