/* eslint-disable no-var */
import { Prisma, PrismaClient } from '@prisma/client';

// Connection errors that are worth retrying — typically a Neon serverless
// endpoint waking from auto-suspend (cold start) or a brief network blip.
const RETRYABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017']);
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const prismaClientSingleton = () => {
  const client = new PrismaClient();

  // Retry transient connection failures with exponential backoff so a cold
  // Neon endpoint doesn't surface as a hard 500 to the user.
  return client.$extends({
    query: {
      async $allOperations({ args, query }) {
        let lastError: unknown;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            return await query(args);
          } catch (err) {
            const code =
              err instanceof Prisma.PrismaClientKnownRequestError ? err.code : undefined;
            const isInitError = err instanceof Prisma.PrismaClientInitializationError;
            if (attempt < MAX_RETRIES && (isInitError || (code && RETRYABLE_CODES.has(code)))) {
              lastError = err;
              await sleep(BASE_DELAY_MS * 2 ** attempt);
              continue;
            }
            throw err;
          }
        }
        throw lastError;
      },
    },
  });
};

type ExtendedPrismaClient = ReturnType<typeof prismaClientSingleton>;

declare global {
  var prismaGlobal: undefined | ExtendedPrismaClient;
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma;
