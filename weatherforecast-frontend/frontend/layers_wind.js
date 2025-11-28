// layers_wind.js
// Hiển thị gió: nền màu tốc độ + hạt chuyển động (particle advection) – kiểu Windy / earth.nullschool
// Yêu cầu:
//  - window.map (Leaflet) đã khởi tạo
//  - Backend trả cells có: lat, lon, wind_ms, wind_dir_deg
//  - Có ít nhất một trong hai hàm:
//      window.fetchLatestTempGrid() -> { cells: [...] }
//      window.getLatestObs()        -> [ {...}, ... ]
//  - Nếu có hàm window.isPointInsideVN(lat, lon) -> boolean thì sẽ tự động lọc trong VN

// ===================== Cấu hình =====================

// Nội suy nền màu trên canvas
const WIND_SAMPLE_STEP_PX = 4;
const WIND_IDW_K_NEAREST = 6;
const WIND_IDW_POWER = 2.0;

// Lưới trường gió (để sample nhanh + mượt)
const WIND_FIELD_DLAT = 0.1;
const WIND_FIELD_DLON = 0.1;

// Hạt gió (particle advection)
const WIND_PARTICLE_COUNT = 1200;           // số hạt tối đa
const WIND_PARTICLE_MIN_SPEED = 0.3;        // m/s – dưới ngưỡng coi như tắt, respawn
const WIND_PARTICLE_MAX_AGE = 600;          // số bước tối đa của 1 hạt
const WIND_PARTICLE_BASE_STEP_DEG = 0.01;   // bước lat/lon tối thiểu mỗi frame (độ)
const WIND_PARTICLE_STEP_DEG_RANGE = 0.05;  // phần tăng thêm theo tốc độ
const WIND_PARTICLE_FADE_ALPHA = 0.08;      // độ mờ mỗi frame (0–1), càng cao càng ngắn vệt

// ===================== Biến toàn cục =====================

let windCanvasLayer = null;      // nền màu gió
let windParticleLayer = null;    // hạt gió động
let currentWindField = null;     // trường gió hiện tại

window.currentWindField = null;
window.windParticleLayer = null;

// ===================== Helper chung =====================

// Wrapper chung cho mask VN để tránh null / lỗi
function isLatLngInsideVN(lat, lon) {
  if (typeof window.isPointInsideVN === "function") {
    try {
      return !!window.isPointInsideVN(lat, lon);
    } catch (e) {
      console.warn("isPointInsideVN error:", e);
      return true;
    }
  }
  // Nếu không có mask thì cho qua, dùng toàn domain dữ liệu
  return true;
}

// ===================== Helper toán học / dữ liệu =====================

function dist2DegWind(lat1, lon1, lat2, lon2) {
  const dLat = lat1 - lat2;
  const dLon = lon1 - lon2;
  return dLat * dLat + dLon * dLon;
}

/**
 * Chuẩn hóa dữ liệu gió từ cells:
 *  - lọc cell có wind_ms & wind_dir_deg hợp lệ
 *  - nếu có isPointInsideVN thì lọc trong VN
 * Trả về: [{lat, lon, u, v, s}]
 */
