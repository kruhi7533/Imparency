import prisma from "@/lib/prisma";

/**
 * Who is allowed to be the money behind an opportunity.
 *
 * The platform verifies organisations hard — documents extracted, fields
 * validated by a human, compliance flags that must be backed by evidence — and
 * then sends an NGO an email saying it has been shortlisted for a grant. If the
 * funder behind that grant is a name somebody typed into a text box, the
 * platform's credibility is doing work the platform has not earned. That is the
 * shape of an advance-fee scam.
 *
 * So a funder is a DONOR whose identity has actually been checked. There is no
 * separate funder role and, for now, no funder organisation: the account IS the
 * funder, and `panStatus` is the existing verification this reuses rather than
 * inventing a second one.
 */

/** Personas that can plausibly fund an opportunity rather than give to one. */
export const INSTITUTIONAL_PERSONAS = ["CSR_OFFICER", "FOUNDATION", "GOVERNMENT"] as const;

export type FunderRejection =
  | "NOT_FOUND"
  | "NOT_A_DONOR"
  | "NOT_INSTITUTIONAL"
  | "NOT_VERIFIED";

export interface FunderCheck {
  ok: boolean;
  reason?: FunderRejection;
  /** Admin-facing explanation. Says what is wrong AND what would fix it. */
  message?: string;
  displayName?: string;
}

/**
 * Can this account stand behind an opportunity?
 *
 * Deliberately returns a reason rather than a boolean: "you cannot open this"
 * with no cause is the kind of dead end an admin cannot act on, and each of
 * these failures has a different fix.
 */
export async function checkFunderEligibility(userId: string): Promise<FunderCheck> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      companyName: true,
      role: true,
      donorPersona: true,
      panStatus: true,
    },
  });

  if (!user) {
    return { ok: false, reason: "NOT_FOUND", message: "That funder account no longer exists." };
  }

  const displayName = user.companyName || user.name || user.email;

  if (user.role !== "DONOR") {
    return {
      ok: false,
      reason: "NOT_A_DONOR",
      displayName,
      message: `${displayName} is not a donor account, so it cannot fund an opportunity.`,
    };
  }

  if (!INSTITUTIONAL_PERSONAS.includes(user.donorPersona as never)) {
    return {
      ok: false,
      reason: "NOT_INSTITUTIONAL",
      displayName,
      message:
        `${displayName} is an individual donor. Only CSR, foundation and government accounts ` +
        `can fund an opportunity — set their persona on the donor record if that is wrong.`,
    };
  }

  if (user.panStatus !== "VERIFIED") {
    return {
      ok: false,
      reason: "NOT_VERIFIED",
      displayName,
      message:
        `${displayName}'s identity is not verified (PAN is ${user.panStatus.toLowerCase()}). ` +
        `An unverified funder must not be put in front of an organisation — verify the PAN ` +
        `on their donor record first.`,
    };
  }

  return { ok: true, displayName };
}
