/**
 * One-off: fingerprint the proof files that predate the duplicate check.
 *
 * Without this, `contentHashes` is empty on every existing proof, so the first
 * new submission can only ever collide with other new submissions — years of
 * already-submitted evidence would be invisible to the check, and the very
 * first thing a dishonest organisation would reuse is a photo it has already
 * had accepted.
 *
 * Re-runnable: it only looks at proofs whose `contentHashes` is still empty,
 * so a second run is a no-op over the ones it already did, and an interrupted
 * run resumes. Hashing is pure, so re-hashing a file it already covered would
 * produce the same value anyway.
 *
 * What it deliberately does NOT do: raise alerts. A duplicate found in
 * historical data is worth a human's attention, but a backfill that opened
 * dozens of fraud alerts in one pass would bury the live queue the day it ran.
 * It REPORTS collisions it noticed and leaves the decision to a person. Run
 * the report, then act on it.
 *
 * Lives in tools/ rather than scripts/ because scripts/ is gitignored and
 * anything that writes to proof records should be reviewable.
 *
 *   npm run backfill:proof-hashes          # dry run, writes nothing
 *   npm run backfill:proof-hashes -- --apply
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import fs from "fs/promises";
import path from "path";
import { PRIVATE_UPLOAD_ROOT } from "../lib/storage";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");

/**
 * Reads a stored file back by the URL recorded on the proof.
 *
 * Three shapes exist because lib/storage.ts has three providers: a local
 * public path, a local private path served through an authorising route, and
 * an absolute provider URL. Returns null rather than throwing for anything
 * missing — a proof whose file has been deleted is a fact to report, not a
 * reason to abort a backfill halfway.
 */
async function readStoredFile(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const res = await fetch(url);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    if (url.startsWith("/api/documents/")) {
      const key = url.slice("/api/documents/".length);
      return await fs.readFile(path.join(process.cwd(), PRIVATE_UPLOAD_ROOT, key));
    }
    if (url.startsWith("/uploads/")) {
      return await fs.readFile(path.join(process.cwd(), "public", url.replace(/^\//, "")));
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  const proofs = await prisma.milestoneProof.findMany({
    where: { contentHashes: { isEmpty: true } },
    select: {
      id: true,
      milestoneId: true,
      mediaUrls: true,
      documentUrls: true,
      submittedAt: true,
      milestone: { select: { title: true, project: { select: { ngo: { select: { orgName: true } } } } } },
    },
    orderBy: { submittedAt: "asc" },
  });

  console.log(`${proofs.length} proof${proofs.length === 1 ? "" : "s"} with no fingerprints.`);
  if (proofs.length === 0) return;

  // hash -> the proofs it was found on, so collisions can be reported at the
  // end instead of one line per file.
  const seen = new Map<string, { proofId: string; milestoneTitle: string; orgName: string }[]>();
  let hashed = 0;
  let unreadable = 0;

  for (const proof of proofs) {
    const urls = [...proof.mediaUrls, ...proof.documentUrls];
    const hashes: string[] = [];

    for (const url of urls) {
      const buffer = await readStoredFile(url);
      if (!buffer) {
        unreadable++;
        continue;
      }
      const hash = createHash("sha256").update(buffer).digest("hex");
      hashes.push(hash);

      const owners = seen.get(hash) ?? [];
      owners.push({
        proofId: proof.id,
        milestoneTitle: proof.milestone.title,
        orgName: proof.milestone.project.ngo.orgName,
      });
      seen.set(hash, owners);
    }

    if (hashes.length === 0) {
      // Every file gone. Leaving contentHashes empty is correct: empty means
      // "not fingerprinted", and writing `{}` deliberately would claim this
      // proof had been checked when it cannot be.
      console.log(`  skip ${proof.id} — no readable files`);
      continue;
    }

    hashed += hashes.length;
    if (APPLY) {
      await prisma.milestoneProof.update({
        where: { id: proof.id },
        data: { contentHashes: hashes },
      });
    }
  }

  const collisions = Array.from(seen.entries()).filter(([, owners]) => owners.length > 1);

  console.log(
    `\n${hashed} file${hashed === 1 ? "" : "s"} hashed, ${unreadable} unreadable.` +
      (APPLY ? "" : "  (dry run — nothing written; pass --apply)")
  );

  if (collisions.length === 0) {
    console.log("No duplicate files in the existing evidence.");
    return;
  }

  console.log(`\n${collisions.length} duplicated file${collisions.length === 1 ? "" : "s"} found in historical evidence:`);
  for (const [hash, owners] of collisions) {
    console.log(`  ${hash.slice(0, 12)}… appears on ${owners.length} proofs:`);
    for (const o of owners) {
      console.log(`    - ${o.proofId}  "${o.milestoneTitle}"  (${o.orgName})`);
    }
  }
  console.log(
    "\nNo alerts were raised for these — review them by hand. A backfill that " +
      "opened one fraud alert per historical collision would bury the live queue."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