function extractWindSrcPoints(cells) {
  if (!Array.isArray(cells)) return [];

  const src = [];

  for (const c of cells) {
    if (!c) continue;
    if (typeof c.wind_ms !== "number" || typeof c.wind_dir_deg !== "number") {
      continue;
    }

    const lat = Number(c.lat);
    const lon = Number(c.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    if (!isLatLngInsideVN(lat, lon)) continue;

    const speed = Math.max(0, Number(c.wind_ms));

    // wind_dir_deg: hướng gió THỔI TỪ (meteo, 0° = từ Bắc)
    // Vector chuyển động (TO) = +180°
    const dirTo = (c.wind_dir_deg + 180) % 360;
    const rad = (dirTo * Math.PI) / 180;

    // u dương về phía Đông, v dương về phía Bắc
    const u = speed * Math.sin(rad);
    const v = speed * Math.cos(rad);

    src.push({ lat, lon, u, v, s: speed });
  }

  return src;
}

/**
 * Xây trường gió đều trên bbox dữ liệu bằng IDW + nội suy bilinear:
 * Trả về:
 * {
 *   minLat,maxLat,minLon,maxLon,
 *   nLat,nLon,
 *   u,v,s,
 *   minS,maxS,
 *   sample(lat, lon) -> {u,v,s}
 * }
 */
function buildWindFieldFromCells(cells) {
  const src = extractWindSrcPoints(cells);
  if (!src.length) return null;

  // Bbox
  let minLat = Infinity,
    maxLat = -Infinity,
    minLon = Infinity,
    maxLon = -Infinity;

  for (const p of src) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  if (!Number.isFinite(minLat)) return null;

  // Mở biên một chút cho nền phủ kín
  minLat -= 0.5;
  maxLat += 0.5;
  minLon -= 0.5;
  maxLon += 0.5;

  const nLat =
    Math.max(2, Math.round((maxLat - minLat) / WIND_FIELD_DLAT) + 1) | 0;
  const nLon =
    Math.max(2, Math.round((maxLon - minLon) / WIND_FIELD_DLON) + 1) | 0;

  const u = new Array(nLat);
  const v = new Array(nLat);
  const s = new Array(nLat);

  for (let iy = 0; iy < nLat; iy++) {
    u[iy] = new Float32Array(nLon);
    v[iy] = new Float32Array(nLon);
    s[iy] = new Float32Array(nLon);
  }

  const K = WIND_IDW_K_NEAREST;
  const POWER = WIND_IDW_POWER;

  function kNearest(lat, lon) {
    const arr = [];
    for (const p of src) {
      const d2 = dist2DegWind(lat, lon, p.lat, p.lon);
      arr.push({ p, d2 });
    }
    arr.sort((a, b) => a.d2 - b.d2);
    return arr.slice(0, Math.min(K, arr.length));
  }

  // IDW trên lưới
  for (let iy = 0; iy < nLat; iy++) {
    const lat = minLat + ((maxLat - minLat) * iy) / (nLat - 1);
    for (let ix = 0; ix < nLon; ix++) {
      const lon = minLon + ((maxLon - minLon) * ix) / (nLon - 1);

      const neighbors = kNearest(lat, lon);
      if (!neighbors.length) {
        u[iy][ix] = 0;
        v[iy][ix] = 0;
        s[iy][ix] = 0;
        continue;
      }

      if (neighbors[0].d2 < 1e-12) {
        const p0 = neighbors[0].p;
        u[iy][ix] = p0.u;
        v[iy][ix] = p0.v;
        s[iy][ix] = p0.s;
        continue;
      }

      let numU = 0;
      let numV = 0;
      let numS = 0;
      let den = 0;

      for (const { p, d2 } of neighbors) {
        if (d2 <= 0) continue;
        const w = 1 / Math.pow(d2, POWER / 2);
        den += w;
        numU += p.u * w;
        numV += p.v * w;
        numS += p.s * w;
      }

      if (den === 0) {
        const p0 = neighbors[0].p;
        u[iy][ix] = p0.u;
        v[iy][ix] = p0.v;
        s[iy][ix] = p0.s;
      } else {
        u[iy][ix] = numU / den;
        v[iy][ix] = numV / den;
        s[iy][ix] = numS / den;
      }
    }
  }

  // Range tốc độ cho màu / scale
  let minS = Infinity;
  let maxS = -Infinity;
  for (let iy = 0; iy < nLat; iy++) {
    for (let ix = 0; ix < nLon; ix++) {
      const sv = s[iy][ix];
      if (!Number.isFinite(sv)) continue;
      if (sv < minS) minS = sv;
      if (sv > maxS) maxS = sv;
    }
  }
  if (!Number.isFinite(minS) || !Number.isFinite(maxS)) {
    minS = 0;
    maxS = 1;
  }

  function sample(lat, lon) {
    if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) {
      return { u: 0, v: 0, s: 0 };
    }

    const ty = (lat - minLat) / (maxLat - minLat || 1);
    const tx = (lon - minLon) / (maxLon - minLon || 1);

    const y = ty * (nLat - 1);
    const x = tx * (nLon - 1);

    const y0 = Math.floor(y);
    const x0 = Math.floor(x);
    const y1 = Math.min(y0 + 1, nLat - 1);
    const x1 = Math.min(x0 + 1, nLon - 1);

    const fy = y - y0;
    const fx = x - x0;

    function bilinear(grid) {
      const v00 = grid[y0][x0];
      const v10 = grid[y0][x1];
      const v01 = grid[y1][x0];
      const v11 = grid[y1][x1];

      const a = v00 * (1 - fx) + v10 * fx;
      const b = v01 * (1 - fx) + v11 * fx;
      return a * (1 - fy) + b * fy;
    }

    const uu = bilinear(u);
    const vv = bilinear(v);
    const ss = bilinear(s);

    return { u: uu, v: vv, s: ss };
  }

  return {
    minLat,
    maxLat,
    minLon,
    maxLon,
    nLat,
    nLon,
    u,
    v,
    s,
    minS,
    maxS,
    sample,
  };
}

