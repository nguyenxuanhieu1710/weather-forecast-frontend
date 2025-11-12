// ===================== Config =====================
const API_BASE = "http://100.123.92.116:8000";
const LQ_KEY = "pk.c4d167c79573b11c6022ab79ad7fd9a0";
const LQ_REGION = "us1";
const OPENWEATHER_API_KEY = "13ef912baa634688591e9e04478d2a01";

// ===================== Cache =====================
let latestObs = null;
let tempPtsCache = null;
let tempCacheAt = 0;
const TEMP_TTL_MS = 3 * 60 * 1000; // 3 phút

// ===================== Data helpers =====================
async function getLatestObs() {
  if (Array.isArray(latestObs) && latestObs.length) return latestObs;
  try {
    const res = await fetch(`${API_BASE}/api/obs/latest`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    latestObs = Array.isArray(json) ? json : (json?.data || []);
    return latestObs;
  } catch (err) {
    console.error("Lỗi load /api/obs/latest:", err);
    latestObs = [];
    return latestObs;
  }
}

async function getTempPts(force = false) {
  const now = Date.now();
  if (!force && tempPtsCache?.length && now - tempCacheAt < TEMP_TTL_MS) return tempPtsCache;
  const d = await getLatestObs();
  tempPtsCache = (d || [])
    .filter(s => Number.isFinite(+s.lat) && Number.isFinite(+s.lon) && Number.isFinite(+s.temp_c))
    .map(s => [+s.lat, +s.lon, +s.temp_c]);
  tempCacheAt = now;
  return tempPtsCache;
}

function findNearestObs(lat, lon, list) {
  if (!Array.isArray(list) || !list.length) return null;
  let best = null, bestD2 = Infinity;
  for (const s of list) {
    const a = +s.lat, b = +s.lon;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const d2 = (lat - a) ** 2 + (lon - b) ** 2;
    if (d2 < bestD2) { bestD2 = d2; best = s; }
  }
  return best;
}

// ===================== Search (LocationIQ) =====================
function initSearch() {
  const input = document.getElementById("pac-input");
  const btnSearch = document.getElementById("btn-search");
  const box = document.getElementById("sg");
  if (!input || !btnSearch) { console.error("Thiếu DOM search"); return; }

  const debounce = (fn, ms = 350) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function currentViewbox() {
    const b = map.getBounds?.(); if (!b) return null;
    const sw = b.getSouthWest(), ne = b.getNorthEast();
    return `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;
  }

  const acFetch = debounce(async (q) => {
    q = (q || "").trim();
    if (q.length < 2) { box.hidden = true; box.innerHTML = ""; return; }
    try {
      const u = new URL("https://api.locationiq.com/v1/autocomplete");
      const params = { key: LQ_KEY, q, limit: 8, countrycodes: "vn" };
      const vb = currentViewbox(); if (vb) { params.viewbox = vb; params.bounded = 1; }
      u.search = new URLSearchParams(params);
      const r = await fetch(u);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const items = await r.json();
      renderSuggest(items.map(it => ({ lat: +it.lat, lon: +it.lon, label: it.display_name })));
    } catch { box.hidden = true; box.innerHTML = ""; }
  }, 350);

  async function doSearch(q) {
    q = (q || "").trim(); if (!q) return;
    const u = new URL(`https://${LQ_REGION}.locationiq.com/v1/search`);
    const params = { key: LQ_KEY, q, format: "json", countrycodes: "vn", "accept-language": "vi", normalizeaddress: 1 };
    const vb = currentViewbox(); if (vb) { params.viewbox = vb; params.bounded = 1; }
    u.search = new URLSearchParams(params);
    const r = await fetch(u);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (Array.isArray(j) && j.length) {
      const it = j[0]; flyTo(+it.lat, +it.lon, it.display_name);
    } else alert("Không tìm thấy địa điểm");
  }

  function renderSuggest(items) {
    if (!items.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.innerHTML = items.map((it, i) => `<div data-i="${i}">${it.label}</div>`).join("");
    box.style.top = (input.offsetTop + input.offsetHeight) + "px";
    box.style.left = input.offsetLeft + "px";
    box.style.width = input.offsetWidth + "px";
    box.hidden = false;
    Array.from(box.children).forEach((el, i) => el.onclick = () => { const it = items[i]; flyTo(it.lat, it.lon, it.label); box.hidden = true; });
  }

  function flyTo(lat, lon, label) {
    map.flyTo([lat, lon], Math.max(map.getZoom(), 14));
    L.marker([lat, lon]).addTo(map).bindPopup(`<b>${label || "Địa điểm"}</b>`).openPopup();
  }

  input.addEventListener("input", (e) => acFetch(e.target.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); doSearch(input.value); } });
  btnSearch.addEventListener("click", () => doSearch(input.value));
}

