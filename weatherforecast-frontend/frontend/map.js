// map.js
// Khởi tạo Leaflet map, load biên giới Việt Nam, xử lý click gọi /obs/nearest + /obs/timeseries


window.map = null;
let clickMarker = null;



function getApiBase() {
  // Ưu tiên API_BASE nếu bạn có khai báo global
  return typeof window.API_BASE === "string" && window.API_BASE
    ? window.API_BASE
    : "http://localhost:8000/api";
}



function findVietnamFeature(geojson) {
  if (!geojson || !Array.isArray(geojson.features)) return null;

  let candidate = null;

  for (const f of geojson.features) {
    if (!f || !f.properties) continue;
    const admin = (f.properties.ADMIN || f.properties.NAME || "").toLowerCase();
    const iso = (f.properties.ISO_A3 || "").toUpperCase();

    if (admin === "vietnam" || admin === "viet nam") return f;
    if (iso === "VNM") candidate = f;
  }
  return candidate;
}

async function loadVietnamBoundary(map) {
  try {
    const resp = await fetch("ne_10m_admin_0_countries.geojson");
    if (!resp.ok) {
      console.error("Failed to load VN geojson:", resp.status);
      return;
    }
    const geo = await resp.json();
    const vnFeature = findVietnamFeature(geo);
    if (!vnFeature) {
      console.error("Vietnam feature not found in geojson");
      return;
    }

    // Lưu geometry để dùng kiểm tra click / lớp phủ
    window.VN_GEOMETRY = vnFeature.geometry;

    const layer = L.geoJSON(vnFeature, {
      style: {
        color: "#ffffff",
        weight: 1,
        fill: false,
      },
    }).addTo(map);

    try {
      map.fitBounds(layer.getBounds(), { padding: [20, 20] });
    } catch (err) {
      console.warn("fitBounds error:", err);
    }
  } catch (err) {
    console.error("Error loading VN boundary:", err);
  }
}

function findCellByLocationId(location_id) {
  const cache = window.latestTempGridCache;
  if (!cache || !Array.isArray(cache.cells)) return null;
  return cache.cells.find((c) => c.location_id === String(location_id)) || null;
}

// Ray-casting trên một ring [ [lon,lat], ... ]
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInGeometry(lat, lon, geometry) {
  if (!geometry || !geometry.type || !geometry.coordinates) return false;

  const x = lon;
  const y = lat;

  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates;
    if (!rings.length) return false;
    return pointInRing(x, y, rings[0]);
  }

  if (geometry.type === "MultiPolygon") {
    const polys = geometry.coordinates;
    for (const poly of polys) {
      if (!poly.length) continue;
      if (pointInRing(x, y, poly[0])) return true;
    }
    return false;
  }

  return false;
}

// Fallback BBOX rất chặt nếu không có mask nào khác
function fallbackBoundsVN(lat, lon) {
  return lat >= 8.0 && lat <= 24.5 && lon >= 102.0 && lon <= 110.0;
}

// Hàm chung kiểm tra click có được phép hay không
function isClickInsideVietnam(lat, lon) {
  // Ưu tiên dùng mask chung toàn hệ thống nếu đã được định nghĩa trong layers.js
  if (typeof window.isPointInsideVN === "function") {
    try {
      return !!window.isPointInsideVN(lat, lon);
    } catch (e) {
      console.warn("isPointInsideVN error:", e);
      // rơi xuống dưới nếu lỗi
    }
  }

  // Nếu có VN_GEOMETRY mà chưa có isPointInsideVN thì tự kiểm tra polygon
  if (window.VN_GEOMETRY) {
    return isPointInGeometry(lat, lon, window.VN_GEOMETRY);
  }

  // Cuối cùng mới dùng BBOX cứng
  return fallbackBoundsVN(lat, lon);
}

