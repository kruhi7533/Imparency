/**
 * Runs the destructive schema sync ONLY for a production deployment.
 *
 * The build script used to call `prisma db push --accept-data-loss`
 * unconditionally. On Vercel that command runs with whatever DATABASE_URL the
 * environment supplies, so the moment preview deployments are given database
 * credentials, every open PR starts pushing ITS OWN schema.prisma over that
 * database — and `--accept-data-loss` drops whatever the branch does not know
 * about, without prompting. With several people on parallel branches carrying
 * different schemas, one person's preview build can delete another's tables.
 *
 * Gating on VERCEL_ENV means the destructive command cannot run outside a
 * production deploy even if the credentials are wrong. It is a guard against
 * misconfiguration, not a substitute for pointing previews at their own
 * database.
 *
 * Node rather than an inline shell `if` so `npm run build` behaves the same on
 * Windows as it does in Vercel's Linux container.
 *
 * NOTE: this still uses `db push`, not `migrate deploy`, because the production
 * database has never been baselined (see CLAUDE.md). That is a separate,
 * bigger decision — this change only narrows WHEN the push is allowed to run.
 */
import { spawnSync } from "node:child_process";

const vercelEnv = process.env.VERCEL_ENV;

if (vercelEnv && vercelEnv !== "production") {
  console.log(`[build-db-sync] VERCEL_ENV=${vercelEnv} — skipping schema push (production only).`);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  // A local `npm run build` with no database configured. Skipping is right:
  // the build itself no longer needs one (see lib/platform-stats.ts).
  console.log("[build-db-sync] No DATABASE_URL — skipping schema push.");
  process.exit(0);
}

console.log("[build-db-sync] Production deploy — pushing schema.");
const result = spawnSync("npx", ["prisma", "db", "push", "--accept-data-loss"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
