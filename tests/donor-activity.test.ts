import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The donor's own activity history: scoped to the donor, internal detail
 * withheld, identity values (PAN) never shown, staff anonymised.
 */

const db = vi.hoisted(() => ({
  requirementAuditLog: { findMany: vi.fn() },
  contractAuditLog: { findMany: vi.fn() },
  donation: { findMany: vi.fn() },
  donorEvent: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));

import { DONOR_VISIBLE_EVENTS, loadDonorActivity } from "@/lib/donor-activity";

const d = (s: string) => new Date(s);

beforeEach(() => {
  vi.clearAllMocks();
  db.requirementAuditLog.findMany.mockResolvedValue([
    { action: "REQUIREMENT_CORRECTION_REQUESTED", actorId: "admin-1", actorRole: "ADMIN", fromStatus: "PENDING_ADMIN_REVIEW", toStatus: "NEEDS_CORRECTION", detail: "Budget band is missing.", createdAt: d("2026-09-02"), requirementId: "req-1", requirement: { fileName: "csr-2026.pdf" } },
    { action: "CSR_DOCUMENT_ACCESSED", actorId: "admin-1", actorRole: "ADMIN", fromStatus: null, toStatus: null, detail: "Admin previewed the original document.", createdAt: d("2026-09-01"), requirementId: "req-1", requirement: { fileName: "csr-2026.pdf" } },
    { action: "REQUIREMENT_EDITED", actorId: "donor-1", actorRole: "DONOR", fromStatus: "DONOR_REVIEW", toStatus: "DONOR_REVIEW", detail: "internal diff", createdAt: d("2026-08-30"), requirementId: "req-1", requirement: { fileName: "" } },
  ]);
  db.contractAuditLog.findMany.mockResolvedValue([
    { action: "PAYMENT_CONFIRMED", actorId: "ngo-user", actorRole: "NGO", detail: "Confirmed.", createdAt: d("2026-10-05"), contractId: "c-1", contract: { title: "CSR grant", ngo: { orgName: "Akshar" } } },
  ]);
  db.donation.findMany.mockResolvedValue([
    { id: "don-1", amount: 2500, status: "FAILED", createdAt: d("2026-10-06"), project: { title: "Literacy kits" } },
  ]);
  db.donorEvent.findMany.mockResolvedValue([{ eventType: "PAN_VERIFIED", source: "SYSTEM", createdAt: d("2026-07-01") }]);
});

describe("loadDonorActivity", () => {
  it("every source is scoped to this donor", async () => {
    await loadDonorActivity("donor-1");
    expect(db.requirementAuditLog.findMany.mock.calls[0][0].where).toEqual({ requirement: { sponsorId: "donor-1" } });
    expect(db.contractAuditLog.findMany.mock.calls[0][0].where).toEqual({ contract: { donorId: "donor-1" } });
    expect(db.donation.findMany.mock.calls[0][0].where).toEqual({ donorId: "donor-1" });
    expect(db.donorEvent.findMany.mock.calls[0][0].where).toMatchObject({ donorId: "donor-1", eventType: { in: Object.keys(DONOR_VISIBLE_EVENTS) } });
  });

  it("never selects donor-event values (PAN, category) — only what happened", async () => {
    await loadDonorActivity("donor-1");
    const select = db.donorEvent.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty("oldValue");
    expect(select).not.toHaveProperty("newValue");
  });

  it("shows requirement detail only when it was written for the donor", async () => {
    const items = await loadDonorActivity("donor-1");
    const reqs = items.filter((i) => i.kind === "REQUIREMENT");
    expect(reqs[0].detail).toBe("Budget band is missing.");
    expect(reqs[1].detail).toBeNull(); // document access: action shown, internal detail not
    expect(reqs[2].detail).toBeNull(); // no status change, internal diff withheld
    expect(reqs[2].title).toContain("CSR requirement");
  });

  it("anonymises platform staff, names the NGO, and says 'You' for the donor", async () => {
    const items = await loadDonorActivity("donor-1");
    expect(items.find((i) => i.kind === "REQUIREMENT")!.actor).toBe("Platform reviewer");
    expect(items.find((i) => i.kind === "CONTRACT")!.actor).toBe("Akshar");
    expect(items.find((i) => i.title.startsWith("Requirement edited"))!.actor).toBe("You");
  });

  it("is newest first and links a failed donation to the retry list", async () => {
    const items = await loadDonorActivity("donor-1");
    expect(items[0]).toMatchObject({ kind: "DONATION", detail: "Payment failed", href: "/donor/donations" });
    expect(items.at(-1)!.title).toBe("PAN verified");
  });
});
