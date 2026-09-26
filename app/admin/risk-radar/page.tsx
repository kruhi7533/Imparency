import prisma from "@/lib/prisma";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import RiskRadarClient from "./RiskRadarClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Risk Radar — every scored entity, worst first.
 *
 * Read-only and additive, the same invariant the Today inbox follows: nothing
 * here writes, and nothing here is the only place an entity can be actioned.
 * Every row links out to the queue that owns it.
 *
 * The ranking is a plain sorted read over stored scores. It deliberately does
 * NOT compute anything: scoring runs on a schedule (app/api/cron/risk-scores)
 * and at the edges that change an entity, because the platform sweep already
 * demonstrated what maintenance work on the request path costs — 466ms of a
 * 624ms page load. `computedAt` travels with the score so a stale ranking is
 * visibly stale rather than quietly wrong.
 *
 * NGO and donor scores are shown in separate lanes and are never interleaved.
 * An NGO at 80 means "this organisation may not be what it claims"; a donor at
 * 80 means "this money may not be what it claims". Ranking them against each
 * other would produce an order whose number means nothing.
 */

interface StoredSignal {
  code: string;
  label: string;
  points: number;
  detail?: string;
}

export default async function RiskRadarPage() {
  // EVERY query lives inside this guard, not just the first one.
  //
  // Both tables behind this page arrived in recent migrations, so the two ways
  // it can fail are a database that has not run them and a long-lived dev server
  // holding a Prisma client generated before them — in which case
  // `prisma.riskDispatch` is simply `undefined` and the page dies with
  // "Cannot read properties of undefined (reading 'findMany')". That is a
  // solvable setup problem wearing the mask of a crash, and it deserves the
  // instruction, not the stack trace.
  let scores;
  let dispatchRows;
  try {
    [scores, dispatchRows] = await Promise.all([
      prisma.entityRiskScore.findMany({
        orderBy: [{ score: "desc" }, { computedAt: "desc" }],
      }),
      // The routing log: what the Radar decided and what came of it. Capped
      // rather than paginated — this is a "what has been happening" panel, and
      // most-recent-first puts anything worth seeing at the top.
      prisma.riskDispatch.findMany({ orderBy: { queuedAt: "desc" }, take: 100 }),
    ]);
  } catch (err: any) {
    return <SchemaOutOfSync title="Risk Radar failed to load" detail={err?.message} />;
  }

  const ngoIds = scores.filter((s) => s.entityType === "NGO").map((s) => s.entityId);
  const donorIds = scores.filter((s) => s.entityType === "DONOR").map((s) => s.entityId);

  const [ngos, donors] = await Promise.all([
    ngoIds.length
      ? prisma.nGOProfile.findMany({
          where: { id: { in: ngoIds } },
          select: { id: true, orgName: true, verificationStatus: true, isSuspended: true },
        })
      : Promise.resolve([]),
    donorIds.length
      ? prisma.user.findMany({
          where: { id: { in: donorIds } },
          select: { id: true, name: true, email: true, donorPersona: true },
        })
      : Promise.resolve([]),
  ]);

  const ngoById = new Map(ngos.map((n) => [n.id, n]));
  const donorById = new Map(donors.map((d) => [d.id, d]));

  const rows = scores
    .map((s) => {
      const signals = (Array.isArray(s.signals) ? s.signals : []) as unknown as StoredSignal[];
      const base = {
        entityId: s.entityId,
        score: s.score,
        band: s.band as string,
        unknownInputs: s.unknownInputs,
        computedAt: s.computedAt.toISOString(),
        // Highest-contributing first: the reason a row is where it is should be
        // the first thing read, not something to reconstruct from a list.
        signals: [...signals].sort((a, b) => b.points - a.points),
      };

      if (s.entityType === "NGO") {
        const ngo = ngoById.get(s.entityId);
        if (!ngo) return null; // deleted since the sweep; the next one drops it
        return {
          ...base,
          lane: "NGO" as const,
          name: ngo.orgName,
          subtitle: ngo.isSuspended
            ? "Suspended"
            : ngo.verificationStatus.charAt(0) + ngo.verificationStatus.slice(1).toLowerCase(),
          href: `/admin/ngos/${ngo.id}`,
        };
      }

      const donor = donorById.get(s.entityId);
      if (!donor) return null;
      return {
        ...base,
        lane: "DONOR" as const,
        name: donor.name,
        subtitle: donor.donorPersona
          ? donor.donorPersona.replace(/_/g, " ").toLowerCase()
          : donor.email,
        href: `/admin/donors/${donor.id}`,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // Names for entities that may not be in the score set any more — a dispatch
  // outlives the score that caused it, by design.
  const dispatchNgoIds = dispatchRows.filter((d) => d.entityType === "NGO").map((d) => d.entityId);
  const dispatchDonorIds = dispatchRows.filter((d) => d.entityType === "DONOR").map((d) => d.entityId);
  const [extraNgos, extraDonors] = await Promise.all([
    dispatchNgoIds.length
      ? prisma.nGOProfile.findMany({ where: { id: { in: dispatchNgoIds } }, select: { id: true, orgName: true } })
      : Promise.resolve([]),
    dispatchDonorIds.length
      ? prisma.user.findMany({ where: { id: { in: dispatchDonorIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const dispatchNameById = new Map<string, string>([
    ...extraNgos.map((n) => [n.id, n.orgName] as [string, string]),
    ...extraDonors.map((d) => [d.id, d.name] as [string, string]),
  ]);

  const decisions = dispatchRows.map((d) => ({
    id: d.id,
    entityType: d.entityType as string,
    entityId: d.entityId,
    name: dispatchNameById.get(d.entityId) ?? "(deleted)",
    href: d.entityType === "NGO" ? `/admin/ngos/${d.entityId}` : `/admin/donors/${d.entityId}`,
    action: d.action as string,
    status: d.status as string,
    scoreAtQueue: d.scoreAtQueue,
    bandAtQueue: d.bandAtQueue as string,
    reason: d.reason,
    resultRef: d.resultRef,
    error: d.error,
    queuedAt: d.queuedAt.toISOString(),
    finishedAt: d.finishedAt?.toISOString() ?? null,
    durationMs:
      d.startedAt && d.finishedAt ? d.finishedAt.getTime() - d.startedAt.getTime() : null,
  }));

  const lastComputedAt = scores.length
    ? scores.reduce((newest, s) => (s.computedAt > newest ? s.computedAt : newest), scores[0].computedAt).toISOString()
    : null;

  return <RiskRadarClient rows={rows} decisions={decisions} lastComputedAt={lastComputedAt} />;
}
