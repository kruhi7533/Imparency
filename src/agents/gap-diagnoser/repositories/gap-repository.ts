import prisma from '@/lib/prisma';
import { GapReportSchemaType } from '../types/gap-types';

export class GapReportRepository {
  async saveReport(
    sponsorRequirementId: string,
    ngoId: string | null,
    overallCompatibility: number,
    gaps: any,
    recommendations: any
  ) {
    return prisma.gapReport.create({
      data: {
        sponsorRequirementId,
        overallCompatibility,
        gapReport: gaps,
        recommendations,
        reviewStatus: 'PENDING'
      }
    });
  }

  async getReport(id: string) {
    return prisma.gapReport.findUnique({
      where: { id },
      include: {
        sponsorRequirement: true
      }
    });
  }

  async updateReport(id: string, updates: { gapReport?: any; reviewStatus?: 'PENDING' | 'APPROVED' | 'REJECTED', reviewedBy?: string }) {
    return prisma.gapReport.update({
      where: { id },
      data: updates
    });
  }
}
