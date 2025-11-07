// ===================== Config =====================
const API_BASE = "http://100.123.92.116:8000";
const LQ_KEY = "pk.c4d167c79573b11c6022ab79ad7fd9a0";
const LQ_REGION = "us1";
const OPENWEATHER_API_KEY = "13ef912baa634688591e9e04478d2a01";

// ===================== Cache =====================
let latestObs = null;
// cache cho điểm heatmap
let tempPtsCache = null;
let tempCacheAt = 0;
const TEMP_TTL_MS = 3 * 60 * 1000; // 3 phút

// trạng thái nút Nhiệt độ
let tempOn = false;
let loadingTemp = false;
let tempReqId = 0; // chống response muộn đè state

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

function findNearestObs(lat, lon, list) {
  if (!Array.isArray(list) || !list.length) return null;
  let best = null, bestD2 = Infinity;
  for (const s of list) {
    const a = +s.lat, b = +s.lon;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const dLat = lat - a, dLon = lon - b;
    const d2 = dLat * dLat + dLon * dLon;
    if (d2 < bestD2) { bestD2 = d2; best = s; }
  }
  return best;
}

// ===================== Search (LocationIQ) =====================
function initSearch() {
  const input = document.getElementById("pac-input");
  const btnSearch = document.getElementById("btn-search");
  const box = document.getElementById("sg");
  if (!input || !btnSearch) return console.error("Thiếu DOM search");

  const debounce = (fn, ms = 350) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

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
      const vb = currentViewbox();
      if (vb) { params.viewbox = vb; params.bounded = 1; }
      u.search = new URLSearchParams(params);
      const r = await fetch(u);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const items = await r.json();
      renderSuggest(items.map(it => ({ lat: +it.lat, lon: +it.lon, label: it.display_name })));
    } catch (e) {
      console.error(e); box.hidden = true; box.innerHTML = "";
    }
  }, 350);

  async function doSearch(q) {
    q = (q || "").trim(); if (!q) return;
    const u = new URL(`https://${LQ_REGION}.locationiq.com/v1/search`);
    const params = { key: LQ_KEY, q, format: "json", countrycodes: "vn", "accept-language": "vi", normalizeaddress: 1 };
    const vb = currentViewbox();
    if (vb) { params.viewbox = vb; params.bounded = 1; }
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
    Array.from(box.children).forEach((el, i) => el.onclick = () => {
      const it = items[i]; flyTo(it.lat, it.lon, it.label); box.hidden = true;
    });
  }

  function flyTo(lat, lon, label) {
    map.flyTo([lat, lon], Math.max(map.getZoom(), 14));
    L.marker([lat, lon]).addTo(map).bindPopup(`<b>${label || "Địa điểm"}</b>`).openPopup();
  }

  input.addEventListener("input", (e) => acFetch(e.target.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); doSearch(input.value); }
  });
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

// ===================== Raster layers =====================
const tempLayer = L.tileLayer(
  `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
  { attribution: "OpenWeatherMap" }
);
const rainLayer = L.tileLayer(
  `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
  { attribution: "OpenWeatherMap" }
);
const windLayer = L.tileLayer(
  `https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
  { attribution: "OpenWeatherMap" }
);

// ===================== Heat layer =====================
const HEAT_OPTS = {
  radius: 28, blur: 18, maxZoom: 12,
  gradient: { 0.2: "#2b6cb0", 0.4: "#60a5fa", 0.6: "#fbbf24", 0.8: "#ef4444", 1.0: "#fff" }
};
let heatLayer = L.heatLayer([], HEAT_OPTS);
  

// Trạng thái thực lấy từ map
function tempIsOn(){ return map.hasLayer(tempLayer) || map.hasLayer(heatLayer); }

function turnOffTemp(){
  if (map.hasLayer(tempLayer)) map.removeLayer(tempLayer);
  if (map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
  // tạo instance mới để tránh kẹt buffer
  heatLayer = L.heatLayer([], HEAT_OPTS);
  document.getElementById("chip-temp").classList.remove("active");
  tempReqId++; // huỷ mọi request enableTemp đang chờ
  // tuỳ chọn: reset cache lần sau luôn refetch
  // tempPtsCache = null; tempCacheAt = 0;
}



async function enableTemp(reqId){
  const pts = await getTempPts(true);          // luôn refetch khi bật lại
  if (!tempIsOn() || reqId !== tempReqId) return; // người dùng đã tắt hoặc có yêu cầu mới
  if (pts.length){
    heatLayer.setLatLngs(pts);
    if (!map.hasLayer(heatLayer)) heatLayer.addTo(map);
  }
}

const tempBtn = document.getElementById("chip-temp");

tempBtn.addEventListener("click", async ()=>{
  if (tempIsOn()){ turnOffTemp(); return; }

  tempBtn.classList.add("active");
  tempLayer.addTo(map);            // bật raster ngay

  const reqId = ++tempReqId;
try{
  const pts = await getTempPts(true);   // refetch
  if (reqId !== tempReqId) return;      // đã bị tắt hoặc có request mới

  if (pts.length){
    heatLayer.setLatLngs(pts);
    heatLayer.addTo(map);               // luôn add lại sau khi set điểm
  } else {
    console.warn("Không có điểm nhiệt độ từ backend.");
  }
}catch(e){
  console.error(e);
  if (reqId === tempReqId) turnOffTemp();
  }
});

// ===== Legend Mưa/Gió =====
let rwLegend = null;
function setLegend(title, stops, colors, unit) {
  if (rwLegend) map.removeControl(rwLegend);
  const ctrl = L.control({ position: "bottomleft" });
  ctrl.onAdd = () => {
    const div = L.DomUtil.create("div","legend");
    div.style.cssText="padding:8px;background:rgba(255,255,255,.9);border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.15)";
    const bar=`linear-gradient(to right, ${colors.join(",")})`;
    div.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px">${title}</div>
      <div style="height:10px;border-radius:6px;background:${bar}"></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px">
        ${stops.map(s=>`<span>${s}${unit}</span>`).join("")}
      </div>`;
    return div;
  };
  ctrl.addTo(map); rwLegend = ctrl;
}
function clearLegend(){ if (rwLegend){ map.removeControl(rwLegend); rwLegend=null; } }

