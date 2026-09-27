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

// In development the dev server often isn't on NEXTAUTH_URL's port (next dev
// falls back to 3001 when 3000 is taken), which produced dead reset links, so
// use the origin the request actually came in on. In production, trust only the
// configured URL: building links from the Host header allows reset-link poisoning.
function resetBaseUrl(request: Request): string {
  const origin = new URL(request.url).origin;
  if (process.env.NODE_ENV !== "production") return origin;
  return process.env.NEXTAUTH_URL || origin;
}

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

      const resetUrl = `${resetBaseUrl(request)}/reset-password?token=${token}`;
      const sent = await sendPasswordResetEmail(user.email, user.name, resetUrl);
      if (!sent?.success) {
        console.error("Forgot Password: reset email failed to send:", sent?.error);
        return NextResponse.json(
          { error: "We couldn't send the reset email right now. Please try again in a few minutes." },
          { status: 503 }
        );
      }
    }

    return NextResponse.json({ success: true, message: GENERIC_MESSAGE });
  } catch (err: any) {
    console.error("Forgot Password Route Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
