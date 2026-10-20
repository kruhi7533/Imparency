#!/usr/bin/env node
/**
 * Logical backup of the database (roadmap row 13, "backup/restore").
 *
 *   node -r dotenv/config tools/db-backup.mjs                 # → backups/imparency-<UTC timestamp>.dump
 *   node -r dotenv/config tools/db-backup.mjs --out my.dump
 *
 * Uses pg_dump in custom format (compressed, restorable table by table) against
 * DIRECT_URL — the non-pooled connection; pg_dump through a pooler fails or
 * hangs. Requires the PostgreSQL client tools (pg_dump 16+) on PATH.
 *
 * This complements, not replaces, the provider's point-in-time restore (Neon
 * keeps history; see docs/RUNBOOK.md). A dump is what you take before anything
 * risky — a migration, a bulk fix — and what you can restore somewhere else.
 *
 * Backups contain personal data. They are written under backups/ (gitignored),
 * never committed, never uploaded anywhere by this script.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("REFUSING: set DIRECT_URL (preferred) or DATABASE_URL.");
  process.exit(1);
}
if (!process.env.DIRECT_URL) console.warn("WARNING: DIRECT_URL is not set; using DATABASE_URL. If it is a pooled URL, pg_dump may fail.");

const outArg = process.argv.indexOf("--out");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = outArg > -1 ? process.argv[outArg + 1] : join("backups", `imparency-${stamp}.dump`);
mkdirSync(dirname(out), { recursive: true });

const which = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
if (which.error) {
  console.error("REFUSING: pg_dump is not on PATH. Install the PostgreSQL client tools (16+).");
  process.exit(1);
}
console.log(`Using ${which.stdout.trim()}`);
console.log(`Backing up to ${out} …`);

const res = spawnSync("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", out, url], { stdio: "inherit" });
if (res.status !== 0) {
  console.error(`pg_dump failed (exit ${res.status}). No backup was written.`);
  process.exit(res.status ?? 1);
}
const size = statSync(out).size;
console.log(`OK — ${(size / 1024 / 1024).toFixed(1)} MB. Verify it with: node -r dotenv/config tools/db-restore.mjs --file ${out} --target <scratch database URL>`);
