import { GoogleGenAI, Type } from "@google/genai";

export interface FcraFlag {
  severity: "LOW" | "MEDIUM" | "HIGH";
  issue: string;
}

export interface FcraExtractionReport {
  extracted_data: {
    fcra_number: string | null;
    org_name: string | null;
    issue_date: string | null;   // ISO-ish string as printed on the certificate
    validity_date: string | null; // expiry / valid-until
    authority: string | null;
  };
  number_matches_form: boolean; // extracted FCRA number ≈ the number the NGO typed
  name_matches_org: boolean;    // extracted org name ≈ the registered org name
  flags: FcraFlag[];
  confidence: number; // 0..1
  summary: string;
}

/**
 * Extracts the key fields from an FCRA certificate so an admin can verify it
 * quickly. Mirrors lib/gemini/verify-ngo-docs.ts: graceful mock fallback when
 * GEMINI_API_KEY is absent, JSON-schema-constrained Gemini call otherwise.
 *
 * Note: this is an EXTRACTION + cross-check aid only — it never auto-approves.
 * An admin makes the final call in the FCRA review queue.
 */
export async function verifyFcraDocument(
  formOrgName: string,
  formFcraNumber: string | null,
  file: { buffer: Buffer; filename: string; mimeType: string }
): Promise<FcraExtractionReport> {
  const apiKey = process.env.GEMINI_API_KEY;

  // 1. Mock fallback when no API key.
  if (!apiKey) {
    console.warn("GEMINI_API_KEY is not defined. Falling back to Mock FCRA extraction.");
    return {
      extracted_data: {
        fcra_number: formFcraNumber || "094421234",
        org_name: formOrgName,
        issue_date: "2018-01-01",
        validity_date: "2030-12-31",
        authority: "Ministry of Home Affairs",
      },
      number_matches_form: true,
      name_matches_org: true,
      flags: [
        {
          severity: "LOW",
          issue: "Mock extraction (no GEMINI_API_KEY). Admin must review the certificate manually.",
        },
      ],
      confidence: 0.5,
      summary:
        "Mock FCRA extraction completed. AI analysis was unavailable; full manual review required.",
    };
  }

  // 2. Gemini-based extraction.
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are an AI document verification agent helping a platform admin verify an NGO's FCRA (Foreign Contribution Regulation Act) certificate issued in India by the Ministry of Home Affairs.

You will receive a single PDF: the FCRA Registration Certificate.

FORM SUBMITTED DATA:
- Organization Name: "${formOrgName}"
- FCRA Registration Number (as typed by the NGO): "${formFcraNumber ?? "(not provided)"}"

Extract the following from the certificate if present:
- FCRA Registration Number
- Organization / Association Name
- Date of Issue / Registration Date
- Valid Until / Expiry / Validity Date
- Issuing Authority

Then:
1. Compare the extracted FCRA number with the FORM SUBMITTED number — set number_matches_form true if they match or are very close (ignore spacing/casing), false otherwise. If no form number was provided, set it to true.
2. Compare the extracted organization name with the FORM SUBMITTED organization name — set name_matches_org accordingly (minor formatting differences are fine).
3. Raise flags for issues such as: unreadable/blurry scan, wrong document type (not an FCRA certificate), name mismatch, number mismatch, expired certificate, or signs of tampering. Use severity LOW/MEDIUM/HIGH.
4. Set a confidence from 0 to 1 reflecting how clearly you could read and verify the certificate.
5. Write a one-line plain-text summary for the admin.

Return ONLY a valid JSON object matching the response schema. No markdown, no explanation outside the JSON.`;

  const inlineFile = {
    inlineData: {
      data: file.buffer.toString("base64"),
      mimeType: file.mimeType,
    },
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [prompt, inlineFile],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            extracted_data: {
              type: Type.OBJECT,
              properties: {
                fcra_number: { type: Type.STRING },
                org_name: { type: Type.STRING },
                issue_date: { type: Type.STRING },
                validity_date: { type: Type.STRING },
                authority: { type: Type.STRING },
              },
              required: ["fcra_number", "org_name"],
            },
            number_matches_form: { type: Type.BOOLEAN },
            name_matches_org: { type: Type.BOOLEAN },
            flags: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  severity: { type: Type.STRING }, // "LOW" | "MEDIUM" | "HIGH"
                  issue: { type: Type.STRING },
                },
                required: ["severity", "issue"],
              },
            },
            confidence: { type: Type.NUMBER },
            summary: { type: Type.STRING },
          },
          required: [
            "extracted_data",
            "number_matches_form",
            "name_matches_org",
            "flags",
            "confidence",
            "summary",
          ],
        },
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response received from Gemini API");
    }

    const result = JSON.parse(text);

    return {
      extracted_data: result.extracted_data || {
        fcra_number: null,
        org_name: null,
        issue_date: null,
        validity_date: null,
        authority: null,
      },
      number_matches_form:
        typeof result.number_matches_form === "boolean" ? result.number_matches_form : false,
      name_matches_org:
        typeof result.name_matches_org === "boolean" ? result.name_matches_org : false,
      flags: Array.isArray(result.flags) ? result.flags : [],
      confidence: typeof result.confidence === "number" ? result.confidence : 0.5,
      summary: result.summary || "FCRA extraction complete. Manual review required.",
    };
  } catch (err: any) {
    console.error("Gemini FCRA extraction API error:", err);
    throw new Error(`Gemini FCRA extraction failed: ${err.message}`);
  }
}
