const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: "sakshi@demo.org" }
  });
  
  if (!user) return;
  const ngo = await prisma.nGOProfile.findUnique({ where: { userId: user.id } });

  // Find the exact job we created
  const candidate = await prisma.matchCandidate.findFirst({
    where: { 
      ngoId: ngo.id,
      job: { opportunity: { title: "Clean Water Assam 2026" } }
    },
    include: { job: true }
  });

  if (candidate) {
    // Update it with rich, realistic reasons
    await prisma.matchCandidate.update({
      where: { id: candidate.id },
      data: {
        reasons: [
          { code: "SECTOR", label: "Sector Match", outcome: "PASS", detail: "Your active projects perfectly align with the Water & Sanitation mandate." },
          { code: "LOCATION", label: "Geographic Coverage", outcome: "PASS", detail: "You have verified operations in Assam (Target State)." },
          { code: "SCALE", label: "Budget Capacity", outcome: "PASS", detail: "Your historical fund utilization demonstrates capacity to handle a ₹500,000 grant." },
          { code: "COMPLIANCE", label: "FCRA & CSR-1", outcome: "PASS", detail: "All required compliance documents are verified and up-to-date." }
        ]
      }
    });
    console.log("Updated match rationale with rich data!");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
