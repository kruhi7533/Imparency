import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limiter";

export async function POST(request: Request) {
  const rl = await checkRateLimit(request, "auth/reset-password", 10, 900);
  if (rl.isBlocked) return rl.response!;

  try {
    const { token, password } = await request.json();

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Reset token is required" }, { status: 400 });
    }

    if (!password || typeof password !== "string" || password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (
      !resetToken ||
      resetToken.used ||
      resetToken.expiresAt < new Date()
    ) {
      return NextResponse.json(
        { error: "This reset link is invalid or has expired" },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      // Burn every outstanding token for this user, not just the one redeemed.
      // A user who clicked "forgot password" three times has three live links;
      // if only the redeemed one were marked used, the older links would still
      // reset the password again after this change.
      prisma.passwordResetToken.updateMany({
        where: { userId: resetToken.userId, used: false },
        data: { used: true },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Reset Password Route Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
