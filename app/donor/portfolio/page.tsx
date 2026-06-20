import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getIndianFinancialYear } from "@/lib/finance-utils";
import PortfolioClient from "./PortfolioClient";

export const dynamic = "force-dynamic";

export default async function DonorPortfolioPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "DONOR") {
    redirect("/login?callbackUrl=/donor/portfolio");
  }

  const userId = session.user.id;

  const donor = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      donations: {
        where: { status: "SUCCESS" },
        include: {
          project: {
            select: {
              id: true,
              title: true,
              coverImage: true,
              causeCategory: true,
              raisedAmount: true,
              targetAmount: true,
              status: true,
              ngo: { select: { orgName: true } },
            },
          },
          taxReceipt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      followers: {
        include: {
          ngo: {
            select: {
              id: true,
              orgName: true,
              causeCategories: true,
              healthScore: true,
              description: true,
            },
          },
        },
      },
    },
  });

  if (!donor) {
    redirect("/login");
  }

  // Calculate generic donor stats
  const totalAmount = Number(donor.totalDonated);
  const uniqueProjectIds = new Set(donor.donations.map((d) => d.projectId));
  const projectsCount = uniqueProjectIds.size;
  const followedCount = donor.followers.length;

  const activeFundedProjects = Array.from(
    new Map(
      donor.donations
        .filter((d) => d.project.status === "ACTIVE")
        .map((d) => [d.projectId, d.project])
    ).values()
  );

  // If corporate donor, calculate CSR Portal metrics
  let csrSummary: { financialYear: string; totalAmount: number }[] = [];
  let csrProjects: {
    projectId: string;
    projectTitle: string;
    ngoName: string;
    amountDonated: number;
    milestonesCompleted: number;
    milestonesPending: number;
    averageAiScore: number | null;
  }[] = [];

  if (donor.isCorporate) {
    // 1. Group by financial year
    const fyMap = new Map<string, number>();
    donor.donations.forEach((d) => {
      const fy = getIndianFinancialYear(new Date(d.createdAt));
      fyMap.set(fy, (fyMap.get(fy) || 0) + Number(d.amount));
    });
    
    csrSummary = Array.from(fyMap.entries())
      .map(([financialYear, totalAmount]) => ({
        financialYear,
        totalAmount
      }))
      .sort((a, b) => b.financialYear.localeCompare(a.financialYear));

    // 2. Project-wise compliance table
    const projectMap = new Map<string, {
      projectId: string;
      projectTitle: string;
      ngoName: string;
      amountDonated: number;
      milestonesCompleted: number;
      milestonesPending: number;
      aiScores: number[];
    }>();

    for (const d of donor.donations) {
      const pId = d.projectId;
      const amount = Number(d.amount);

      if (!projectMap.has(pId)) {
        // Fetch project milestones and their latest proofs
        const projectWithMilestones = await prisma.project.findUnique({
          where: { id: pId },
          include: {
            ngo: true,
            milestones: {
              include: {
                proofs: {
                  orderBy: { submittedAt: "desc" },
                  take: 1
                }
              }
            }
          }
        });

        if (projectWithMilestones) {
          const milestones = projectWithMilestones.milestones;
          const completed = milestones.filter(m => m.status === "COMPLETED" || m.status === "VERIFIED");
          const pending = milestones.filter(m => m.status !== "COMPLETED" && m.status !== "VERIFIED");
          
          const scores: number[] = [];
          completed.forEach((m) => {
            const latestProof = m.proofs[0];
            if (latestProof && latestProof.aiValidationScore !== null) {
              scores.push(latestProof.aiValidationScore);
            }
          });

          projectMap.set(pId, {
            projectId: pId,
            projectTitle: projectWithMilestones.title,
            ngoName: projectWithMilestones.ngo.orgName,
            amountDonated: amount,
            milestonesCompleted: completed.length,
            milestonesPending: pending.length,
            aiScores: scores
          });
        }
      } else {
        const item = projectMap.get(pId)!;
        item.amountDonated += amount;
      }
    }

    csrProjects = Array.from(projectMap.values()).map((item) => {
      const avgScore = item.aiScores.length > 0 
        ? Math.round(item.aiScores.reduce((a, b) => a + b, 0) / item.aiScores.length)
        : null;
      return {
        projectId: item.projectId,
        projectTitle: item.projectTitle,
        ngoName: item.ngoName,
        amountDonated: item.amountDonated,
        milestonesCompleted: item.milestonesCompleted,
        milestonesPending: item.milestonesPending,
        averageAiScore: avgScore
      };
    });
  }

  // Serialize models to plain JSON objects
  const serializedDonor = {
    id: donor.id,
    name: donor.name,
    email: donor.email,
    isCorporate: donor.isCorporate,
    companyName: donor.companyName,
    gstNumber: donor.gstNumber,
    totalDonated: totalAmount,
  };

  const serializedDonations = donor.donations.map((d) => ({
    id: d.id,
    amount: Number(d.amount),
    createdAt: d.createdAt.toISOString(),
    project: {
      id: d.project.id,
      title: d.project.title,
      causeCategory: d.project.causeCategory,
      ngo: { orgName: d.project.ngo.orgName }
    },
    taxReceipt: d.taxReceipt ? {
      id: d.taxReceipt.id,
      pdfUrl: d.taxReceipt.pdfUrl,
      receiptNumber: d.taxReceipt.receiptNumber
    } : null
  }));

  const serializedFollowers = donor.followers.map((f) => ({
    ngo: {
      id: f.ngo.id,
      orgName: f.ngo.orgName,
      healthScore: f.ngo.healthScore !== null ? Number(f.ngo.healthScore) : null,
      description: f.ngo.description,
      causeCategories: f.ngo.causeCategories
    }
  }));

  const serializedActiveFunded = activeFundedProjects.map((p) => ({
    id: p.id,
    title: p.title,
    raisedAmount: Number(p.raisedAmount),
    targetAmount: Number(p.targetAmount),
  }));

  return (
    <PortfolioClient
      donor={serializedDonor}
      donations={serializedDonations}
      followers={serializedFollowers}
      activeFundedProjects={serializedActiveFunded}
      csrSummary={csrSummary}
      csrProjects={csrProjects}
    />
  );
}
