import { NextResponse } from "next/server";
import { lookupInvite } from "@/lib/ngo-team-invites";
import { checkRateLimit } from "@/lib/rate-limiter";

/**
 * NGO-003: what the accept page shows for a token. Public (the invitee may
 * have no account). POST so the secret travels in the body, not a query
 * string or access log. An unknown token reveals nothing but INVALID.
 */
export async function POST(request: Request) {
  const rl = await checkRateLimit(request, "team-invites/lookup", 30, 600);
  if (rl.isBlocked) return rl.response;
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json(await lookupInvite(body?.token));
  } catch {
    return NextResponse.json({ error: "Could not check the invitation." }, { status: 500 });
  }
}
