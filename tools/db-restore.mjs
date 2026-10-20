#!/usr/bin/env node
/**
 * Restore a backup made by tools/db-backup.mjs into a TARGET database, then
 * print row counts of the tables that matter so the restore can be checked.
 *
 *   node -r dotenv/config tools/db-restore.mjs --file backups/x.dump --target "postgresql://…/scratch"
 *
 * Safety:
 * - The target must be given explicitly. It is NEVER taken from DATABASE_URL.
 * - Restoring INTO the live database (target equals DATABASE_URL or
 *   DIRECT_URL) is refused unless --i-understand-this-overwrites-live is passed.
 *   The normal use is a scratch database or a Neon branch, for a restore drill
 *   or to recover a single table.
 *
 * Requires pg_restore and psql (16+) on PATH.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const file = arg("--file");
const target = arg("--target");
const overwriteLive = process.argv.includes("--i-understand-this-overwrites-live");

if (!file || !existsSync(file)) {
  console.error("REFUSING: --file <backup.dump> is required and must exist.");
  process.exit(1);
}
if (!target) {
  console.error("REFUSING: --target <database URL> is required. It is never inferred.");
  process.exit(1);
}
const norm = (u) => (u || "").replace(/[?#].*$/, "");
const live = [process.env.DATABASE_URL, process.env.DIRECT_URL].filter(Boolean).map(norm);
if (live.includes(norm(target)) && !overwriteLive) {
  console.error("REFUSING: the target is the live database. Restore into a scratch database or a Neon branch.");
  console.error("If you really mean to overwrite live data, read docs/RUNBOOK.md first.");
  process.exit(1);
}

for (const tool of ["pg_restore", "psql"]) {
  if (spawnSync(tool, ["--version"]).error) {
    console.error(`REFUSING: ${tool} is not on PATH. Install the PostgreSQL client tools (16+).`);
    process.exit(1);
  }
}

console.log(`Restoring ${file} …`);
const res = spawnSync("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", target, file], { stdio: "inherit" });
if (res.status !== 0) console.warn(`pg_restore exited ${res.status} — check the messages above (some are harmless on an empty target).`);

const tables = ["User", "NGOProfile", "Project", "Donation", "Contract", "ContractPayment", "LedgerEntry", "OutcomeClaim", "_prisma_migrations"];
const sql = tables.map((t) => `SELECT '${t}' AS table, count(*) FROM "${t}"`).join(" UNION ALL ") + ";";
console.log("\nRow counts in the restored database (compare with the source):");
spawnSync("psql", [target, "-c", sql], { stdio: "inherit" });
