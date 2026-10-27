import { INDIAN_STATES, REPORTING_CADENCES, SECTOR_OPTIONS } from "./form-options";
import { budgetStatements, findAmounts } from "./extraction-checks";
import { REQUIREMENT_FIELD_KEYS, type RequirementFieldKey } from "./provenance";

/**
 * Deterministic, rule-based CSR requirement extractor — the path used when no
 * model key is configured, or the model call fails or times out. Same output
 * shape as the LLM path ({ value, confidence } per field); fields are tagged
 * `source: "RULES"` by the caller so every screen can say "Rule-based
 * extraction — please confirm".
 *
 * Rules, not guesses: a field is filled only when the text states it in a form
 * these patterns recognise. Anything not found stays `null` with confidence 0
 * and the donor fills it in. Nothing is inferred from context, and nothing in
 * the document can instruct this code — it has no instructions to follow.
 *
 * Confidence reflects how the value was found: an explicit label ("Budget:",
 * "State:") scores higher than a keyword elsewhere in the text. Every value is
 * capped at RULE_CONFIDENCE_MAX so a rule result never reads as certain.
 *
 * Pure module: no I/O, safe to test on fixtures.
 */

export const RULE_EXTRACTOR_VERSION = "rules-v1";
export const RULE_CONFIDENCE_MAX = 0.85;

export type RuleField = { value: unknown; confidence: number };
export type RuleExtraction = Record<RequirementFieldKey, RuleField>;

const LABELLED = 0.85;
const KEYWORD = 0.6;
const WEAK = 0.4;

