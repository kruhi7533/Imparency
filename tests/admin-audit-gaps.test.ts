import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What these tests protect.
 *
 * The routes closed under NFR-2 — the ones that changed state, spent money on
 * a model, or moved data out of the platform without leaving a record of who
 * did it.
 *
 * The structural guard in admin-audit-coverage.test.ts asserts only that these
 * routes *call* logAdminAction. That is deliberately shallow: it cannot tell a
 * correct log from a useless one. These tests assert the thing an auditor
 * actually needs — the right actor, the right action, the right entity, and no
 * personal data in the payload.
 *
 * The privacy assertion is the one worth keeping honest. The audit log outlives
 * PII retention on the tables it points at, so a log entry carrying a name or
 * an email is a leak that survives the deletion meant to remove it.
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    adminActionLog: { findMany: vi.fn(), create: vi.fn() },
    fcraQuarterlyReport: { findUnique: vi.fn() },
    reliefInitiative: { findUnique: vi.fn() },
    project: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-log")>();
  return { ...actual, logAdminAction: vi.fn() };
});
vi.mock("@/lib/crisis/bank-encryption", () => ({
  decryptBankAccountNumber: vi.fn(() => "123456789012"),
  maskAccountNumber: vi.fn(() => "****"),
}));
vi.mock("@/lib/fcra-quarterly", () => ({
  generateFcraQuarterlyReport: vi.fn(),
}));
vi.mock("@/lib/gemini/screen-project", () => ({ screenProject: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })),
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { logAdminAction } from "@/lib/admin-log";
import { decryptBankAccountNumber } from "@/lib/crisis/bank-encryption";
import { generateFcraQuarterlyReport } from "@/lib/fcra-quarterly";
import { screenProject } from "@/lib/gemini/screen-project";

import { GET as exportAudit } from "@/app/api/admin/audit/export/route";
import { POST as generateFcra } from "@/app/api/admin/fcra-report/generate/route";
import { GET as exportFcra } from "@/app/api/admin/fcra-report/[id]/export/route";
import { GET as initiativeDetail } from "@/app/api/admin/initiatives/[id]/route";
import { POST as screenProjectRoute } from "@/app/api/admin/screen-project/route";

const db = prisma as any;
const session = getServerSession as any;
const logged = logAdminAction as any;

const ADMIN = { user: { id: "admin_1", role: "ADMIN" } };

/** The single log entry a route wrote. */
function onlyLog() {
  expect(logged).toHaveBeenCalledTimes(1);
  return logged.mock.calls[0][0];
}

/**
 * No personal data anywhere in a log payload, at any depth.
 *
 * Checks the serialised entry rather than named fields, because the leak this
 * is guarding against is someone adding a convenient `orgName` to metadata,
 * not someone misusing `note`.
 */
function expectNoPersonalData(entry: Record<string, unknown>, forbidden: string[]) {
  const serialised = JSON.stringify(entry);
  expect(serialised).not.toContain("@");
  for (const value of forbidden) {
    expect(serialised, `leaked ${value} into the audit log`).not.toContain(value);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue(ADMIN);
  db.adminActionLog.findMany.mockResolvedValue([]);
});

