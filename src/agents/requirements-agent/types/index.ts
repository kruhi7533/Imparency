export interface ExtractedField<T> {
  value: T | null;
  confidence: number;
}

export interface CSRRequirements {
  sector: ExtractedField<string>;
  state: ExtractedField<string>;
  district: ExtractedField<string>;
  budgetMin: ExtractedField<number>;
  budgetMax: ExtractedField<number>;
  currency: ExtractedField<string>;
  durationMonths: ExtractedField<number>;
  expectedBeneficiaries: ExtractedField<number>;
  primaryKPIs: ExtractedField<string[]>;
  secondaryKPIs: ExtractedField<string[]>;
  reportingCadence: ExtractedField<string>;
  timeline: ExtractedField<string>;
  requiredDocuments: ExtractedField<string[]>;
  contactPerson: ExtractedField<string>;
  contactEmail: ExtractedField<string>;
  contactPhone: ExtractedField<string>;
  specialConstraints: ExtractedField<string>;
  summary: ExtractedField<string>;
}

export type ExtractionStatus = 
  | 'UPLOADED'
  | 'OCR_RUNNING'
  | 'EXTRACTING'
  | 'FAILED'
  | 'PENDING_REVIEW'
  | 'VALIDATED';

export interface SponsorRequirementDTO {
  id: string;
  sponsorId: string | null;
  rawDocumentUrl: string;
  fileName: string;
  fileHash: string;
  rawText: string;
  extractedFields: CSRRequirements;
  confidenceScores: Record<string, number>;
  extractionStatus: ExtractionStatus;
  extractedByAgent: string;
  modelVersion: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
