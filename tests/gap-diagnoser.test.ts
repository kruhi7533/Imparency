import { describe, it, expect, vi, beforeEach } from "vitest";

// 1. Mock external dependencies BEFORE importing handlers
vi.mock("@/lib/prisma", () => {
  return {
    default: {
      sponsorRequirement: {
        findUnique: vi.fn(),
      },
      project: {
        findMany: vi.fn(),
      },
      nGOCompliance: {
        findUnique: vi.fn(),
      },
      gapReport: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      }
    }
  };
});

vi.mock("@/lib/auth-guards", () => {
  return {
    verifySessionRole: vi.fn(),
  };
});

vi.mock("@/src/agents/gap-diagnoser/services/ai-diagnoser", () => {
  return {
    AIDiagnoserService: class {
      generateGapReport = vi.fn().mockResolvedValue({
        overallCompatibility: 85,
        gaps: [
          {
            category: "Geography",
            severity: "HIGH",
            description: "No active initiatives found in Assam.",
            recommendation: "Launch an Assam initiative."
          }
        ]
      });
    }
  };
});

import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { ComparisonEngine } from "@/src/agents/gap-diagnoser/services/comparison-engine";
import { POST, GET, PUT } from "@/app/api/gap-analysis/[requirementId]/route";
import { SponsorRequirementData } from "@/src/agents/gap-diagnoser/types/gap-types";
import { Project, NGOCompliance, Milestone } from "@prisma/client";

// Helper to create mock Project
const createMockProject = (overrides: Partial<Project & { milestones: Milestone[] }>): Project & { milestones: Milestone[] } => {
  return {
    id: "proj-1",
    ngoId: "ngo-123",
    title: "Test Project",
    description: "This is a test initiative",
    causeCategory: "Education",
    targetAmount: 5000000 as any, // ₹50 Lakhs
    raisedAmount: 0 as any,
    status: "ACTIVE",
    coverImage: "",
    location: "Guwahati, Assam",
    latitude: null,
    longitude: null,
    districtName: "Kamrup",
    stateName: "Assam",
    geoIntelligence: null,
    geoFetchedAt: null,
    problem_statement: "High dropout rates",
    expected_outcome: "Reduce dropout by supporting 100 students.",
    tocAnalysis: null,
    isDeleted: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    reviewNote: null,
    reviewedAt: null,
    reviewedById: null,
    aiScreeningScore: null,
    aiScreeningResult: null,
    crisisEventId: null,
    isCrisisGeneralFund: false,
    milestones: [
      {
        id: "m-1",
        projectId: "proj-1",
        title: "Milestone 1",
        description: "Verify baseline details",
        targetAmount: 2500000 as any,
        deadline: new Date("2026-07-01"), // 6 months from start
        status: "PENDING",
        sequenceOrder: 1,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      }
    ],
    ...overrides
  } as any;
};

