import prisma from "@/lib/prisma";

/**
 * Turning the ledger's ids into something a human can read.
 *
 * The ledger and the exception queue store IDS ONLY, on purpose: those tables
 * outlive PII retention on the rows they point at, so a name copied into them
 * would be a copy nobody can later erase (the same rule as AdminActionLog).
 *
 * That is a storage rule, not a display rule. An admin looking at "₹1,000 from
 * a0fe0e5e-9b93-… to 7ea1fe77-…" cannot act on it. So the names are resolved
 * HERE, at render time, from the live tables — which means they disappear
 * correctly when the underlying row is deleted, instead of lingering in a
 * finance record forever.
 *
 * Best-effort by design: an id that no longer resolves renders as the id. A
 * dangling reference is itself worth seeing, and it must never take the
 * finance page down.
 */

export interface FinanceLabels {
  /** donorId -> display name */
  donors: Map<string, string>;
  /** projectId -> the campaign and the organisation behind it */
  projects: Map<string, { title: string; orgName: string; ngoId: string }>;
  /** donationId -> the two ends of that donation, for exceptions that name one */
  donations: Map<string, { donorId: string; projectId: string }>;
}

export const EMPTY_LABELS: FinanceLabels = {
  donors: new Map(),
  projects: new Map(),
  donations: new Map(),
};

/**
 * One batched lookup for a whole page of rows.
 *
 * Three queries regardless of how many rows are shown — resolving per row
 * would put an N+1 directly behind the finance view.
 */
export async function loadFinanceLabels(ids: {
  donorIds?: Array<string | null | undefined>;
  projectIds?: Array<string | null | undefined>;
  donationIds?: Array<string | null | undefined>;
}): Promise<FinanceLabels> {
  const donorIds = unique(ids.donorIds);
  const projectIds = unique(ids.projectIds);
  const donationIds = unique(ids.donationIds);

  // Donations are resolved first: one names a donor and a project that the
  // other two lookups then have to cover.
  const donations = donationIds.length
    ? await prisma.donation.findMany({
        where: { id: { in: donationIds } },
        select: { id: true, donorId: true, projectId: true },
      })
    : [];

  const allDonorIds = unique([...donorIds, ...donations.map((d) => d.donorId)]);
  const allProjectIds = unique([...projectIds, ...donations.map((d) => d.projectId)]);

  const [donors, projects] = await Promise.all([
    allDonorIds.length
      ? prisma.user.findMany({
          where: { id: { in: allDonorIds } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
    allProjectIds.length
      ? prisma.project.findMany({
          where: { id: { in: allProjectIds } },
          select: { id: true, title: true, ngoId: true, ngo: { select: { orgName: true } } },
        })
      : Promise.resolve([]),
  ]);

  return {
    donors: new Map(donors.map((d) => [d.id, donorDisplayName(d)])),
    projects: new Map(
      projects.map((p) => [
        p.id,
        { title: p.title, orgName: p.ngo?.orgName ?? "Unknown organisation", ngoId: p.ngoId },
      ]),
    ),
    donations: new Map(donations.map((d) => [d.id, { donorId: d.donorId, projectId: d.projectId }])),
  };
}

/**
 * A donor with no name falls back to the local part of their email, never the
 * whole address — an admin needs to tell two donors apart on this page, not to
 * be handed a mailing list from a finance view.
 */
export function donorDisplayName(donor: { name?: string | null; email?: string | null }): string {
  const name = donor.name?.trim();
  if (name) return name;
  const local = donor.email?.split("@")[0]?.trim();
  return local ? `${local}…` : "Unknown donor";
}

/** Short id for when nothing resolves. Enough to grep the database with. */
export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`;
}

function unique(values: Array<string | null | undefined> = []): string[] {
  // Array.from rather than spreading the Set: the project's tsconfig target
  // does not allow iterating one directly.
  return Array.from(new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0)));
}