// ===================== Màu tốc độ gió (nền màu) =====================

function windSpeedToRGBA(field, speed) {
  if (!field) return [0, 0, 0, 0];

  const minS = field.minS;
  const maxS = field.maxS <= minS ? minS + 1 : field.maxS;

  let v = (speed - minS) / (maxS - minS);
  v = Math.max(0, Math.min(1, v));

  // gamma nhẹ cho vùng gió vừa
  const gamma = 0.8;
  v = Math.pow(v, gamma);

  const stops = [
    { v: 0.0, r: 10,  g: 20,  b: 90 },   // dark blue
    { v: 0.3, r: 20,  g: 120, b: 120 },  // green-cyan
    { v: 0.6, r: 180, g: 210, b: 60 },   // yellow-ish
    { v: 0.8, r: 220, g: 120, b: 40 },   // orange
    { v: 1.0, r: 200, g: 40,  b: 140 },  // magenta
  ];

  let r = stops[stops.length - 1].r;
  let g = stops[stops.length - 1].g;
  let b = stops[stops.length - 1].b;

  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i];
    const s1 = stops[i + 1];
    if (v >= s0.v && v <= s1.v) {
      const t = (v - s0.v) / (s1.v - s0.v || 1);
      r = s0.r + (s1.r - s0.r) * t;
      g = s0.g + (s1.g - s0.g) * t;
      b = s0.b + (s1.b - s0.b) * t;
      break;
    }
  }

  const alpha =
    v < 0.05 ? 0.0 :
    v < 0.3 ? 0.35 :
    v < 0.6 ? 0.6 :
    v < 0.85 ? 0.8 : 0.95;

  return [
    Math.round(r),
    Math.round(g),
    Math.round(b),
    Math.round(alpha * 255),
  ];
}

// ===================== Lớp nền màu gió (canvas tĩnh, vẽ lại khi pan/zoom) =====================

