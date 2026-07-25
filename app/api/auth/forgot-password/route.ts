import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sendPasswordResetEmail } from "@/lib/email";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Generic response used whether or not the email is registered, so the
// endpoint can't be used to enumerate which emails have accounts.
const GENERIC_MESSAGE =
  "If an account exists for this email, we've sent password reset instructions.";

export async function POST(request: Request) {
  const rl = await checkRateLimit(request, "auth/forgot-password", 5, 900);
  if (rl.isBlocked) return rl.response!;

  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    // Only send a reset link for accounts that actually have a password
    // (Google-only accounts are created with an empty passwordHash).
    if (user && user.passwordHash) {
      const token = crypto.randomBytes(32).toString("hex");

      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token,
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });

      const resetUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/reset-password?token=${token}`;
      await sendPasswordResetEmail(user.email, user.name, resetUrl);
    }

    return NextResponse.json({ success: true, message: GENERIC_MESSAGE });
  } catch (err: any) {
    console.error("Forgot Password Route Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
