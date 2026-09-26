"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Label } from "@/components/ui/label";

export default function NewProposalPage({ params }: { params: { requirementId: string } }) {
  const router = useRouter();
  const { toast } = useToast();
  
  const [activities, setActivities] = useState("");
  const [budget, setBudget] = useState("");
  const [milestones, setMilestones] = useState([{ title: "", target: "" }]);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirementId: params.requirementId,
          activities,
          budget,
          milestones
        })
      });
      if (!res.ok) throw new Error("Failed to create proposal");
      const data = await res.json();
      toast({ title: "Proposal V1 Submitted!" });
      router.push(`/ngo/proposals/${data.id}`);
    } catch (err) {
      toast({ variant: "destructive", title: "Error submitting proposal" });
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-zinc-900 py-12">
      <div className="max-w-4xl mx-auto px-6">
        <h1 className="text-3xl font-bold mb-8">Draft Proposal (V1)</h1>
        <form onSubmit={handleSubmit}>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Core Details</CardTitle>
              <CardDescription>Outline how you plan to address the CSR mandate.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Proposed Activities</Label>
                <Textarea 
                  required 
                  rows={4} 
                  placeholder="Describe the key activities you will undertake..."
                  value={activities}
                  onChange={(e) => setActivities(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Total Budget Requested (₹)</Label>
                <Input 
                  required 
                  type="number" 
                  placeholder="e.g. 500000"
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
              {milestones.map((m, idx) => (
                <div key={idx} className="flex gap-4">
                  <Input 
                    placeholder="Milestone Title" 
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
              <Button type="button" variant="outline" onClick={() => setMilestones([...milestones, { title: "", target: "" }])}>
                Add Milestone
              </Button>
            </CardContent>
          </Card>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Submitting..." : "Submit Proposal V1"}
          </Button>
        </form>
      </div>
    </main>
  );
}
