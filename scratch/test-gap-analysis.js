import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const req = await prisma.sponsorRequirement.create({
    data: {
      title: "Clean Water Assam 2026",
      extractedData: {
        sector: "Water",
        state: "Assam",
        budget: 5000000,
        durationMonths: 24,
        fcraRequired: true
      }
    }
  });

  console.log('Created SponsorRequirement:', req.id);

  const res = await fetch(`http://localhost:3000/api/gap-analysis/${req.id}`, {
    method: 'POST'
  });

  const data = await res.json();
  console.log('API Response:', data);
}

main().catch(console.error).finally(() => prisma.$disconnect());