// Helper to create mock Compliance
const createMockCompliance = (overrides: Partial<NGOCompliance>): NGOCompliance => {
  return {
    id: "comp-1",
    ngoId: "ngo-123",
    panVerified: true,
    panVerifiedAt: new Date(),
    registrationVerified: true,
    registrationVerifiedAt: new Date(),
    a12Verified: true,
    a12VerifiedAt: new Date(),
    a12DocumentUrl: "http://example.com/12a",
    eightyGVerified: true,
    eightyGVerifiedAt: new Date(),
    fcraNumber: "123456",
    fcraStatus: "ACTIVE",
    fcraAuthority: "MHA",
    fcraRegisteredSince: 2020,
    fcraIssueDate: new Date(),
    fcraExpiryDate: new Date("2030-01-01"),
    fcraCertificateUrl: "http://example.com/fcra",
    fcraExtractedData: null,
    fcraAdminNote: null,
    fcraVerifiedAt: new Date(),
    verifiedById: "admin-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
};

describe("ComparisonEngine", () => {
  const engine = new ComparisonEngine();

  describe("Sector (Cause Category)", () => {
    it("returns MATCH on exact match", () => {
      const requirement: SponsorRequirementData = { sector: "Education" };
      const project = createMockProject({ causeCategory: "Education" });
      const result = engine.compare("req-1", requirement, [project], null);
      
      const sectorResult = result.dimensions.find(d => d.dimension === "Sector");
      expect(sectorResult).toBeDefined();
      expect(sectorResult!.status).toBe("MATCH");
    });

    it("returns PARTIAL on substring match", () => {
      const requirement: SponsorRequirementData = { sector: "Education Development" };
      const project = createMockProject({ causeCategory: "Education" });
      const result = engine.compare("req-1", requirement, [project], null);
      
      const sectorResult = result.dimensions.find(d => d.dimension === "Sector");
      expect(sectorResult!.status).toBe("PARTIAL");
    });

    it("returns MISSING if cause category is unrelated", () => {
      const requirement: SponsorRequirementData = { sector: "Healthcare" };
      const project = createMockProject({ causeCategory: "Education" });
      const result = engine.compare("req-1", requirement, [project], null);
      
      const sectorResult = result.dimensions.find(d => d.dimension === "Sector");
      expect(sectorResult!.status).toBe("MISSING");
    });
  });

  describe("Geography (State & District)", () => {
    it("returns MATCH for matching state and district", () => {
      const requirement: SponsorRequirementData = { state: "Assam", district: "Kamrup" };
      const project = createMockProject({ stateName: "Assam", districtName: "Kamrup" });
      const result = engine.compare("req-1", requirement, [project], null);
      
      const stateResult = result.dimensions.find(d => d.dimension === "Geography" && d.notes === "State level comparison");
      const districtResult = result.dimensions.find(d => d.dimension === "Geography" && d.notes === "District level comparison");
      
      expect(stateResult!.status).toBe("MATCH");
      expect(districtResult!.status).toBe("MATCH");
    });

    it("returns PARTIAL for district match if only State matches", () => {
      const requirement: SponsorRequirementData = { state: "Assam", district: "Dibrugarh" };
      const project = createMockProject({ stateName: "Assam", districtName: "Kamrup" });
      const result = engine.compare("req-1", requirement, [project], null);
      
      const stateResult = result.dimensions.find(d => d.notes === "State level comparison");
      const districtResult = result.dimensions.find(d => d.notes === "District level comparison");
      
      expect(stateResult!.status).toBe("MATCH");
      expect(districtResult!.status).toBe("PARTIAL");
    });

    it("returns MISSING when state is completely different", () => {
      const requirement: SponsorRequirementData = { state: "Karnataka", district: "Bangalore" };
      const project = createMockProject({ stateName: "Assam", districtName: "Kamrup" });
      const result = engine.compare("req-1", requirement, [project], null);
      
      const stateResult = result.dimensions.find(d => d.notes === "State level comparison");
      const districtResult = result.dimensions.find(d => d.notes === "District level comparison");
      
      expect(stateResult!.status).toBe("MISSING");
      expect(districtResult!.status).toBe("MISSING");
    });
  });

  describe("Budget", () => {
    it("returns MATCH if maximum project budget is >= requirement budget", () => {
      const requirement: SponsorRequirementData = { budget: 5000000 };
      const project = createMockProject({ targetAmount: 5000000 as any });
      const result = engine.compare("req-1", requirement, [project], null);
      
      const budgetResult = result.dimensions.find(d => d.dimension === "Budget");
      expect(budgetResult!.status).toBe("MATCH");
    });

    it("returns PARTIAL if maximum project budget is >= 50% of requirement budget", () => {
      const requirement: SponsorRequirementData = { budget: 10000000 }; // 1 Cr
      const project = createMockProject({ targetAmount: 6000000 as any }); // 60L
      const result = engine.compare("req-1", requirement, [project], null);
      
      const budgetResult = result.dimensions.find(d => d.dimension === "Budget");
      expect(budgetResult!.status).toBe("PARTIAL");
    });

    it("returns MISSING if budget is less than 50% of requirement", () => {
      const requirement: SponsorRequirementData = { budget: 10000000 };
      const project = createMockProject({ targetAmount: 2000000 as any }); // 20L
      const result = engine.compare("req-1", requirement, [project], null);
      
      const budgetResult = result.dimensions.find(d => d.dimension === "Budget");
      expect(budgetResult!.status).toBe("MISSING");
    });
  });

  describe("Timeline (Duration)", () => {
    it("returns MATCH if active projects duration matches requirement duration", () => {
      const requirement: SponsorRequirementData = { durationMonths: 12 };
      const project = createMockProject({
        createdAt: new Date("2026-01-01"),
        milestones: [
          { deadline: new Date("2026-12-31") }
        ] as any
      });
      const result = engine.compare("req-1", requirement, [project], null);
      
      const timelineResult = result.dimensions.find(d => d.dimension === "Timeline");
      expect(timelineResult!.status).toBe("MATCH");
    });
  });

  describe("Target Beneficiaries", () => {
    it("returns MATCH if regex matches a larger number of beneficiaries in outcome", () => {
      const requirement: SponsorRequirementData = { beneficiaries: 100 };
      const project = createMockProject({ expected_outcome: "Support 150 students with study books" });
      const result = engine.compare("req-1", requirement, [project], null);
      
      const beneficiariesResult = result.dimensions.find(d => d.notes === "Target Beneficiaries comparison");
      expect(beneficiariesResult!.status).toBe("MATCH");
    });
  });

  describe("Compliance (Certifications & FCRA)", () => {
    it("returns MATCH when required certs (12A, 80G) and FCRA status are valid", () => {
      const requirement: SponsorRequirementData = {
        requiredCertifications: ["12A", "80G"],
        fcraRequired: true
      };
      const compliance = createMockCompliance({
        a12Verified: true,
        eightyGVerified: true,
        fcraStatus: "ACTIVE"
      });
      const result = engine.compare("req-1", requirement, [], compliance);
      
      const certResult = result.dimensions.find(d => d.notes === "Required certifications audit");
      const fcraResult = result.dimensions.find(d => d.notes === "FCRA compliance validation");
      
      expect(certResult!.status).toBe("MATCH");
      expect(fcraResult!.status).toBe("MATCH");
    });
  });
});

describe("Gap Analysis API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/gap-analysis/[requirementId]", () => {
    it("returns 401 if unauthorized", async () => {
      (verifySessionRole as any).mockResolvedValue({
        authorized: false,
        response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
      });

      const req = new Request("http://localhost/api/gap-analysis/req-123", { method: "POST" });
      const res = await POST(req, { params: { requirementId: "req-123" } });
      expect(res.status).toBe(401);
    });

    it("returns 403 if forbidden role", async () => {
      (verifySessionRole as any).mockResolvedValue({
        authorized: true,
        session: { user: { role: "DONOR", email: "donor@example.com" } }
      });

      const req = new Request("http://localhost/api/gap-analysis/req-123", { method: "POST" });
      const res = await POST(req, { params: { requirementId: "req-123" } });
      expect(res.status).toBe(403);
    });

    it("generates and saves report if authorized as NGO", async () => {
      (verifySessionRole as any).mockResolvedValue({
        authorized: true,
        session: { user: { role: "NGO", ngoProfileId: "ngo-123", name: "NGO Admin" } }
      });

      (prisma.sponsorRequirement.findUnique as any).mockResolvedValue({
        id: "req-123",
        title: "Clean Water 2026",
        extractedData: {
          sector: "Water",
          state: "Assam",
          budget: 5000000,
          fcraRequired: true
        }
      });

      (prisma.project.findMany as any).mockResolvedValue([
        createMockProject({ ngoId: "ngo-123", causeCategory: "Water", location: "Assam" })
      ]);

      (prisma.nGOCompliance.findUnique as any).mockResolvedValue(
        createMockCompliance({ ngoId: "ngo-123", fcraStatus: "ACTIVE" })
      );

      (prisma.gapReport.create as any).mockResolvedValue({
        id: "report-999",
        sponsorRequirementId: "req-123",
        ngoId: "ngo-123",
        overallCompatibility: 85,
        gapReport: [],
        recommendations: [],
        reviewStatus: "PENDING"
      });

      const req = new Request("http://localhost/api/gap-analysis/req-123", { method: "POST" });
      const res = await POST(req, { params: { requirementId: "req-123" } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.gapReportId).toBe("report-999");
      expect(data.status).toBe("PROCESSING");
      expect(prisma.gapReport.create).toHaveBeenCalled();
    });
  });

  describe("GET /api/gap-analysis/[id]", () => {
    it("returns report details if authorized and owned by same NGO", async () => {
      (verifySessionRole as any).mockResolvedValue({
        authorized: true,
        session: { user: { role: "NGO", ngoProfileId: "ngo-123" } }
      });

      (prisma.gapReport.findUnique as any).mockResolvedValue({
        id: "report-999",
        ngoId: "ngo-123",
        sponsorRequirementId: "req-123",
        overallCompatibility: 85,
        gapReport: [],
        recommendations: [],
        reviewStatus: "PENDING",
        sponsorRequirement: { title: "Clean Water" }
      });

      const req = new Request("http://localhost/api/gap-analysis/report-999", { method: "GET" });
      const res = await GET(req, { params: { requirementId: "report-999" } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.id).toBe("report-999");
    });

    it("returns 403 if NGO tries to access report of another NGO", async () => {
      (verifySessionRole as any).mockResolvedValue({
        authorized: true,
        session: { user: { role: "NGO", ngoProfileId: "ngo-other" } }
      });

      (prisma.gapReport.findUnique as any).mockResolvedValue({
        id: "report-999",
        ngoId: "ngo-123",
        sponsorRequirementId: "req-123",
        sponsorRequirement: { title: "Clean Water" }
      });

      const req = new Request("http://localhost/api/gap-analysis/report-999", { method: "GET" });
      const res = await GET(req, { params: { requirementId: "report-999" } });
      expect(res.status).toBe(403);
    });
  });

  describe("PUT /api/gap-analysis/[id]", () => {
    it("updates review status successfully", async () => {
      (verifySessionRole as any).mockResolvedValue({
        authorized: true,
        session: { user: { role: "ADMIN", name: "Admin User" } }
      });

      (prisma.gapReport.findUnique as any).mockResolvedValue({
        id: "report-999",
        ngoId: "ngo-123",
        sponsorRequirementId: "req-123",
        sponsorRequirement: { title: "Clean Water" }
      });

      (prisma.gapReport.update as any).mockResolvedValue({
        id: "report-999",
        reviewStatus: "APPROVED",
        reviewedBy: "Admin User"
      });

      const req = new Request("http://localhost/api/gap-analysis/report-999", {
        method: "PUT",
        body: JSON.stringify({ reviewStatus: "APPROVED" })
      });
      const res = await PUT(req, { params: { requirementId: "report-999" } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.reviewStatus).toBe("APPROVED");
      expect(prisma.gapReport.update).toHaveBeenCalledWith({
        where: { id: "report-999" },
        data: { reviewStatus: "APPROVED", reviewedBy: "Admin User" }
      });
    });
  });
});
