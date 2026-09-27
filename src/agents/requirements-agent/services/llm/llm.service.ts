import { GoogleGenAI, Type } from '@google/genai';
import { RequirementSchema, ExtractedRequirementJSON } from '../../validators/schema';
import { SYSTEM_PROMPT } from '../../prompts';
import crypto from 'crypto';

export interface LLMExtractionResult {
  data: ExtractedRequirementJSON;
  metadata: {
    promptHash: string;
    model: string;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    responseId: string;
  };
}

const GEMINI_MODEL = 'gemini-3.6-flash';

// Tried in order. When a model is overloaded (503) or rate-limited (429) the
// next one usually still has capacity. flash-lite is what most of lib/gemini uses.
const MODEL_CHAIN = [GEMINI_MODEL, 'gemini-3.5-flash-lite'];

/**
 * Thrown when every model in the chain was out of capacity. This is a temporary
 * provider-side condition, not a problem with the document, so callers should
 * surface it as "try again shortly" (HTTP 503) rather than a generic failure.
 */
export class LlmUnavailableError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(
      'The AI service (Google Gemini) is temporarily overloaded, so your document could not be analysed right now. ' +
      'Please try again in a minute or two.'
    );
    this.name = 'LlmUnavailableError';
    this.detail = detail;
  }
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Phone numbers only where they are unambiguous: an explicit country code, or
// right after a phone/mobile/tel/contact label. Bare digit runs are left alone
// so budgets like "6000000000" are never mistaken for phone numbers.
const PHONE_PATTERN = /\+\d{1,3}[\s-]?\d[\d\s-]{7,13}\d|(?<=\b(?:phone|mobile|mob|tel|telephone|contact(?:\s+no)?)\.?\s*[:\-]?\s*)\d[\d\s-]{7,13}\d/gi;

/**
 * Replaces emails and phone numbers with placeholders ([EMAIL_1], [PHONE_1])
 * before document text is sent to the LLM, so donor contact PII never leaves
 * the platform. The placeholders are mapped back in the structured result.
 */
export function redactContactDetails(text: string): { text: string; tokens: Map<string, string> } {
  const tokens = new Map<string, string>();
  const replaceWith = (prefix: string) => {
    const seen = new Map<string, string>();
    return (match: string) => {
      if (!seen.has(match)) {
        const token = `[${prefix}_${seen.size + 1}]`;
        seen.set(match, token);
        tokens.set(token, match);
      }
      return seen.get(match)!;
    };
  };
  const redacted = text.replace(EMAIL_PATTERN, replaceWith("EMAIL")).replace(PHONE_PATTERN, replaceWith("PHONE"));
  return { text: redacted, tokens };
}

function restoreContactDetails<T>(data: T, tokens: Map<string, string>): T {
  if (tokens.size === 0) return data;
  const restore = (s: string) => s.replace(/\[(EMAIL|PHONE)_\d+\]/g, (t) => tokens.get(t) ?? t);
  const walk = (v: any): any =>
    typeof v === "string" ? restore(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
      : v;
  return walk(data);
}

/** 503 UNAVAILABLE / 429 RESOURCE_EXHAUSTED — capacity problems that another model or a later retry can fix. */
function isCapacityError(err: any): boolean {
  if (err?.status === 503 || err?.status === 429) return true;
  const message = String(err?.message ?? err ?? '');
  return /\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(message);
}

/** { value, confidence } pair, mirroring `fieldSchema` in ../../validators/schema. */
const field = (valueType: any) => ({
  type: Type.OBJECT,
  properties: {
    value: { ...valueType, nullable: true },
    confidence: { type: Type.NUMBER },
  },
  required: ['value', 'confidence'],
});

const STRING = { type: Type.STRING };
const NUMBER = { type: Type.NUMBER };
const STRING_ARRAY = { type: Type.ARRAY, items: { type: Type.STRING } };

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    sector: field(STRING),
    state: field(STRING),
    district: field(STRING),
    budgetMin: field(NUMBER),
    budgetMax: field(NUMBER),
    currency: field(STRING),
    durationMonths: field(NUMBER),
    expectedBeneficiaries: field(NUMBER),
    primaryKPIs: field(STRING_ARRAY),
    secondaryKPIs: field(STRING_ARRAY),
    reportingCadence: field(STRING),
    timeline: field(STRING),
    requiredDocuments: field(STRING_ARRAY),
    contactPerson: field(STRING),
    contactEmail: field(STRING),
    contactPhone: field(STRING),
    specialConstraints: field(STRING),
    summary: field(STRING),
  },
  required: [
    'sector', 'state', 'district', 'budgetMin', 'budgetMax', 'currency',
    'durationMonths', 'expectedBeneficiaries', 'primaryKPIs', 'secondaryKPIs',
    'reportingCadence', 'timeline', 'requiredDocuments', 'contactPerson',
    'contactEmail', 'contactPhone', 'specialConstraints', 'summary',
  ],
};

