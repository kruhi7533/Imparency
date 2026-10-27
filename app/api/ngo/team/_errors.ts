import { NextResponse } from "next/server";
import { InviteError } from "@/lib/ngo-team-invites";

/** InviteError → structured JSON; anything else → a generic 500 (never err.message). */
export function inviteErrorResponse(err: unknown, scope: string) {
  if (err instanceof InviteError) {
    return NextResponse.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, { status: err.status });
  }
  console.error(`[${scope}] failed:`, (err as any)?.code ?? "error");
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
