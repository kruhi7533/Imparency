import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  haversineDistanceKm,
  classifyProofLocation,
  extractGpsFromImage,
  LOCATION_MISMATCH_THRESHOLD_KM,
} from "@/lib/proof-location";

// Real coordinates, not arbitrary numbers, so the distances are checkable
// against a known reference rather than trusted blind.
const NASHIK = { latitude: 19.9975, longitude: 73.7898 };
const MUMBAI = { latitude: 19.076, longitude: 72.8777 }; // ~165km from Nashik
const PUNE = { latitude: 18.5204, longitude: 73.8567 }; // ~163km from Nashik
const NASHIK_NEARBY = { latitude: 20.05, longitude: 73.85 }; // a few km away

describe("haversineDistanceKm", () => {
  it("is zero for the same point", () => {
    expect(haversineDistanceKm(NASHIK, NASHIK)).toBe(0);
  });

  it("matches a known real-world distance within a small tolerance", () => {
    // Nashik-Mumbai STRAIGHT-LINE (aerial) distance is ~140km — not the
    // ~165km road-trip distance GPS navigation apps report, which is the
    // wrong reference number for what haversine actually computes and is
    // worth naming explicitly here so nobody "fixes" this test back to it.
    const d = haversineDistanceKm(NASHIK, MUMBAI);
    expect(d).toBeGreaterThan(125);
    expect(d).toBeLessThan(155);
  });

  it("is symmetric", () => {
    expect(haversineDistanceKm(NASHIK, PUNE)).toBeCloseTo(haversineDistanceKm(PUNE, NASHIK), 6);
  });

  it("is small for nearby points within the same district", () => {
    expect(haversineDistanceKm(NASHIK, NASHIK_NEARBY)).toBeLessThan(10);
  });
});

describe("classifyProofLocation", () => {
  it("is NO_GPS_DATA when the proof has no coordinates — not MATCH, not silently skipped", () => {
    // This is the common case (most phones strip EXIF location), and it must
    // never be indistinguishable from a verified match in the admin UI.
    const result = classifyProofLocation(null, NASHIK);
    expect(result.status).toBe("NO_GPS_DATA");
    expect(result.distanceKm).toBeNull();
  });

  it("is NO_GPS_DATA when the project has no registered coordinates", () => {
    const result = classifyProofLocation(NASHIK, null);
    expect(result.status).toBe("NO_GPS_DATA");
  });

  it("is NO_GPS_DATA when both are missing", () => {
    expect(classifyProofLocation(null, null).status).toBe("NO_GPS_DATA");
  });

  it("is MATCH when both points are close together", () => {
    const result = classifyProofLocation(NASHIK_NEARBY, NASHIK);
    expect(result.status).toBe("MATCH");
    expect(result.distanceKm).not.toBeNull();
  });

  it("is MISMATCH when the proof photo was taken far from the project's site", () => {
    const result = classifyProofLocation(MUMBAI, NASHIK);
    expect(result.status).toBe("MISMATCH");
    expect(result.distanceKm).toBeGreaterThan(LOCATION_MISMATCH_THRESHOLD_KM);
  });

  it("is MATCH comfortably under the threshold and MISMATCH comfortably over it", () => {
    // Concrete points on each side of LOCATION_MISMATCH_THRESHOLD_KM (50km),
    // not a re-derivation of the function's own comparison — a version of
    // this test that just mirrors "distanceKm > THRESHOLD" back at the
    // function would pass even if `>` were swapped for `>=` or `<`, which
    // defeats the point of having it.
    const KM_PER_DEGREE_LAT = 111.32;
    const under = {
      latitude: NASHIK.latitude + 40 / KM_PER_DEGREE_LAT,
      longitude: NASHIK.longitude,
    };
    const over = {
      latitude: NASHIK.latitude + 60 / KM_PER_DEGREE_LAT,
      longitude: NASHIK.longitude,
    };
    expect(classifyProofLocation(under, NASHIK).status).toBe("MATCH");
    expect(classifyProofLocation(over, NASHIK).status).toBe("MISMATCH");
  });
});

describe("extractGpsFromImage", () => {
  // exifr's own correctness at parsing a real GPS-tagged photo is not
  // re-tested here — that is exifr's job, on an actively maintained library.
  // What belongs to this function's own contract, and is worth pinning, is
  // that it NEVER throws and treats "no GPS tag" and "not parseable at all"
  // identically as null — a proof submission must not fail because a photo's
  // metadata couldn't be read.

  it("returns null for a real image with no GPS EXIF data", async () => {
    // Confirmed empirically before writing this: exifr.gps() resolves to
    // `undefined` here, it does not throw — this is the common case, since
    // most phone cameras strip location metadata by default.
    const buffer = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    expect(await extractGpsFromImage(buffer)).toBeNull();
  });

  it("returns null, not a throw, for a buffer that is not a valid image at all", async () => {
    const garbage = Buffer.from("this is definitely not a JPEG");
    await expect(extractGpsFromImage(garbage)).resolves.toBeNull();
  });

  it("returns null for an empty buffer", async () => {
    await expect(extractGpsFromImage(Buffer.alloc(0))).resolves.toBeNull();
  });
});
