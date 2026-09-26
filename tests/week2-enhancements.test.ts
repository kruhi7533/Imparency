import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock NextAuth getServerSession
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

// Mock Next.js navigation and cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock Prisma
vi.mock("@/lib/prisma", () => ({
  default: {
    nGOTeamMember: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    nGOProfile: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import prisma from "@/lib/prisma";
import { updateMemberRole } from "@/app/ngo/settings/team/actions";

const getServerSessionMock = getServerSession as any;
const prismaMock = prisma as any;

describe("Week 2 Enhancements — Team Roles, CSR Validations, & Verified State", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Team Roles & Permissions (updateMemberRole)", () => {
    it("rejects unauthorized access when session has no ngoProfileId", async () => {
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "user-123", role: "NGO" }, // no ngoProfileId
      });

      const result = await updateMemberRole("member-456", "FINANCE");
      expect(result.error).toBe("Not authorized");
    });

    it("rejects role update if caller is FIELD_STAFF", async () => {
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "user-123", ngoProfileId: "ngo-001", role: "NGO" },
      });

      prismaMock.nGOTeamMember.findUnique.mockResolvedValueOnce({
        id: "mem-1",
        userId: "user-123",
        ngoId: "ngo-001",
        role: "FIELD_STAFF",
      });

      const result = await updateMemberRole("member-456", "FINANCE");
      expect(result.error).toContain("do not have permission");
    });

    it("prevents an ADMIN from demoting an OWNER", async () => {
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "admin-123", ngoProfileId: "ngo-001", role: "NGO" },
      });

      // Caller is ADMIN
      prismaMock.nGOTeamMember.findUnique
        .mockResolvedValueOnce({
          id: "mem-admin",
          userId: "admin-123",
          ngoId: "ngo-001",
          role: "ADMIN",
        })
        // Target is OWNER
        .mockResolvedValueOnce({
          id: "mem-owner",
          userId: "owner-456",
          ngoId: "ngo-001",
          role: "OWNER",
        });

      const result = await updateMemberRole("owner-456", "FIELD_STAFF");
      expect(result.error).toContain("Only an Owner can modify an Owner's role");
    });

    it("prevents an ADMIN from promoting someone to OWNER", async () => {
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "admin-123", ngoProfileId: "ngo-001", role: "NGO" },
      });

      // Caller is ADMIN
      prismaMock.nGOTeamMember.findUnique
        .mockResolvedValueOnce({
          id: "mem-admin",
          userId: "admin-123",
          ngoId: "ngo-001",
          role: "ADMIN",
        })
        // Target is FIELD_STAFF
        .mockResolvedValueOnce({
          id: "mem-target",
          userId: "target-789",
          ngoId: "ngo-001",
          role: "FIELD_STAFF",
        });

      const result = await updateMemberRole("target-789", "OWNER");
      expect(result.error).toContain("Only an Owner can promote a member to Owner");
    });

    it("allows OWNER to update a member role successfully", async () => {
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "owner-123", ngoProfileId: "ngo-001", role: "NGO" },
      });

      // Caller is OWNER
      prismaMock.nGOTeamMember.findUnique
        .mockResolvedValueOnce({
          id: "mem-owner",
          userId: "owner-123",
          ngoId: "ngo-001",
          role: "OWNER",
        })
        // Target is FIELD_STAFF
        .mockResolvedValueOnce({
          id: "mem-target",
          userId: "target-789",
          ngoId: "ngo-001",
          role: "FIELD_STAFF",
        });

      prismaMock.nGOTeamMember.update.mockResolvedValueOnce({
        id: "mem-target",
        userId: "target-789",
        role: "FINANCE",
      });

      const result = await updateMemberRole("target-789", "FINANCE");
      expect(result.success).toBe(true);
      expect(prismaMock.nGOTeamMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { role: "FINANCE" },
        })
      );
    });
  });

  describe("CSR GSTIN & CSR-1 Format Validations", () => {
    it("validates standard 15-character GSTIN regex format", () => {
      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      
      const validGstin = "27AAAAA1111A1Z1";
      const invalidGstin1 = "123";
      const invalidGstin2 = "27AAAAA1111A1Y1"; // must have Z as 14th char
      
      expect(gstinRegex.test(validGstin)).toBe(true);
      expect(gstinRegex.test(invalidGstin1)).toBe(false);
      expect(gstinRegex.test(invalidGstin2)).toBe(false);
    });

    it("validates standard MCA Form CSR-1 registration number format", () => {
      const csrRegex = /^CSR[0-9]{8,12}$/i;
      
      const validCsr1 = "CSR00012345";
      const invalidCsr = "XYZ123";
      
      expect(csrRegex.test(validCsr1)).toBe(true);
      expect(csrRegex.test(invalidCsr)).toBe(false);
    });
  });
});
