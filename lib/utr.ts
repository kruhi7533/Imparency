/**
 * UTR (Unique Transaction Reference) handling for contract payments.
 *
 * A UTR is what ties a donor's "I paid" to a line on the NGO's bank statement,
 * so it is captured and kept in EVERY payment mode — a SANDBOX payment the
 * donor gives a UTR for keeps that UTR as its reference; only a payment with
 * no UTR gets a generated SANDBOX-… id.
 *
 * Normalisation: trim, uppercase, strip all whitespace. Banks print the same
 * UTR as "hdfcr5 2026 0001" in one place and "HDFCR520260001" in another; a
 * matcher comparing raw strings would miss the one match it exists to find.
 *
 * Format: 6–30 letters/digits after normalisation. NEFT UTRs are 16
 * characters, RTGS 22, IMPS RRNs 12 digits and cheque numbers 6 digits, so
 * this admits all four and refuses junk ("paid", "n/a", a pasted sentence).
 *
 * Duplicate scope — PER PAYER ACCOUNT (Contract.donorId), across all of that
 * account's contracts, enforced by @@unique([payerAccountId, utr]):
 *  - Per-contract would be too narrow: one transfer quoted against two of the
 *    same donor's contracts is exactly the double-claim to stop.
 *  - Global would be wrong twice over: UTRs are unique per remitting bank, not
 *    across banks, so two donors can legitimately collide; and a 409 on donor
 *    B's form would reveal that donor A reported that UTR.
 *  Cross-donor reuse is still caught — by the admin UTR sweep, where one
 *  statement line matching two pending payments is AMBIGUOUS and goes to the
 *  exception queue for a human.
 */

export const UTR_PATTERN = /^[A-Z0-9]{6,30}$/;

export function normalizeUtr(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export type UtrCheck = { ok: true; utr: string | null } | { ok: false; error: string };

/**
 * Validates an optional UTR from a request body. Absent / blank → `utr: null`;
 * anything else must normalise to the accepted format.
 */
export function parseUtr(raw: unknown): UtrCheck {
  if (raw === undefined || raw === null) return { ok: true, utr: null };
  if (typeof raw !== "string") return { ok: false, error: "utr must be a string." };
  const utr = normalizeUtr(raw);
  if (!utr) return { ok: true, utr: null };
  if (!UTR_PATTERN.test(utr)) {
    return {
      ok: false,
      error: "UTR / reference must be 6–30 letters or digits (spaces are ignored), e.g. HDFCN52026102700001.",
    };
  }
  return { ok: true, utr };
}
