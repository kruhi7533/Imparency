import { NextResponse } from 'next/server';
import { stat } from 'fs/promises';
import path from 'path';
import prisma from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');
    const audience = url.searchParams.get('audience');
    
    const projSuffix = projectId ? `_${projectId}` : '';
    const audSuffix = audience === 'foreign' ? '_foreign' : '_indian';
    const fileName = `ImpactBridge_Pitch_Deck${projSuffix}${audSuffix}.pptx`;
    
    const filePath = path.join(process.cwd(), 'public/downloads', fileName);
    
    const [leadCount, fileStats] = await Promise.all([
      prisma.pitchLead.count(),
      stat(filePath).catch(() => null)
    ]);
    
    return NextResponse.json({ 
      generatedAt: fileStats ? fileStats.mtime.toISOString() : null, 
      fileSizeKb: fileStats ? Math.round(fileStats.size / 1024) : null,
      leadCount
    });
  } catch (error: any) {
    console.error('Error fetching meta:', error);
    return NextResponse.json({ error: 'Failed to fetch meta' }, { status: 500 });
  }
}