// ===================== Map init =====================
const map = L.map("map").setView([21.0285, 105.8542], 11);
window.map = map;

const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20, attribution: "© OpenStreetMap contributors"
}).addTo(map);

const googleStreets = L.tileLayer(
  "https://{s}.google.com/vt/lyrs=m&hl=vi&x={x}&y={y}&z={z}",
  { maxZoom: 20, subdomains: ["mt0","mt1","mt2","mt3"], attribution: "© Google" }
);
const googleSat = L.tileLayer(
  "https://{s}.google.com/vt/lyrs=s&hl=vi&x={x}&y={y}&z={z}",
  { maxZoom: 20, subdomains: ["mt0","mt1","mt2","mt3"], attribution: "© Google" }
);
L.control.layers(
  { OpenStreetMap: osm, "Google Map": googleStreets, Satellite: googleSat },
  {}, { position: "topleft" }
).addTo(map);

// Pane riêng cho lớp khí tượng
map.createPane("meteo");
map.getPane("meteo").style.zIndex = 420;
map.getPane("meteo").style.mixBlendMode = "multiply";



// ===================== Legend =====================
let rwLegend = null;
function setLegend(title, stops, colors, unit) {
  if (rwLegend) map.removeControl(rwLegend);
  const ctrl = L.control({ position: "bottomleft" });

  ctrl.onAdd = () => {
    const div = L.DomUtil.create("div", "legend");
    div.style.cssText =
      "padding:10px 12px;background:rgba(255,255,255,.95);border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.12);";

    const bar = `linear-gradient(to right, ${colors.join(",")})`;

    const ticks = stops.map((_, i) => {
      const pct = (i / (stops.length - 1)) * 100;
      return `<span style="position:absolute;left:${pct}%;bottom:-4px;width:1px;height:6px;background:#9aa4b2;transform:translateX(-0.5px)"></span>`;
    }).join("");

    const labels = `
      <div style="display:flex;justify-content:space-between;gap:14px;flex:1;
                  font-size:12px;font-variant-numeric:tabular-nums;color:#475569;">
        ${stops.map(s => `<span>${s}</span>`).join("")}
      </div>
      <div style="margin-left:10px;font-size:12px;color:#64748b;white-space:nowrap">${unit}</div>`;

    div.innerHTML = `
      <div style="font-weight:700;color:#334155;margin-bottom:8px">${title}</div>
      <div style="position:relative;height:12px;border-radius:8px;background:${bar};
                  box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)">${ticks}</div>
      <div style="display:flex;align-items:center;margin-top:6px">${labels}</div>
    `;

    L.DomEvent.disableClickPropagation(div);
    return div;
  };

  ctrl.addTo(map);
  rwLegend = ctrl;
}

function clearLegend(){ if (rwLegend){ map.removeControl(rwLegend); rwLegend = null; } }

// Legend nhiệt độ tĩnh trong HTML
const tempLegendBox = document.getElementById("legend-temp");
function showTempLegend(on){ if (tempLegendBox) tempLegendBox.style.display = on ? "block" : "none"; }

// ===================== Color + Grid helpers =====================
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpColor(c1, c2, t) {
  const a = hexToRgb(c1), b = hexToRgb(c2);
  const r = Math.round(lerp(a.r, b.r, t));
  const g = Math.round(lerp(a.g, b.g, t));
  const bb = Math.round(lerp(a.b, b.b, t));
  return `rgb(${r},${g},${bb})`;
}
function makeStopColorScale(stops, colors) {
  return function(v) {
    if (!Number.isFinite(v)) return "rgba(0,0,0,0)";
    if (v <= stops[0]) return colors[0];
    const last = stops.length - 1;
    if (v >= stops[last]) return colors[last];
    for (let i = 0; i < last; i++) {
      const s0 = stops[i], s1 = stops[i+1];
      if (v >= s0 && v <= s1) {
        const t = (v - s0) / (s1 - s0 || 1e-9);
        return lerpColor(colors[i], colors[i+1], t);
      }
    }
    return colors[last];
  };
}

const GRID_STEP = 0.25;
const GRID_HALF = GRID_STEP / 2;

// thang màu
const TEMP_STOPS  = [0, 10, 20, 30, 40];
const TEMP_COLORS = ["#2b6cb0","#60a5fa","#fbbf24","#f97316","#b91c1c"];
const tempColorScale = makeStopColorScale(TEMP_STOPS, TEMP_COLORS);

