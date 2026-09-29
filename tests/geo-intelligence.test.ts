import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * fetchGeoIntelligence reaches two third-party APIs (data.gov.in Census 2011
 * and AgroMonitoring NDVI) to enrich a project location. It had zero coverage,
 * which matters more than usual here because the whole function is written to
 * degrade rather than throw: every failure path returns a partial result.
 *
 * So the contract under test is mostly about what happens when the outside
 * world misbehaves — no key, non-200, malformed body, network throw — and the
 * assertion is always the same shape: a well-formed result with nulls in it,
 * never a rejected promise, because a project page must still render when
 * data.gov.in is down.
 *
 * The NDVI leg is a two-step handshake (POST a polygon, then GET its history)
 * and each step can fail independently, so both are pinned separately.
 *
 * No network: fetch is stubbed. The real endpoints are never contacted.
 */

const CENSUS_HOST = "api.data.gov.in";
const POLY_PATH = "/agro/1.0/polygons";
const NDVI_PATH = "/agro/1.0/ndvi/history";

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function notOk(status = 500) {
  return { ok: false, status, json: async () => ({}) };
}

/**
 * Routes a stubbed fetch by URL so a test can fail one API and leave the other
 * healthy — the mixed-outcome cases are the realistic ones.
 */
function routedFetch(routes: {
  census?: () => any;
  polygon?: () => any;
  ndvi?: () => any;
}) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes(CENSUS_HOST)) return (routes.census ?? (() => notOk(404)))();
    if (u.includes(POLY_PATH)) return (routes.polygon ?? (() => notOk(404)))();
    if (u.includes(NDVI_PATH)) return (routes.ndvi ?? (() => notOk(404)))();
    throw new Error(`unexpected fetch to ${u}`);
  });
}

const censusRecords = (record: Record<string, unknown>) => ok({ records: [record] });
const ndviHistory = (means: number[]) => ok(means.map((mean) => ({ data: { mean } })));

let fetchMock: ReturnType<typeof vi.fn>;

async function run(
  routes: Parameters<typeof routedFetch>[0],
  coords: [number, number] = [12.9716, 77.5946]
) {
  fetchMock = routedFetch(routes);
  vi.stubGlobal("fetch", fetchMock);
  const { fetchGeoIntelligence } = await import("@/lib/geo-intelligence");
  return fetchGeoIntelligence(coords[0], coords[1], "Bengaluru Urban", "Karnataka");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.DATA_GOV_IN_API_KEY = "census-key";
  process.env.AGROMONITORING_API_KEY = "agro-key";
});

afterEach(() => {
  delete process.env.DATA_GOV_IN_API_KEY;
  delete process.env.AGROMONITORING_API_KEY;
  vi.unstubAllGlobals();
});

describe("fetchGeoIntelligence — the happy path", () => {
  it("returns census figures and an NDVI reading together", async () => {
    const result = await run({
      census: () => censusRecords({ literacy_rate: "88.48", rural_population: "1234567" }),
      polygon: () => ok({ id: "poly-1" }),
      ndvi: () => ndviHistory([0.3, 0.71]),
    });

    expect(result.literacyRate).toBeCloseTo(88.48, 5);
    expect(result.ruralPopulation).toBe(1234567);
    expect(result.ndviScore).toBeCloseTo(0.71, 5);
  });

  it("echoes the district and state it was given, unmodified", async () => {
    const result = await run({ census: () => notOk(), polygon: () => notOk() });
    expect(result.district).toBe("Bengaluru Urban");
    expect(result.state).toBe("Karnataka");
  });

  it("stamps fetchedAt as a parseable ISO-8601 instant", async () => {
    const result = await run({ census: () => notOk(), polygon: () => notOk() });
    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(Number.isNaN(Date.parse(result.fetchedAt))).toBe(false);
  });

  it("takes the most recent NDVI sample, which is the last element", async () => {
    const result = await run({
      polygon: () => ok({ id: "poly-1" }),
      ndvi: () => ndviHistory([0.9, 0.8, 0.12]),
    });
    expect(result.ndviScore).toBeCloseTo(0.12, 5);
  });
});

describe("fetchGeoIntelligence — NDVI interpretation bands", () => {
  async function interpret(mean: number) {
    const result = await run({
      polygon: () => ok({ id: "poly-1" }),
      ndvi: () => ndviHistory([mean]),
    });
    return result.ndviInterpretation;
  }

  it("calls anything above 0.5 dense vegetation", async () => {
    expect(await interpret(0.75)).toBe("Dense vegetation (healthy agricultural area)");
  });

  it("treats 0.5 itself as moderate, not dense — the band is exclusive at the top", async () => {
    expect(await interpret(0.5)).toBe("Moderate vegetation");
  });

  it("calls 0.2 up to 0.5 moderate, inclusive at the bottom", async () => {
    expect(await interpret(0.2)).toBe("Moderate vegetation");
    expect(await interpret(0.49)).toBe("Moderate vegetation");
  });

  it("calls 0 up to 0.2 sparse, inclusive at zero", async () => {
    expect(await interpret(0)).toBe("Sparse vegetation / semi-arid");
    expect(await interpret(0.19)).toBe("Sparse vegetation / semi-arid");
  });

  it("reads a negative NDVI as water or built-up land, not as an error", async () => {
    expect(await interpret(-0.3)).toBe("Urban / barren / water body");
  });

  it("does not claim an interpretation when NDVI could not be read at all", async () => {
    const result = await run({ polygon: () => notOk(503) });
    expect(result.ndviScore).toBeNull();
    expect(result.ndviInterpretation).toBe("Unknown / Fetch Failed");
  });
});

