import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { fundingState, type FundingState } from "@/lib/allocation";
import type { Tx } from "@/lib/requirements/commit";

/**
 * "Project becomes FUNDED" (roadmap row 10).
 *
 * A project is FUNDED when every rupee committed to it by a signed contract has
 * actually arrived — the reconciled payments across its ACTIVE/COMPLETED
 * contracts cover the contracts' grant totals. A promise is not funding, and a
 * donor-recorded payment the NGO has not confirmed is not funding either: only
 * RECONCILED money counts (the same rule as lib/contract-payments.ts).
 *
 * FUNDED is deliberately NOT a ProjectStatus. Donations, Discover, matching and
 * field work all key off status ACTIVE, and a funded project must keep working.
 * The state is derived live from the payment rows (never cached — a stored total
 * is one more counter able to drift from its evidence); `Project.fundedAt`
 * records only the EVENT, once, so the parties are told exactly once.
 */

type Amount = Prisma.Decimal | string | number;
const dec = (v: Amount) => new Prisma.Decimal(v.toString());

export const FUNDING_CONTRACT_STATUSES = ["ACTIVE", "COMPLETED"] as const;

export interface ProjectFunding {
  /** Grant totals of the project's signed (ACTIVE/COMPLETED) contracts. */
  committed: string;
  /** RECONCILED contract payments against those contracts. */
  reconciled: string;
  state: FundingState;
  /** True once every committed rupee has arrived. */
  funded: boolean;
}

export function projectFunding(
  contracts: Array<{ status: string; totalGrantAmount: Amount; payments: Array<{ amount: Amount; status: string }> }>
): ProjectFunding {
  const signed = contracts.filter((c) => (FUNDING_CONTRACT_STATUSES as readonly string[]).includes(c.status));
  const committed = signed.reduce((sum, c) => sum.plus(dec(c.totalGrantAmount)), new Prisma.Decimal(0));
  const reconciled = signed.reduce(
    (sum, c) => c.payments.filter((p) => p.status === "RECONCILED").reduce((s, p) => s.plus(dec(p.amount)), sum),
    new Prisma.Decimal(0)
  );
  const state: FundingState = committed.isZero() ? "UNFUNDED" : fundingState(committed, reconciled);
  return {
    committed: committed.toFixed(2),
    reconciled: reconciled.toFixed(2),
    state,
    funded: state === "FUNDED" || state === "OVERFUNDED",
  };
}

/**
 * Stamps `fundedAt` the first time the project is fully funded. Call it inside
 * the transaction that reconciles a payment. Compare-and-swap on
 * `fundedAt: null`, so two concurrent reconciliations stamp (and notify) once.
 */
export async function stampProjectFundedIfComplete(tx: Tx, projectId: string, now: Date = new Date()): Promise<boolean> {
  const contracts = await tx.contract.findMany({
    where: { projectId, status: { in: [...FUNDING_CONTRACT_STATUSES] } },
    select: { status: true, totalGrantAmount: true, payments: { select: { amount: true, status: true } } },
  });
  if (!projectFunding(contracts).funded) return false;
  const { count } = await tx.project.updateMany({ where: { id: projectId, fundedAt: null }, data: { fundedAt: now } });
  return count === 1;
}

/** Tells the NGO and every funding donor, once. Best-effort: the stamp is the record. */
export async function notifyProjectFunded(projectId: string): Promise<void> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        title: true,
        ngo: { select: { userId: true } },
        contracts: { where: { status: { in: [...FUNDING_CONTRACT_STATUSES] } }, select: { donorId: true } },
      },
    });
    if (!project) return;
    const recipients = new Set<string>([project.ngo.userId, ...project.contracts.map((c) => c.donorId)]);
    await prisma.notification.createMany({
      data: Array.from(recipients).map((userId) => ({
        userId,
        type: "PROJECT_FUNDED",
        title: "Project fully funded",
        body: `"${project.title}" is now fully funded — every committed rupee has been received and reconciled.`,
      })),
    });
  } catch (err) {
    console.error("[project-funding] notification failed:", err);
  }
}

/** Live funding for several projects at once (lists and cockpits). */
export async function loadProjectFunding(projectIds: string[]): Promise<Map<string, ProjectFunding>> {
  if (projectIds.length === 0) return new Map();
  const contracts = await prisma.contract.findMany({
    where: { projectId: { in: projectIds }, status: { in: [...FUNDING_CONTRACT_STATUSES] } },
    select: { projectId: true, status: true, totalGrantAmount: true, payments: { select: { amount: true, status: true } } },
  });
  const out = new Map<string, ProjectFunding>();
  for (const id of projectIds) out.set(id, projectFunding(contracts.filter((c) => c.projectId === id)));
  return out;
}
