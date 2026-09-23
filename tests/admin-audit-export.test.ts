import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: { adminActionLog: { findMany: vi.fn() } },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/admin/audit/export/route";

const db = prisma as any;
const session = getServerSession as any;

/**
 * What these tests protect.
 *
 * The audit trail is the record an auditor reads when they do not trust the
 * platform. Two things must hold: only an admin can take a copy of it, and the
 * copy must honour the filters it claims to — a CSV silently capped or
 * silently unfiltered would be believed anyway.
 */

function req(query = "") {
  return new Request(`http://localhost/api/admin/audit/export${query}`) as any;
}

function log(overrides: Record<string, unknown> = {}) {
  return {
    id: "log_1",
    createdAt: new Date("2026-09-18T10:30:00.000Z"),
    admin: { name: "Ada Admin", email: "ada@example.org" },
    action: "NGO_APPROVED",
    entityType: "NGO",
    entityId: "ngo_1",
    note: null,
    oldValue: null,
    newValue: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  db.adminActionLog.findMany.mockResolvedValue([log()]);
});

describe("who may export the audit trail", () => {
  it("refuses an unauthenticated caller and reads nothing", async () => {
    session.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(db.adminActionLog.findMany).not.toHaveBeenCalled();
  });

  it("refuses an NGO caller and reads nothing", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "NGO" } });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(db.adminActionLog.findMany).not.toHaveBeenCalled();
  });

  it("refuses a DONOR caller and reads nothing", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "DONOR" } });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(db.adminActionLog.findMany).not.toHaveBeenCalled();
  });
});

describe("the exported file", () => {
  it("is served as a downloadable CSV", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="audit-trail-\d{4}-\d{2}-\d{2}\.csv"$/);
  });

  it("writes a header and one row per entry", async () => {
    db.adminActionLog.findMany.mockResolvedValue([log(), log({ id: "log_2", action: "NGO_REJECTED" })]);
    const lines = (await (await GET(req())).text()).split("\n");

    expect(lines[0]).toBe("When,Actor,Action,Entity Type,Entity ID,Note,Old Value,New Value");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"NGO_APPROVED"');
    expect(lines[2]).toContain('"NGO_REJECTED"');
  });

  it("names the platform when no admin took the action", async () => {
    // adminId is nullable precisely so platform-taken actions stay in the log.
    db.adminActionLog.findMany.mockResolvedValue([log({ admin: null })]);
    const csv = await (await GET(req())).text();
    expect(csv).toContain('"Platform"');
  });

  it("falls back to an admin's email when they have no name", async () => {
    db.adminActionLog.findMany.mockResolvedValue([log({ admin: { name: null, email: "ada@example.org" } })]);
    const csv = await (await GET(req())).text();
    expect(csv).toContain('"ada@example.org"');
  });

  it("escapes quotes and keeps commas and newlines inside one field", async () => {
    // An unescaped note would otherwise shift every later column in that row.
    db.adminActionLog.findMany.mockResolvedValue([
      log({ note: 'Rejected: said "we are 12A", comma, and\nnewline' }),
    ]);
    const csv = await (await GET(req())).text();
    expect(csv).toContain('"Rejected: said ""we are 12A"", comma, and\nnewline"');
  });

  it("serialises JSON change snapshots rather than printing [object Object]", async () => {
    db.adminActionLog.findMany.mockResolvedValue([
      log({ oldValue: { status: "PENDING" }, newValue: { status: "VERIFIED" } }),
    ]);
    const csv = await (await GET(req())).text();
    expect(csv).toContain('"{""status"":""PENDING""}"');
    expect(csv).toContain('"{""status"":""VERIFIED""}"');
  });
});

describe("filters", () => {
  it("exports everything when no filter is given", async () => {
    await GET(req());
    expect(db.adminActionLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, orderBy: { createdAt: "desc" } })
    );
  });

  it("applies the same filters the page uses", async () => {
    await GET(req("?action=APPROVED&entityType=NGO&actor=ada&from=2026-09-01&to=2026-09-18"));
    const { where } = db.adminActionLog.findMany.mock.calls[0][0];

    expect(where.action).toEqual({ contains: "APPROVED", mode: "insensitive" });
    expect(where.entityType).toBe("NGO");
    expect(where.admin.OR).toHaveLength(2);
    expect(where.createdAt.gte).toEqual(new Date("2026-09-01"));
    expect(where.createdAt.lte).toEqual(new Date("2026-09-18T23:59:59.999Z"));
  });

  it("is not limited to one page of results", async () => {
    // The page paginates at 50; an export of "every rejection in March" must not.
    await GET(req());
    const args = db.adminActionLog.findMany.mock.calls[0][0];
    expect(args.skip).toBeUndefined();
    expect(args.take).toBeGreaterThan(50);
  });
});

describe("when the log is larger than the cap", () => {
  it("says so in the file instead of returning a silently partial one", async () => {
    const take = 5001;
    db.adminActionLog.findMany.mockResolvedValue(
      Array.from({ length: take }, (_, i) => log({ id: `log_${i}` }))
    );

    const lines = (await (await GET(req())).text()).split("\n");
    expect(lines).toHaveLength(1 + 5000 + 1); // header + capped rows + the notice
    expect(lines[lines.length - 1]).toContain("Truncated at 5000 rows");
  });

  it("adds no notice when the result fits", async () => {
    const csv = await (await GET(req())).text();
    expect(csv).not.toContain("Truncated");
  });
});
