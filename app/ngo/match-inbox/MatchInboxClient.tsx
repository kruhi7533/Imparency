"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Target, MapPin, IndianRupee, Clock, CheckCircle2, AlertTriangle, AlertCircle, Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Progress } from "@/components/ui/progress";

export default function MatchInboxClient({ opportunities, ngoId }: { opportunities: any[], ngoId: string }) {
  const { toast } = useToast();
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  const handleRunAnalysis = async (reqId: string) => {
    setAnalyzingId(reqId);
    try {
      const res = await fetch(`/api/gap-analysis/${reqId}?ngoId=${ngoId}`, { method: 'POST' });
      if (res.ok) {
        toast({ title: "Analysis Complete", description: "Refresh to see the match rationale." });
        window.location.reload();
      } else {
        toast({ variant: "destructive", title: "Analysis Failed", description: "Failed to generate match rationale." });
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "An error occurred." });
    }
    setAnalyzingId(null);
  };

  const [decliningId, setDecliningId] = useState<string | null>(null);

  const handleDecline = async (matchCandidateId: string) => {
    if (!confirm("Are you sure you want to decline this opportunity? It will be removed from your inbox.")) return;
    setDecliningId(matchCandidateId);
    try {
      const res = await fetch(`/api/ngo/matches/${matchCandidateId}/decline`, { method: 'POST' });
      if (res.ok) {
        toast({ title: "Opportunity Declined", description: "It has been removed from your inbox." });
        window.location.reload();
      } else {
        toast({ variant: "destructive", title: "Error", description: "Failed to decline opportunity." });
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "An error occurred." });
    }
    setDecliningId(null);
  };

  const handleExpressInterest = (reqTitle: string) => {
    toast({
      title: "Interest Expressed!",
      description: `You have expressed interest in ${reqTitle}. The sponsor will be notified.`,
    });
  };

  const getSeverityBadge = (sev: string) => {
    if (sev === 'HIGH') return <Badge variant="destructive" className="flex items-center gap-1 text-[10px]"><AlertCircle className="w-3 h-3"/> HIGH GAP</Badge>;
    if (sev === 'MEDIUM') return <Badge variant="secondary" className="bg-yellow-500 hover:bg-yellow-600 flex items-center gap-1 text-[10px]"><AlertTriangle className="w-3 h-3"/> MEDIUM GAP</Badge>;
    return <Badge variant="outline" className="text-muted-foreground flex items-center gap-1 text-[10px]"><CheckCircle2 className="w-3 h-3"/> LOW GAP</Badge>;
  };

  if (opportunities.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <Sparkles className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No Match Opportunities Yet</h3>
          <p className="text-gray-500 max-w-md">
            When CSRs post funding mandates (RFPs) that align with your projects, they will appear here with an AI-generated match rationale.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {opportunities.map((opp) => {
        const data = opp.extractedData || {};
        const gapReport = opp.gapReports?.[0];

        return (
          <Card key={opp.id} className="overflow-hidden border-2 hover:border-primary/20 transition-colors">
            <CardHeader className="bg-white dark:bg-zinc-900 border-b">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-xl font-bold">{opp.title}</CardTitle>
                  <CardDescription className="mt-1">
                    Matched Opportunity • Posted {new Date(opp.createdAt).toLocaleDateString()}
                  </CardDescription>
                </div>
                {gapReport && (
                  <div className="flex flex-col items-end">
                    <span className="text-sm text-gray-500 mb-1 font-semibold">Match Score</span>
                    <div className="flex items-center gap-3">
                      <Progress value={gapReport.overallCompatibility} className="w-24 h-2" />
                      <span className="font-bold text-primary">{gapReport.overallCompatibility}%</span>
                    </div>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 bg-gray-50 dark:bg-zinc-800/50 p-4 rounded-lg">
                <div className="space-y-1">
                  <span className="text-xs text-gray-500 flex items-center gap-1"><Target className="w-3 h-3"/> Sector</span>
                  <p className="font-medium">{data.sector || "Any"}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-gray-500 flex items-center gap-1"><MapPin className="w-3 h-3"/> Location</span>
                  <p className="font-medium">{data.state || "Anywhere"}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-gray-500 flex items-center gap-1"><IndianRupee className="w-3 h-3"/> Budget</span>
                  <p className="font-medium">₹{data.budget?.toLocaleString() || "Unspecified"}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3"/> Duration</span>
                  <p className="font-medium">{data.durationMonths ? `${data.durationMonths} Months` : "N/A"}</p>
                </div>
              </div>

              {gapReport ? (
                <div className="space-y-4">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" /> AI Match Rationale
                  </h4>
                  {gapReport.gapReport.length > 0 ? (
                    <div className="grid gap-3">
                      {gapReport.gapReport.map((gap: any, idx: number) => (
                        <div key={idx} className="bg-white dark:bg-zinc-900 border p-3 rounded-md shadow-sm">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-medium text-sm">{gap.label || gap.category}</span>
                            {getSeverityBadge(gap.outcome === 'FAIL' ? 'HIGH' : gap.severity || 'LOW')}
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">{gap.detail || gap.description}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-green-50 text-green-700 p-4 rounded-md border border-green-200 flex items-start gap-2">
                      <CheckCircle2 className="w-5 h-5 shrink-0" />
                      <p className="text-sm font-medium">Perfect Match! Your NGO's active projects align perfectly with all CSR requirements.</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-6 bg-gray-50 dark:bg-zinc-800/50 rounded-lg border border-dashed">
                  <p className="text-gray-500 mb-4 text-sm">Our AI hasn't analyzed your alignment with this mandate yet.</p>
                  <Button 
                    variant="outline" 
                    onClick={() => handleRunAnalysis(opp.id)}
                    disabled={analyzingId === opp.id}
                  >
                    {analyzingId === opp.id ? "Analyzing..." : "Run AI Gap Analysis"}
                  </Button>
                </div>
              )}
            </CardContent>
            {gapReport && (
              <div className="bg-gray-50 dark:bg-zinc-900 border-t p-4 flex justify-between items-center rounded-b-xl">
                <p className="text-xs text-gray-500">Only express interest if you can address the highlighted gaps.</p>
                <div className="flex gap-2">
                  <Button 
                    variant="ghost" 
                    className="text-gray-500 hover:text-red-600 dark:hover:text-red-400"
                    onClick={() => handleDecline(opp.matchCandidateId)}
                    disabled={decliningId === opp.matchCandidateId}
                  >
                    {decliningId === opp.matchCandidateId ? "Declining..." : "Not Interested"}
                  </Button>
                  <Button onClick={() => window.location.href = `/ngo/proposals/new/${opp.id}`}>
                    Draft Proposal
                  </Button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
