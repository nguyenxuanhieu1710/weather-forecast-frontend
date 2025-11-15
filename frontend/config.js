// ===================== Config & Globals =====================

// Nếu API của bạn đang không có prefix /api, sửa dòng này lại cho đúng:
const API_BASE = "http://100.123.92.116:8000/api";

const TEMP_TTL_MS = 3 * 60 * 1000; // 3 phút

const TEMP_MIN_C = 10;
const TEMP_MAX_C = 40;

/**
 * @typedef {Object} ObsCell
 * @property {string} location_id
 * @property {number} lat
 * @property {number} lon
 * @property {number} temp_c
 * @property {number} precip_mm
 * @property {string} valid_at
 * @property {boolean} [is_active]
 */

/**
 * @typedef {Object} LatestObsState
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

  if (!force && latestTempGridCache && now < latestTempGridCache.validUntil) {
    return latestTempGridCache;
  }

  const url = `${API_BASE}/obs/latest?var=temp`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch latest temp grid: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const rawCells = Array.isArray(data.data) ? data.data : [];

  /** @type {ObsCell[]} */
    const cells = rawCells
    .map((r) => {
      if (!r) return null;

      const location_id = r.location_id || r.id || null;
      const lat = r.lat;
      const lon = r.lon;
      const temp_c = r.temp_c;
      const valid_at = r.valid_at;

      // Các thông số bổ sung lấy từ backend (nếu có)
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

      if (
        !location_id ||
        lat == null ||
        lon == null ||
        temp_c == null ||
        !valid_at
      ) {
        return null;
      }

      return {
        location_id: String(location_id),
        lat: Number(lat),
        lon: Number(lon),
        temp_c: Number(temp_c),
        precip_mm,
        valid_at: String(valid_at),

        // thông số phụ, có thì dùng, không có thì null
        wind_ms,
        wind_dir_deg,
        rel_humidity_pct,
        cloudcover_pct,
        surface_pressure_hpa,

        is_active: true
      };
    })

    .filter(
      (c) =>
        c &&
        Number.isFinite(c.lat) &&
        Number.isFinite(c.lon) &&
        Number.isFinite(c.temp_c)
    );

  const obsTime =
    cells.length > 0 && cells[0].valid_at
      ? cells[0].valid_at
      : null;

  const state = {
    cells,
    fetchedAt: now,
    validUntil: now + TEMP_TTL_MS,
    obsTime
  };

  latestTempGridCache = state;
  window.latestTempGridCache = state;

  return state;
}

function invalidateLatestTempGrid() {
  latestTempGridCache = null;
  window.latestTempGridCache = null;
}

/**
 * GET /obs/nearest (nearest_point)
 */
async function fetchNearestTemp(lat, lon) {
  const url = new URL(`${API_BASE}/obs/nearest`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));

  const resp = await fetch(url.toString());

  if (resp.status === 404) {
    return { has_data: false, found: false };
  }

  if (!resp.ok) {
    throw new Error(`Failed to fetch nearest: HTTP ${resp.status}`);
  }

  const data = await resp.json();

  const found = !!data.found;

  return {
    has_data: found,
    found,
    location_id: data.location_id || null,
    lat: data.lat,
    lon: data.lon
  };
}

window.API_BASE = API_BASE;
window.TEMP_TTL_MS = TEMP_TTL_MS;
window.TEMP_MIN_C = TEMP_MIN_C;
window.TEMP_MAX_C = TEMP_MAX_C;

window.fetchLatestTempGrid = fetchLatestTempGrid;
window.invalidateLatestTempGrid = invalidateLatestTempGrid;
window.fetchNearestTemp = fetchNearestTemp;