const none = (): RuleField => ({ value: null, confidence: 0 });
const found = (value: unknown, confidence: number): RuleField => ({ value, confidence: Math.min(confidence, RULE_CONFIDENCE_MAX) });

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Text after "Label:" at the start of a line or sentence whose label matches. */
function labelled(ls: string[], label: RegExp): string | null {
  const segments = ls.flatMap((l) => l.split(/(?<=[.;])\s+(?=[A-Z])/));
  for (const l of segments) {
    const m = l.match(new RegExp(`^\\s*(?:${label.source})\\s*[:\\-–]\\s*(.+)$`, "i"));
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

function containsWord(text: string, word: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escape(word.toLowerCase())}([^a-z0-9]|$)`, "i").test(text.toLowerCase());
}

const SECTOR_KEYWORDS: Record<string, string[]> = {
  Education: ["education", "school", "schools", "literacy", "students", "learning"],
  Healthcare: ["healthcare", "health", "hospital", "medical", "nutrition clinic"],
  Environment: ["environment", "climate", "afforestation", "tree plantation", "renewable"],
  "Women Empowerment": ["women empowerment", "women's empowerment", "gender"],
  "Rural Development": ["rural development", "village development"],
  Hunger: ["hunger", "malnutrition", "mid-day meal", "food security"],
  "Skill Development": ["skill development", "skilling", "vocational training"],
  Livelihood: ["livelihood", "livelihoods", "income generation"],
  "Water & Sanitation": ["water", "sanitation", "wash", "toilets"],
  "Child Welfare": ["child welfare", "child protection", "children's welfare"],
  "Disability & Inclusion": ["disability", "persons with disabilities", "inclusion"],
  "Disaster Relief": ["disaster relief", "flood relief", "disaster"],
};

function extractSector(text: string, ls: string[]): RuleField {
  const label = labelled(ls, /sector|cause|thematic area|focus area|programme area|program area|csr (?:sector|area)/);
  if (label) {
    const option = SECTOR_OPTIONS.find((o) => containsWord(label, o)) ??
      SECTOR_OPTIONS.find((o) => SECTOR_KEYWORDS[o]?.some((k) => containsWord(label, k)));
    if (option) return found(option, LABELLED);
  }
  // Keyword count across the document; only a clear winner counts.
  const scores = SECTOR_OPTIONS.map((o) => ({
    o,
    n: (SECTOR_KEYWORDS[o] ?? [o.toLowerCase()]).reduce(
      (s, k) => s + (text.toLowerCase().match(new RegExp(`(^|[^a-z])${escape(k)}([^a-z]|$)`, "g"))?.length ?? 0),
      0
    ),
  })).sort((a, b) => b.n - a.n);
  if (scores[0].n >= 2 && scores[0].n > (scores[1]?.n ?? 0)) return found(scores[0].o, KEYWORD);
  return none();
}

function extractState(text: string, ls: string[]): RuleField {
  const label = labelled(ls, /(?:target )?state|geography|location|region/);
  const states = INDIAN_STATES.filter((s) => s !== "Pan-India");
  if (label) {
    const hit = states.filter((s) => containsWord(label, s));
    if (hit.length === 1) return found(hit[0], LABELLED);
    if (hit.length > 1) return found(hit.join(", "), KEYWORD);
    if (/pan[\s-]?india|all india|nationwide/i.test(label)) return found("Pan-India", LABELLED);
  }
  if (/\bpan[\s-]?india\b/i.test(text)) return found("Pan-India", KEYWORD);
  const hits = states.filter((s) => containsWord(text, s));
  if (hits.length === 1) return found(hits[0], KEYWORD);
  return none(); // several states mentioned without a label: ambiguous, leave to the donor
}

function extractDistrict(text: string, ls: string[]): RuleField {
  const label = labelled(ls, /(?:target )?district/);
  if (label) return found(label.split(/[,;]/)[0].trim().slice(0, 120), LABELLED);
  const m = text.match(/\bdistrict(?:s)?\s+(?:of\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/);
  if (m) return found(m[1], KEYWORD);
  const m2 = text.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\s+district\b/);
  if (m2) return found(m2[1], KEYWORD);
  return none();
}

function extractBudget(text: string): { min: RuleField; max: RuleField; conflict: boolean } {
  const statements = budgetStatements(text);
  if (statements.length === 0) return { min: none(), max: none(), conflict: false };
  const distinct = new Map(statements.map((s) => [`${s.min}-${s.max}`, s]));
  // Conflicting figures: take the FIRST statement but at weak confidence — the
  // BUDGET_CONFLICT flag (extraction-checks.ts) asks a human to confirm.
  const first = statements[0];
  const conf = distinct.size > 1 ? WEAK : LABELLED;
  const isRange = first.min !== first.max;
  const upTo = !isRange && /\b(up\s*to|upto|maximum|not exceeding|max(?:imum)?\.?)\b/i.test(first.text);
  return {
    min: isRange ? found(first.min, conf) : upTo ? none() : found(first.min, conf),
    max: found(first.max, conf),
    conflict: distinct.size > 1,
  };
}

function extractDuration(text: string, ls: string[]): RuleField {
  const source = labelled(ls, /duration|project period|programme duration|program duration|tenure/) ?? text;
  const conf = source === text ? KEYWORD : LABELLED;
  const months = source.match(/\b(\d{1,3})\s*(?:-\s*)?months?\b/i);
  if (months) return found(Number(months[1]), conf);
  const years = source.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:-\s*)?years?\b/i);
  if (years && source !== text) return found(Math.round(Number(years[1]) * 12), conf);
  const yearsInText = text.match(/\b(?:duration|period|over|for)\s+(?:of\s+)?(\d{1,2})\s*years?\b/i);
  if (yearsInText) return found(Number(yearsInText[1]) * 12, KEYWORD);
  return none();
}

const BENEFICIARY_NOUN =
  "beneficiar(?:y|ies)|students|children|girls|boys|women|farmers|families|households|youth|patients|people|persons|individuals|villagers|teachers|schools";

function extractBeneficiaries(text: string, ls: string[]): RuleField {
  const label = labelled(ls, /(?:expected |target |number of )?beneficiar(?:y|ies)(?: count| reach)?|target (?:group|reach|population)|reach/);
  const parseNum = (s: string) => Number(s.replace(/,/g, ""));
  if (label) {
    const m = label.match(/(\d[\d,]*)/);
    if (m && parseNum(m[1]) > 0) return found(parseNum(m[1]), LABELLED);
  }
  const m = text.match(new RegExp(`\\b(\\d[\\d,]*)\\s*(?:\\+\\s*)?(?:${BENEFICIARY_NOUN})\\b`, "i"));
  if (m && parseNum(m[1]) > 0) return found(parseNum(m[1]), KEYWORD);
  return none();
}

/** Bullet/numbered lines under a heading like "KPIs" / "Outcomes", or the rest of a "KPIs:" line. */
function extractList(ls: string[], heading: RegExp): string[] | null {
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(new RegExp(`^\\s*(?:${heading.source})\\s*[:\\-–]?\\s*(.*)$`, "i"));
    if (!m) continue;
    const items: string[] = [];
    if (m[1].trim()) items.push(...m[1].split(/[;,]/).map((s) => s.trim()).filter(Boolean));
    for (let j = i + 1; j < ls.length && items.length < 10; j++) {
      const b = ls[j].match(/^\s*(?:[-•*▪●]|\d{1,2}[.)])\s+(.+)$/);
      if (!b) break;
      items.push(b[1].trim());
    }
    if (items.length) return items.map((s) => s.slice(0, 200));
  }
  return null;
}

function extractCadence(text: string, ls: string[]): RuleField {
  const label = labelled(ls, /reporting(?: cadence| frequency| requirements?)?|reports?/);
  const map: Array<[RegExp, string]> = [
    [/\bmonthly\b/i, "Monthly"],
    [/\bquarterly\b/i, "Quarterly"],
    [/\bhalf[\s-]?yearly\b|\bbi[\s-]?annual(?:ly)?\b|\bsix[\s-]monthly\b/i, "Half-yearly"],
    [/\bannual(?:ly)?\b|\byearly\b/i, "Annually"],
  ];
  if (label) {
    const hit = map.find(([re]) => re.test(label));
    if (hit) return found(hit[1], LABELLED);
  }
  const m = text.match(/\b(monthly|quarterly|half[\s-]?yearly|annual(?:ly)?)\s+(?:progress\s+)?(?:reports?|reporting|updates?)\b/i) ??
    text.match(/\breport(?:s|ing)?\s+(?:shall be submitted\s+|on a\s+|every\s+)?(monthly|quarterly|half[\s-]?yearly|annual(?:ly)?)/i);
  if (m) {
    const hit = map.find(([re]) => re.test(m[1]));
    if (hit && REPORTING_CADENCES.includes(hit[1])) return found(hit[1], KEYWORD);
  }
  return none();
}

function extractTimeline(ls: string[], text: string): RuleField {
  const deadline = labelled(ls, /(?:proposal |submission |application )?deadline|last date(?: for submission)?|due date|submit by/);
  const timeline = labelled(ls, /timeline|project timeline|start date|implementation period/);
  const parts = [timeline, deadline ? `Proposal deadline: ${deadline}` : null].filter(Boolean) as string[];
  if (parts.length) return found(parts.join("; ").slice(0, 300), LABELLED);
  const m = text.match(/\b(?:deadline|last date)[^.\n]{0,20}?(\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
  if (m) return found(`Proposal deadline: ${m[1]}`, KEYWORD);
  return none();
}

const DOC_RULES: Array<[RegExp, string]> = [
  [/\b12\s*-?\s*A{1,2}\b/i, "12A registration"],
  [/\b80\s*-?\s*G\b/i, "80G certificate"],
  [/\bFCRA\b/i, "FCRA registration"],
  [/\bCSR\s*-?\s*1\b/i, "CSR-1 registration"],
  [/\bPAN\b/, "PAN of the NGO"],
  [/\baudited (?:financials|financial statements|accounts)\b/i, "Audited financials (last 3 years)"],
  [/\bannual reports?\b/i, "Annual report"],
];

function extractDocuments(text: string, ls: string[]): RuleField {
  const section = labelled(ls, /(?:required |mandatory |eligibility )?documents?(?: required)?|eligibility(?: criteria)?/);
  const list = extractList(ls, /(?:required |mandatory )?documents(?: required)?|eligibility(?: criteria)?/);
  const scope = [section ?? "", ...(list ?? [])].join(" ");
  const fromScope = DOC_RULES.filter(([re]) => re.test(scope)).map(([, d]) => d);
  if (fromScope.length) return found(fromScope, LABELLED);
  const anywhere = DOC_RULES.filter(([re, d]) => re.test(text) && d !== "PAN of the NGO").map(([, d]) => d);
  return anywhere.length ? found(anywhere, KEYWORD) : none();
}

function extractFcra(text: string): RuleField {
  if (/\bFCRA\b[^.\n]{0,40}\b(not required|not mandatory|not applicable|not needed)\b/i.test(text) ||
      /\b(no|without)\s+FCRA\b/i.test(text) ||
      // A form-style answer: "FCRA registration required: No" — the "No" is the answer.
      /\bFCRA\b[^.\n]{0,60}\b(required|mandatory)\b\??\s*[:\-–]\s*(no|false|not required|n\/a)\b/i.test(text)) {
    return found(false, LABELLED);
  }
  if (/\bFCRA\b[^.\n]{0,60}\b(required|mandatory|must|necessary|registered|registration)\b/i.test(text) ||
      /\b(must|should|required to)\b[^.\n]{0,60}\bFCRA\b/i.test(text) ||
      /\bforeign contribution\b/i.test(text)) {
    return found(true, LABELLED);
  }
  return none();
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/;

function extractSummary(ls: string[]): RuleField {
  const label = labelled(ls, /(?:executive )?summary|objective|purpose|background|overview|about the (?:programme|program|project)/);
  if (label) return found(label.slice(0, 1000), LABELLED);
  // The title line (first line with letters), clearly weak.
  const title = ls.find((l) => /[a-z]{3}/i.test(l) && l.length <= 200);
  return title ? found(title, WEAK) : none();
}

/**
 * Extracts every requirement field from document text by rule. Fields not
 * found are null/0. `budgetConflict` reports more than one stated budget.
 */
export function extractByRules(text: string): { data: RuleExtraction; budgetConflict: boolean } {
  const ls = lines(text);
  const budget = extractBudget(text);
  const kpis = extractList(ls, /(?:primary |key )?(?:kpis?|key performance indicators|expected outcomes|outcomes|deliverables)/);
  const secondary = extractList(ls, /secondary (?:kpis?|outcomes|indicators)/);
  const email = text.match(EMAIL)?.[0] ?? null;
  const phone = text.match(PHONE)?.[0] ?? null;
  const person = labelled(ls, /contact(?: person| name)?|point of contact|spoc/);
  const constraints = labelled(ls, /special (?:constraints|conditions)|constraints|exclusions|conditions/);
  const hasCurrency = /₹|\bINR\b|\bRs\.?/i.test(text) || findAmounts(text).some((a) => /lakh|lac|crore|cr\b/i.test(a.raw));

  const data = {} as RuleExtraction;
  for (const k of REQUIREMENT_FIELD_KEYS) data[k] = none();
  Object.assign(data, {
    summary: extractSummary(ls),
    sector: extractSector(text, ls),
    state: extractState(text, ls),
    district: extractDistrict(text, ls),
    budgetMin: budget.min,
    budgetMax: budget.max,
    currency: budget.max.value !== null && hasCurrency ? found("INR", LABELLED) : none(),
    durationMonths: extractDuration(text, ls),
    expectedBeneficiaries: extractBeneficiaries(text, ls),
    primaryKPIs: kpis ? found(kpis, LABELLED) : none(),
    secondaryKPIs: secondary ? found(secondary, LABELLED) : none(),
    reportingCadence: extractCadence(text, ls),
    timeline: extractTimeline(ls, text),
    requiredDocuments: extractDocuments(text, ls),
    contactPerson: person && !EMAIL.test(person) ? found(person.slice(0, 120), LABELLED) : none(),
    contactEmail: email ? found(email, LABELLED) : none(),
    contactPhone: phone ? found(phone, KEYWORD) : none(),
    specialConstraints: constraints ? found(constraints.slice(0, 1000), LABELLED) : none(),
    fcraRequired: extractFcra(text),
  } satisfies Partial<RuleExtraction>);
  return { data, budgetConflict: budget.conflict };
}
