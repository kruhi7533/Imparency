import { NextResponse } from 'next/server';
import { GapReportRepository } from '@/src/agents/gap-diagnoser/repositories/gap-repository';
import { verifySessionRole } from '@/lib/auth-guards';

// GET /api/gap-analysis/report/:id
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
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

    const { id } = params;
    const repo = new GapReportRepository();
    const report = await repo.getReport(id);

    if (!report) {
      return NextResponse.json({ error: 'Gap Report not found' }, { status: 404 });
    }

    // Security Gate: Ensure NGO user can only see their own report
    if (role === 'NGO' && report.ngoId !== ngoProfileId) {
      return NextResponse.json({ error: 'Forbidden: Access to this report is restricted' }, { status: 403 });
    }

    return NextResponse.json(report);
  } catch (error: any) {
    console.error('Gap Report GET Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT /api/gap-analysis/report/:id
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
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

    const { id } = params;
    const body = await request.json();

    const repo = new GapReportRepository();
    const existingReport = await repo.getReport(id);

    if (!existingReport) {
      return NextResponse.json({ error: 'Gap Report not found' }, { status: 404 });
    }

    // Security Gate: Ensure NGO user can only edit their own report
    if (role === 'NGO' && existingReport.ngoId !== ngoProfileId) {
      return NextResponse.json({ error: 'Forbidden: Access to this report is restricted' }, { status: 403 });
    }

    // Filter updates
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

    const updated = await repo.updateReport(id, updates);
    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('Gap Report PUT Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
