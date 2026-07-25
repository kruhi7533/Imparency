import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    passwordResetToken: { create: vi.fn() },
  },
}));
vi.mock("@/lib/email", () => ({
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock("@/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })),
}));

import prisma from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limiter";
import { POST } from "@/app/api/auth/forgot-password/route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a reset email and returns the generic message for an existing password user", async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "user_1",
      email: "donor@example.com",
      name: "Dana Donor",
      passwordHash: "hashed",
    });

    const res = await POST(request({ email: "donor@example.com" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      "donor@example.com",
      "Dana Donor",
      expect.stringContaining("/reset-password?token=")
    );
  });

  it("returns the same generic message when no account exists, without sending an email", async () => {
    (prisma.user.findUnique as any).mockResolvedValue(null);

    const res = await POST(request({ email: "nobody@example.com" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("does not send a reset email for Google-only accounts (empty passwordHash)", async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "user_2",
      email: "oauth@example.com",
      name: "OAuth User",
      passwordHash: "",
    });

    const res = await POST(request({ email: "oauth@example.com" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("rejects requests missing an email", async () => {
    const res = await POST(request({}));
    expect(res.status).toBe(400);
  });

  it("returns 429 when rate limited", async () => {
    (checkRateLimit as any).mockResolvedValueOnce({
      isBlocked: true,
      response: new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }),
    });

    const res = await POST(request({ email: "donor@example.com" }));
    expect(res.status).toBe(429);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
