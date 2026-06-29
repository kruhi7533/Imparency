import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { GoogleGenerativeAI } from "@google/generative-ai";

const execAsync = promisify(exec);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// In-memory rate limiting map (userId -> timestamp)
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

function getFilePath(projectId?: string | null, audience?: string | null) {
  const projSuffix = projectId ? `_${projectId}` : '';
  const audSuffix = audience === 'foreign' ? '_foreign' : '_indian';
  const fileName = `ImpactBridge_Pitch_Deck${projSuffix}${audSuffix}.pptx`;
  return path.join(process.cwd(), 'public/downloads', fileName);
}

async function rewriteDescription(description: string, audience: string) {
  if (!process.env.GEMINI_API_KEY) return description;
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const audienceFocus = audience === 'foreign' 
      ? 'Global/Foreign Donors (focus on strict compliance, FCRA, and large-scale global impact)' 
      : 'Indian Donors (focus on local community impact, 80G tax benefits, and grassroot changes)';
      
    const prompt = `You are an expert copywriter and fundraiser for NGOs. 
Please rewrite the following campaign description to be highly persuasive, professional, and impactful.
Target audience: ${audienceFocus}.
Keep it under 3 sentences and extremely punchy. Do not include any quotes.

Original description:
${description}`;

    const result = await model.generateContent(prompt);
    return result.response.text().trim().replace(/^["']|["']$/g, '');
  } catch (error) {
    console.error("[pitch] Gemini rewriting failed:", error);
    return description;
  }
}

// Helper to run generation script
async function ensureGenerated(projectId?: string | null, audience?: string | null) {
  const start = Date.now();
  try {
    let payloadArg = '';
    
    let payload: any = {
      audience: audience === 'foreign' ? 'foreign' : 'indian'
    };

    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId }
      });
      if (project) {
        const rewrittenDescription = project.description 
          ? await rewriteDescription(project.description, payload.audience)
          : null;

        payload = {
          ...payload,
          projectId: project.id,
          title: project.title,
          description: rewrittenDescription,
          causeCategory: project.causeCategory,
          targetAmount: project.targetAmount ? project.targetAmount.toString() : '0'
        };
      }
    }
    
    payloadArg = Buffer.from(JSON.stringify(payload)).toString('base64');

    const command = payloadArg ? `node scripts/generate-pitch.js ${payloadArg}` : 'node scripts/generate-pitch.js';
    const { stdout, stderr } = await execAsync(command);
    console.log(`[pitch] Generated in ${Date.now() - start}ms`);
  } catch (error: any) {
    console.error('[pitch] Generation failed:', error.stderr || error.message);
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');
    const audience = url.searchParams.get('audience');
    const filePath = getFilePath(projectId, audience);
    
    let needsGeneration = true;

    // Check if file exists and is recent (less than 24 hours old)
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const fileAgeMs = Date.now() - stats.mtimeMs;
      const twentyFourHoursMs = 24 * 60 * 60 * 1000;
      
      if (fileAgeMs < twentyFourHoursMs) {
        needsGeneration = false;
      }
    }

    if (needsGeneration) {
      await ensureGenerated(projectId, audience);
    }

    // Stream the file as the response body
    const fileBuffer = fs.readFileSync(filePath);
    
    const projSuffix = projectId ? `_${projectId}` : '';
    const audSuffix = audience === 'foreign' ? '_foreign' : '_indian';
    const fileName = `ImpactBridge_Pitch_Deck${projSuffix}${audSuffix}.pptx`;
    
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Generation failed' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    // Auth Check: must be NGO or ADMIN
    if (!session?.user || (session.user.role !== 'NGO' && session.user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');
    const audience = url.searchParams.get('audience');
    const userId = session.user.id;
    const rateLimitKey = `${userId}-${projectId || 'org'}-${audience || 'indian'}`;

    // Rate Limit Check
    const lastRequest = rateLimitMap.get(rateLimitKey);
    if (lastRequest && Date.now() - lastRequest < RATE_LIMIT_MS) {
      return NextResponse.json({ error: 'Regeneration limit: once per 5 minutes' }, { status: 429 });
    }
    
    // Update rate limit timestamp
    rateLimitMap.set(rateLimitKey, Date.now());

    // Force regenerate
    await ensureGenerated(projectId, audience);

    const filePath = getFilePath(projectId, audience);
    const stats = fs.statSync(filePath);
    
    return NextResponse.json({
      success: true,
      generatedAt: stats.mtime.toISOString(),
      fileSize: stats.size
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.stderr || error.message || 'Generation failed' },
      { status: 500 }
    );
  }
}
