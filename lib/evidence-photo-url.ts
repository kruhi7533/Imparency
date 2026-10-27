import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed, expiring links to private field-evidence photos (NEG-015).
 *
 * SERVER-ONLY (node crypto) — never import from a "use client" file.
 *
 * A field photo can show a beneficiary, so its bytes are never at a stable,
 * shareable address. `GET /api/field/evidence/[id]/photo` without a signature
 * authorises the session and redirects to a link signed for THAT viewer and
 * valid for a few minutes; with a signature it checks the signature, the
 * expiry, that the session is the same viewer, and then re-runs the access
 * rule — so revocation (consent withdrawn, evidence rejected) applies to a
 * link that was issued before it, not only to new ones.
 *
 * The signature binds evidence id + viewer user id + expiry. A copied link is
 * useless to anyone else (different session) and to the same person after it
 * expires.
 */

export const PHOTO_URL_TTL_SECONDS = 5 * 60;

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET || process.env.EVIDENCE_URL_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set; cannot sign evidence photo links.");
  return s;
}

function mac(evidenceId: string, viewerId: string, exp: number): string {
  return createHmac("sha256", secret()).update(`field-photo:v1:${evidenceId}:${viewerId}:${exp}`).digest("base64url");
}

export function signEvidencePhotoPath(
  evidenceId: string,
  viewerId: string,
  now: Date = new Date(),
  ttlSeconds: number = PHOTO_URL_TTL_SECONDS,
): { url: string; expiresAt: string } {
  const exp = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const sig = mac(evidenceId, viewerId, exp);
  return {
    url: `/api/field/evidence/${encodeURIComponent(evidenceId)}/photo?exp=${exp}&sig=${sig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export type PhotoSignatureCheck = { ok: true } | { ok: false; code: "LINK_EXPIRED" | "LINK_INVALID" };

export function verifyEvidencePhotoSignature(
  evidenceId: string,
  viewerId: string,
  expRaw: string | null,
  sigRaw: string | null,
  now: Date = new Date(),
): PhotoSignatureCheck {
  if (!expRaw || !sigRaw || !/^\d{1,12}$/.test(expRaw)) return { ok: false, code: "LINK_INVALID" };
  const exp = Number(expRaw);
  const expected = Buffer.from(mac(evidenceId, viewerId, exp));
  const given = Buffer.from(sigRaw);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, code: "LINK_INVALID" };
  // Checked after the MAC, so an attacker cannot learn anything from the order.
  if (Math.floor(now.getTime() / 1000) > exp) return { ok: false, code: "LINK_EXPIRED" };
  // A link signed for longer than the TTL was not issued by this code.
  if (exp - Math.floor(now.getTime() / 1000) > PHOTO_URL_TTL_SECONDS + 60) return { ok: false, code: "LINK_INVALID" };
  return { ok: true };
}