describe("fetchGeoIntelligence — missing credentials", () => {
  it("skips the census call entirely when no data.gov.in key is configured", async () => {
    delete process.env.DATA_GOV_IN_API_KEY;
    const result = await run({ polygon: () => ok({ id: "p" }), ndvi: () => ndviHistory([0.4]) });

    expect(result.literacyRate).toBeNull();
    expect(result.ruralPopulation).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes(CENSUS_HOST))).toBe(false);
    // The other leg is unaffected — one missing key must not disable both.
    expect(result.ndviScore).toBeCloseTo(0.4, 5);
  });

  it("skips the NDVI handshake entirely when no AgroMonitoring key is configured", async () => {
    delete process.env.AGROMONITORING_API_KEY;
    const result = await run({ census: () => censusRecords({ literacy_rate: "70" }) });

    expect(result.ndviScore).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes(POLY_PATH))).toBe(false);
    expect(result.literacyRate).toBeCloseTo(70, 5);
  });

  it("still resolves a complete object with both keys absent", async () => {
    delete process.env.DATA_GOV_IN_API_KEY;
    delete process.env.AGROMONITORING_API_KEY;
    const result = await run({});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      district: "Bengaluru Urban",
      state: "Karnataka",
      literacyRate: null,
      ruralPopulation: null,
      ndviScore: null,
      ndviInterpretation: "Unknown / Fetch Failed",
    });
  });
});

describe("fetchGeoIntelligence — degrading on bad upstream data", () => {
  it("survives a census response carrying no records array", async () => {
    const result = await run({ census: () => ok({}) });
    expect(result.literacyRate).toBeNull();
  });

  it("survives an empty census records array", async () => {
    const result = await run({ census: () => ok({ records: [] }) });
    expect(result.literacyRate).toBeNull();
  });

  it("leaves a census field null when that field is absent from the record", async () => {
    const result = await run({ census: () => censusRecords({ literacy_rate: "61.5" }) });
    expect(result.literacyRate).toBeCloseTo(61.5, 5);
    expect(result.ruralPopulation).toBeNull();
  });

  it("does not reject when the census call throws outright", async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes(CENSUS_HOST)) throw new Error("ECONNRESET");
      return notOk();
    });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGeoIntelligence } = await import("@/lib/geo-intelligence");

    const result = await fetchGeoIntelligence(1, 2, "D", "S");
    expect(result.literacyRate).toBeNull();
  });

  it("abandons NDVI when the polygon POST succeeds but returns no id", async () => {
    const result = await run({ polygon: () => ok({}) });

    expect(result.ndviScore).toBeNull();
    // Without an id there is nothing to query, so the history GET must not fire.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes(NDVI_PATH))).toBe(false);
  });

  it("abandons NDVI when the history GET fails after a good polygon", async () => {
    const result = await run({ polygon: () => ok({ id: "poly-1" }), ndvi: () => notOk(502) });
    expect(result.ndviScore).toBeNull();
  });

  it("survives an empty NDVI history", async () => {
    const result = await run({ polygon: () => ok({ id: "poly-1" }), ndvi: () => ok([]) });
    expect(result.ndviScore).toBeNull();
  });

  it("survives an NDVI sample with no mean in it", async () => {
    const result = await run({
      polygon: () => ok({ id: "poly-1" }),
      ndvi: () => ok([{ data: {} }]),
    });
    expect(result.ndviScore).toBeNull();
  });

  it("survives an NDVI history that is not an array at all", async () => {
    const result = await run({
      polygon: () => ok({ id: "poly-1" }),
      ndvi: () => ok({ error: "unexpected shape" }),
    });
    expect(result.ndviScore).toBeNull();
  });
});

describe("fetchGeoIntelligence — request construction", () => {
  it("sends the district as a URL-encoded filter so a space cannot break the query", async () => {
    await run({ census: () => censusRecords({}) });

    const censusUrl = String(
      fetchMock.mock.calls.find(([u]) => String(u).includes(CENSUS_HOST))![0]
    );
    expect(censusUrl).toContain("filters[district]=Bengaluru%20Urban");
    expect(censusUrl).toContain("api-key=census-key");
  });

  it("builds a closed polygon of five points around the given coordinate", async () => {
    await run({ polygon: () => ok({ id: "p" }), ndvi: () => ok([]) }, [20, 80]);

    const polyCall = fetchMock.mock.calls.find(([u]) => String(u).includes(POLY_PATH))!;
    const body = JSON.parse(String((polyCall[1] as RequestInit).body));
    const ring = body.geo_json.geometry.coordinates[0];

    expect(body.geo_json.geometry.type).toBe("Polygon");
    expect(ring).toHaveLength(5);
    // A GeoJSON ring must close: last point identical to the first.
    expect(ring[4]).toEqual(ring[0]);
    // Coordinates are [lng, lat] in GeoJSON order, not [lat, lng].
    expect(ring[0]).toEqual([80 - 0.005, 20 - 0.005]);
    expect(ring[2]).toEqual([80 + 0.005, 20 + 0.005]);
  });

  it("asks for a 30-day NDVI window ending now", async () => {
    await run({ polygon: () => ok({ id: "poly-9" }), ndvi: () => ok([]) });

    const ndviUrl = new URL(
      String(fetchMock.mock.calls.find(([u]) => String(u).includes(NDVI_PATH))![0])
    );
    const start = Number(ndviUrl.searchParams.get("start"));
    const end = Number(ndviUrl.searchParams.get("end"));

    expect(ndviUrl.searchParams.get("polyid")).toBe("poly-9");
    expect(end - start).toBe(30 * 24 * 60 * 60);
    // Unix seconds, not milliseconds — off by 1000x is the classic bug here.
    expect(Math.abs(end - Math.floor(Date.now() / 1000))).toBeLessThan(120);
  });
});
