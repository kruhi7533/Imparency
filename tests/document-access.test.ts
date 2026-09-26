import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Access control on private documents.
 *
 * These files are scanned PAN cards, registration certificates, 12A/80G and
 * FCRA papers, and relief-initiative bank proofs. Before /api/documents existed
 * they were written into `public/uploads/` and served by Next as static assets
 * — no session, no role, no ownership check. This pins the replacement.
 *
 * The case that matters most is the third one: an NGO asking for a *different*
 * NGO's document. `verifySessionRole("NGO")` would happily let that through,
 * because role is not ownership.
 */

vi.mock("@/lib/prisma", () => ({
  default: { nGOProfile: { findFirst: vi.fn() } },
}));

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

vi.mock("fs/promises", () => ({
  default: { readFile: vi.fn() },
  readFile: vi.fn(),
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import fs from "fs/promises";
import { GET } from "@/app/api/documents/[...path]/route";

const prismaMock = prisma as any;
const getSessionMock = getServerSession as any;
const readFileMock = fs.readFile as any;

function get(segments: string[]) {
  return GET(new Request("http://localhost"), { params: { path: segments } });
}

const DOC = ["documents", "abc-123.pdf"];

describe("GET /api/documents/[...path]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileMock.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));
  });

  it("refuses an anonymous request with 401", async () => {
    getSessionMock.mockResolvedValue(null);

    const res = await get(DOC);

    expect(res.status).toBe(401);
    // The point of the whole route: nothing is read before authorisation.
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("serves any document to an admin", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });

    const res = await get(DOC);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    // A private document must never sit in a shared cache.
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("refuses an NGO asking for a document that is not on its own profile", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user_b", role: "NGO" } });
    // Org B's profile does not list this file — the ownership query finds nothing.
    prismaMock.nGOProfile.findFirst.mockResolvedValue(null);

    const res = await get(DOC);

    expect(res.status).toBe(403);
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("serves an NGO its own document", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user_a", role: "NGO" } });
    prismaMock.nGOProfile.findFirst.mockResolvedValue({ id: "ngo_a" });

    const res = await get(DOC);

    // Positive control — proves the 403 above came from the ownership check
    // rather than from NGOs being locked out of this route entirely.
    expect(res.status).toBe(200);
    expect(prismaMock.nGOProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_a", documents: { has: "/api/documents/documents/abc-123.pdf" } },
      })
    );
  });

  it("refuses a donor outright", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "donor_1", role: "DONOR" } });

    const res = await get(DOC);

    expect(res.status).toBe(403);
    expect(prismaMock.nGOProfile.findFirst).not.toHaveBeenCalled();
  });

  it("blocks path traversal out of the private root", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });

    // Admin is otherwise allowed everything, so a traversal that slipped past
    // would read arbitrary files off the server — .env included.
    const res = await get(["..", "..", ".env"]);

    expect(res.status).toBe(400);
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("returns 404 rather than 500 when the file is gone", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
    const enoent: any = new Error("no such file");
    enoent.code = "ENOENT";
    readFileMock.mockRejectedValue(enoent);

    const res = await get(DOC);

    expect(res.status).toBe(404);
  });

  it("does not render an unexpected file type inline as something executable", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });

    const res = await get(["documents", "payload.html"]);

    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });
});
