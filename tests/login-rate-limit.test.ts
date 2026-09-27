import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

vi.mock("@/lib/prisma", () => ({ default: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/rate-limiter", () => ({
  rateLimit: vi.fn(async () => ({ success: true, limitRemaining: 4 })),
  isRateLimited: vi.fn(async () => false),
  clearRateLimit: vi.fn(async () => {}),
}));

import prisma from "@/lib/prisma";
import { rateLimit, isRateLimited, clearRateLimit } from "@/lib/rate-limiter";
import { authOptions } from "@/lib/auth";

// next-auth v4's CredentialsProvider keeps the user-supplied authorize() under `options`.
const authorize = (authOptions.providers[0] as any).options.authorize as (
  credentials: { email: string; password: string },
  req: unknown
) => Promise<any>;

const req = { headers: { "x-forwarded-for": "1.2.3.4" } };
const KEY = "1.2.3.4|donor@example.com";
const dbUser = {
  id: "user_1",
  email: "donor@example.com",
  name: "Dana Donor",
  passwordHash: bcrypt.hashSync("correct-password", 4),
  role: "DONOR",
  avatar: null,
  donorPersona: null,
  ngoProfile: null,
  teamMemberships: [],
};

describe("credentials login rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.user.findUnique as any).mockResolvedValue(dbUser);
  });

  it("keys the limit on IP + normalized email, not IP alone", async () => {
    await authorize({ email: " Donor@Example.com ", password: "correct-password" }, req);
    expect(isRateLimited).toHaveBeenCalledWith(KEY, "auth/login", 5, 900);
  });

  it("does not count a successful login, and clears the bucket", async () => {
    const user = await authorize({ email: "donor@example.com", password: "correct-password" }, req);
    expect(user.id).toBe("user_1");
    expect(rateLimit).not.toHaveBeenCalled();
    expect(clearRateLimit).toHaveBeenCalledWith(KEY, "auth/login");
  });

  it("counts a wrong password as a failure", async () => {
    await expect(
      authorize({ email: "donor@example.com", password: "wrong-password" }, req)
    ).rejects.toThrow("Invalid password");
    expect(rateLimit).toHaveBeenCalledWith(KEY, "auth/login", 5, 900);
    expect(clearRateLimit).not.toHaveBeenCalled();
  });

  it("counts an unknown email as a failure", async () => {
    (prisma.user.findUnique as any).mockResolvedValue(null);
    await expect(
      authorize({ email: "donor@example.com", password: "whatever-pass" }, req)
    ).rejects.toThrow("No user found");
    expect(rateLimit).toHaveBeenCalledWith(KEY, "auth/login", 5, 900);
  });

  it("blocks once the limit is reached, before checking the password", async () => {
    (isRateLimited as any).mockResolvedValueOnce(true);
    await expect(
      authorize({ email: "donor@example.com", password: "correct-password" }, req)
    ).rejects.toThrow(/Too many login attempts/);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
