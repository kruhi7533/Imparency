'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, AlertTriangle, ArrowRight, Save, Clock } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';

interface GapDetail {
  category: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  recommendation: string;
}

interface GapReport {
  id: string;
  overallCompatibility: number;
  gapReport: GapDetail[];
  reviewStatus: 'PENDING' | 'APPROVED' | 'REVISION_REQUESTED';
  sponsorRequirement: {
    title: string;
  };
}

export default function GapAnalysisDashboard({ params }: { params: { id: string } }) {
  const [report, setReport] = useState<GapReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    fetch(`/api/gap-analysis/report/${params.id}`)
      .then(res => res.json())
      .then(data => {
        setReport(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [params.id]);

  const handleApprove = async () => {
    try {
      const res = await fetch(`/api/gap-analysis/report/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus: 'APPROVED' })
      });
      if (res.ok) {
        setReport(prev => prev ? { ...prev, reviewStatus: 'APPROVED' } : null);
        toast({ title: 'Report Approved', description: 'The gap report has been approved.' });
      }
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to approve report.' });
    }
  };

  if (loading) return <div className="p-10 flex justify-center"><Clock className="animate-spin text-primary" /></div>;
  if (!report) return <div className="p-10 text-center">Report not found</div>;

  const getSeverityBadge = (sev: string) => {
    if (sev === 'HIGH') return <Badge variant="destructive" className="flex items-center gap-1"><AlertCircle className="w-3 h-3"/> HIGH</Badge>;
    if (sev === 'MEDIUM') return <Badge variant="secondary" className="bg-yellow-500 hover:bg-yellow-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> MEDIUM</Badge>;
    return <Badge variant="outline" className="text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> LOW</Badge>;
  };

  const filteredGaps = report.gapReport.filter(g => filter === 'ALL' || g.severity === filter);

  return (
    <div className="container max-w-5xl mx-auto py-8 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gap Analysis: {report.sponsorRequirement.title}</h1>
          <p className="text-muted-foreground mt-2">Internal review dashboard for assessing alignment with CSR requirements.</p>
        </div>
        <Badge variant={report.reviewStatus === 'APPROVED' ? 'default' : 'secondary'} className="text-sm px-3 py-1">
          {report.reviewStatus}
        </Badge>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <Card className="md:col-span-1 border-primary/20">
          <CardHeader>
            <CardTitle>Compatibility Score</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center pt-4">
            <div className="text-6xl font-black text-primary mb-4">{report.overallCompatibility}%</div>
            <Progress value={report.overallCompatibility} className="h-3 w-full" />
            <p className="text-sm text-muted-foreground mt-4 text-center">
              Based on deterministic dimension comparison and AI synthesis.
            </p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex justify-between items-center">
              <span>Detected Gaps ({report.gapReport.length})</span>
              <div className="flex gap-2">
                <Button variant={filter === 'ALL' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('ALL')}>All</Button>
                <Button variant={filter === 'HIGH' ? 'destructive' : 'outline'} size="sm" onClick={() => setFilter('HIGH')}>High</Button>
                <Button variant={filter === 'MEDIUM' ? 'secondary' : 'outline'} size="sm" onClick={() => setFilter('MEDIUM')}>Med</Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 max-h-[500px] overflow-y-auto pr-4">
            {filteredGaps.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No gaps match this filter.</p>
            ) : (
              filteredGaps.map((gap, i) => (
                <div key={i} className="rounded-lg border p-4 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-semibold text-lg">{gap.category} Gap</span>
                    {getSeverityBadge(gap.severity)}
                  </div>
                  <p className="text-sm text-foreground/80 mb-3">{gap.description}</p>
                  <div className="bg-muted/50 p-3 rounded-md">
                    <span className="text-xs font-bold uppercase text-muted-foreground mb-1 block">Recommendation</span>
                    <p className="text-sm flex items-start gap-2">
                      <ArrowRight className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                      {gap.recommendation}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end gap-4 border-t pt-6">
        <Button variant="outline" onClick={() => router.back()}>Back</Button>
        {report.reviewStatus !== 'APPROVED' && (
          <Button onClick={handleApprove} className="gap-2">
            <Save className="w-4 h-4" /> Approve Report
          </Button>
        )}
      </div>
    </div>
  );
}
