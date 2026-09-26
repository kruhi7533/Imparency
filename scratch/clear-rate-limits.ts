import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.rateLimitLog.deleteMany();
  console.log(`✅ RateLimitLog table cleared! Deleted ${result.count} entries. You can login now.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