const RAIN_STOPS  = [0, 5, 10, 20, 30, 50];
const RAIN_COLORS = ["#e6f4ff","#b3dcff","#7fbfff","#5f8bff","#7a3cff","#b400ff"];
const rainColorScale = makeStopColorScale(RAIN_STOPS, RAIN_COLORS);

const WIND_STOPS  = [0, 5, 10, 15, 25, 40];
const WIND_COLORS = ["#f7fbff","#deebf7","#c6dbef","#9ecae1","#6baed6","#08519c"];
const windColorScale = makeStopColorScale(WIND_STOPS, WIND_COLORS);

// xây layer lưới từ obs
function buildGridLayerFromObs(obs, valueKey, colorScale) {
  if (!Array.isArray(obs) || !obs.length) return null;
  const group = L.layerGroup();

  for (const o of obs) {
    const lat = +o.lat;
    const lon = +o.lon;
    const v = +o[valueKey];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(v)) continue;

    // Cắt theo bbox Việt Nam (đủ để loại bỏ phần Lào / TQ / Campuchia / biển xa)
    if (lat < 8 || lat > 24.5 || lon < 102 || lon > 110) continue;

    const bounds = [
      [lat - GRID_HALF, lon - GRID_HALF],
      [lat + GRID_HALF, lon + GRID_HALF]
    ];
    const color = colorScale(v);

    const rect = L.rectangle(bounds, {
      pane: "meteo",
      stroke: false,
      fillOpacity: 0.85,
      fillColor: color
    });

    rect.feature = { properties: { obs: o } };
    rect.on("click", () => {
      fetchAndShowWeatherFromObs(lat, lon);
    });

    group.addLayer(rect);
  }

  return group;
}



// các layer lưới
let tempGridLayer = null;
let rainGridLayer = null;
let windGridLayer = null;

// ===================== Unified controller: Nhiệt độ • Mưa • Gió =====================
let mode = "none";    // "none" | "temp" | "rain" | "wind"
let reqId = 0;

function setChipActive(next){
  document.getElementById("chip-temp")?.classList.toggle("active", next==="temp");
  document.getElementById("chip-rain")?.classList.toggle("active", next==="rain");
  document.getElementById("chip-wind")?.classList.toggle("active", next==="wind");
}

function clearAllLayers(){
  if (tempGridLayer && map.hasLayer(tempGridLayer)) map.removeLayer(tempGridLayer);
  if (rainGridLayer && map.hasLayer(rainGridLayer)) map.removeLayer(rainGridLayer);
  if (windGridLayer && map.hasLayer(windGridLayer)) map.removeLayer(windGridLayer);
  tempGridLayer = rainGridLayer = windGridLayer = null;
  clearLegend();
  showTempLegend(false);
}

async function switchLayer(next){
  const my = ++reqId;

  if (mode === next){
    clearAllLayers();
    setChipActive("none");
    mode = "none";
    return;
  }

  clearAllLayers();
  setChipActive(next);

  const obs = await getLatestObs();
  if (my !== reqId || !Array.isArray(obs) || !obs.length){ mode = "none"; return; }

  if (next === "temp"){
    tempGridLayer = buildGridLayerFromObs(obs, "temp_c", tempColorScale);
    if (tempGridLayer) tempGridLayer.addTo(map);
    showTempLegend(true);
    mode = "temp";
    return;
  }

  if (next === "rain"){
    rainGridLayer = buildGridLayerFromObs(obs, "precip_mm", rainColorScale);
    if (rainGridLayer) rainGridLayer.addTo(map);
    setLegend("Mưa", RAIN_STOPS, RAIN_COLORS, "mm/h");
    mode = "rain";
    return;
  }

  if (next === "wind"){
    windGridLayer = buildGridLayerFromObs(obs, "wind_ms", windColorScale);
    if (windGridLayer) windGridLayer.addTo(map);
    setLegend("Gió", WIND_STOPS, WIND_COLORS, "m/s");
    mode = "wind";
    return;
  }
}

document.getElementById("chip-temp").onclick = () => switchLayer("temp");
document.getElementById("chip-rain").onclick  = () => switchLayer("rain");
document.getElementById("chip-wind").onclick  = () => switchLayer("wind");

// ===================== Sidebar từ backend =====================
const sidebar = document.getElementById("sidebar");
document.getElementById("sb-close").addEventListener("click", () => sidebar.classList.remove("open"));

