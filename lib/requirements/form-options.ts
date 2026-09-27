/**
 * Option lists for the structured CSR requirement form and its downloadable
 * template (public/templates/csr-requirement-template.docx). Pure data — safe
 * to import from client components.
 */

/** Project cause categories first: matching compares the sector against these. */
export const SECTOR_OPTIONS = [
  "Education",
  "Healthcare",
  "Environment",
  "Women Empowerment",
  "Rural Development",
  "Hunger",
  "Skill Development",
  "Livelihood",
  "Water & Sanitation",
  "Child Welfare",
  "Disability & Inclusion",
  "Disaster Relief",
];

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
  "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
  "Pan-India",
];

export const REPORTING_CADENCES = ["Monthly", "Quarterly", "Half-yearly", "Annually", "At each milestone"];

/**
 * Wording matters: lib/requirements/facts.ts detects "FCRA", "80G" and "12A"
 * in required documents to apply the hard eligibility rules in matching.
 */
export const COMMON_DOCUMENTS = [
  "12A registration",
  "80G certificate",
  "FCRA registration",
  "CSR-1 registration",
  "PAN of the NGO",
  "Audited financials (last 3 years)",
  "Annual report",
  "Project proposal & budget",
];
