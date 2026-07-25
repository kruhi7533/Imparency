import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma
vi.mock("@/lib/prisma", () => ({
  default: {
    nGOProfile: { findUnique: vi.fn() },
    donorInquiry: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    donorInquiryMessage: { create: vi.fn() },
    $transaction: vi.fn((cb) => cb(prismaMock)),
  },
}));

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { GET, POST as CREATE_POST } from "@/app/api/ngo/[id]/inquiry/route";
import { POST as REPLY_POST } from "@/app/api/ngo/inquiries/[threadId]/reply/route";

const prismaMock = prisma as any;
const getSessionMock = getServerSession as any;

describe("Donor Inquiry API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/ngo/[id]/inquiry", () => {
    it("returns 401 if unauthorized", async () => {
      getSessionMock.mockResolvedValue(null);

      const res = await GET(new Request("http://localhost"), { params: { id: "ngo_1" } });
      expect(res.status).toBe(401);
    });

    it("returns thread details if authorized", async () => {
      getSessionMock.mockResolvedValue({ user: { id: "donor_1", role: "DONOR" } });
      const mockThread = { id: "thread_1", ngoId: "ngo_1", donorId: "donor_1", status: "OPEN", messages: [] };
      prismaMock.donorInquiry.findUnique.mockResolvedValue(mockThread);

      const res = await GET(new Request("http://localhost"), { params: { id: "ngo_1" } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.inquiry).toEqual(mockThread);
    });
  });

  describe("POST /api/ngo/[id]/inquiry", () => {
    it("returns 401 if unauthorized", async () => {
      getSessionMock.mockResolvedValue(null);

      const res = await CREATE_POST(
        new Request("http://localhost", { method: "POST", body: JSON.stringify({ body: "hello" }) }),
        { params: { id: "ngo_1" } }
      );
      expect(res.status).toBe(401);
    });

    it("creates a message and thread successfully", async () => {
      getSessionMock.mockResolvedValue({ user: { id: "donor_1", role: "DONOR" } });
      prismaMock.nGOProfile.findUnique.mockResolvedValue({ id: "ngo_1" });
      
      const mockResult = {
        id: "thread_1",
        ngoId: "ngo_1",
        donorId: "donor_1",
        status: "OPEN",
        messages: [{ id: "m_1", senderId: "donor_1", senderRole: "DONOR", body: "hello" }],
      };
      
      prismaMock.donorInquiry.upsert.mockResolvedValue({ id: "thread_1" });
      prismaMock.donorInquiry.findUnique.mockResolvedValue(mockResult);

      const res = await CREATE_POST(
        new Request("http://localhost", { method: "POST", body: JSON.stringify({ body: "hello" }) }),
        { params: { id: "ngo_1" } }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.inquiry).toEqual(mockResult);
    });
  });

  describe("POST /api/ngo/inquiries/[threadId]/reply", () => {
    it("returns 403 if sender is not NGO or ADMIN", async () => {
      getSessionMock.mockResolvedValue({ user: { id: "donor_1", role: "DONOR" } });

      const res = await REPLY_POST(
        new Request("http://localhost", { method: "POST", body: JSON.stringify({ body: "reply" }) }),
        { params: { threadId: "thread_1" } }
      );
      expect(res.status).toBe(403);
    });

    it("NGO replies and updates thread status successfully", async () => {
      getSessionMock.mockResolvedValue({ user: { id: "ngo_user_1", role: "NGO", ngoProfileId: "ngo_1" } });
      prismaMock.donorInquiry.findUnique.mockResolvedValue({ id: "thread_1", ngoId: "ngo_1" });
      
      const mockResult = {
        id: "thread_1",
        ngoId: "ngo_1",
        status: "RESPONDED",
        messages: [
          { id: "m_1", senderId: "donor_1", senderRole: "DONOR", body: "hello" },
          { id: "m_2", senderId: "ngo_user_1", senderRole: "NGO", body: "reply" },
        ],
      };
      prismaMock.donorInquiry.update.mockResolvedValue(mockResult);

      const res = await REPLY_POST(
        new Request("http://localhost", { method: "POST", body: JSON.stringify({ body: "reply" }) }),
        { params: { threadId: "thread_1" } }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.inquiry).toEqual(mockResult);
    });
  });
});
