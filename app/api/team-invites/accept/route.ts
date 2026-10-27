import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { acceptInvite, InviteError } from "@/lib/ngo-team-invites";
import { checkRateLimit } from "@/lib/rate-limiter";

/**
 * NGO-003: accept an invitation. New email → creates the account (name +
 * password) and the membership in one transaction. Existing account → must be
 * signed in as that email. Expired / revoked / used / unknown tokens are refused.
 */
export async function POST(request: Request) {
  const rl = await checkRateLimit(request, "team-invites/accept", 10, 600);
  if (rl.isBlocked) return rl.response;
  const body = await request.json().catch(() => ({}));
  const session = await getServerSession(authOptions);
  try {
    const result = await acceptInvite(body?.token, {
      sessionUserId: session?.user?.id ?? null,
      name: body?.name,
      password: body?.password,
    });
    return NextResponse.json({ ok: true, role: result.role, newAccount: result.newAccount, ...(result.newAccount ? { email: result.email } : {}) });
  } catch (err) {
    if (err instanceof InviteError) {
      return NextResponse.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, { status: err.status });
    }
    console.error("[team-invites/accept] failed:", (err as any)?.code ?? "error");
    return NextResponse.json({ error: "Could not accept the invitation." }, { status: 500 });
  }
}
