import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { POST as createProposal } from "@/app/api/proposals/route";
import { PUT as updateProposal } from "@/app/api/proposals/[id]/route";

// Mock next-auth session
vi.mock("next-auth", () => ({
  getServerSession: vi.fn()
}));
import { getServerSession } from "next-auth";

describe("Proposal Workflow (Week 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should block proposal creation if not logged in as NGO", async () => {
    (getServerSession as any).mockResolvedValueOnce(null);
    const req = new Request("http://localhost/api/proposals", {
      method: "POST",
      body: JSON.stringify({})
    });
    const res = await createProposal(req);
    expect(res.status).toBe(401);
  });

  it("should create a V1 Proposal successfully as NGO", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "ngo-user-123", role: "NGO" }
    });

    // Mock Prisma behavior
    vi.spyOn(prisma.nGOProfile, "findUnique").mockResolvedValueOnce({ id: "ngo-profile-123" } as any);
    vi.spyOn(prisma.proposal, "create").mockResolvedValueOnce({
      id: "proposal-1",
      opportunityId: "opp-1",
      ngoId: "ngo-profile-123",
      title: "Proposal for Opportunity",
      summary: "Proposal summary",
      plan: "Build 5 schools",
      requestedAmount: 500000,
      milestones: [{ title: "M1", target: "Do stuff" }],
      status: "SUBMITTED",
      version: 1,
      history: "[]",
      submittedAt: new Date()
    } as any);

    const req = new Request("http://localhost/api/proposals", {
      method: "POST",
      body: JSON.stringify({
        requirementId: "opp-1",
        activities: "Build 5 schools",
        budget: "500000",
        milestones: [{ title: "M1", target: "Do stuff" }]
      })
    });

    const res = await createProposal(req);
    const json = await res.json();
    
    expect(res.status).toBe(200);
    expect(json.status).toBe("SUBMITTED");
    expect(json.version).toBe(1);
    expect(json.plan).toBe("Build 5 schools");
  });

  it("should process Donor Change Request and update status", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "donor-user-123", role: "DONOR" }
    });

    vi.spyOn(prisma.proposal, "findUnique").mockResolvedValueOnce({ id: "proposal-1", status: "SUBMITTED", version: 1 } as any);
    vi.spyOn(prisma.proposal, "update").mockResolvedValueOnce({
      id: "proposal-1",
      status: "CHANGE_REQUESTED",
      decisionNote: "Reduce the budget please."
    } as any);

    const req = new Request("http://localhost/api/proposals/proposal-1", {
      method: "PUT",
      body: JSON.stringify({
        action: "REQUEST_CHANGE",
        feedback: "Reduce the budget please."
      })
    });

    const res = await updateProposal(req, { params: { id: "proposal-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("CHANGE_REQUESTED");
  });

  it("should allow NGO to submit V2 Proposal and increment version", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "ngo-user-123", role: "NGO" }
    });

    vi.spyOn(prisma.proposal, "findUnique").mockResolvedValueOnce({ 
      id: "proposal-1", 
      status: "CHANGE_REQUESTED", 
      version: 1,
      history: "[]"
    } as any);

    vi.spyOn(prisma.proposal, "update").mockResolvedValueOnce({
      id: "proposal-1",
      status: "SUBMITTED",
      version: 2,
      plan: "Build 5 schools (Revised)",
      requestedAmount: 450000
    } as any);

    const req = new Request("http://localhost/api/proposals/proposal-1", {
      method: "PUT",
      body: JSON.stringify({
        action: "SUBMIT_V2",
        activities: "Build 5 schools (Revised)",
        budget: "450000",
        milestones: [{ title: "M1", target: "Do stuff cheaper" }]
      })
    });

    const res = await updateProposal(req, { params: { id: "proposal-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("SUBMITTED");
    expect(json.version).toBe(2);
    expect(json.requestedAmount).toBe(450000);
  });
});