const WindCanvasLayer = L.Layer.extend({
  initialize: function () {
    this._map = null;
    this._canvas = null;
    this._ctx = null;
    this._cells = [];
    this._field = null;
    this._redrawRequested = false;
  },

  onAdd: function (map) {
    this._map = map;
    this._initCanvas();

    const pane = map.getPane("meteo") || map.getPanes().overlayPane;
    pane.appendChild(this._canvas);

    this._reset();
    this._fetchAndRedraw();

    map.on("moveend zoomend resize", this._reset, this);
  },

  onRemove: function (map) {
    map.off("moveend zoomend resize", this._reset, this);
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    this._canvas = null;
    this._ctx = null;
    this._map = null;
    this._cells = [];
    this._field = null;
  },

  _initCanvas: function () {
    if (this._canvas) return;
    const canvas = (this._canvas = L.DomUtil.create(
      "canvas",
      "meteo-wind-canvas"
    ));
    const size = this._map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.pointerEvents = "none";
    this._ctx = canvas.getContext("2d");
  },

  _reset: function () {
    if (!this._map || !this._canvas) return;

    const size = this._map.getSize();
    const canvas = this._canvas;

    const topLeft = this._map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(canvas, topLeft);

    if (canvas.width !== size.x || canvas.height !== size.y) {
      canvas.width = size.x;
      canvas.height = size.y;
    }

    this._scheduleRedraw();
  },

  _scheduleRedraw: function () {
    if (this._redrawRequested) return;
    this._redrawRequested = true;
    requestAnimationFrame(() => {
      this._redrawRequested = false;
      this._draw();
    });
  },

  _fetchAndRedraw: async function () {
    try {
      let cells = [];

      // Ưu tiên fetchLatestTempGrid nếu có
      if (typeof window.fetchLatestTempGrid === "function") {
        const state = await window.fetchLatestTempGrid(false);
        cells = state && Array.isArray(state.cells) ? state.cells : [];
      } else if (typeof window.getLatestObs === "function") {
        const obs = await window.getLatestObs();
        cells = Array.isArray(obs) ? obs : [];
      }

      if (typeof window.filterCellsInsideVN === "function") {
        cells = window.filterCellsInsideVN(cells);
      }

      this._cells = cells;
      const field = buildWindFieldFromCells(cells);
      this._field = field;
      currentWindField = field;
      window.currentWindField = field;

      // thông báo cho layer hạt gió nếu đang bật
      if (window.windParticleLayer && typeof window.windParticleLayer.onFieldUpdated === "function") {
        window.windParticleLayer.onFieldUpdated();
      }

      this._scheduleRedraw();
    } catch (err) {
      console.error("WindCanvasLayer fetch error", err);
      this._cells = [];
      this._field = null;
      currentWindField = null;
      window.currentWindField = null;

      if (window.windParticleLayer && typeof window.windParticleLayer.onFieldUpdated === "function") {
        window.windParticleLayer.onFieldUpdated();
      }

      this._scheduleRedraw();
    }
  },

  _draw: function () {
    if (!this._map || !this._ctx || !this._canvas) return;

    const ctx = this._ctx;
    const canvas = this._canvas;
    const size = this._map.getSize();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const field = this._field;
    if (!field) return;

    const w = size.x;
    const h = size.y;
    const step = WIND_SAMPLE_STEP_PX;

    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const latlng = this._map.containerPointToLatLng([
          x + step / 2,
          y + step / 2,
        ]);
        if (!latlng) continue;

        const lat = latlng.lat;
        const lon = latlng.lng;

        if (!isLatLngInsideVN(lat, lon)) continue;

        const wVec = field.sample(lat, lon);
        if (!wVec || !Number.isFinite(wVec.s) || wVec.s <= 0.05) continue;

        const [r, g, b, a] = windSpeedToRGBA(field, wVec.s);

        for (let yy = y; yy < y + step && yy < h; yy++) {
          for (let xx = x; xx < x + step && xx < w; xx++) {
            const idx = (yy * w + xx) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = a;
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  },
});

// ===================== Lớp hạt gió (particle advection) =====================

const WindParticleLayer = L.Layer.extend({
  initialize: function () {
    this._map = null;
    this._canvas = null;
    this._ctx = null;
    this._particles = [];
    this._animFrameId = null;
    this._lastTime = null;
  },

  onAdd: function (map) {
    this._map = map;
    this._initCanvas();

    const pane = map.getPane("meteo") || map.getPanes().overlayPane;
    pane.appendChild(this._canvas);

    this._reset();

    map.on("moveend zoomend resize", this._reset, this);

    this._startAnimation();
  },

  onRemove: function (map) {
    map.off("moveend zoomend resize", this._reset, this);
    this._stopAnimation();

    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    this._canvas = null;
    this._ctx = null;
    this._map = null;
    this._particles = [];
  },

  _initCanvas: function () {
    if (this._canvas) return;
    const canvas = (this._canvas = L.DomUtil.create(
      "canvas",
      "meteo-wind-particles"
    ));
    const size = this._map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.pointerEvents = "none";

    this._ctx = canvas.getContext("2d");
  },

  _reset: function () {
    if (!this._map || !this._canvas) return;

    const size = this._map.getSize();
    const canvas = this._canvas;

    canvas.width = size.x;
    canvas.height = size.y;

    const topLeft = this._map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(canvas, topLeft);

    // Không reset lat/lon của hạt để tránh nhảy, chỉ clear canvas
    if (this._ctx) {
      this._ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  },

  _startAnimation: function () {
    if (this._animFrameId != null) return;

    const loop = (timestamp) => {
      this._animFrameId = requestAnimationFrame(loop);
      this._tick(timestamp);
    };

    this._animFrameId = requestAnimationFrame(loop);
  },

  _stopAnimation: function () {
    if (this._animFrameId != null) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
  },

  _tick: function (timestamp) {
    if (!this._map || !this._ctx || !this._canvas) return;

    const field = window.currentWindField;
    const ctx = this._ctx;
    const canvas = this._canvas;

    if (!field) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this._particles = [];
      this._lastTime = timestamp;
      return;
    }

    // dt để có thể scale nếu cần (hiện tại dùng đơn giản)
    if (this._lastTime == null) this._lastTime = timestamp;
    const dt = (timestamp - this._lastTime) / 1000;
    this._lastTime = timestamp;

    // Tạo đủ số hạt
    this._ensureParticles(field);

    // Fade nhẹ để tạo vệt
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0," + WIND_PARTICLE_FADE_ALPHA.toFixed(3) + ")";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "lighter";

    // Vẽ từng hạt
    ctx.lineWidth = 1;
    ctx.lineCap = "round";

    const alive = [];
    for (const p of this._particles) {
      if (this._stepParticle(p, field, dt)) {
        alive.push(p);
      }
    }
    this._particles = alive;

    ctx.globalCompositeOperation = "source-over";
  },

  _ensureParticles: function (field) {
    const deficit = WIND_PARTICLE_COUNT - this._particles.length;
    if (deficit <= 0) return;

    for (let i = 0; i < deficit; i++) {
      const p = this._spawnParticle(field);
      if (p) this._particles.push(p);
      else break;
    }
  },

  _spawnParticle: function (field) {
    const map = this._map;
    if (!map || !field) return null;

    const bounds = map.getBounds();

    // Giao bbox field với bbox map
    const minLat = Math.max(field.minLat, bounds.getSouth());
    const maxLat = Math.min(field.maxLat, bounds.getNorth());
    const minLon = Math.max(field.minLon, bounds.getWest());
    const maxLon = Math.min(field.maxLon, bounds.getEast());

    if (!(minLat < maxLat && minLon < maxLon)) return null;

    // Thử một số lần để tìm chỗ có gió đủ mạnh
    for (let k = 0; k < 30; k++) {
      const lat = minLat + Math.random() * (maxLat - minLat);
      const lon = minLon + Math.random() * (maxLon - minLon);

      if (!isLatLngInsideVN(lat, lon)) continue;

      const vec = field.sample(lat, lon);
      if (!vec || !Number.isFinite(vec.s) || vec.s < WIND_PARTICLE_MIN_SPEED) {
        continue;
      }

      return {
        lat,
        lon,
        prevLat: lat,
        prevLon: lon,
        age: 0,
      };
    }

    return null;
  },

  _stepParticle: function (p, field, dt) {
    const lat = p.lat;
    const lon = p.lon;

    if (!isLatLngInsideVN(lat, lon)) {
      return false;
    }

    const vec = field.sample(lat, lon);
    if (!vec || !Number.isFinite(vec.s)) return false;

    const speed = vec.s;
    if (speed < WIND_PARTICLE_MIN_SPEED) {
      p.age += 1;
      if (p.age > 20) return false;
      return true;
    }

    const uu = vec.u;
    const vv = vec.v;
    let mag = Math.sqrt(uu * uu + vv * vv);
    if (!Number.isFinite(mag) || mag < 1e-6) return false;

    const dirX = uu / mag; // hướng Đông
    const dirY = vv / mag; // hướng Bắc

    let sNorm = 0;
    if (field.maxS > field.minS) {
      sNorm = (speed - field.minS) / (field.maxS - field.minS);
      if (sNorm < 0) sNorm = 0;
      else if (sNorm > 1) sNorm = 1;
    }

    const stepDeg =
      WIND_PARTICLE_BASE_STEP_DEG +
      WIND_PARTICLE_STEP_DEG_RANGE * sNorm;

    // dt có thể scale thêm nếu muốn nhanh/chậm theo thời gian thực
    const scaledStep = stepDeg * (dt > 0 ? dt * 60 : 1);

    const latRad = (lat * Math.PI) / 180;
    let cosLat = Math.cos(latRad);
    if (!Number.isFinite(cosLat) || Math.abs(cosLat) < 0.2) {
      cosLat = cosLat >= 0 ? 0.2 : -0.2;
    }

    const newLat = lat + dirY * scaledStep;
    const newLon = lon + (dirX * scaledStep) / cosLat;

    if (
      newLat < field.minLat ||
      newLat > field.maxLat ||
      newLon < field.minLon ||
      newLon > field.maxLon
    ) {
      return false;
    }

    if (!isLatLngInsideVN(newLat, newLon)) {
      return false;
    }

    // Vẽ đoạn từ prev -> new
    const map = this._map;
    const ctx = this._ctx;
    const p0 = map.latLngToContainerPoint([p.prevLat, p.prevLon]);
    const p1 = map.latLngToContainerPoint([newLat, newLon]);

    const size = map.getSize();
    if (
      p1.x < -50 || p1.y < -50 ||
      p1.x > size.x + 50 || p1.y > size.y + 50
    ) {
      return false;
    }

    // alpha theo tốc độ
    let alpha = 0.1 + 0.9 * sNorm;
    if (alpha > 1) alpha = 1;

    ctx.strokeStyle = "rgba(255,255,255," + alpha.toFixed(3) + ")";
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();

    // cập nhật particle
    p.prevLat = newLat;
    p.prevLon = newLon;
    p.lat = newLat;
    p.lon = newLon;
    p.age = (p.age || 0) + 1;

    if (p.age > WIND_PARTICLE_MAX_AGE) {
      return false;
    }

    return true;
  },

  // Gọi khi field cập nhật mạnh (fetch mới)
  onFieldUpdated: function () {
    // reset toàn bộ hạt để sinh lại theo trường mới
    this._particles = [];
    if (this._ctx && this._canvas) {
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    }
  },
});

// ===================== API global cho nút Gió =====================

function showWindLayer() {
  if (!window.map) {
    console.error("showWindLayer: map chưa khởi tạo");
    return;
  }

  // nền màu
  if (windCanvasLayer) {
    window.map.removeLayer(windCanvasLayer);
    windCanvasLayer = null;
  }
  windCanvasLayer = new WindCanvasLayer();
  windCanvasLayer.addTo(window.map);

  // hạt gió
  if (windParticleLayer) {
    window.map.removeLayer(windParticleLayer);
    windParticleLayer = null;
    window.windParticleLayer = null;
  }
  windParticleLayer = new WindParticleLayer();
  windParticleLayer.addTo(window.map);
  window.windParticleLayer = windParticleLayer;
}

function hideWindLayer() {
  if (!window.map) return;

  if (windCanvasLayer) {
    window.map.removeLayer(windCanvasLayer);
    windCanvasLayer = null;
  }
  if (windParticleLayer) {
    window.map.removeLayer(windParticleLayer);
    windParticleLayer = null;
    window.windParticleLayer = null;
  }

  currentWindField = null;
  window.currentWindField = null;
}

window.showWindLayer = showWindLayer;
window.hideWindLayer = hideWindLayer;
