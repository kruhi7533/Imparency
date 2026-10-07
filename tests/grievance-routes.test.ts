import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The grievance routes: filing one, and an admin moving it along.
 *
 * The isolation property here is the INVERSE of every other test in this repo.
 * Elsewhere the bug is forgetting an ownership check; on this table an
 * ownership check would be the bug — an organisation that can read complaints
 * against itself can identify whoever filed them. So what is pinned is that
 * the ONLY reader is an admin, and that an NGO session gets 403.
 *
 * Also pinned: the reporter cannot set severity or status (they would), a
 * project must belong to the organisation named, both closures demand a
 * reason, and the complaint body and resolution note never reach the audit log.
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    nGOProfile: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    grievance: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })),
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { logAdminAction } from "@/lib/admin-log";
import { checkRateLimit } from "@/lib/rate-limiter";
import { POST as FILE_GRIEVANCE } from "@/app/api/grievances/route";
import { PATCH as TRIAGE } from "@/app/api/admin/grievances/[id]/route";

const db = prisma as any;
const session = getServerSession as any;
const audit = logAdminAction as any;
const rateLimit = checkRateLimit as any;

const NGO_ID = "ngo_1";
const OTHER_NGO_ID = "ngo_2";
const REPORTER_ID = "user_reporter";
const ADMIN_ID = "user_admin";
const GRIEVANCE_ID = "griev_1";

/** The complaint text, kept in one place so the audit-log assertions can
 *  search for it rather than for a string that merely resembles it. */
const BODY_TEXT = "The borewell listed as finished was never dug. I visited the site on 2 October.";
const RESOLUTION_NOTE = "Site visit confirmed the borewell exists; reporter had the wrong village.";

