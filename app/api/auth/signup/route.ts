// DPDP Note: Consent for ACCOUNT_CREATION is captured client-side in
// app/login/page.tsx and logged via /api/consent/record after user creation.
// Do NOT create a user record if the client did not send consent first.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  try {
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

    // ── Auto-accept team invite if one exists for this email ──────────────
    try {
      // Check by token first (from invite link), then by email (catch-all)
      const invite = inviteToken
        ? await prisma.teamInvite.findUnique({ where: { token: inviteToken } })
        : await prisma.teamInvite.findFirst({
            where: {
              email: email.trim().toLowerCase(),
              accepted: false,
              expiresAt: { gt: new Date() },
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
