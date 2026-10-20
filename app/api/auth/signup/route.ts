// DPDP Note: Consent for ACCOUNT_CREATION is captured client-side in
// app/login/page.tsx and logged via /api/consent/record after user creation.
// Do NOT create a user record if the client did not send consent first.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { checkRateLimit } from "@/lib/rate-limiter";
import { acceptDonorInviteOnSignup } from "@/lib/donor-team-admin";

export async function POST(request: Request) {
  try {
    const rl = await checkRateLimit(request, "auth/signup", 5, 3600);
    if (rl.isBlocked) return rl.response;

    const { name, email, password, role, inviteToken } = await request.json();
    
    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    
    if (!["DONOR", "NGO"].includes(role)) {
      return NextResponse.json({ error: "Invalid role selected" }, { status: 400 });
    }

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json({ error: "A user is already registered with this email" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        passwordHash,
        role,
      },
    });

    // ── Donor organisation invite (lib/donor-team-admin.ts) ───────────────
    if (user.role === "DONOR") {
      const joined = await acceptDonorInviteOnSignup(user, typeof inviteToken === "string" ? inviteToken : null);
      if (joined) {
        return NextResponse.json({
          success: true,
          userId: user.id,
          joinedDonorTeam: true,
          message: "Account created and you've joined your organisation's CSR team.",
        });
      }
    }

    // ── Auto-accept team invite if one exists for this email ──────────────
    try {
      const now = new Date();
      const normalizedEmail = email.trim().toLowerCase();
      // Check by token (matching email and non-expired), or by email fallback
      const invite = inviteToken
        ? await prisma.teamInvite.findFirst({
            where: {
              token: inviteToken,
              email: normalizedEmail,
              accepted: false,
              expiresAt: { gt: now },
            },
          })
        : await prisma.teamInvite.findFirst({
            where: {
              email: normalizedEmail,
              accepted: false,
              expiresAt: { gt: now },
            },
          });

      if (invite && !invite.accepted) {
        // Add them to the NGO team
        await prisma.nGOTeamMember.create({
          data: {
            userId: user.id,
            ngoId: invite.ngoId,
            role: invite.role,
          },
        });

        // Mark invite as accepted
        await prisma.teamInvite.update({
          where: { id: invite.id },
          data: { accepted: true },
        });

        return NextResponse.json({
          success: true,
          userId: user.id,
          joinedNgo: true,
          message: "Account created and you've been added to your NGO team!",
        });
      }
    } catch (inviteErr) {
      // Non-fatal — user is still created
      console.warn("[signup] Invite auto-accept failed:", inviteErr);
    }

    return NextResponse.json({ success: true, userId: user.id });
  } catch (err: any) {
    console.error("Signup Route Error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
