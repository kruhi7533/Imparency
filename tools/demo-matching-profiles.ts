/**
 * Matching profiles for the demo projects (roadmap row 7): who each serves, how
 * many, for how long, what it measures and how often it reports. Shared by
 * scripts/seed-demo.ts (new demo data) and tools/seed-ngo-demo.ts (backfilling
 * demo projects created before these fields existed). Riverbank Cleanup is left
 * incomplete on purpose so the readiness checklist has a real case to show.
 */
export type MatchingProfile = {
  expectedBeneficiaries: number | null;
  beneficiaryGroup: string | null;
  durationMonths: number | null;
  primaryKPIs: string[];
  reportingCadence: string | null;
};

export const MATCHING_PROFILES: Record<string, MatchingProfile> = {
  "Digital Classrooms Initiative": { expectedBeneficiaries: 1200, beneficiaryGroup: "Students of classes 6–8 in 5 government schools, Bangalore Rural", durationMonths: 12, primaryKPIs: ["Students using digital lessons weekly", "Science and maths assessment scores"], reportingCadence: "Quarterly" },
  "Teacher Training Bootcamp": { expectedBeneficiaries: 50, beneficiaryGroup: "Government primary school teachers in Bangalore Urban", durationMonths: 6, primaryKPIs: ["Teachers trained", "Classrooms using active-learning methods"], reportingCadence: "Monthly" },
  "Rural Literacy Kits": { expectedBeneficiaries: 500, beneficiaryGroup: "Children aged 6–10 in remote villages of Mysore district", durationMonths: 6, primaryKPIs: ["Literacy kits distributed", "Children reading at grade level"], reportingCadence: "Quarterly" },
  "Mobile Clinic Van": { expectedBeneficiaries: 6000, beneficiaryGroup: "Residents of 12 villages without a primary health centre, Pune district", durationMonths: 18, primaryKPIs: ["Patients consulted", "Villages covered monthly"], reportingCadence: "Monthly" },
  "Maternal Health Support": { expectedBeneficiaries: 400, beneficiaryGroup: "Pregnant women and new mothers in tribal hamlets", durationMonths: 12, primaryKPIs: ["Antenatal check-ups completed", "Institutional deliveries"], reportingCadence: "Quarterly" },
  "Himalayan Forestation Drive": { expectedBeneficiaries: 900, beneficiaryGroup: "Households in 6 hill villages that depend on forest produce", durationMonths: 24, primaryKPIs: ["Saplings planted", "Sapling survival rate after monsoon"], reportingCadence: "Half-yearly" },
  "Riverbank Cleanup Campaigns": { expectedBeneficiaries: null, beneficiaryGroup: null, durationMonths: null, primaryKPIs: [], reportingCadence: null },
  "Sewing Training Centers": { expectedBeneficiaries: 120, beneficiaryGroup: "Women aged 18–45 from low-income households in Jaipur", durationMonths: 9, primaryKPIs: ["Women trained", "Women earning from tailoring within 3 months"], reportingCadence: "Quarterly" },
  "Micro-loans for Women Artisans": { expectedBeneficiaries: 80, beneficiaryGroup: "Women block-print and embroidery artisans in self-help groups", durationMonths: 12, primaryKPIs: ["Loans disbursed", "Loan repayment rate"], reportingCadence: "Quarterly" },
  "Youth Welding Certification Program": { expectedBeneficiaries: 60, beneficiaryGroup: "Unemployed youth aged 18–25 from Nagpur's industrial belt", durationMonths: 8, primaryKPIs: ["Youth certified", "Youth placed in jobs"], reportingCadence: "Monthly" },
  "Electrical Technician Track": { expectedBeneficiaries: 40, beneficiaryGroup: "School leavers aged 18–24 from Nagpur district", durationMonths: 10, primaryKPIs: ["Trainees certified", "Trainees placed in jobs"], reportingCadence: "Quarterly" },
  "Child Nutrition & Learning Centers": { expectedBeneficiaries: 300, beneficiaryGroup: "Children under 6 in urban slums of Bhopal", durationMonths: 12, primaryKPIs: ["Children receiving daily meals", "Children at healthy weight-for-age"], reportingCadence: "Monthly" },
  "Legal Aid for Street Children": { expectedBeneficiaries: 150, beneficiaryGroup: "Street-connected children and adolescents in Bhopal", durationMonths: 12, primaryKPIs: ["Children with identity documents", "Cases resolved"], reportingCadence: "Quarterly" },
  "Daily Community Kitchen": { expectedBeneficiaries: 800, beneficiaryGroup: "Daily-wage workers and elderly residents in north Chennai", durationMonths: 12, primaryKPIs: ["Meals served", "Days of uninterrupted service"], reportingCadence: "Monthly" },
  "Fisherfolk Breakfast Drive": { expectedBeneficiaries: 350, beneficiaryGroup: "Children of fishing families along the Chennai coast", durationMonths: 6, primaryKPIs: ["Breakfasts served", "School attendance"], reportingCadence: "Monthly" },
};

/** "Bangalore, Karnataka" -> "Karnataka". */
export const stateOf = (address: string) => address.split(",").pop()!.trim();
