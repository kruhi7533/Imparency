import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequirementSchema } from '@/src/agents/requirements-agent/validators/schema';
import { OcrService } from '@/src/agents/requirements-agent/services/ocr/ocr.service';
import { LlmService } from '@/src/agents/requirements-agent/services/llm/llm.service';

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  default: {
    sponsorRequirement: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    agentExecution: {
      create: vi.fn(),
    },
  },
}));

import prisma from '@/lib/prisma';
const prismaMock = prisma as any;

describe('Requirements Analyst Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Zod Schema Validation', () => {
    it('successfully validates complete structured fields', () => {
      const validData = {
        sector: { value: 'Education', confidence: 0.95 },
        state: { value: 'Karnataka', confidence: 0.90 },
        district: { value: 'Bangalore', confidence: 0.85 },
        budgetMin: { value: 5000000, confidence: 0.92 },
        budgetMax: { value: 10000000, confidence: 0.88 },
        currency: { value: 'INR', confidence: 0.99 },
        durationMonths: { value: 12, confidence: 0.95 },
        expectedBeneficiaries: { value: 1500, confidence: 0.82 },
        primaryKPIs: { value: ['Literacy improvement'], confidence: 0.89 },
        secondaryKPIs: { value: ['Infrastructure setup'], confidence: 0.80 },
        reportingCadence: { value: 'Quarterly', confidence: 0.91 },
        timeline: { value: 'FY2026', confidence: 0.85 },
        requiredDocuments: { value: ['80G Certificate'], confidence: 0.94 },
        contactPerson: { value: 'Sarah Jenkins', confidence: 0.96 },
        contactEmail: { value: 'sarah.j@csr.org', confidence: 0.99 },
        contactPhone: { value: '+919900011223', confidence: 0.97 },
        specialConstraints: { value: 'None', confidence: 0.84 },
        summary: { value: 'A summary here', confidence: 0.90 },
      };

      const result = RequirementSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('rejects values that mismatch types', () => {
      const invalidData = {
        sector: { value: 12345, confidence: 0.95 }, // sector should be a string or null
      };
      const result = RequirementSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('allows missing values to be null', () => {
      const dataWithNulls = {
        sector: { value: 'Education', confidence: 0.95 },
        state: { value: null, confidence: 0.0 }, // null allowed
        district: { value: null, confidence: 0.0 },
        budgetMin: { value: null, confidence: 0.0 },
        budgetMax: { value: null, confidence: 0.0 },
        currency: { value: null, confidence: 0.0 },
        durationMonths: { value: null, confidence: 0.0 },
        expectedBeneficiaries: { value: null, confidence: 0.0 },
        primaryKPIs: { value: null, confidence: 0.0 },
        secondaryKPIs: { value: null, confidence: 0.0 },
        reportingCadence: { value: null, confidence: 0.0 },
        timeline: { value: null, confidence: 0.0 },
        requiredDocuments: { value: null, confidence: 0.0 },
        contactPerson: { value: null, confidence: 0.0 },
        contactEmail: { value: null, confidence: 0.0 },
        contactPhone: { value: null, confidence: 0.0 },
        specialConstraints: { value: null, confidence: 0.0 },
        summary: { value: 'Summary is here', confidence: 0.90 },
      };

      const result = RequirementSchema.safeParse(dataWithNulls);
      expect(result.success).toBe(true);
    });
  });

  describe('OCR / Clean Text utilities', () => {
    it('properly collapses multiple horizontal spaces and blank lines', () => {
      const raw = 'Hello    world!   \n\n\nNew   line  here.';
      const cleaned = OcrService.cleanText(raw);
      expect(cleaned).toBe('Hello world!\n\nNew line here.');
    });

    it('filters out non-printable binary control characters', () => {
      const raw = 'Doc\x00\x01\x02Text';
      const cleaned = OcrService.cleanText(raw);
      expect(cleaned).toBe('DocText');
    });
  });

  describe('LLM Structured Output Extractor', () => {
    it('resolves mock requirements in mock mode when key is absent', async () => {
      const text = 'Sponsor seeks Karnataka Bangalore Education project with budget 5000000.';
      
      const prevMock = process.env.MOCK_AI;
      process.env.MOCK_AI = 'true';
      
      try {
        const result = await LlmService.extractStructuredRequirements(text);
        expect(result.data.sector.value).toBe('Education');
        expect(result.data.state.value).toBe('Karnataka');
        expect(result.data.district.value).toBe('Bangalore');
        expect(result.metadata.model).toBe('mock-gemini-3.6-flash');
      } finally {
        process.env.MOCK_AI = prevMock;
      }
    });
  });
});
