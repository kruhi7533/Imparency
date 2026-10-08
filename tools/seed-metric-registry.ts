/**
 * Seed the Week 8 Metric Registry starter set.
 *
 *   npx tsx -r dotenv/config tools/seed-metric-registry.ts            # dry run
 *   npx tsx -r dotenv/config tools/seed-metric-registry.ts -- --apply
 *
 * Lives in tools/ rather than scripts/ because it writes, and scripts/ is
 * gitignored — the same reason tools/backfill-proof-hashes.ts is there.
 *
 * Idempotent by `code`: it upserts, so re-running after adding a metric to
 * SEED_METRICS adds only the new one. The registry is a published contract
 * (the NGO track consumes these codes), so this has to be safe to re-run on a
 * database that already has claims pointing at these rows.
 *
 * It validates before writing, through the SAME validateMetricDefinition the
 * admin route uses. A seed that could insert a metric the API would reject
 * would make the registry's own rules a lie.
 *
 * What it deliberately does NOT do: overwrite `status`. If an admin has
 * deprecated IB-MEALS-001 on purpose, a re-run must not silently reactivate
 * it — that would resurrect a definition a human retired.
 */
import { PrismaClient } from "@prisma/client";
import { SEED_METRICS, validateMetricDefinition } from "../lib/metric-registry";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(APPLY ? "APPLYING\n" : "DRY RUN — nothing will be written. Pass --apply.\n");

  // Validate everything before writing anything: a partial seed of a contract
  // is worse than none, because the gaps look deliberate.
  let invalid = 0;
  for (const m of SEED_METRICS) {
    const errors = validateMetricDefinition(m);
    if (errors.length > 0) {
      invalid++;
      console.error(`INVALID ${m.code}:`);
      for (const e of errors) console.error(`   ${e.field}: ${e.message}`);
    }
  }
  if (invalid > 0) {
    console.error(`\nREFUSING: ${invalid} metric(s) fail the registry's own validation.`);
    process.exitCode = 1;
    return;
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const m of SEED_METRICS) {
    const existing = await prisma.metricDefinition.findUnique({ where: { code: m.code } });

    if (!existing) {
      console.log(`+ ${m.code} — "${m.name}" (${m.unit}), requires ${m.requiredEvidence.join(", ")}`);
      if (APPLY) {
        await prisma.metricDefinition.create({
          data: {
            code: m.code,
            name: m.name,
            unit: m.unit,
            definition: m.definition,
            status: m.status,
            sdgGoals: m.sdgGoals,
            irisCode: m.irisCode,
            requiredEvidence: m.requiredEvidence,
            aggregatable: m.aggregatable,
          },
        });
      }
      created++;
      continue;
    }

    const drifted =
      existing.name !== m.name ||
      existing.unit !== m.unit ||
      existing.definition !== m.definition ||
      existing.irisCode !== m.irisCode ||
      existing.aggregatable !== m.aggregatable ||
      existing.sdgGoals.join(",") !== m.sdgGoals.join(",") ||
      existing.requiredEvidence.join(",") !== m.requiredEvidence.join(",");

    if (!drifted) {
      unchanged++;
      continue;
    }

    // A changed definition or unit changes how existing numbers should be read,
    // so the version is bumped rather than the edit being made silently.
    const versionBump =
      existing.definition !== m.definition || existing.unit !== m.unit ? existing.version + 1 : existing.version;

    console.log(
      `~ ${m.code} — updating${versionBump !== existing.version ? ` (version ${existing.version} -> ${versionBump})` : ""}` +
        `${existing.status !== m.status ? `; status left as ${existing.status} (not overwritten)` : ""}`
    );
    if (APPLY) {
      await prisma.metricDefinition.update({
        where: { code: m.code },
        data: {
          name: m.name,
          unit: m.unit,
          definition: m.definition,
          sdgGoals: m.sdgGoals,
          irisCode: m.irisCode,
          requiredEvidence: m.requiredEvidence,
          aggregatable: m.aggregatable,
          version: versionBump,
          // status deliberately absent — see the header.
        },
      });
    }
    updated++;
  }

  console.log(
    `\n${APPLY ? "Done" : "Dry run complete"}: ${created} to create, ${updated} to update, ${unchanged} already current.`
  );
  if (!APPLY && created + updated > 0) console.log("Re-run with -- --apply to write.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