async function fetchAndShowWeatherFromObs(lat, lon) {
  document.getElementById("sb-coord").textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const list = await getLatestObs();
  if (!list.length) { alert("Không có dữ liệu quan trắc."); return; }
  const s = findNearestObs(lat, lon, list);
  if (!s) { alert("Không tìm thấy điểm quan trắc."); return; }

  document.getElementById("sb-temp").textContent = Number.isFinite(+s.temp_c) ? `${(+s.temp_c).toFixed(1)} °C` : "-- °C";
  document.getElementById("sb-rain").textContent = Number.isFinite(+s.precip_mm) ? `${(+s.precip_mm).toFixed(1)} mm` : "-- mm";
  document.getElementById("sb-wind").textContent = Number.isFinite(+s.wind_ms) ? `${(+s.wind_ms).toFixed(1)} m/s` : "-- m/s";
  document.getElementById("sb-hum").textContent = "-- %";

  sidebar.classList.add("open");
}
map.on("click", (e) => fetchAndShowWeatherFromObs(e.latlng.lat, e.latlng.lng));
L.marker([21.0034, 105.82]).addTo(map)
  .bindPopup("Hà Nội")
  .on("click", (e) => fetchAndShowWeatherFromObs(e.latlng.lat, e.latlng.lng));

// ===================== Timebar =====================
const range = document.getElementById("time-range");
const label = document.getElementById("time-label");
let timer = null;

function updateTimeLabel() {
  const h = String(range.value).padStart(2, "0");
  label.textContent = `Hôm nay • ${h}:00`;
}
range.addEventListener("input", updateTimeLabel);
document.getElementById("btn-play").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  const playing = btn.getAttribute("aria-pressed") === "true";
  if (playing) {
    btn.setAttribute("aria-pressed", "false"); btn.textContent = "▶️";
    clearInterval(timer); timer = null;
  } else {
    btn.setAttribute("aria-pressed", "true"); btn.textContent = "⏸";
    timer = setInterval(() => { range.value = (Number(range.value) + 1) % 24; updateTimeLabel(); }, 700);
  }
});
updateTimeLabel();

// ===================== Theme + basemap =====================
const darkBase = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  { subdomains: "abcd", maxZoom: 20, attribution: "© OpenStreetMap contributors · © CARTO" }
);
let lightBase = osm;
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const tbtn = document.getElementById("theme-toggle");
  if (tbtn) {
    tbtn.textContent = theme === "dark" ? "☀️" : "🌙";
    tbtn.setAttribute("aria-pressed", theme === "dark");
  }
  if (theme === "dark") {
    if (map.hasLayer(lightBase)) map.removeLayer(lightBase);
    if (!map.hasLayer(darkBase)) darkBase.addTo(map);
  } else {
    if (map.hasLayer(darkBase)) map.removeLayer(darkBase);
    if (!map.hasLayer(lightBase)) lightBase.addTo(map);
  }
}
let currentTheme =
  localStorage.getItem("wf_theme") ||
  (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
applyTheme(currentTheme);
document.getElementById("theme-toggle").addEventListener("click", () => {
  currentTheme = (document.documentElement.getAttribute("data-theme") === "dark") ? "light" : "dark";
  localStorage.setItem("wf_theme", currentTheme);
  applyTheme(currentTheme);
});
map.on("baselayerchange", (e) => {
  if (document.documentElement.getAttribute("data-theme") === "light") lightBase = e.layer;
});

// Tạo layer biên giới Việt Nam (chỉ hiển thị đường biên)
let vietnamMask = null;

fetch("vietnam.geojson")
  .then(r => r.json())
  .then(data => {
    const vn = data.features.find(f =>
      f.properties.ADMIN === "Vietnam" ||
      f.properties.NAME === "Vietnam"
    );
    if (!vn) {
      console.error("Không tìm thấy feature Vietnam trong vietnam.geojson");
      return;
    }

    vietnamMask = L.geoJSON(vn, {
      pane: "meteo",
      style: {
        color: "#4b5563",
        weight: 1.2,
        fillOpacity: 0
      }
    }).addTo(map);
  })
  .catch(err => console.error("Lỗi load vietnam.geojson:", err));






// ===================== Vị trí hiện tại =====================
let userMarker = null;
document.getElementById("btn-locate").addEventListener("click", () => {
  if (!navigator.geolocation) return alert("Trình duyệt không hỗ trợ định vị.");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      map.flyTo([latitude, longitude], 15);
      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.marker([latitude, longitude]).addTo(map).bindPopup("Vị trí của bạn").openPopup();
    },
    () => alert("Không lấy được vị trí.")
  );
});

// ===================== Init =====================
initSearch();
