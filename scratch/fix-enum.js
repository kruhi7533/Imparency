const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`DROP TYPE IF EXISTS "DonorCategory" CASCADE`);
  console.log('Dropped enum');
}

main().catch(console.error).finally(() => prisma.$disconnect());
