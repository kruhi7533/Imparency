const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const proposal = await prisma.proposal.findFirst({
    where: { status: "SUBMITTED" }
  });

  if (!proposal) {
    console.log("No submitted proposal found.");
    return;
  }

  await prisma.proposal.update({
    where: { id: proposal.id },
    data: {
      status: "CHANGE_REQUESTED",
      decisionNote: "We like the proposal, but your budget is slightly too high for the initial phase. Please reduce the budget to ₹4,50,000 and remove the second milestone."
    }
  });

  console.log("Simulated CSR change request for proposal:", proposal.id);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
