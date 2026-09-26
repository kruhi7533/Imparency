import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ComparisonEngine } from '@/src/agents/gap-diagnoser/services/comparison-engine';
import { AIDiagnoserService } from '@/src/agents/gap-diagnoser/services/ai-diagnoser';
import { GapReportRepository } from '@/src/agents/gap-diagnoser/repositories/gap-repository';
import { verifySessionRole } from '@/lib/auth-guards';

// POST /api/gap-analysis/:requirementId
// Creates a new Gap Report comparing sponsor requirement to NGO initiatives
export async function POST(
  request: Request,
  { params }: { params: { requirementId: string } }
) {
  try {
    // 1. Session and Role Validation (Internal NGO staff & Admins only)
    const sessionResult = await verifySessionRole();
    if (!sessionResult.authorized) {
      return sessionResult.response;
    }

    const { role, ngoProfileId, id: userId } = sessionResult.session.user;
    if (role !== 'ADMIN' && role !== 'NGO') {
      return NextResponse.json({ error: 'Forbidden: Internal access only' }, { status: 403 });
    }

    const { requirementId } = params;

    // 2. Fetch Sponsor Requirement
    const sponsorRequirement = await prisma.sponsorRequirement.findUnique({
      where: { id: requirementId }
    });

    if (!sponsorRequirement) {
      return NextResponse.json({ error: 'Sponsor Requirement not found' }, { status: 404 });
    }

    // 3. Resolve target NGO profile ID (NGO users are isolated to their own profile)
    const { searchParams } = new URL(request.url);
    let targetNgoId = searchParams.get('ngoId');

    if (role === 'NGO') {
      // NGO users are locked to their own NGO profile
      targetNgoId = ngoProfileId;
    }

    if (!targetNgoId && role === 'NGO') {
      return NextResponse.json({ error: 'NGO profile association not found' }, { status: 400 });
    }

    // 4. Fetch active initiatives (Projects) with Milestones
    const activeProjects = await prisma.project.findMany({
      where: {
        status: 'ACTIVE',
        isDeleted: false,
        ...(targetNgoId ? { ngoId: targetNgoId } : {})
      },
      include: {
        milestones: {
          orderBy: {
            sequenceOrder: 'asc'
          }
        }
      }
    });

    // 5. Fetch compliance details if analyzing a specific NGO
    const ngoCompliance = targetNgoId ? await prisma.nGOCompliance.findUnique({
      where: { ngoId: targetNgoId }
    }) : null;

    // 6. Run deterministic comparison
    const comparisonEngine = new ComparisonEngine();
    const comparisonResult = comparisonEngine.compare(
      requirementId,
      sponsorRequirement.extractedData as any,
      activeProjects,
      ngoCompliance
    );

    // 7. Run AI Synthesis
    const aiDiagnoser = new AIDiagnoserService();
    const aiReport = await aiDiagnoser.generateGapReport(comparisonResult);

    // 8. Save report using Repository pattern
    const gapRepository = new GapReportRepository();
    
    // Save recommendations list extracted from the gaps
    const recommendationsList = aiReport.gaps.map(g => g.recommendation);

    const savedReport = await gapRepository.saveReport(
      requirementId,
      targetNgoId,
      aiReport.overallCompatibility,
      aiReport.gaps,
      recommendationsList
    );

    return NextResponse.json({
      gapReportId: savedReport.id,
      status: 'PROCESSING'
    });
  } catch (error: any) {
    console.error('POST Gap Analysis Error:', error);
    
    if (error.message && error.message.includes('API Timeout')) {
      return NextResponse.json({ error: error.message }, { status: 504 });
    }
    if (error.message && error.message.includes('Structured Output')) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

// GET /api/gap-analysis/:id
// Fetches a Gap Report
export async function GET(
  request: Request,
  { params }: { params: { requirementId: string } }
) {
  try {
    const sessionResult = await verifySessionRole();
    if (!sessionResult.authorized) {
      return sessionResult.response;
    }

    const { role, ngoProfileId } = sessionResult.session.user;
    if (role !== 'ADMIN' && role !== 'NGO') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // The param is named requirementId because of the dynamic folder [requirementId]
    const reportId = params.requirementId;

    const repo = new GapReportRepository();
    const report = await repo.getReport(reportId);

    if (!report) {
      return NextResponse.json({ error: 'Gap Report not found' }, { status: 404 });
    }

    // Security Gate: Ensure NGO user can only see their own report
    if (role === 'NGO' && report.ngoId !== ngoProfileId) {
      return NextResponse.json({ error: 'Forbidden: Access to this report is restricted' }, { status: 403 });
    }

    return NextResponse.json(report);
  } catch (error: any) {
    console.error('GET Gap Report Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT /api/gap-analysis/:id
// Updates the review status or recommendations of a Gap Report
export async function PUT(
  request: Request,
  { params }: { params: { requirementId: string } }
) {
  try {
    const sessionResult = await verifySessionRole();
    if (!sessionResult.authorized) {
      return sessionResult.response;
    }

    const { role, ngoProfileId, id: userId } = sessionResult.session.user;
    if (role !== 'ADMIN' && role !== 'NGO') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const reportId = params.requirementId;
    const body = await request.json();

    const repo = new GapReportRepository();
    const existingReport = await repo.getReport(reportId);

    if (!existingReport) {
      return NextResponse.json({ error: 'Gap Report not found' }, { status: 404 });
    }

    // Security Gate: Ensure NGO user can only edit their own report
    if (role === 'NGO' && existingReport.ngoId !== ngoProfileId) {
      return NextResponse.json({ error: 'Forbidden: Access to this report is restricted' }, { status: 403 });
    }

    // Filter allowed fields for update
    const updates: any = {};
    if (body.reviewStatus !== undefined) {
      updates.reviewStatus = body.reviewStatus;
    }
    if (body.gapReport !== undefined) {
      updates.gapReport = body.gapReport;
    }
    if (body.recommendations !== undefined) {
      updates.recommendations = body.recommendations;
    }
    
    // Set reviewer name/ID
    updates.reviewedBy = sessionResult.session.user.name || userId;

    const updated = await repo.updateReport(reportId, updates);
    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('PUT Gap Report Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
