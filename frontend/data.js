// ===================== Data helpers =====================

// Toàn bộ quan trắc mới nhất – dùng cho heatmap, detail
async function getLatestObs() {
  if (Array.isArray(latestObs) && latestObs.length) return latestObs;

  try {
    const res = await fetch(`${API_BASE}/api/obs/latest`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    latestObs = Array.isArray(json) ? json : json?.data || [];
    return latestObs;
  } catch (err) {
    console.error("Lỗi load /api/obs/latest:", err);
    latestObs = [];
    return latestObs;
  }
}

// Cache cho điểm nhiệt độ (nếu có dùng)
async function getTempPts(force = false) {
  const now = Date.now();
  if (!force && tempPtsCache?.length && now - tempCacheAt < TEMP_TTL_MS) {
    return tempPtsCache;
  }

  const d = await getLatestObs();
  tempPtsCache = (d || [])
    .filter(
      (s) =>
        Number.isFinite(+s.lat) &&
        Number.isFinite(+s.lon) &&
        Number.isFinite(+s.temp_c)
    )
    .map((s) => [+s.lat, +s.lon, +s.temp_c]);
  tempCacheAt = now;
  return tempPtsCache;
}

// ===================== Nearest do BACKEND xử lý =====================

// Gọi API /api/obs/nearest?lat=..&lon=..
async function getNearestObsFromBackend(lat, lon) {
  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon)
    });
    const url = `${API_BASE}/api/obs/nearest?${params.toString()}`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    if (!json || json.found === false) {
      console.warn("Backend /api/obs/nearest trả found = false");
      return null;
    }
    // Dạng hiện tại: { "found": true, "location_id": "...", "lat": 11.0, "lon": 106.5 }
    return json;
  } catch (err) {
    console.error("Lỗi gọi /api/obs/nearest:", err);
    return null;
  }
}

// Map nearest (location_id / lat/lon) về bản ghi trong /api/obs/latest
function findObsFromLatestByNearestInfo(list, nearestInfo) {
  if (!Array.isArray(list) || !list.length || !nearestInfo) return null;

  if (nearestInfo.location_id) {
    const byId = list.find((s) => s.location_id === nearestInfo.location_id);
    if (byId) return byId;
  }

  const nLat = Number(nearestInfo.lat);
  const nLon = Number(nearestInfo.lon);
  if (Number.isFinite(nLat) && Number.isFinite(nLon)) {
    const eps = 1e-5;
    const byCoord =
      list.find(
        (s) =>
          Math.abs(Number(s.lat) - nLat) < eps &&
          Math.abs(Number(s.lon) - nLon) < eps
      ) || null;
    if (byCoord) return byCoord;
  }

  return null;
}

// ===================== Fetch + show info khi click map =====================
// DÙNG BACKEND NEAREST cho snapping; frontend không tự nearest nữa.

async function fetchAndShowWeatherFromObs(lat, lon) {
  const nearest = await getNearestObsFromBackend(lat, lon);
  if (!nearest) {
    console.warn("Không tìm được nearest từ backend.");
    hideDetail();
    return;
  }

  const list = await getLatestObs();
  if (!list.length) {
    console.warn("Không có dữ liệu /api/obs/latest.");
    hideDetail();
    return;
  }

  const s = findObsFromLatestByNearestInfo(list, nearest);
  if (!s) {
    console.warn(
      "Backend trả nearest nhưng không tìm thấy bản ghi khớp trong /api/obs/latest."
    );
    showDetail({
      name: "Điểm gần nhất (backend)",
      time: "--",
      tempC: null,
      rainMm: null,
      windMs: null,
      lat: Number(nearest.lat),
      lon: Number(nearest.lon)
    });
    return;
  }

  const validTime = s.valid_at || s.time || s.timestamp || "--";

  showDetail({
    name: s.location_name || s.station_name || "Điểm quan trắc",
    time: validTime,
    tempC: Number.isFinite(+s.temp_c) ? +s.temp_c : null,
    rainMm: Number.isFinite(+s.precip_mm) ? +s.precip_mm : null,
    windMs: Number.isFinite(+s.wind_ms) ? +s.wind_ms : null,
    lat: +s.lat,
    lon: +s.lon
  });
}

// ===================== Grid step inference (cho mưa/gió) =====================

function inferGridHalfStep(obs) {
  const lats = [];
  const lons = [];
  const seenLat = new Set();
  const seenLon = new Set();

  for (const o of obs) {
    const la = +o.lat;
    const lo = +o.lon;
    if (Number.isFinite(la) && !seenLat.has(la)) {
      lats.push(la);
      seenLat.add(la);
    }
    if (Number.isFinite(lo) && !seenLon.has(lo)) {
      lons.push(lo);
      seenLon.add(lo);
    }
  }

  lats.sort((a, b) => a - b);
  lons.sort((a, b) => a - b);

  function medianDelta(arr) {
    const d = [];
    for (let i = 1; i < arr.length; i++) d.push(arr[i] - arr[i - 1]);
    d.sort((a, b) => a - b);
    if (!d.length) return 0.25;
    const m = d[Math.floor(d.length / 2)];
    return m || 0.25;
  }

  const stepLat = medianDelta(lats);
  const stepLon = medianDelta(lons);

  const halfLat = Math.min((stepLat / 2) * 1.01, 0.5);
  const halfLon = Math.min((stepLon / 2) * 1.01, 0.5);

  return { halfLat, halfLon };
}
