import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export async function recalculateNGOHealthScore(ngoId: string): Promise<void> {
  console.time(`healthScore-${ngoId}`);
  
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Fetch NGO Profile
      const ngo = await tx.nGOProfile.findUnique({
        where: { id: ngoId }
      });
      
      if (!ngo) {
        throw new Error(`NGO Profile ${ngoId} not found`);
      }
      
      // 2. Fetch Projects associated with this NGO
      const projects = await tx.project.findMany({
        where: { ngoId },
        select: { id: true, raisedAmount: true }
      });
      
      const projectIds = projects.map((p) => p.id);
      
      // Metric 1: Fund Utilization (30%)
      const totalRaised = projects.reduce((sum, p) => sum + Number(p.raisedAmount), 0);
      
      const pendingMilestones = await tx.milestone.findMany({
        where: {
          projectId: { in: projectIds },
          status: { in: ["PENDING", "IN_PROGRESS", "PROOF_SUBMITTED"] }
        },
        select: { targetAmount: true }
      });
      
      const pendingFunds = pendingMilestones.reduce((sum, m) => sum + Number(m.targetAmount), 0);
      
      const utilizationActive = totalRaised > 0;
      const utilizationScore = utilizationActive
        ? Math.max(0, ((totalRaised - pendingFunds) / totalRaised) * 100)
        : null;
        
      // Metric 2: Milestone Completion (30%)
      const milestones = await tx.milestone.findMany({
        where: { projectId: { in: projectIds } },
        select: { status: true }
      });
      
      const totalMilestonesCount = milestones.length;
      const completedMilestonesCount = milestones.filter((m) => m.status === "COMPLETED" || m.status === "VERIFIED").length;
      
      const completionActive = totalMilestonesCount > 0;
      const completionScore = completionActive
        ? (completedMilestonesCount / totalMilestonesCount) * 100
        : null;
        
      // Metric 3: Proof Submission Speed (20%)
      const proofs = await tx.milestoneProof.findMany({
        where: {
          milestone: {
            projectId: { in: projectIds }
          }
        },
        select: {
          submittedAt: true,
          milestone: {
            select: { deadline: true }
          }
        }
      });
      
      const speedActive = proofs.length > 0;
      let averageDelayDays = 0;
      if (speedActive) {
        let totalDelayDays = 0;
        proofs.forEach((proof) => {
          const submitted = new Date(proof.submittedAt);
          const deadline = new Date(proof.milestone.deadline);
          const diffTime = submitted.getTime() - deadline.getTime();
          const diffDays = diffTime / (1000 * 60 * 60 * 24);
          const delay = diffDays > 0 ? diffDays : 0;
          totalDelayDays += delay;
        });
        averageDelayDays = totalDelayDays / proofs.length;
      }
      
      const speedScore = speedActive
        ? Math.max(0, 100 - (averageDelayDays * 5))
        : null;
        
      // Metric 4: Donor Return Rate (20%)
      const donations = await tx.donation.findMany({
        where: {
          projectId: { in: projectIds },
          status: "SUCCESS"
        },
        select: { donorId: true }
      });
      
      const donorCounts: Record<string, number> = {};
      donations.forEach((d) => {
        donorCounts[d.donorId] = (donorCounts[d.donorId] || 0) + 1;
      });
      
      const uniqueDonorsList = Object.keys(donorCounts);
      const totalUniqueDonors = uniqueDonorsList.length;
      const returningDonorsCount = uniqueDonorsList.filter((donorId) => donorCounts[donorId] >= 2).length;
      
      const donorReturnActive = totalUniqueDonors >= 5;
      const donorReturnScore = donorReturnActive
        ? (returningDonorsCount / totalUniqueDonors) * 100
        : null;
        
      // Check New NGO starting score rules:
      // Default to null if completed milestones < 1 or unique donors < 3
      if (completedMilestonesCount < 1 || totalUniqueDonors < 3) {
        await tx.nGOProfile.update({
          where: { id: ngoId },
          data: {
            healthScore: null,
            healthScoreBreakdown: Prisma.DbNull
          }
        });
        console.log(`NGO ${ngoId} health score set to Pending (New NGO: ${completedMilestonesCount} completed milestones, ${totalUniqueDonors} unique donors)`);
        return;
      }
      
      // Calculate Weights with Redistribution
      const initialWeights = {
        utilization: 30,
        completion: 30,
        speed: 20,
        donorReturn: 20
      };
      
      const activeStates = {
        utilization: utilizationActive,
        completion: completionActive,
        speed: speedActive,
        donorReturn: donorReturnActive
      };
      
      const skippedMetrics = (Object.keys(activeStates) as Array<keyof typeof activeStates>).filter(
        (key) => !activeStates[key]
      );
      const activeMetrics = (Object.keys(activeStates) as Array<keyof typeof activeStates>).filter(
        (key) => activeStates[key]
      );
      
      if (activeMetrics.length === 0) {
        await tx.nGOProfile.update({
          where: { id: ngoId },
          data: {
            healthScore: null,
            healthScoreBreakdown: Prisma.DbNull
          }
        });
        return;
      }
      
      const totalSkippedWeight = skippedMetrics.reduce((sum, key) => sum + initialWeights[key], 0);
      const weightBonus = totalSkippedWeight / activeMetrics.length;
      
      const finalWeights = {
        utilization: utilizationActive ? 30 + weightBonus : 0,
        completion: completionActive ? 30 + weightBonus : 0,
        speed: speedActive ? 20 + weightBonus : 0,
        donorReturn: donorReturnActive ? 20 + weightBonus : 0
      };
      
      let weightedSum = 0;
      if (utilizationActive) weightedSum += (utilizationScore || 0) * finalWeights.utilization;
      if (completionActive) weightedSum += (completionScore || 0) * finalWeights.completion;
      if (speedActive) weightedSum += (speedScore || 0) * finalWeights.speed;
      if (donorReturnActive) weightedSum += (donorReturnScore || 0) * finalWeights.donorReturn;
      
      const finalHealthScore = weightedSum / 100;
      
      // Update database
      await tx.nGOProfile.update({
        where: { id: ngoId },
        data: {
          healthScore: finalHealthScore,
          healthScoreBreakdown: {
            utilization: { score: utilizationScore, weight: finalWeights.utilization },
            completion: { score: completionScore, weight: finalWeights.completion },
            speed: { score: speedScore, weight: finalWeights.speed },
            donorReturn: { score: donorReturnScore, weight: finalWeights.donorReturn }
          }
        }
      });
      
      console.log(`Recalculated health score for NGO ${ngoId}: ${finalHealthScore.toFixed(2)}/100`);
    });
  } catch (error) {
    console.error(`Failed to recalculate health score for NGO ${ngoId}:`, error);
  } finally {
    console.timeEnd(`healthScore-${ngoId}`);
  }
}
