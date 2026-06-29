import { PrismaClient } from "@prisma/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { v2 as cloudinary } from 'cloudinary';

const prisma = new PrismaClient();

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

async function uploadToCloudinary(twilioUrl: string, draftId: string): Promise<string | null> {
  try {
    const result = await cloudinary.uploader.upload(twilioUrl, {
      folder: `whatsapp-proofs/${draftId}`,
      resource_type: 'auto',
      timeout: 15000
    });
    return result.secure_url;
  } catch (err) {
    console.error('[worker] Cloudinary upload failed:', twilioUrl, err);
    return null;  // non-fatal: return null, continue worker
  }
}

async function checkFailureRate(ngoId: string) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [total, failed] = await Promise.all([
    prisma.draftProof.count({
      where: { ngoId, createdAt: { gte: oneHourAgo } }
    }),
    prisma.draftProof.count({
      where: { ngoId, workerStatus: 'ENRICHMENT_FAILED', createdAt: { gte: oneHourAgo } }
    })
  ]);
  
  if (total >= 5 && failed / total >= 0.2) {
    // High-priority alert — replace console.error with Slack/email hook later
    console.error(`[ALERT] High enrichment failure rate: ${failed}/${total} in last hour for NGO ${ngoId}`);
    // TODO: await sendSlackAlert(`Gemini failure rate ${Math.round(failed/total*100)}% — check API key/quota`)
  }
}

const MAX_RETRIES = 2;
const TIMEOUT_MS = 25000; // 25 seconds

async function fetchWithRetryAndTimeout(prompt: string, systemPrompt: string): Promise<string> {
  if (!apiKey) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY environment variable is missing.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-pro", 
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          predictedProjectId:    { type: "string",  nullable: true },
          predictedMilestoneId:  { type: "string",  nullable: true },
          predictionConfidence:  { type: "number" },
          aiSummary:             { type: "string"  },
          riskLevel:             { type: "string", enum: ["LOW","MEDIUM","HIGH"] },
          riskReason:            { type: "string",  nullable: true }
        },
        required: ["predictionConfidence","aiSummary","riskLevel"]
      }
    }
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Gemini API timeout")), TIMEOUT_MS)
      );

      const generatePromise = model.generateContent(prompt);

      const result = await Promise.race([generatePromise, timeoutPromise]);
      const text = result.response.text();
      return text;
    } catch (error) {
      console.warn(`[worker] Gemini attempt ${attempt} failed:`, error);
      if (attempt === MAX_RETRIES) {
        throw error;
      }
    }
  }
  
  throw new Error("All Gemini attempts failed.");
}

export async function processProofInBackground(draftId: string, ngoId: string): Promise<void> {
  console.log(`[worker] Starting enrichment for draft ${draftId}...`);
  
  try {
    // STEP 1 — Mark as enriching
    await prisma.draftProof.update({
      where: { id: draftId },
      data: { workerStatus: "ENRICHING" },
    });

    // STEP 2 — Fetch context
    const draft = await prisma.draftProof.findUnique({
      where: { id: draftId },
    });

    if (!draft) {
      throw new Error(`DraftProof ${draftId} not found.`);
    }

    const projects = await prisma.project.findMany({
      where: { ngoId, isDeleted: false, status: "ACTIVE" },
      select: {
        id: true,
        title: true,
        description: true,
        milestones: {
          where: { status: { in: ["PENDING", "IN_PROGRESS", "PROOF_SUBMITTED"] } },
          select: {
            id: true,
            projectId: true,
            title: true,
            description: true,
            targetAmount: true,
          },
        },
      },
    });

    // STEP 3 — Call Gemini 2.5 Pro with structured output
    const systemPrompt = `You are an AI assistant for an NGO field reporting system. 
Analyze the field worker's message and return ONLY valid JSON matching this exact schema:
{
  "predictedProjectId": string | null,
  "predictedMilestoneId": string | null,
  "predictionConfidence": number (0.0-1.0),
  "aiSummary": string (1-2 clear sentences summarizing what was done),
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "riskReason": string | null (explain risk if MEDIUM or HIGH, null if LOW)
}
Risk guidance:
- HIGH: mentions damage, failure, fraud indicators, missing photos when many claimed, impossible GPS
- MEDIUM: vague description, low photo count relative to claimed work, GPS missing
- LOW: clear description, photo evidence, plausible GPS, matches a milestone well`;

    const userPrompt = `Field worker message: ${draft.rawMessage}
Photos attached: ${draft.photoCount}
GPS: ${draft.rawGpsLat !== null && draft.rawGpsLng !== null ? `${draft.rawGpsLat}, ${draft.rawGpsLng}` : 'not provided'}
Available projects and milestones: ${JSON.stringify(projects)}`;

    console.log(`[worker] Calling Gemini for draft ${draftId}...`);
    let rawResponseText = await fetchWithRetryAndTimeout(userPrompt, systemPrompt);

    // STEP 4 — Parse Gemini response safely
    let parsed: any;
    try {
      parsed = JSON.parse(rawResponseText);
    } catch (parseError) {
      console.error(`[worker] Failed to parse JSON for draft ${draftId}. Raw response:`, rawResponseText);
      throw new Error("Invalid JSON response from Gemini.");
    }

    // Validate required fields (basic check)
    if (
      parsed.predictionConfidence === undefined ||
      !parsed.aiSummary ||
      !parsed.riskLevel
    ) {
      console.error(`[worker] Missing required fields in JSON for draft ${draftId}. Parsed:`, parsed);
      throw new Error("Missing required fields in Gemini response.");
    }

    // ADDITION 2: Cloudinary media upload
    const persistentUrls: string[] = [];
    if (draft.mediaUrls && draft.mediaUrls.length > 0) {
      const uploads = await Promise.allSettled(
        draft.mediaUrls.map(url => uploadToCloudinary(url, draft.id))
      );
      uploads.forEach(r => {
        if (r.status === 'fulfilled' && r.value) persistentUrls.push(r.value);
      });
    }

    // STEP 5 — Update DraftProof
    console.log(`[worker] Enrichment successful for draft ${draftId}. Updating DB...`);
    await prisma.draftProof.update({
      where: { id: draftId },
      data: {
        workerStatus: "ENRICHED",
        predictedProjectId: parsed.predictedProjectId || null,
        predictedMilestoneId: parsed.predictedMilestoneId || null,
        predictionConfidence: parsed.predictionConfidence,
        aiSummary: parsed.aiSummary,
        riskLevel: parsed.riskLevel,
        riskReason: parsed.riskReason || null,
        persistentPhotoUrls: persistentUrls
      },
    });

    // STEP 6 — Update FieldWorker totalSubmissions
    if (draft.fieldWorkerId) {
      await prisma.fieldWorker.update({
        where: { id: draft.fieldWorkerId },
        data: { totalSubmissions: { increment: 1 } },
      });
    }

    console.log(`[worker] Finished processing draft ${draftId}.`);
    
  } catch (error) {
    console.error(`[worker] Enrichment failed for draft ${draftId}:`, error);
    
    // Fallback: Never throw, update DB to ENRICHMENT_FAILED
    try {
      await prisma.draftProof.update({
        where: { id: draftId },
        data: { workerStatus: "ENRICHMENT_FAILED" },
      });
      console.log(`[worker] Draft ${draftId} marked as ENRICHMENT_FAILED.`);
      
      // ADDITION 3: Alerting on failure rate
      await checkFailureRate(ngoId);
    } catch (dbError) {
      console.error(`[worker] CRITICAL ERROR: Could not mark draft ${draftId} as failed in DB:`, dbError);
    }
  }
}