describe("exporting the audit trail is itself audited", () => {
  const req = (query = "") =>
    new Request(`http://localhost/api/admin/audit/export${query}`) as any;

  it("records who took the copy, against the system rather than a person", async () => {
    await exportAudit(req());
    const entry = onlyLog();

    expect(entry.adminId).toBe("admin_1");
    expect(entry.action).toBe("AUDIT_TRAIL_EXPORTED");
    expect(entry.entityType).toBe("SYSTEM");
  });

  it("records the filters the export was taken under", async () => {
    // "They exported everything" and "they exported one NGO's rejections" are
    // different events, and only metadata can tell them apart afterwards.
    await exportAudit(req("?entityType=NGO&action=REJECTED"));
    expect(onlyLog().metadata.filters).toEqual({ entityType: "NGO", action: "REJECTED" });
  });

  it("omits filters that were not supplied rather than logging undefined", async () => {
    await exportAudit(req());
    expect(onlyLog().metadata.filters).toEqual({});
  });

  it("records how many rows actually left", async () => {
    db.adminActionLog.findMany.mockResolvedValue([
      { id: "1", createdAt: new Date(), admin: null, action: "NGO_APPROVED", entityType: "NGO", entityId: "n1", note: null, oldValue: null, newValue: null },
      { id: "2", createdAt: new Date(), admin: null, action: "NGO_REJECTED", entityType: "NGO", entityId: "n2", note: null, oldValue: null, newValue: null },
    ]);
    await exportAudit(req());
    const entry = onlyLog();
    expect(entry.metadata.rowCount).toBe(2);
    expect(entry.metadata.truncated).toBe(false);
  });

  it("says so when the export was capped, so a partial copy is not read as complete", async () => {
    db.adminActionLog.findMany.mockResolvedValue(
      Array.from({ length: 5001 }, (_, i) => ({
        id: `log_${i}`, createdAt: new Date(), admin: null, action: "NGO_APPROVED",
        entityType: "NGO", entityId: "n", note: null, oldValue: null, newValue: null,
      }))
    );
    await exportAudit(req());
    const entry = onlyLog();
    expect(entry.metadata.truncated).toBe(true);
    expect(entry.metadata.rowCount).toBe(5000);
  });

  it("carries no exported content into the log", async () => {
    db.adminActionLog.findMany.mockResolvedValue([
      { id: "1", createdAt: new Date(), admin: { name: "Ada Admin", email: "ada@example.org" }, action: "NGO_APPROVED", entityType: "NGO", entityId: "n1", note: "Looks fine", oldValue: null, newValue: null },
    ]);
    await exportAudit(req());
    // The log describes the export; it must not become a second copy of it.
    expectNoPersonalData(onlyLog(), ["Ada Admin", "Looks fine"]);
  });

  it("writes no log when the caller is not an admin", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "NGO" } });
    const res = await exportAudit(req());
    expect(res.status).toBe(403);
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("FCRA quarterly reports", () => {
  it("records who generated the report and for which quarter", async () => {
    (generateFcraQuarterlyReport as any).mockResolvedValue({ id: "rep_1", quarter: "2026-Q2" });

    const res = await generateFcra(
      new Request("http://localhost/api/admin/fcra-report/generate", { method: "POST" }) as any
    );
    expect(res.status).toBe(200);

    const entry = onlyLog();
    expect(entry.adminId).toBe("admin_1");
    expect(entry.action).toBe("FCRA_REPORT_GENERATED");
    expect(entry.entityType).toBe("FCRA_REPORT");
    expect(entry.entityId).toBe("rep_1");
    expect(entry.metadata.quarter).toBe("2026-Q2");
  });

  it("does not log a report that failed to generate", async () => {
    (generateFcraQuarterlyReport as any).mockRejectedValue(new Error("no donations"));
    const res = await generateFcra(
      new Request("http://localhost/api/admin/fcra-report/generate", { method: "POST" }) as any
    );
    expect(res.status).toBe(500);
    expect(logged).not.toHaveBeenCalled();
  });

  it("records the export as a disclosure, counting organisations but naming none", async () => {
    db.fcraQuarterlyReport.findUnique.mockResolvedValue({
      id: "rep_1",
      quarter: "2026-Q2",
      ngoBreakdown: [
        { ngoId: "n1", orgName: "Ujjwal Seva Trust", fcraNumber: "123", status: "VALID", expiryDate: null },
        { ngoId: "n2", orgName: "Vitacare Foundation", fcraNumber: "456", status: "EXPIRED", expiryDate: null },
      ],
    });

    const res = await exportFcra(
      new Request("http://localhost/api/admin/fcra-report/rep_1/export") as any,
      { params: { id: "rep_1" } }
    );
    expect(res.status).toBe(200);

    const entry = onlyLog();
    expect(entry.action).toBe("FCRA_REPORT_EXPORTED");
    expect(entry.metadata.ngoCount).toBe(2);
    // The CSV carries the organisation names. The log must not.
    expectNoPersonalData(entry, ["Ujjwal Seva Trust", "Vitacare Foundation"]);
  });

  it("does not log an export of a report that does not exist", async () => {
    db.fcraQuarterlyReport.findUnique.mockResolvedValue(null);
    const res = await exportFcra(
      new Request("http://localhost/api/admin/fcra-report/nope/export") as any,
      { params: { id: "nope" } }
    );
    expect(res.status).toBe(404);
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("viewing an initiative's decrypted bank details", () => {
  const initiative = {
    id: "init_1",
    organizerName: "Ravi Kumar",
    bankAccountNumberEnc: "enc",
    requiredFunds: 50000,
    raisedAmount: 1000,
    crisisEvent: { title: "Flood relief", slug: "flood" },
    submittedBy: { name: "Ravi Kumar", email: "ravi@example.org" },
  };

  const call = () =>
    initiativeDetail(new Request("http://localhost/api/admin/initiatives/init_1") as any, {
      params: { id: "init_1" },
    });

  beforeEach(() => {
    db.reliefInitiative.findUnique.mockResolvedValue({ ...initiative });
  });

  it("logs the disclosure even though the request is a GET", async () => {
    // This is the only place an account number is decrypted, so "who has seen
    // this organiser's account number" has to have an answer.
    const res = await call();
    expect(res.status).toBe(200);

    const entry = onlyLog();
    expect(entry.adminId).toBe("admin_1");
    expect(entry.action).toBe("INITIATIVE_BANK_DETAILS_VIEWED");
    expect(entry.entityType).toBe("RELIEF_INITIATIVE");
    expect(entry.entityId).toBe("init_1");
  });

  it("never puts the account number or the organiser in the log", async () => {
    await call();
    expectNoPersonalData(onlyLog(), ["123456789012", "Ravi Kumar"]);
  });

  it("records that decryption failed, because a key problem needs noticing", async () => {
    (decryptBankAccountNumber as any).mockImplementationOnce(() => {
      throw new Error("bad key");
    });
    await call();
    expect(onlyLog().metadata.decrypted).toBe(false);
  });

  it("records a successful decryption as such", async () => {
    await call();
    expect(onlyLog().metadata.decrypted).toBe(true);
  });

  it("writes no log when the initiative does not exist", async () => {
    db.reliefInitiative.findUnique.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(logged).not.toHaveBeenCalled();
  });

  it("writes no log, and decrypts nothing, for a non-admin", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "DONOR" } });
    const res = await call();
    expect(res.status).toBe(403);
    expect(decryptBankAccountNumber).not.toHaveBeenCalled();
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("running the project screening agent", () => {
  const call = () =>
    screenProjectRoute(
      new Request("http://localhost/api/admin/screen-project", {
        method: "POST",
        body: JSON.stringify({ projectId: "proj_1" }),
      }) as any
    );

  beforeEach(() => {
    db.project.findUnique.mockResolvedValue({
      id: "proj_1",
      title: "Clean water",
      description: "d",
      causeCategory: "WATER",
      targetAmount: 100000,
      location: "Pune",
      problem_statement: "p",
      expected_outcome: "o",
      aiScreeningScore: 41,
      milestones: [],
    });
    db.project.update.mockResolvedValue({});
    (screenProject as any).mockResolvedValue({ score: 72, flags: [] });
  });

  it("records the score it replaced alongside the one it stored", async () => {
    // A re-run overwrites aiScreeningScore in place, so without the old value
    // the advice a human actually acted on is unrecoverable.
    const res = await call();
    expect(res.status).toBe(200);

    const entry = onlyLog();
    expect(entry.action).toBe("PROJECT_SCREENED");
    expect(entry.entityType).toBe("PROJECT");
    expect(entry.entityId).toBe("proj_1");
    expect(entry.oldValue).toEqual({ aiScreeningScore: 41 });
    expect(entry.newValue).toEqual({ aiScreeningScore: 72 });
  });

  it("records null rather than omitting the old score on a first run", async () => {
    db.project.findUnique.mockResolvedValue({
      id: "proj_1", title: "t", description: "d", causeCategory: "WATER",
      targetAmount: 1, location: "l", problem_statement: "p", expected_outcome: "o",
      aiScreeningScore: null, milestones: [],
    });
    await call();
    expect(onlyLog().oldValue).toEqual({ aiScreeningScore: null });
  });

  it("writes no log when the model call fails and nothing was stored", async () => {
    (screenProject as any).mockRejectedValue(new Error("model timeout"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(db.project.update).not.toHaveBeenCalled();
    expect(logged).not.toHaveBeenCalled();
  });

  it("writes no log when the project does not exist", async () => {
    db.project.findUnique.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(logged).not.toHaveBeenCalled();
  });
});
