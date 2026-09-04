import exifr from "exifr";

/**
 * GPS provenance checking for milestone proof photos — Week 7's "duplicate/
 * GPS/risk flag" gap.
 *
 * The pure geometry and classification below (haversine distance + a
 * threshold call) is directly testable with plain numbers, and is kept
 * separate from extractGpsFromImage's file I/O for that reason — same split
 * already used for lib/risk-compliance-view.ts elsewhere in this codebase.
 * Raising a FraudAlert on a MISMATCH is a further side effect and lives in
 * the submit-proof route, which already owns every other side effect of a
 * submission (upload, AI validation, health score recalculation).
 */

/** Kilometres beyond which a proof's photo location and its project's
 *  registered site are treated as a mismatch worth a human's attention.
 *
 *  Deliberately loose, not tight: phone GPS in rural India routinely drifts
 *  several kilometres, and a real project like "Clean Water for 10 Villages
 *  in Nashik District" legitimately spans tens of kilometres end to end. This
 *  number trades missed mismatches for not flooding the admin queue with
 *  false positives on ordinary field work — the same tradeoff the 12A/80G
 *  compliance rule makes by not flagging every unregistered NGO. Revisit with
 *  real submission data once there is some.
 */
export const LOCATION_MISMATCH_THRESHOLD_KM = 50;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Great-circle distance between two points, in kilometres. */
export function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const EARTH_RADIUS_KM = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return EARTH_RADIUS_KM * c;
}

export type ProofLocationStatus = "MATCH" | "MISMATCH" | "NO_GPS_DATA";

export interface ProofLocationResult {
  status: ProofLocationStatus;
  distanceKm: number | null;
}

/**
 * Classifies a proof's location against its project's registered site.
 *
 * NO_GPS_DATA is its own status, not folded into MATCH or skipped silently.
 * Most phone cameras strip location metadata by default, so absence is the
 * common case, not the suspicious one — but it must still render as a
 * distinct, visible state in the admin UI rather than as an unlabelled blank
 * that looks the same as "verified". The compliance-evidence rule this
 * codebase already applies elsewhere — "no evidence must never read as safe"
 * — applies here too, even though the underlying cause (phones, not fraud)
 * is completely different.
 */
export function classifyProofLocation(
  proof: Coordinates | null,
  project: Coordinates | null
): ProofLocationResult {
  if (!proof || !project) {
    return { status: "NO_GPS_DATA", distanceKm: null };
  }

  const distanceKm = haversineDistanceKm(proof, project);
  return {
    status: distanceKm > LOCATION_MISMATCH_THRESHOLD_KM ? "MISMATCH" : "MATCH",
    distanceKm,
  };
}

/**
 * Reads GPS coordinates out of an image buffer's EXIF data, if present.
 *
 * Returns null rather than throwing for BOTH cases callers must treat
 * identically: no GPS tag in the EXIF data (`exifr.gps` resolves to
 * `undefined` — confirmed empirically, it does not throw for this case), and
 * a corrupt or non-image buffer (exifr throws; caught here). A submission
 * must never fail because a photo's metadata couldn't be parsed — that would
 * turn an informational, non-blocking check into an outage.
 */
export async function extractGpsFromImage(buffer: Buffer): Promise<Coordinates | null> {
  try {
    const result = await exifr.gps(buffer);
    if (!result) return null;
    return { latitude: result.latitude, longitude: result.longitude };
  } catch {
    return null;
  }
}
