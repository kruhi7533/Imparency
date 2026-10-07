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

/**
 * Does this free text name one of `options`?
 *
 * Deliberately a containment test rather than equality. Both the extractor and
 * the donor form legitimately produce compound values -- "Education & skilling",
 * "Maharashtra, Goa" -- that are correct but are not list entries, so equality
 * would reject good data. What this is here to catch is the opposite case: a
 * value that names no known option *at all*.
 *
 * Two tiers, both on word boundaries so "Goals" does not match "Goa":
 *   - the whole option appears ("Water & Sanitation"), or
 *   - any word of it with 5+ letters does ("Water and Sanitation" -> "Water").
 * The second tier is what keeps near-miss phrasings working. It is permissive by
 * design: the cost of a false accept is the status quo, the cost of a false
 * reject is an admin blocked from validating a correct requirement.
 */
export function namesKnownOption(value: string, options: string[]): boolean {
  const text = value.toLowerCase();
  // Index walk rather than a built RegExp: the option strings would otherwise
  // need escaping ("Water & Sanitation", "Disability & Inclusion").
  const isBoundary = (char: string | undefined) => char === undefined || !/[a-z0-9]/.test(char);
  const hasWord = (word: string) => {
    for (let from = 0; ; ) {
      const at = text.indexOf(word, from);
      if (at === -1) return false;
      if (isBoundary(text[at - 1]) && isBoundary(text[at + word.length])) return true;
      from = at + 1;
    }
  };
  return options.some(
    (option) =>
      hasWord(option.toLowerCase()) ||
      option
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((word) => word.length >= 5 && hasWord(word))
  );
}
