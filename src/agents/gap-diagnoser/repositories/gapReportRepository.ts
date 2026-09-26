import prisma from "@/lib/prisma";

export async function createGapReport(data: {
  sponsorRequirementId: string;
  overallCompatibility: number;
  gapReport: any;
  recommendations: any;
  reviewedBy?: string | null;
}) {
  return prisma.gapReport.create({ data });
}

export async function getGapReportById(id: string) {
  return prisma.gapReport.findUnique({ where: { id } });
}

export async function updateGapReport(id: string, patch: Partial<{ reviewStatus: string; recommendations: any; reviewedBy: string }>) {
  return prisma.gapReport.update({ where: { id }, data: patch as any });
}
