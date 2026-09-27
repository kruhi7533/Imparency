"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export default function ProposalDashboardPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { toast } = useToast();
  
  const [proposal, setProposal] = useState<any>(null);
  const [activities, setActivities] = useState("");
  const [budget, setBudget] = useState("");
  const [milestones, setMilestones] = useState([{ title: "", target: "" }]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/proposals/${params.id}`)
      .then(res => res.json())
      .then(data => {
        setProposal(data);
        setActivities(data.activities);
        setBudget(data.budget.toString());
        setMilestones(data.milestones || []);
      });
  }, [params.id]);

  const handleSubmitV2 = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`/api/proposals/${params.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SUBMIT_V2",
          activities,
          budget,
          milestones
        })
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      toast({ title: `Proposal V${data.version} Submitted!` });
      setProposal(data);
    } catch (err) {
      toast({ variant: "destructive", title: "Error submitting revision" });
    }
    setLoading(false);
  };

  if (!proposal) return <div className="p-12 text-center">Loading...</div>;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-zinc-900 py-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Proposal Workspace (V{proposal.version})</h1>
          <Badge variant={proposal.status === "CHANGE_REQUESTED" ? "destructive" : "default"}>
            {proposal.status}
          </Badge>
        </div>

        {proposal.status === "CHANGE_REQUESTED" && (
          <Card className="mb-8 border-red-500 bg-red-50 dark:bg-red-950/20">
            <CardHeader>
              <CardTitle className="text-red-700 dark:text-red-400">CSR Feedback / Change Request</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-red-600 dark:text-red-300">{proposal.feedback}</p>
            </CardContent>
          </Card>
        )}

        {proposal.status !== "CHANGE_REQUESTED" && proposal.status !== "DRAFT" && (
          <Card className="mb-8">
            <CardContent className="py-6 text-center text-gray-500">
              Your proposal is currently locked for review by the sponsor. 
            </CardContent>
          </Card>
        )}

        <form onSubmit={handleSubmitV2}>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Core Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Proposed Activities</Label>
                <Textarea 
                  required 
                  rows={4} 
                  disabled={proposal.status !== "CHANGE_REQUESTED"}
                  value={activities}
                  onChange={(e) => setActivities(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Total Budget Requested (₹)</Label>
                <Input 
                  required 
                  type="number" 
                  disabled={proposal.status !== "CHANGE_REQUESTED"}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Milestones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {milestones.map((m: any, idx: number) => (
                <div key={idx} className="flex gap-4">
                  <Input 
                    placeholder="Milestone Title" 
                    disabled={proposal.status !== "CHANGE_REQUESTED"}
                    value={m.title}
                    onChange={(e) => {
                      const newM = [...milestones];
                      newM[idx].title = e.target.value;
                      setMilestones(newM);
                    }}
                    required
                  />
                  <Input 
                    type="number"
                    placeholder="Target Amount" 
                    disabled={proposal.status !== "CHANGE_REQUESTED"}
                    value={m.target}
                    onChange={(e) => {
                      const newM = [...milestones];
                      newM[idx].target = e.target.value;
                      setMilestones(newM);
                    }}
                    required
                  />
                </div>
              ))}
              {proposal.status === "CHANGE_REQUESTED" && (
                <Button type="button" variant="outline" onClick={() => setMilestones([...milestones, { title: "", target: "" }])}>
                  Add Milestone
                </Button>
              )}
            </CardContent>
          </Card>

          {proposal.status === "CHANGE_REQUESTED" && (
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Submitting..." : "Submit revision"}
            </Button>
          )}
        </form>
      </div>
    </main>
  );
}
