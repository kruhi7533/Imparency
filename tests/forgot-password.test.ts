import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    passwordResetToken: { create: vi.fn() },
  },
}));
vi.mock("@/lib/email", () => ({
  sendPasswordResetEmail: vi.fn(async () => ({ success: true })),
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

  it("builds the reset link from the request's origin in development, not NEXTAUTH_URL", async () => {
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "user_1", email: "donor@example.com", name: "Dana Donor", passwordHash: "hashed",
    });

    await POST(new Request("http://localhost:3001/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "donor@example.com" }),
    }));

    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      "donor@example.com",
      "Dana Donor",
      expect.stringMatching(/^http:\/\/localhost:3001\/reset-password\?token=/)
    );
    vi.unstubAllEnvs();
  });

  it("returns 503 instead of claiming success when the email fails to send", async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "user_1", email: "donor@example.com", name: "Dana Donor", passwordHash: "hashed",
    });
    (sendPasswordResetEmail as any).mockResolvedValueOnce({ success: false, error: "SMTP down" });

    const res = await POST(request({ email: "donor@example.com" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/couldn't send/i);
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