function fileRequest(body: unknown) {
  return new Request("http://localhost/api/grievances", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any;
}

function patchRequest(body: unknown) {
  return new Request(`http://localhost/api/admin/grievances/${GRIEVANCE_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as any;
}

const validFiling = {
  ngoId: NGO_ID,
  category: "FUND_MISUSE",
  subject: "Milestone reported complete but no work done",
  body: BODY_TEXT,
};

function signInAs(role: string, id: string) {
  session.mockResolvedValue({ user: { id, role } });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue({ isBlocked: false, response: null });
  db.nGOProfile.findUnique.mockResolvedValue({ id: NGO_ID });
  db.grievance.create.mockResolvedValue({
    id: GRIEVANCE_ID,
    status: "OPEN",
    createdAt: new Date("2026-10-05T10:00:00Z"),
  });
  db.grievance.updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/grievances — filing", () => {
  it("requires a session", async () => {
    session.mockResolvedValue(null);
    const res = await FILE_GRIEVANCE(fileRequest(validFiling));
    expect(res.status).toBe(401);
    expect(db.grievance.create).not.toHaveBeenCalled();
  });

  it("accepts a filing from a donor and starts it OPEN with no severity", async () => {
    signInAs("DONOR", REPORTER_ID);
    const res = await FILE_GRIEVANCE(fileRequest(validFiling));

    expect(res.status).toBe(201);
    const data = db.grievance.create.mock.calls[0][0].data;
    expect(data.reporterId).toBe(REPORTER_ID);
    expect(data.ngoId).toBe(NGO_ID);
    expect(data.category).toBe("FUND_MISUSE");
    // Neither is set at intake: OPEN comes from the column default, severity
    // stays null until a human judges it.
    expect(data.status).toBeUndefined();
    expect(data.severity).toBeUndefined();
  });

  it("accepts a filing from an NGO user — their own staff reporting them is the point", async () => {
    signInAs("NGO", "user_ngo_staff");
    const res = await FILE_GRIEVANCE(fileRequest(validFiling));
    expect(res.status).toBe(201);
  });

  it("ignores a severity the reporter tried to set, rather than trusting or rejecting it", async () => {
    // Rejecting would lose a real complaint over a field the reporter never
    // saw; trusting would make every complaint CRITICAL within a week.
    signInAs("DONOR", REPORTER_ID);
    const res = await FILE_GRIEVANCE(
      fileRequest({ ...validFiling, severity: "CRITICAL", status: "RESOLVED" })
    );

    expect(res.status).toBe(201);
    const data = db.grievance.create.mock.calls[0][0].data;
    expect(data.severity).toBeUndefined();
    expect(data.status).toBeUndefined();
  });

  it("is rate limited before it does anything else", async () => {
    rateLimit.mockResolvedValue({
      isBlocked: true,
      response: new Response(null, { status: 429 }),
    });
    signInAs("DONOR", REPORTER_ID);

    const res = await FILE_GRIEVANCE(fileRequest(validFiling));

    expect(res.status).toBe(429);
    expect(db.grievance.create).not.toHaveBeenCalled();
  });

  it("falls back to OTHER for an unrecognised category instead of failing the filing", async () => {
    signInAs("DONOR", REPORTER_ID);
    await FILE_GRIEVANCE(fileRequest({ ...validFiling, category: "SOMETHING_ELSE" }));
    expect(db.grievance.create.mock.calls[0][0].data.category).toBe("OTHER");
  });

  it("refuses a filing with no description", async () => {
    signInAs("DONOR", REPORTER_ID);
    const res = await FILE_GRIEVANCE(fileRequest({ ...validFiling, body: "   " }));
    expect(res.status).toBe(400);
    expect(db.grievance.create).not.toHaveBeenCalled();
  });

  it("refuses a filing against an organisation that does not exist", async () => {
    signInAs("DONOR", REPORTER_ID);
    db.nGOProfile.findUnique.mockResolvedValue(null);

    const res = await FILE_GRIEVANCE(fileRequest(validFiling));

    expect(res.status).toBe(404);
    expect(db.grievance.create).not.toHaveBeenCalled();
  });

  it("refuses a project that belongs to a DIFFERENT organisation", async () => {
    // Otherwise one complaint names two unrelated parties and an admin cannot
    // tell which it concerns.
    signInAs("DONOR", REPORTER_ID);
    db.project.findUnique.mockResolvedValue({ ngoId: OTHER_NGO_ID });

    const res = await FILE_GRIEVANCE(fileRequest({ ...validFiling, projectId: "proj_other" }));

    expect(res.status).toBe(400);
    expect(db.grievance.create).not.toHaveBeenCalled();
  });

  it("accepts a project that does belong to the organisation named", async () => {
    signInAs("DONOR", REPORTER_ID);
    db.project.findUnique.mockResolvedValue({ ngoId: NGO_ID });

    const res = await FILE_GRIEVANCE(fileRequest({ ...validFiling, projectId: "proj_1" }));

    expect(res.status).toBe(201);
    expect(db.grievance.create.mock.calls[0][0].data.projectId).toBe("proj_1");
  });

  it("tells the reporter the organisation cannot see it", async () => {
    signInAs("DONOR", REPORTER_ID);
    const res = await FILE_GRIEVANCE(fileRequest(validFiling));
    const json = await res.json();
    expect(json.message).toContain("Nobody at the organisation you reported can see it");
  });
});

describe("PATCH /api/admin/grievances/[id] — only an admin may read or move one", () => {
  const openGrievance = {
    id: GRIEVANCE_ID,
    status: "OPEN",
    category: "FUND_MISUSE",
    ngoId: NGO_ID,
  };

  it("denies an NGO session with 403 — the organisation under complaint most of all", async () => {
    signInAs("NGO", "user_ngo_staff");
    db.grievance.findUnique.mockResolvedValue(openGrievance);

    const res = await TRIAGE(patchRequest({ action: "TRIAGE", severity: "HIGH" }), {
      params: { id: GRIEVANCE_ID },
    });

    expect(res.status).toBe(403);
    expect(db.grievance.updateMany).not.toHaveBeenCalled();
    // And it did not even read the row: the guard runs before the lookup, so
    // no complaint content is loaded for a caller who may not see it.
    expect(db.grievance.findUnique).not.toHaveBeenCalled();
  });

  it("denies a donor session with 403, including the reporter themselves", async () => {
    signInAs("DONOR", REPORTER_ID);

    const res = await TRIAGE(patchRequest({ action: "DISMISS", note: "never mind" }), {
      params: { id: GRIEVANCE_ID },
    });

    expect(res.status).toBe(403);
    expect(db.grievance.updateMany).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated caller with 401", async () => {
    session.mockResolvedValue(null);
    const res = await TRIAGE(patchRequest({ action: "TRIAGE", severity: "LOW" }), {
      params: { id: GRIEVANCE_ID },
    });
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/admin/grievances/[id] — the gates", () => {
  beforeEach(() => signInAs("ADMIN", ADMIN_ID));

  it("triages, recording the severity and who judged it", async () => {
    db.grievance.findUnique.mockResolvedValue({
      id: GRIEVANCE_ID,
      status: "OPEN",
      category: "SAFEGUARDING",
      ngoId: NGO_ID,
    });

    const res = await TRIAGE(patchRequest({ action: "TRIAGE", severity: "CRITICAL" }), {
      params: { id: GRIEVANCE_ID },
    });

    expect(res.status).toBe(200);
    const update = db.grievance.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: GRIEVANCE_ID, status: "OPEN" });
    expect(update.data).toMatchObject({
      status: "TRIAGED",
      severity: "CRITICAL",
      triagedById: ADMIN_ID,
    });
  });

  it("refuses to triage without a severity — that judgement IS the triage", async () => {
    db.grievance.findUnique.mockResolvedValue({
      id: GRIEVANCE_ID,
      status: "OPEN",
      category: "OTHER",
      ngoId: NGO_ID,
    });

    const res = await TRIAGE(patchRequest({ action: "TRIAGE" }), { params: { id: GRIEVANCE_ID } });

    expect(res.status).toBe(400);
    expect(db.grievance.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a dismissal with no reason", async () => {
    db.grievance.findUnique.mockResolvedValue({
      id: GRIEVANCE_ID,
      status: "INVESTIGATING",
      category: "OTHER",
      ngoId: NGO_ID,
    });

    const res = await TRIAGE(patchRequest({ action: "DISMISS", note: "  " }), {
      params: { id: GRIEVANCE_ID },
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("entitled to a reason");
    expect(db.grievance.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a resolution with no account of what was done", async () => {
    db.grievance.findUnique.mockResolvedValue({
      id: GRIEVANCE_ID,
      status: "INVESTIGATING",
      category: "OTHER",
      ngoId: NGO_ID,
    });

    const res = await TRIAGE(patchRequest({ action: "RESOLVE" }), { params: { id: GRIEVANCE_ID } });

    expect(res.status).toBe(400);
    expect(db.grievance.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a dismissal straight out of the queue with 409", async () => {
    db.grievance.findUnique.mockResolvedValue({
      id: GRIEVANCE_ID,
      status: "OPEN",
      category: "OTHER",
      ngoId: NGO_ID,
    });

    const res = await TRIAGE(
      patchRequest({ action: "DISMISS", note: "looks like a misunderstanding" }),
      { params: { id: GRIEVANCE_ID } }
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("look at it first");
    expect(db.grievance.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to move a complaint that is already closed", async () => {
    db.grievance.findUnique.mockResolvedValue({
      id: GRIEVANCE_ID,
      status: "RESOLVED",
      category: "OTHER",
      ngoId: NGO_ID,
    });

    const res = await TRIAGE(patchRequest({ action: "DISMISS", note: "changed my mind" }), {
      params: { id: GRIEVANCE_ID },
    });

    expect(res.status).toBe(409);
    expect(db.grievance.updateMany).not.toHaveBeenCalled();
  });

  it("gives the loser of a race 409 rather than overwriting the winner", async () => {
    db.grievance.findUnique.mockResolvedValue({
      id: GRIEVANCE_ID,
      status: "OPEN",
      category: "OTHER",
      ngoId: NGO_ID,
    });
    // Another admin moved it between the read and the write.
    db.grievance.updateMany.mockResolvedValue({ count: 0 });

    const res = await TRIAGE(patchRequest({ action: "TRIAGE", severity: "LOW" }), {
      params: { id: GRIEVANCE_ID },
    });

    expect(res.status).toBe(409);
    expect(audit).not.toHaveBeenCalled();
  });

  it("404s for a grievance that does not exist", async () => {
    db.grievance.findUnique.mockResolvedValue(null);
    const res = await TRIAGE(patchRequest({ action: "TRIAGE", severity: "LOW" }), {
      params: { id: "nope" },
    });
    expect(res.status).toBe(404);
  });

  it("rejects an unknown action", async () => {
    const res = await TRIAGE(patchRequest({ action: "DELETE" }), { params: { id: GRIEVANCE_ID } });
    expect(res.status).toBe(400);
    expect(db.grievance.findUnique).not.toHaveBeenCalled();
  });
});

describe("the audit log carries ids, not the complaint", () => {
  beforeEach(() => signInAs("ADMIN", ADMIN_ID));

  it("logs the dismissal without the resolution note or the complaint body", async () => {
    db.grievance.findUnique.mockResolvedValue({
      id: GRIEVANCE_ID,
      status: "INVESTIGATING",
      category: "FUND_MISUSE",
      ngoId: NGO_ID,
    });

    await TRIAGE(patchRequest({ action: "DISMISS", note: RESOLUTION_NOTE }), {
      params: { id: GRIEVANCE_ID },
    });

    expect(audit).toHaveBeenCalledTimes(1);
    const logged = audit.mock.calls[0][0];
    expect(logged.action).toBe("GRIEVANCE_DISMISSED");
    expect(logged.entityType).toBe("GRIEVANCE");
    expect(logged.entityId).toBe(GRIEVANCE_ID);
    expect(logged.oldValue).toEqual({ status: "INVESTIGATING" });
    expect(logged.newValue).toEqual({ status: "DISMISSED" });

    // The note was stored on the row...
    expect(db.grievance.updateMany.mock.calls[0][0].data.resolutionNote).toBe(RESOLUTION_NOTE);
    // ...and must not appear anywhere in the audit payload.
    const serialised = JSON.stringify(logged);
    expect(serialised).not.toContain(RESOLUTION_NOTE);
    expect(serialised).not.toContain(BODY_TEXT);
    expect(logged.note).toBeUndefined();
    // That a reason exists is still auditable.
    expect(logged.metadata.noteRecorded).toBe(true);
  });

  it("logs the triage with the severity, which is a decision and not personal data", async () => {
    db.grievance.findUnique.mockResolvedValue({
      id: GRIEVANCE_ID,
      status: "OPEN",
      category: "SAFEGUARDING",
      ngoId: NGO_ID,
    });

    await TRIAGE(patchRequest({ action: "TRIAGE", severity: "HIGH" }), {
      params: { id: GRIEVANCE_ID },
    });

    const logged = audit.mock.calls[0][0];
    expect(logged.action).toBe("GRIEVANCE_TRIAGED");
    expect(logged.newValue).toEqual({ status: "TRIAGED", severity: "HIGH" });
    expect(logged.metadata.category).toBe("SAFEGUARDING");
    expect(logged.metadata.noteRecorded).toBeUndefined();
  });
});
