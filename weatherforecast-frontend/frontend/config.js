// ===================== Config & Globals =====================

// Nếu API của bạn đã có prefix /api thì để nguyên:
//const API_BASE = "http://100.123.92.116:8000/api"; //(DUY)
const API_BASE = "http://100.113.91.24:8000/api"; // (HUY)
// Ví dụ localhost: "http://localhost:8000/api"



// LocationIQ search
const LQ_KEY = "pk.c4d167c79573b11c6022ab79ad7fd9a0";
const LQ_REGION = "us1";

const TEMP_TTL_MS = 3 * 60 * 1000; // 3 phút cache snapshot

const TEMP_MIN_C = 10;
const TEMP_MAX_C = 40;

/**
 * @typedef {Object} ObsCell
 * @property {string|null} location_id
 * @property {number} lat
 * @property {number} lon
 * @property {number} temp_c
 * @property {string|null} valid_at
 * @property {number} [precip_mm]
 * @property {number|null} [wind_ms]
 * @property {number|null} [wind_dir_deg]
 * @property {number|null} [rel_humidity_pct]
 * @property {number|null} [cloudcover_pct]
 * @property {number|null} [surface_pressure_hpa]
 */

/**
 * @typedef {Object} LatestTempGridCache
 * @property {ObsCell[]} cells
 * @property {number} fetchedAt
 * @property {number} validUntil
 * @property {string|null} obsTime
 */

let latestTempGridCache = null;
window.latestTempGridCache = null;

/**
 * GET /obs/latest (latest_snapshot)
 * backend trả: {"count": N, "data": [ ... ]}
 */
async function fetchLatestTempGrid(force = false) {
  const now = Date.now();

  // Dùng cache nếu còn hạn
  if (!force && latestTempGridCache && now < latestTempGridCache.validUntil) {
    return latestTempGridCache;
  }

  const url = `${API_BASE}/obs/latest?var=temp`;

  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`Failed to fetch latest temp grid: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const rawCells = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data)
    ? data
    : [];

  /** @type {ObsCell[]} */
  const cells = rawCells
    .map((r) => {
      if (!r) return null;

      const lat = Number(r.lat);
      const lon = Number(r.lon);
      const temp_c =
        r.temp_c != null ? Number(r.temp_c) : NaN;

      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(temp_c)) {
        return null;
      }

      const location_id = r.location_id || r.id || null;
      const valid_at = r.valid_at || null;

      const precip_mm =
        r.precip_mm != null ? Number(r.precip_mm) : 0;
      const wind_ms =
        r.wind_ms != null ? Number(r.wind_ms) : null;
      const wind_dir_deg =
        r.wind_dir_deg != null ? Number(r.wind_dir_deg) : null;
      const rel_humidity_pct =
        r.rel_humidity_pct != null ? Number(r.rel_humidity_pct) : null;
      const cloudcover_pct =
        r.cloudcover_pct != null ? Number(r.cloudcover_pct) : null;
      const surface_pressure_hpa =
        r.surface_pressure_hpa != null ? Number(r.surface_pressure_hpa) : null;

      return {
        location_id: location_id != null ? String(location_id) : null,
        lat,
        lon,
        temp_c,
        valid_at,
        precip_mm,
        wind_ms,
        wind_dir_deg,
        rel_humidity_pct,
        cloudcover_pct,
        surface_pressure_hpa,
      };
    })
    .filter(Boolean);

  const obsTime = data.obs_time || (cells.length ? cells[0].valid_at : null);

  latestTempGridCache = {
    cells,
    fetchedAt: now,
    validUntil: now + TEMP_TTL_MS,
    obsTime: obsTime || null,
  };

  window.latestTempGridCache = latestTempGridCache;
  return latestTempGridCache;
}

function invalidateLatestTempGrid() {
  latestTempGridCache = null;
  window.latestTempGridCache = null;
}

/**
 * GET /obs/nearest?lat=..&lon=..
 * Trả về điểm quan trắc gần nhất
 */
async function fetchNearestTemp(lat, lon) {
  const url = new URL(`${API_BASE}/obs/nearest`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));

  const resp = await fetch(url.toString(), { cache: "no-store" });

  if (resp.status === 404) {
    return { has_data: false, found: false };
  }

  if (!resp.ok) {
    throw new Error(`Failed to fetch nearest: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const found = !!(data && (data.found ?? true));

  return {
    raw: data,
    has_data: found,
    found,
    location_id: data.location_id || data.id || null,
    lat: data.lat,
    lon: data.lon,
  };
}

// Xuất global cho các file khác dùng
window.API_BASE = API_BASE;
window.LQ_KEY = LQ_KEY;
window.LQ_REGION = LQ_REGION;
window.TEMP_TTL_MS = TEMP_TTL_MS;
window.TEMP_MIN_C = TEMP_MIN_C;
window.TEMP_MAX_C = TEMP_MAX_C;

window.fetchLatestTempGrid = fetchLatestTempGrid;
window.invalidateLatestTempGrid = invalidateLatestTempGrid;
window.fetchNearestTemp = fetchNearestTemp;
