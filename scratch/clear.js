import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.$executeRawUnsafe('DELETE FROM "SponsorRequirement" WHERE title IS NULL');
  console.log('Deleted null titles');
}
main().catch(console.error).finally(() => prisma.$disconnect());
