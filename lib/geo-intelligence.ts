export interface GeoIntelligenceResult {
  district: string;
  state: string;
  literacyRate: number | null;
  ruralPopulation: number | null;
  ndviScore: number | null;
  ndviInterpretation: string;
  fetchedAt: string;
}

export async function fetchGeoIntelligence(
  lat: number,
  lng: number,
  district: string,
  state: string
): Promise<GeoIntelligenceResult> {
  const dataGovApiKey = process.env.DATA_GOV_IN_API_KEY;
  const agroApiKey = process.env.AGROMONITORING_API_KEY;

  let literacyRate: number | null = null;
  let ruralPopulation: number | null = null;
  let ndviScore: number | null = null;
  let ndviInterpretation = "Unknown / Fetch Failed";

  const fetchCensus = async () => {
    if (!dataGovApiKey) return;
    try {
      // Free Data.gov.in API for Census 2011 district data
      // Filter by district name (case-insensitive usually, but passing exactly what's given)
      const url = `https://api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69?api-key=${dataGovApiKey}&format=json&offset=0&limit=1&filters[district]=${encodeURIComponent(district)}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.records && data.records.length > 0) {
        const record = data.records[0];
        // Parse fields based on common Census 2011 dataset structure
        // The exact field names might vary slightly but usually it's rural_population, literacy_rate
        literacyRate = record.literacy_rate ? parseFloat(record.literacy_rate) : null;
        ruralPopulation = record.rural_population ? parseInt(record.rural_population, 10) : null;
      }
    } catch (e) {
      console.error("Failed to fetch Census data", e);
    }
  };

  const fetchNDVI = async () => {
    if (!agroApiKey) return;
    try {
      // Step 1: Create polygon ~1km^2
      // 1 degree latitude ~= 111km, so 0.005 degrees ~= 0.55km. A ~1km box is approx +/- 0.005
      const offset = 0.005;
      const polygonGeoJSON = {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [lng - offset, lat - offset],
              [lng + offset, lat - offset],
              [lng + offset, lat + offset],
              [lng - offset, lat + offset],
              [lng - offset, lat - offset] // close polygon
            ]
          ]
        }
      };

      const polyRes = await fetch(`http://api.agromonitoring.com/agro/1.0/polygons?appid=${agroApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Project_${district}_${Date.now()}`,
          geo_json: polygonGeoJSON
        })
      });

      if (!polyRes.ok) return;
      const polyData = await polyRes.json();
      const polyId = polyData.id;

      if (!polyId) return;

      // Step 2: Fetch NDVI history for the last 30 days
      const to = Math.floor(Date.now() / 1000);
      const from = to - (30 * 24 * 60 * 60);

      const ndviRes = await fetch(`http://api.agromonitoring.com/agro/1.0/ndvi/history?polyid=${polyId}&start=${from}&end=${to}&appid=${agroApiKey}`);
      if (!ndviRes.ok) return;
      
      const ndviData = await ndviRes.json();
      if (Array.isArray(ndviData) && ndviData.length > 0) {
        // AgroMonitoring returns array sorted by time, most recent last, or we can just pick the last one
        const latest = ndviData[ndviData.length - 1];
        if (latest && latest.data && latest.data.mean !== undefined) {
          ndviScore = latest.data.mean;
        }
      }
    } catch (e) {
      console.error("Failed to fetch NDVI data", e);
    }
  };

  await Promise.all([fetchCensus(), fetchNDVI()]);

  if (ndviScore !== null) {
    if (ndviScore > 0.5) ndviInterpretation = "Dense vegetation (healthy agricultural area)";
    else if (ndviScore >= 0.2) ndviInterpretation = "Moderate vegetation";
    else if (ndviScore >= 0) ndviInterpretation = "Sparse vegetation / semi-arid";
    else ndviInterpretation = "Urban / barren / water body";
  }

  return {
    district,
    state,
    literacyRate,
    ruralPopulation,
    ndviScore,
    ndviInterpretation,
    fetchedAt: new Date().toISOString()
  };
}
