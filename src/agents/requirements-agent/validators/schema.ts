import { z } from 'zod';

const fieldSchema = <T extends z.ZodTypeAny>(valueType: T) => z.object({
  value: valueType.nullable(),
  confidence: z.number().min(0).max(1)
});

export const RequirementSchema = z.object({
  sector: fieldSchema(z.string()),
  state: fieldSchema(z.string()),
  district: fieldSchema(z.string()),
  budgetMin: fieldSchema(z.number()),
  budgetMax: fieldSchema(z.number()),
  currency: fieldSchema(z.string()),
  durationMonths: fieldSchema(z.number()),
  expectedBeneficiaries: fieldSchema(z.number()),
  primaryKPIs: fieldSchema(z.array(z.string())),
  secondaryKPIs: fieldSchema(z.array(z.string())),
  reportingCadence: fieldSchema(z.string()),
  timeline: fieldSchema(z.string()),
  requiredDocuments: fieldSchema(z.array(z.string())),
  contactPerson: fieldSchema(z.string()),
  contactEmail: fieldSchema(z.string()),
  contactPhone: fieldSchema(z.string()),
  specialConstraints: fieldSchema(z.string()),
  summary: fieldSchema(z.string())
});

export type ExtractedRequirementJSON = z.infer<typeof RequirementSchema>;