export class LlmService {
  /**
   * Sends cleaned text to Gemini using a structured response schema.
   * Retries each model with exponential backoff, and moves on to the next model
   * in MODEL_CHAIN only when the current one is out of capacity.
   */
  static async extractStructuredRequirements(
    cleanedText: string,
    maxRetries: number = 3
  ): Promise<LLMExtractionResult> {
    // Mock output is only ever returned when it is asked for explicitly. A
    // missing API key must fail loudly — returning fabricated CSR figures that
    // look like a successful extraction is far worse than an error.
    if (process.env.MOCK_AI === 'true') {
      return this.getMockResult(cleanedText);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'GEMINI_API_KEY is not configured, so the CSR document cannot be analysed. ' +
        'Set GEMINI_API_KEY in the environment (or MOCK_AI=true for local development).'
      );
    }

    const ai = new GoogleGenAI({ apiKey });
    const { text: llmText, tokens: contactTokens } = redactContactDetails(cleanedText);
    const promptHash = crypto.createHash('sha256').update(SYSTEM_PROMPT + llmText).digest('hex');

    let lastError: any;

    for (const model of MODEL_CHAIN) {
      let delay = 1000; // start with 1s delay

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const startTime = Date.now();

        try {
          console.log(`Sending text to Gemini ${model} (Attempt ${attempt}/${maxRetries})...`);
          const response = await ai.models.generateContent({
            model,
            contents: [llmText],
            config: {
              systemInstruction: SYSTEM_PROMPT,
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA,
              temperature: 0.0, // deterministic
            },
          });

          const latencyMs = Date.now() - startTime;
          const text = response.text;

          if (!text) {
            throw new Error('Gemini returned an empty response.');
          }

          const validated = restoreContactDetails(RequirementSchema.parse(JSON.parse(text)), contactTokens);
          const usage = response.usageMetadata;

          return {
            data: validated,
            metadata: {
              promptHash,
              model,
              latencyMs,
              promptTokens: usage?.promptTokenCount || 0,
              completionTokens: usage?.candidatesTokenCount || 0,
              totalTokens: usage?.totalTokenCount || 0,
              responseId: response.responseId || '',
            },
          };
        } catch (err: any) {
          lastError = err;
          console.error(`LLM extraction with ${model} attempt ${attempt} failed:`, err.message || err);

          if (attempt < maxRetries) {
            // Wait with exponential backoff + jitter
            const jitter = Math.random() * 200;
            await new Promise((resolve) => setTimeout(resolve, delay + jitter));
            delay *= 2;
          }
        }
      }

      // Only fall through to the next model when this one was out of capacity;
      // other failures (malformed output, invalid request) won't be fixed by switching.
      if (!isCapacityError(lastError)) break;
      console.warn(`Gemini ${model} is out of capacity; trying the next model.`);
    }

    if (isCapacityError(lastError)) {
      throw new LlmUnavailableError(lastError?.message || String(lastError));
    }
    throw new Error(
      `Failed to extract structured requirements after ${maxRetries} attempts. Last error: ${lastError?.message || lastError}`
    );
  }

  /**
   * Generates mock results for test suites and localized sandbox runs.
   */
  private static getMockResult(text: string): LLMExtractionResult {
    console.warn('MOCK_AI is enabled. Returning mock requirements — these are not real extractions.');
    const promptHash = crypto.createHash('sha256').update(SYSTEM_PROMPT + text).digest('hex');
    const hasEducation = /education/i.test(text);
    const hasKarnataka = /karnataka/i.test(text);
    const hasBangalore = /bangalore/i.test(text);
    const hasBudget = /budget/i.test(text);

    const mockFields: ExtractedRequirementJSON = {
      sector: { value: hasEducation ? 'Education' : 'Healthcare', confidence: 0.95 },
      state: { value: hasKarnataka ? 'Karnataka' : 'Maharashtra', confidence: 0.90 },
      district: { value: hasBangalore ? 'Bangalore' : 'Mumbai', confidence: 0.85 },
      budgetMin: { value: hasBudget ? 5000000 : 1000000, confidence: 0.92 },
      budgetMax: { value: hasBudget ? 10000000 : 2000000, confidence: 0.88 },
      currency: { value: 'INR', confidence: 0.99 },
      durationMonths: { value: 12, confidence: 0.95 },
      expectedBeneficiaries: { value: 1500, confidence: 0.82 },
      primaryKPIs: { value: ['Student literacy rates', 'Teacher training hours'], confidence: 0.89 },
      secondaryKPIs: { value: ['School infrastructure completion'], confidence: 0.80 },
      reportingCadence: { value: 'Quarterly', confidence: 0.91 },
      timeline: { value: 'FY2026-Q1 to Q4', confidence: 0.85 },
      requiredDocuments: { value: ['80G Certificate', '12A Registration'], confidence: 0.94 },
      contactPerson: { value: 'Sarah Jenkins', confidence: 0.96 },
      contactEmail: { value: 'sarah.j@corporate-csr.org', confidence: 0.99 },
      contactPhone: { value: '+919900011223', confidence: 0.97 },
      specialConstraints: { value: 'Must adhere to FCRA limits', confidence: 0.84 },
      summary: { value: 'Extracted summary of CSR target requirements.', confidence: 0.90 },
    };

    return {
      data: mockFields,
      metadata: {
        promptHash,
        model: 'mock-gemini-3.6-flash',
        latencyMs: 150,
        promptTokens: 420,
        completionTokens: 210,
        totalTokens: 630,
        responseId: 'mock-response-id-12345',
      },
    };
  }
}
