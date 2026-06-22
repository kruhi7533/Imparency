import { GoogleGenAI, Type } from "@google/genai";
import prisma from "@/lib/prisma";

export interface VerificationReport {
  extracted_data: {
    org_name: string | null;
    registration_number: string | null;
    pan_number: string | null;
    ngo_8og_number: string | null;
    validity_notes: string | null;
  };
  consistency_score: number;
  flags: { severity: "LOW" | "MEDIUM" | "HIGH"; issue: string }[];
  recommendation: "APPROVE" | "REVIEW_CAREFULLY" | "LIKELY_FRAUD";
  summary: string;
}

export async function verifyNGODocuments(
  ngoProfileId: string,
  formOrgName: string,
  formRegNumber: string,
  formPanNumber: string,
  files: { buffer: Buffer; filename: string; mimeType: string }[]
): Promise<VerificationReport> {
  const apiKey = process.env.GEMINI_API_KEY;

  // 1. Fallback to Mock Validation if GEMINI_API_KEY is not defined
  if (!apiKey) {
    console.warn("GEMINI_API_KEY is not defined. Falling back to Mock verification.");
    const isMockSuspicious = formOrgName.toLowerCase().includes("fraud") ||
                             formRegNumber.includes("9999") ||
                             formPanNumber.includes("9999");
                             
    const flags: { severity: "LOW" | "MEDIUM" | "HIGH"; issue: string }[] = [];
    if (isMockSuspicious) {
      flags.push({ severity: "HIGH", issue: "Mock verification: Potential fraud indicator detected." });
    }
    
    // Check for duplicates in database
    const duplicateProfile = await prisma.nGOProfile.findFirst({
      where: {
        id: { not: ngoProfileId },
        OR: [
          { registrationNumber: formRegNumber },
          { panNumber: formPanNumber }
        ]
      }
    });

    if (duplicateProfile) {
      flags.push({ 
        severity: "HIGH", 
        issue: `Duplicate registration details detected: Registration number or PAN matches another registered NGO profile (ID: ${duplicateProfile.id})` 
      });
    }

    const recommendation = (isMockSuspicious || duplicateProfile) ? "LIKELY_FRAUD" : "APPROVE";
    const consistency_score = (isMockSuspicious || duplicateProfile) ? 35 : 98;
    const summary = (isMockSuspicious || duplicateProfile)
      ? `Mock verification flagged organization "${formOrgName}" as LIKELY_FRAUD due to duplicate records or mock test inputs.`
      : `Mock verification completed. Organization name and credentials match the mock documents successfully.`;

    return {
      extracted_data: {
        org_name: formOrgName,
        registration_number: formRegNumber,
        pan_number: formPanNumber,
        ngo_8og_number: "80G/2026/MOCK-1",
        validity_notes: "Valid through 2031-03-31"
      },
      consistency_score,
      flags,
      recommendation,
      summary
    };
  }

  // 2. Gemini-based Document verification
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are an AI document verification agent assisting a platform admin in verifying NGO registration documents in India.
Your task is to analyze the three uploaded PDF documents in order:
1. Certificate of Registration
2. NGO PAN Card Copy
3. 80G Registration Copy

FORM SUBMITTED DATA:
- Organization Name: "${formOrgName}"
- Registration Number: "${formRegNumber}"
- PAN Number: "${formPanNumber}"

For each document, extract the following details if present:
- Organization Name
- Registration Number
- PAN Number
- 80G Certificate Number
- Certificate Validity or Issue Dates

Analyze the extracted data and:
1. Cross-check each extracted value against the FORM SUBMITTED DATA. Check for exact matches or very close equivalents (e.g. minor spacing or casing differences are okay, but different names or numbers are mismatches).
2. Check for internal consistency across the documents (e.g., does the PAN number on the PAN card copy match the PAN number referred to in the 80G copy).
3. Look for validation issues, such as:
   - Name mismatch (Form Name vs Document Name)
   - Registration number mismatch
   - PAN mismatch
   - Illegible or unreadable document
   - Expired or missing validity dates
   - Suspiciously low-quality scan or signs of tampering
4. Set a consistency score from 0 to 100 based on matches and readability.
5. Determine a recommendation:
   - "APPROVE": If all details match perfectly, documents are valid, and there are no issues.
   - "REVIEW_CAREFULLY": If there are minor mismatches, formatting differences, or missing dates that require manual review.
   - "LIKELY_FRAUD": If there are major mismatches (e.g., different PAN numbers, completely different org names), signs of tampering, or unreadable documents.

Return ONLY a valid JSON object matching the response schema. No markdown, no HTML, no explanation outside the JSON.`;

  const inlineFiles = files.map((f) => ({
    inlineData: {
      data: f.buffer.toString("base64"),
      mimeType: f.mimeType
    }
  }));

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [prompt, ...inlineFiles],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            extracted_data: {
              type: Type.OBJECT,
              properties: {
                org_name: { type: Type.STRING },
                registration_number: { type: Type.STRING },
                pan_number: { type: Type.STRING },
                ngo_8og_number: { type: Type.STRING },
                validity_notes: { type: Type.STRING }
              },
              required: ["org_name", "registration_number", "pan_number"]
            },
            consistency_score: { type: Type.INTEGER },
            flags: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  severity: { type: Type.STRING }, // "LOW", "MEDIUM", "HIGH"
                  issue: { type: Type.STRING }
                },
                required: ["severity", "issue"]
              }
            },
            recommendation: { type: Type.STRING }, // "APPROVE", "REVIEW_CAREFULLY", "LIKELY_FRAUD"
            summary: { type: Type.STRING }
          },
          required: ["extracted_data", "consistency_score", "flags", "recommendation", "summary"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response received from Gemini API");
    }

    const result = JSON.parse(text);

    const extracted_data = result.extracted_data || {
      org_name: null,
      registration_number: null,
      pan_number: null,
      ngo_8og_number: null,
      validity_notes: null
    };
    
    let consistency_score = typeof result.consistency_score === "number" ? result.consistency_score : 50;
    const flags: { severity: "LOW" | "MEDIUM" | "HIGH"; issue: string }[] = Array.isArray(result.flags) ? result.flags : [];
    let recommendation = result.recommendation || "REVIEW_CAREFULLY";
    let summary = result.summary || "AI document verification complete. Review required.";

    // 3. Database Check: Check for duplicate registration numbers or PAN numbers against existing Profiles
    const duplicateProfile = await prisma.nGOProfile.findFirst({
      where: {
        id: { not: ngoProfileId },
        OR: [
          { registrationNumber: formRegNumber },
          { panNumber: formPanNumber }
        ]
      }
    });

    if (duplicateProfile) {
      flags.push({ 
        severity: "HIGH", 
        issue: `Duplicate registration details detected: Registration number or PAN matches another registered NGO profile (ID: ${duplicateProfile.id})` 
      });
      recommendation = "LIKELY_FRAUD";
      consistency_score = Math.min(consistency_score, 30);
      summary = `WARNING: Duplicate Registration Number or PAN Number matches another registered NGO profile in the database. Potential fraudulent double registration. ${summary}`;
    }

    return {
      extracted_data,
      consistency_score,
      flags,
      recommendation,
      summary
    };
  } catch (err: any) {
    console.error("Gemini NGO documents verification API error:", err);
    throw new Error(`Gemini verification failed: ${err.message}`);
  }
}
