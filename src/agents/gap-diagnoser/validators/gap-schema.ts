import { z } from 'zod';

export const GapCategoryEnum = z.enum([
  'Geography',
  'Sector',
  'Budget',
  'Timeline',
  'KPIs',
  'Compliance',
  'Other'
]);

export const GapSeverityEnum = z.enum(['HIGH', 'MEDIUM', 'LOW']);

export const GapDetailSchema = z.object({
  category: GapCategoryEnum,
  severity: GapSeverityEnum,
  description: z.string().describe('Explanation of why this gap exists based on the comparison.'),
  recommendation: z.string().describe('Practical recommendation to resolve the gap without fabricating capabilities.')
});

export const GapReportSchema = z.object({
  overallCompatibility: z.number().min(0).max(100).describe('Score from 0 to 100 indicating how well the NGO matches the requirements.'),
  gaps: z.array(GapDetailSchema).describe('List of detected gaps. Empty array if perfectly aligned.')
});

export const SponsorRequirementSchema = z.object({
  sector: z.string().optional(),
  state: z.string().optional(),
  district: z.string().optional(),
  budget: z.number().optional(),
  durationMonths: z.number().optional(),
  beneficiaries: z.number().optional(),
  kpis: z.array(z.string()).optional(),
  reportingCadence: z.string().optional(),
  requiredCertifications: z.array(z.string()).optional(),
  fcraRequired: z.boolean().optional(),
  specialConstraints: z.array(z.string()).optional(),
  sdgGoals: z.array(z.string()).optional()
});
