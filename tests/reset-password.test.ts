import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    passwordResetToken: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    user: { update: vi.fn() },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  },
}));
vi.mock("@/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })),
}));

import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limiter";
import { POST } from "@/app/api/auth/reset-password/route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets the password for a valid, unexpired, unused token", async () => {
    (prisma.passwordResetToken.findUnique as any).mockResolvedValue({
      id: "token_1",
      userId: "user_1",
      token: "valid-token",
      used: false,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await POST(request({ token: "valid-token", password: "newpassword123" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("invalidates every outstanding token for the user, not just the one redeemed", async () => {
    // A user who requested several reset emails has several live links. Once one
    // is redeemed the rest must die with it, or an older link could reset the
    // password again after the fact.
    (prisma.passwordResetToken.findUnique as any).mockResolvedValue({
      id: "token_2",
      userId: "user_1",
      token: "valid-token",
      used: false,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await POST(request({ token: "valid-token", password: "newpassword123" }));

    expect(res.status).toBe(200);
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user_1", used: false },
      data: { used: true },
    });
    // Not a single-row update scoped to the redeemed token.
    expect(prisma.passwordResetToken.update).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    (prisma.passwordResetToken.findUnique as any).mockResolvedValue({
      id: "token_1",
      userId: "user_1",
      token: "expired-token",
      used: false,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const res = await POST(request({ token: "expired-token", password: "newpassword123" }));
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an already-used token", async () => {
    (prisma.passwordResetToken.findUnique as any).mockResolvedValue({
      id: "token_1",
      userId: "user_1",
      token: "used-token",
      used: true,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await POST(request({ token: "used-token", password: "newpassword123" }));
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an unknown token", async () => {
    (prisma.passwordResetToken.findUnique as any).mockResolvedValue(null);

    const res = await POST(request({ token: "unknown-token", password: "newpassword123" }));
    expect(res.status).toBe(400);
  });

  it("rejects a password shorter than 8 characters", async () => {
    const res = await POST(request({ token: "valid-token", password: "short" }));
    expect(res.status).toBe(400);
    expect(prisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a missing token", async () => {
    const res = await POST(request({ password: "newpassword123" }));
    expect(res.status).toBe(400);
  });

  it("returns 429 when rate limited", async () => {
    (checkRateLimit as any).mockResolvedValueOnce({
      isBlocked: true,
      response: new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }),
    });

    const res = await POST(request({ token: "valid-token", password: "newpassword123" }));
    expect(res.status).toBe(429);
    expect(prisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });
});
