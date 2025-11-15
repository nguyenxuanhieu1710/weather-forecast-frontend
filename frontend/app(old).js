// ===================== Config =====================
const API_BASE = "http://100.123.92.116:8000";
const LQ_KEY = "pk.c4d167c79573b11c6022ab79ad7fd9a0";
const LQ_REGION = "us1";

// ===================== State =====================
let map;
let baseLightLayer;
let baseSatLayer;

let tempGridLayer = null;

let latestObs = null;

// "none" | "temp" | sau này "rain" | "wind"
let currentMode = "none";

// ===================== Init =====================
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initBaseLayers();
  initEvents();
  bootstrapDataAndRender();
});

// Khởi tạo bản đồ
function initMap() {
  map = L.map("map", {
    center: [16, 106],
    zoom: 5.5,
    minZoom: 4,
    maxZoom: 12,
    zoomControl: false
  });

  L.control.zoom({ position: "topright" }).addTo(map);
}

// Base layers (Light / Satellite)
function initBaseLayers() {
  baseLightLayer = L.tileLayer(
    `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`,
    {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }
  );

  // Placeholder satellite (có thể thay bằng Mapbox, MapTiler, v.v.)
  baseSatLayer = L.tileLayer(
    `https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png`,
    {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }
  );

  baseLightLayer.addTo(map);
}

// Sự kiện chung
function initEvents() {
  // Click vào map: lấy nearest từ backend
  map.on("click", (e) => {
    const { lat, lng } = e.latlng;
    fetchNearestAndUpdateUI(lat, lng);
  });

  // Cho layer grid gọi dùng
  window.onGridCellClick = function (lat, lon) {
    fetchNearestAndUpdateUI(lat, lon);
  };

  // Nếu có nút mode nhiệt độ trong HTML, có thể gán như sau:
  // document.getElementById("btn-temp").addEventListener("click", () => {
  //   switchToTempMode();
  // });
}

// ===================== Data =====================
async function getLatestObs() {
  if (Array.isArray(latestObs) && latestObs.length) return latestObs;

  const url = `${API_BASE}/api/obs/latest`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`obs/latest HTTP ${res.status}`);

  const json = await res.json();
  latestObs = Array.isArray(json.data) ? json.data : [];
  return latestObs;
}

// Gọi backend nearest cho 1 vị trí bất kỳ
async function fetchNearestAndUpdateUI(lat, lon) {
  try {
    const url = `${API_BASE}/api/obs/nearest?lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error("nearest HTTP", res.status);
      return;
    }
    const data = await res.json();
    updateDetailPanel(data, lat, lon);
  } catch (err) {
    console.error("fetchNearestAndUpdateUI error", err);
  }
}

// ===================== Render =====================
async function bootstrapDataAndRender() {
  try {
    const obs = await getLatestObs();
    switchToTempMode(obs);
  } catch (err) {
    console.error("bootstrapDataAndRender error", err);
  }
}

// Bật mode nhiệt độ
function switchToTempMode(obsOptional) {
  currentMode = "temp";
  setLegendForMode("temp");

  const obs = obsOptional || latestObs || [];

  // Xoá layer cũ nếu có
  if (tempGridLayer) {
    map.removeLayer(tempGridLayer);
    tempGridLayer = null;
  }

  // Tạo lưới mới từ dữ liệu obs
  tempGridLayer = createTempGridLayer(obs);
  tempGridLayer.addTo(map);
}

// ===================== UI: panel chi tiết =====================

// data: JSON trả về từ /api/obs/nearest
function updateDetailPanel(data, clickLat, clickLon) {
  // Tuỳ backend, giả sử:
  // {
  //   location_id: "...",
  //   name: "Tên trạm",
  //   lat: ...,
  //   lon: ...,
  //   temp_c: ...,
  //   wind_ms: ...,
  //   rain_mm: ...,
  //   valid_at: "2025-11-14T..."
  // }

  const el = document.getElementById("details-panel");
  if (!el) {
    console.log("Nearest:", data);
    return;
  }

  const temp = data.temp_c != null ? `${data.temp_c.toFixed(1)} °C` : "—";
  const wind =
    data.wind_ms != null ? `${data.wind_ms.toFixed(1)} m/s` : "—";
  const rain =
    data.rain_mm != null ? `${data.rain_mm.toFixed(1)} mm` : "—";

  const locName = data.name || data.station_name || "Trạm quan trắc";
  const stationLat =
    typeof data.lat === "number" ? data.lat.toFixed(3) : "—";
  const stationLon =
    typeof data.lon === "number" ? data.lon.toFixed(3) : "—";

  const clickLatStr =
    typeof clickLat === "number" ? clickLat.toFixed(3) : "—";
  const clickLonStr =
    typeof clickLon === "number" ? clickLon.toFixed(3) : "—";

  const timeStr = data.valid_at || data.obs_time || "";

  el.innerHTML = `
    <div style="font-weight:600;margin-bottom:4px;">${locName}</div>
    <div style="font-size:13px;color:#6b7280;margin-bottom:8px;">
      Trạm: (${stationLat}, ${stationLon})<br/>
      Vị trí click: (${clickLatStr}, ${clickLonStr})<br/>
      Thời gian: ${timeStr}
    </div>
    <div style="font-size:14px;">
      <div>Nhiệt độ: <strong>${temp}</strong></div>
      <div>Gió: <strong>${wind}</strong></div>
      <div>Mưa: <strong>${rain}</strong></div>
    </div>
  `;
}
