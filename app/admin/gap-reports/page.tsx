import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileCheck, ArrowRight, ShieldAlert } from "lucide-react";

export const runtime = "nodejs";

export default async function AdminGapReportsListPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  // Fetch all Gap Reports globally
  const reports = await prisma.gapReport.findMany({
    include: {
      sponsorRequirement: {
        select: { fileName: true }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  // Fetch NGO org names for mapping
  const ngos = await prisma.nGOProfile.findMany({
    select: { id: true, orgName: true }
  });
  const ngoMap = new Map(ngos.map(n => [n.id, n.orgName]));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Gap Analysis Console</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Internal console for reviewing overall and specific NGO capability gap evaluations.
          </p>
        </div>

        {reports.length === 0 ? (
          <Card className="border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <CardHeader className="text-center py-10">
              <ShieldAlert className="mx-auto w-12 h-12 text-muted-foreground mb-4" />
              <CardTitle>No Gap Reports Generated</CardTitle>
              <CardDescription>
                Trigger an analysis run from a sponsor requirement to see reports here.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {reports.map((report) => {
              return (
                <Card key={report.id} className="border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:shadow-md transition-shadow">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <Badge variant={report.reviewStatus === 'APPROVED' ? 'default' : 'secondary'}>
                        {report.reviewStatus}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(report.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <CardTitle className="mt-2 text-lg truncate" title={report.sponsorRequirement.fileName}>
                      {report.sponsorRequirement.fileName}
                    </CardTitle>
                    <CardDescription className="truncate">
                      Global Run
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-baseline justify-between border-t border-b py-2">
                      <span className="text-xs text-muted-foreground">Compatibility:</span>
                      <span className="text-2xl font-black text-emerald-600">{report.overallCompatibility}%</span>
                    </div>
                    <Link href={`/ngo/gap-analysis/${report.id}`} className="w-full block">
                      <Button className="w-full gap-2" variant="outline">
                        View Report Details <ArrowRight className="w-4 h-4" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </main>
    </div>
  );
}