// ===== Heatmap Mưa/Gió =====
const RAIN_MAX = 50;   // mm/h
const WIND_MAX = 40;   // m/s
const HEAT_COMMON = { radius: 28, blur: 20, maxZoom: 12, minOpacity: 0.35 };

const rainGradient = { 0.00:"rgba(0,0,0,0)", 0.05:"#d7f3ff", 0.15:"#9ed9f6", 0.30:"#5cb2ee", 0.55:"#2f7fd8", 0.75:"#5b3fd6", 0.90:"#a426d9", 1.00:"#ff4dd2" };
const windGradient = { 0.00:"#f7fbff", 0.15:"#deebf7", 0.30:"#c6dbef", 0.50:"#9ecae1", 0.70:"#6baed6", 0.85:"#3182bd", 1.00:"#08519c" };

let rainHeat = L.heatLayer([], { ...HEAT_COMMON, gradient: rainGradient });
let windHeat = L.heatLayer([], { ...HEAT_COMMON, gradient: windGradient });

const as01 = (v,max)=> Math.max(0, Math.min(1, v/max));
const toRain = a => a.map(o => [o.lat, o.lon, as01(+o.precip_mm||0, RAIN_MAX)]);
const toWind = a => a.map(o => [o.lat, o.lon, as01(+o.wind_ms||0,   WIND_MAX)]);

// ===== Controller: 1 state duy nhất =====
let layerMode = "none"; // "none" | "rain" | "wind"
let busy = false;
let reqId = 0;

function setChip(id, on){ document.getElementById(id)?.classList.toggle("active", !!on); }
function clearLayers(){
  if (map.hasLayer(rainHeat)) map.removeLayer(rainHeat);
  if (map.hasLayer(windHeat)) map.removeLayer(windHeat);
}

async function switchMode(next){
  if (busy) return;
  busy = true;
  const my = ++reqId;

  try {
    // toggle off nếu bấm lại chính nó
    if (layerMode === next) {
      clearLayers(); clearLegend();
      setChip("chip-rain", false); setChip("chip-wind", false);
      layerMode = "none";
      return;
    }

    // chuyển lớp
    clearLayers(); clearLegend();
    setChip("chip-rain", next==="rain");
    setChip("chip-wind", next==="wind");

    const obs = await getLatestObs();         // /api/obs/latest
    if (my !== reqId || !Array.isArray(obs) || !obs.length) return;

    if (next === "rain") {
      rainHeat.setLatLngs(toRain(obs));
      rainHeat.addTo(map);
      setLegend("Mưa", [0,5,10,20,30,50],
        ["#0000","#d7f3ff","#9ed9f6","#5cb2ee","#2f7fd8","#a426d9"], " mm/h");
    } else if (next === "wind") {
      windHeat.setLatLngs(toWind(obs));
      windHeat.addTo(map);
      setLegend("Gió", [0,5,10,15,25,40],
        ["#f7fbff","#deebf7","#c6dbef","#9ecae1","#6baed6","#08519c"], " m/s");
    }
    layerMode = next;
  } catch(e){ console.error(e); }
  finally { busy = false; }
}

// Gắn đúng 1 lần
document.getElementById("chip-rain").onclick = () => switchMode("rain");
document.getElementById("chip-wind").onclick = () => switchMode("wind");



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
