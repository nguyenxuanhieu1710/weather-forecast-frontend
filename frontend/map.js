// map.js
// Khởi tạo Leaflet map, load biên giới Việt Nam, gán VN_GEOMETRY, xử lý click gọi /obs/nearest

window.map = null;
let clickMarker = null;

/**
 * Tìm feature Việt Nam trong geojson Natural Earth
 */
function findVietnamFeature(geojson) {
  if (!geojson || !Array.isArray(geojson.features)) return null;

  let candidate = null;

  for (const f of geojson.features) {
    if (!f || !f.properties) continue;
    const admin = (f.properties.ADMIN || f.properties.NAME || "").toLowerCase();
    const iso = (f.properties.ISO_A3 || "").toUpperCase();

    if (admin === "vietnam" || admin === "viet nam") {
      return f;
    }
    if (iso === "VNM") {
      candidate = f;
    }
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

    window.VN_GEOMETRY = vnFeature.geometry;

    const layer = L.geoJSON(vnFeature, {
      style: {
        color: "#ffffff",
        weight: 1,
        fill: false
      }
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

/**
 * Lấy cell nhiệt độ hiện tại từ cache theo location_id
 */
function findCellByLocationId(location_id) {
  const cache = window.latestTempGridCache;
  if (!cache || !Array.isArray(cache.cells)) return null;
  return cache.cells.find((c) => c.location_id === String(location_id)) || null;
}

/**
 * HTML popup khi click
 * - nearest_point: location_id + lat/lon
 * - latest_snapshot: temp_c + valid_at
 */
function renderTempPopupContent(clickLat, clickLon, nearestResult) {
  if (!nearestResult || !nearestResult.found) {
    return "<b>Không tìm thấy điểm gần nhất</b>";
  }

  const locId = nearestResult.location_id;
  const locLat = nearestResult.lat;
  const locLon = nearestResult.lon;

  const cell = locId ? findCellByLocationId(locId) : null;

  let html = "<div class='popup-temp'>";

  if (cell && cell.temp_c != null) {
    html +=
      "<div><b>Nhiệt độ</b>: " +
      cell.temp_c.toFixed(1) +
      " °C</div>";
  } else {
    html += "<div><b>Nhiệt độ</b>: N/A (không có trong snapshot)</div>";
  }

  if (cell && cell.valid_at) {
    html += "<div>Quan trắc: " + cell.valid_at + "</div>";
  }

  html += "<hr style='margin:4px 0;' />";

  html +=
    "<div><b>Vị trí click</b>: " +
    clickLat.toFixed(4) +
    ", " +
    clickLon.toFixed(4) +
    "</div>";

  html +=
    "<div>Điểm gần nhất: " +
    (locLat != null ? locLat.toFixed(4) : "?") +
    ", " +
    (locLon != null ? locLon.toFixed(4) : "?") +
    "</div>";

  if (locId) {
    html += "<div>Location ID: " + locId + "</div>";
  }

  html += "</div>";

  return html;
}

/**
 * Click map → gọi /obs/nearest → popup
 */
function bindMapClickNearest(map) {
  map.on("click", async (e) => {
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;

    // Nếu có mask VN thì check
    if (typeof window.isPointInsideVN === "function") {
      if (!window.isPointInsideVN(lat, lon)) {
        // ngoài VN: popup báo lỗi, không vẽ marker
        L.popup()
          .setLatLng(e.latlng)
          .setContent("<b>Ngoài phạm vi Việt Nam</b>")
          .openOn(map);
        return;
      }
    }

    // ===== CỘT MỐC TẠI VỊ TRÍ CLICK =====
    // Nếu đã có marker cũ thì xóa
    if (clickMarker) {
      clickMarker.remove();
      clickMarker = null;
    }
    // Tạo marker mới tại vị trí click
    clickMarker = L.circleMarker(e.latlng, {
      radius: 6,
      weight: 2,
      color: "#ffffff",     // viền
      fillColor: "#007bff", // màu trong (muốn đổi thì đổi)
      fillOpacity: 1.0
    }).addTo(map);

    try {
      // 1) gọi API nearest → biết location_id + lat/lon của điểm gần nhất
      const result = await window.fetchNearestTemp(lat, lon);

      // 2) đảm bảo đã có cache lưới obs mới nhất
      try {
        if (
          (!window.latestTempGridCache ||
            !Array.isArray(window.latestTempGridCache.cells) ||
            window.latestTempGridCache.cells.length === 0) &&
          typeof window.fetchLatestTempGrid === "function"
        ) {
          await window.fetchLatestTempGrid(false);
        }
      } catch (eCache) {
        console.warn("fetchLatestTempGrid for click failed:", eCache);
      }

      // 3) từ location_id tìm cell để lấy temp/rain/wind...
      let cell = null;
      if (result && result.found && result.location_id) {
        cell = findCellByLocationId(result.location_id);
      }

      // 4) đẩy thông tin vào panel bên phải
      if (typeof window.updateWeatherDetail === "function") {
        window.updateWeatherDetail(lat, lon, result, cell);
      }
    } catch (err) {
      console.error("fetchNearestTemp error:", err);
      if (typeof window.updateWeatherDetail === "function") {
        window.updateWeatherDetail(lat, lon, null, null);
      }
    }
  });
}

/**
 * Khởi tạo map
 */
function initMap() {
  if (window.map) return window.map;

  const map = L.map("map", {
    center: [16.0, 107.5],
    zoom: 5,
    minZoom: 4,
    maxZoom: 12,
    zoomControl: true
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
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
