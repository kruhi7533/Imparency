export type DimensionMatchStatus = 'MATCH' | 'PARTIAL' | 'MISSING';
export type GapSeverity = 'HIGH' | 'MEDIUM' | 'LOW';
export type GapCategory = 'Geography' | 'Sector' | 'Budget' | 'Timeline' | 'KPIs' | 'Compliance' | 'Other';

export interface SponsorRequirementData {
  sector?: string;
  state?: string;
  district?: string;
  budget?: number;
  durationMonths?: number;
  beneficiaries?: number;
  kpis?: string[];
  reportingCadence?: string;
  requiredCertifications?: string[];
  fcraRequired?: boolean;
  specialConstraints?: string[];
  sdgGoals?: string[];
}

export interface DimensionComparison {
  dimension: GapCategory;
  status: DimensionMatchStatus;
  sponsorValue: any;
  ngoValue: any;
  notes?: string;
}

export interface ComparisonResult {
  sponsorRequirementId: string;
  ngoId?: string; // Evaluated globally against all active projects if not specific to one NGO
  dimensions: DimensionComparison[];
  activeProjectsCount: number;
}

export interface GapDetail {
  category: GapCategory;
  severity: GapSeverity;
  description: string;
  recommendation: string;
}

export interface GapReportSchemaType {
  overallCompatibility: number;
  gaps: GapDetail[];
}
