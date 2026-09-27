const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: "sakshi@demo.org" }
  });
  
  if (!user) {
    console.log("Could not find user sakshi@demo.org");
    return;
  }
  
  const ngo = await prisma.nGOProfile.findUnique({
    where: { userId: user.id }
  });

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

  if (!ngo || !admin) {
    console.log("No NGO or Admin found");
    return;
  }

  const opp = await prisma.fundingOpportunity.create({
    data: {
      title: "Clean Water Assam 2026",
      funderName: "TechCorp Foundation",
      description: "Providing clean drinking water across Assam.",
      status: "OPEN",
      amount: 500000,
      createdById: admin.id
    }
  });

  const job = await prisma.matchingJob.create({
    data: {
      opportunityId: opp.id,
      status: "COMPLETED",
      criteriaSnapshot: "[]"
    }
  });

  const candidate = await prisma.matchCandidate.create({
    data: {
      jobId: job.id,
      ngoId: ngo.id,
      verdict: "ELIGIBLE",
      decision: "SHORTLISTED",
      reasons: [
        { code: "SECTOR", label: "Sector Match", outcome: "PASS", detail: "Matches Water & Sanitation" }
      ]
    }
  });

  console.log("Demo opportunity seeded in Match Inbox specifically for sakshi@demo.org!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
