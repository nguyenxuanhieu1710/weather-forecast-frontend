// map.js
// Khởi tạo Leaflet map, load biên giới Việt Nam, xử lý click gọi /obs/nearest + /obs/timeseries

window.map = null;
let clickMarker = null;

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

function bindMapClickNearest(map) {
  map.on("click", async (e) => {
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;

    let result = null;
    try {
      if (typeof window.fetchNearestTemp === "function") {
        result = await window.fetchNearestTemp(lat, lon);
      }
    } catch (err) {
      console.error("[map] fetchNearestTemp failed", err);
    }

    let cell = null;
    let locationId = null;

    if (result && result.found && result.location_id) {
      locationId = String(result.location_id);
      cell = typeof findCellByLocationId === "function"
        ? findCellByLocationId(locationId)
        : null;
    }

    window.lastNearestResult = result || null;
    window.lastLocationId = locationId;
    window.lastCell = cell || null;

    if (typeof window.updateWeatherDetail === "function") {
      window.updateWeatherDetail(lat, lon, result, cell);
    }

    if (locationId && window.fetchAlertSummary && window.updateAlertPanel) {
      try {
        const summary = await window.fetchAlertSummary(locationId);
        window.updateAlertPanel(summary);
        if (typeof window.showAlertPanel === "function") {
          window.showAlertPanel();
        }
      } catch (err) {
        console.error("[map] fetchAlertSummary failed", err);
      }
    }

    // TIMESERIES → FORECAST BAR
    if (locationId && typeof window.loadTimeSeriesForLocation === "function") {
      try {
        await window.loadTimeSeriesForLocation(locationId);
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