function bindMapClickNearest(map) {
  // chống race: click sau phải thắng
  let clickSeq = 0;

  function pickNearestFields(result) {
    const locId =
      result?.location_id ||
      result?.location?.id ||
      result?.location?.location_id ||
      null;

    const sLat =
      (typeof result?.lat === "number" ? result.lat : null) ??
      (typeof result?.location?.lat === "number" ? result.location.lat : null);

    const sLon =
      (typeof result?.lon === "number" ? result.lon : null) ??
      (typeof result?.location?.lon === "number" ? result.location.lon : null);

    return { locId: locId ? String(locId) : null, sLat, sLon };
  }

  map.on("click", async (e) => {
    const seq = ++clickSeq;

    const lat = e.latlng.lat;
    const lon = e.latlng.lng;

    const inside = isClickInsideVietnam(lat, lon);

    // ===== CLICK NGOÀI VIỆT NAM =====
    if (!inside) {
      L.popup({ maxWidth: 220 })
        .setLatLng(e.latlng)
        .setContent(
          `
          <div style="text-align:center; font-size:13px;">
            Vị trí đang chọn:<br>
            <b>${lat.toFixed(4)}, ${lon.toFixed(4)}</b><br>
            <span style="display:inline-block;margin-top:4px;color:#ef4444;font-weight:600;">
              Nằm ngoài phạm vi Việt Nam
            </span>
          </div>
        `
        )
        .openOn(map);

      window.lastNearestResult = null;
      window.lastLocationId = null;
      window.lastCell = null;

      if (clickMarker) {
        try {
          map.removeLayer(clickMarker);
        } catch (_) {}
        clickMarker = null;
      }

      if (typeof window.clearWeatherDetail === "function")
        window.clearWeatherDetail();
      if (typeof window.hideAlertPanel === "function") window.hideAlertPanel();

      return;
    }

    // ===== CLICK TRONG VIỆT NAM =====
    // marker điểm click (UX + debug)
    if (!clickMarker) {
      clickMarker = L.circleMarker(e.latlng, {
        radius: 6,
        weight: 2,
        color: "#22c55e",
        fillColor: "#22c55e",
        fillOpacity: 0.35,
      }).addTo(map);
    } else {
      clickMarker.setLatLng(e.latlng);
    }

    const popup = L.popup()
      .setLatLng(e.latlng)
      .setContent(
        `
        <div style="text-align: center;">
          Vị trí đang chọn:<br>
          <b>${lat.toFixed(4)}, ${lon.toFixed(4)}</b><br>
          <span style="font-size: 11px; color: gray;">... Đang tìm trạm ...</span>
        </div>
      `
      )
      .openOn(map);

    let result = null;
    try {
      if (typeof window.fetchNearestTemp === "function") {
        result = await window.fetchNearestTemp(lat, lon);
      }
    } catch (err) {
      console.error("[map] fetchNearestTemp failed", err);
    }

    // nếu có click mới hơn => bỏ qua kết quả cũ
    if (seq !== clickSeq) return;

    const { locId, sLat, sLon } = pickNearestFields(result);


    if (map.hasLayer(popup)) {
      if (result && result.found && locId) {
        popup.setContent(`
          <div style="text-align: center;">
            Vị trí đang chọn:<br>
            <b>${lat.toFixed(4)}, ${lon.toFixed(4)}</b>
            <hr style="margin: 5px 0; border: 0; border-top: 1px solid #ddd;">
            <span style="color: #007bff; font-weight: bold;">Trạm quan trắc gần nhất:</span><br>
            Tọa độ: <b>${typeof sLat === "number" ? sLat.toFixed(1) : "–"}, ${
          typeof sLon === "number" ? sLon.toFixed(1) : "–"
        }
        `);
      } else {
        popup.setContent(`
          <div style="text-align: center;">
            Vị trí đang chọn:<br>
            <b>${lat.toFixed(4)}, ${lon.toFixed(4)}</b><br>
            <i>Không tìm thấy trạm gần đây</i>
          </div>
        `);
      }
    }

    // cập nhật state
    let cell = null;
    if (locId) {
      cell =
        typeof findCellByLocationId === "function"
          ? findCellByLocationId(locId)
          : null;
    }

    window.lastNearestResult = result || null;
    window.lastLocationId = locId || null;
    window.lastCell = cell || null;

    // sync TimeState locationId để toàn app nhất quán
    if (
      locId &&
      window.TimeState &&
      typeof window.TimeState.setLocationId === "function"
    ) {
      window.TimeState.setLocationId(locId);
    }

    if (locId && window.fetchAlertSummary && window.updateAlertPanel) {
      try {
        const summary = await window.fetchAlertSummary(locId);
        if (seq !== clickSeq) return;
        window.updateAlertPanel(summary);
        if (typeof window.showAlertPanel === "function")
          window.showAlertPanel();
      } catch (err) {
        console.error("[map] fetchAlertSummary failed", err);
      }
    }

    if (locId && typeof window.loadTimeSeriesForLocation === "function") {
      try {
        await window.loadTimeSeriesForLocation(locId);
      } catch (err) {
        console.error("[map] loadTimeSeriesForLocation failed", err);
      }
    }
  });
}

function initMap() {
  if (window.map) return window.map;

  const map = L.map("map", {
    center: [16.0, 107.5],
    zoom: 5,
    minZoom: 4,
    maxZoom: 12,
    zoomControl: true,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  }).addTo(map);

  map.createPane("meteo");
  const meteoPane = map.getPane("meteo");
  if (meteoPane) {
    meteoPane.style.zIndex = 450;
  }

  window.map = map;

  loadVietnamBoundary(map);
  bindMapClickNearest(map);

  return map;
}

window.initMap = initMap;
