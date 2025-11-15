// ===================== Giới hạn VN (bbox thô) =====================
const VN_MIN_LAT = 8.0;
const VN_MAX_LAT = 24.5;
const VN_MIN_LON = 102.0;
const VN_MAX_LON = 110.0;

// ===================== Point-in-polygon cho vietnam.geojson =====================

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];

    const intersect =
      yi > lat !== yj > lat &&
      lon <
        ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygonGeometry(lon, lat, geom) {
  if (!geom) return false;

  if (geom.type === "Polygon") {
    const coords = geom.coordinates;
    if (!coords.length) return false;
    const outer = coords[0];
    if (!pointInRing(lon, lat, outer)) return false;
    for (let i = 1; i < coords.length; i++) {
      if (pointInRing(lon, lat, coords[i])) return false;
    }
    return true;
  }

  if (geom.type === "MultiPolygon") {
    const polys = geom.coordinates;
    for (const poly of polys) {
      if (!poly.length) continue;
      const outer = poly[0];
      if (!pointInRing(lon, lat, outer)) continue;

      let inHole = false;
      for (let i = 1; i < poly.length; i++) {
        if (pointInRing(lon, lat, poly[i])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
    return false;
  }

  return false;
}

function pointInVietnam(lat, lon) {
  const geom = window.VN_GEOMETRY;
  if (!geom) {
    // fallback: chỉ bbox nếu polygon chưa load
    return (
      lat >= VN_MIN_LAT &&
      lat <= VN_MAX_LAT &&
      lon >= VN_MIN_LON &&
      lon <= VN_MAX_LON
    );
  }
  return pointInPolygonGeometry(lon, lat, geom);
}

// ===================== Distance helpers (Haversine) =====================

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// ===================== Nearest trạm (local) cho heatmap =====================

function findNearestObsLocal(lat, lon, obs) {
  let best = null;
  let bestD = Infinity;

  for (const o of obs) {
    const la = +o.lat;
    const lo = +o.lon;
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;

    const d = haversineKm(lat, lon, la, lo);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

// ===================== Nhiệt độ: nearest-grid, cắt theo VN polygon =====================

function buildTempInterpolatedGridLayer(obs) {
  if (!Array.isArray(obs) || !obs.length) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const o of obs) {
    const la = +o.lat;
    const lo = +o.lon;
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;

    if (la < VN_MIN_LAT || la > VN_MAX_LAT || lo < VN_MIN_LON || lo > VN_MAX_LON)
      continue;

    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (lo < minLon) minLon = lo;
    if (lo > maxLon) maxLon = lo;
  }

  if (!Number.isFinite(minLat)) return null;

  minLat = Math.max(minLat - 0.25, VN_MIN_LAT);
  maxLat = Math.min(maxLat + 0.25, VN_MAX_LAT);
  minLon = Math.max(minLon - 0.25, VN_MIN_LON);
  maxLon = Math.min(maxLon + 0.25, VN_MAX_LON);

  const stepLat = 0.25;
  const stepLon = 0.25;
  const halfLat = stepLat / 2;
  const halfLon = stepLon / 2;

  const group = L.layerGroup();

  for (let lat = minLat; lat <= maxLat; lat += stepLat) {
    for (let lon = minLon; lon <= maxLon; lon += stepLon) {
      // chỉ vẽ nếu tâm nằm trong polygon VN
      if (!pointInVietnam(lat, lon)) continue;

      const nearest = findNearestObsLocal(lat, lon, obs);
      if (!nearest || !Number.isFinite(+nearest.temp_c)) continue;

      const tempVal = +nearest.temp_c;

      const bounds = [
        [lat - halfLat, lon - halfLon],
        [lat + halfLat, lon + halfLon]
      ];

      const rect = L.rectangle(bounds, {
        pane: "meteo",
        stroke: false,
        fillOpacity: 0.92,
        fillColor: tempColorScale(tempVal)
      });

      rect.on("click", () => {
        // popup chi tiết → dùng nearest backend
        fetchAndShowWeatherFromObs(lat, lon);
      });

      group.addLayer(rect);
    }
  }

  return group;
}

// ===================== Build rectangles grid cho mưa/gió (cũng cắt theo VN) =====================

function buildGridLayerFromObs(obs, valueKey, colorScale) {
  if (!Array.isArray(obs) || !obs.length) return null;

  const { halfLat, halfLon } = inferGridHalfStep(obs);
  const group = L.layerGroup();

  for (const o of obs) {
    const lat = +o.lat;
    const lon = +o.lon;
    const v = +o[valueKey];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(v))
      continue;

    if (!pointInVietnam(lat, lon)) continue;

    const bounds = [
      [lat - halfLat, lon - halfLon],
      [lat + halfLat, lon + halfLon]
    ];
    const color = colorScale(v);

    const rect = L.rectangle(bounds, {
      pane: "meteo",
      stroke: false,
      fillOpacity: 0.92,
      fillColor: color
    });

    rect.on("click", () => {
      fetchAndShowWeatherFromObs(lat, lon);
    });

    group.addLayer(rect);
  }

  return group;
}

// ===================== Weather layers load/toggle =====================

async function loadTemperatureLayer() {
  const myReq = ++layerReqId;
  const obs = await getLatestObs();
  if (myReq !== layerReqId || !obs.length) return;

  if (tempLayer && map.hasLayer(tempLayer)) map.removeLayer(tempLayer);
  tempLayer = buildTempInterpolatedGridLayer(obs);
  if (tempLayer) tempLayer.addTo(map);

  clearLegend();
  setLegend("Nhiệt độ", TEMP_STOPS, TEMP_COLORS, "°C");
}

async function loadRainLayer() {
  const myReq = ++layerReqId;
  const obs = await getLatestObs();
  if (myReq !== layerReqId || !obs.length) return;

  if (rainLayer && map.hasLayer(rainLayer)) map.removeLayer(rainLayer);
  rainLayer = buildGridLayerFromObs(obs, "precip_mm", rainColorScale);
  if (rainLayer) rainLayer.addTo(map);

  clearLegend();
  setLegend("Lượng mưa", RAIN_STOPS, RAIN_COLORS, "mm");
}

async function loadWindLayer() {
  const myReq = ++layerReqId;
  const obs = await getLatestObs();
  if (myReq !== layerReqId || !obs.length) return;

  if (windLayer && map.hasLayer(windLayer)) map.removeLayer(windLayer);
  windLayer = buildGridLayerFromObs(obs, "wind_ms", windColorScale);
  if (windLayer) windLayer.addTo(map);

  clearLegend();
  setLegend("Tốc độ gió", WIND_STOPS, WIND_COLORS, "m/s");
}

function clearAllWeatherLayers() {
  if (tempLayer && map.hasLayer(tempLayer)) map.removeLayer(tempLayer);
  if (rainLayer && map.hasLayer(rainLayer)) map.removeLayer(rainLayer);
  if (windLayer && map.hasLayer(windLayer)) map.removeLayer(windLayer);
  tempLayer = rainLayer = windLayer = null;
  clearLegend();
}

function toggleTempLayer() {
  if (tempLayer && map.hasLayer(tempLayer)) {
    clearAllWeatherLayers();
  } else {
    clearAllWeatherLayers();
    loadTemperatureLayer();
  }
}

function toggleRainLayer() {
  if (rainLayer && map.hasLayer(rainLayer)) {
    clearAllWeatherLayers();
  } else {
    clearAllWeatherLayers();
    loadRainLayer();
  }
}

function toggleWindLayer() {
  if (windLayer && map.hasLayer(windLayer)) {
    clearAllWeatherLayers();
  } else {
    clearAllWeatherLayers();
    loadWindLayer();
  }
}
