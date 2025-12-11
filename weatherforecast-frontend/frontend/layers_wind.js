// layers_wind.js
// Hiển thị gió: nền màu tốc độ + streamline động (pathline) – KHÔNG dùng mũi tên, KHÔNG dùng hạt rời
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

// Streamline động
const WIND_STREAMLINE_COUNT = 400;         // số đường luồng tối đa
const WIND_STREAMLINE_MAX_POINTS = 20;     // số điểm tối đa trên 1 streamline
const WIND_STREAMLINE_MIN_SPEED = 0.3;     // m/s – dưới ngưỡng thì coi như chết, respawn
const WIND_STREAMLINE_BASE_STEP_DEG = 0.02; // bước lat/lon tối thiểu mỗi frame (độ)
const WIND_STREAMLINE_STEP_DEG_RANGE = 0.06; // thêm theo tốc độ để chỗ gió mạnh chạy nhanh hơn
const WIND_STREAMLINE_MAX_AGE = 1000;      // số frame tối đa cho 1 streamline

// ===================== Biến toàn cục =====================

let windCanvasLayer = null;        // nền màu gió
let windStreamlineLayer = null;    // streamline động
let currentWindField = null;       // trường gió hiện tại

window.currentWindField = null;
window.windStreamlineLayer = null;

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

// ====== scale lon theo vĩ độ ======
function dist2DegWind(lat1, lon1, lat2, lon2) {
  const dLat = lat1 - lat2;
  const meanLatRad = ((lat1 + lat2) * 0.5 * Math.PI) / 180;
  const dLon = (lon1 - lon2) * Math.cos(meanLatRad);
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
 * Xây trường gió đều trên bbox dữ liệu bằng IDW trên u,v; s = hypot(u,v):
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

  // Mở biên
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

  // IDW trên lưới: chỉ nội suy u,v; s suy ra từ hypot(u,v)
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

      // trùng điểm
      if (neighbors[0].d2 < 1e-12) {
        const p0 = neighbors[0].p;
        u[iy][ix] = p0.u;
        v[iy][ix] = p0.v;
        s[iy][ix] = Math.hypot(p0.u, p0.v);
        continue;
      }

      let numU = 0;
      let numV = 0;
      let den = 0;

      for (const { p, d2 } of neighbors) {
        if (d2 <= 0) continue;
        const w = 1 / Math.pow(d2, POWER / 2); // d2 là khoảng cách bình phương
        den += w;
        numU += p.u * w;
        numV += p.v * w;
      }

      let uu, vv;
      if (den === 0) {
        const p0 = neighbors[0].p;
        uu = p0.u;
        vv = p0.v;
      } else {
        uu = numU / den;
        vv = numV / den;
      }

      u[iy][ix] = uu;
      v[iy][ix] = vv;
      s[iy][ix] = Math.hypot(uu, vv);
    }
  }

  // Range tốc độ cho màu
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

  // sample: bilinear u,v; s = hypot(u,v) (không nội suy s độc lập)
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
    const ss = Math.hypot(uu, vv);

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
    s,       // giữ lại để debug/inspect; giá trị luôn khớp hypot(u,v)
    minS,
    maxS,
    sample,
  };
}

// ===================== Màu tốc độ gió =====================

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

// ===================== Lớp nền màu gió (canvas) =====================

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

      // thông báo cho layer streamline, nếu đang bật
      if (window.windStreamlineLayer && typeof window.windStreamlineLayer.onFieldUpdated === "function") {
        window.windStreamlineLayer.onFieldUpdated();
      }

      this._scheduleRedraw();
    } catch (err) {
      console.error("WindCanvasLayer fetch error", err);
      this._cells = [];
      this._field = null;
      currentWindField = null;
      window.currentWindField = null;

      if (window.windStreamlineLayer && typeof window.windStreamlineLayer.onFieldUpdated === "function") {
        window.windStreamlineLayer.onFieldUpdated();
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

// ===================== Lớp streamline gió (canvas động) =====================

const WindStreamlineLayer = L.Layer.extend({
  initialize: function () {
    this._map = null;
    this._canvas = null;
    this._ctx = null;
    this._streamlines = [];
    this._animFrameId = null;
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
    this._streamlines = [];
  },

  _initCanvas: function () {
    if (this._canvas) return;
    const canvas = (this._canvas = L.DomUtil.create(
      "canvas",
      "meteo-wind-streamlines"
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

    // Khi pan/zoom thì bỏ toàn bộ streamline cũ, seed lại theo viewport mới
    this._streamlines = [];
  },

  _startAnimation: function () {
    if (this._animFrameId != null) return;

    const loop = (timestamp) => {
      this._animFrameId = requestAnimationFrame(loop);
      this._tick();
    };

    this._animFrameId = requestAnimationFrame(loop);
  },

  _stopAnimation: function () {
    if (this._animFrameId != null) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
  },

  _tick: function () {
    if (!this._map || !this._ctx || !this._canvas) return;

    const field = window.currentWindField;
    const ctx = this._ctx;
    const canvas = this._canvas;

    // Không có trường gió → clear và đợi
    if (!field) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    // Đảm bảo đủ số streamline
    this._ensureStreamlines(field);

    // Cập nhật vị trí streamline
    this._advanceStreamlines(field);

    // Vẽ lại
    this._renderStreamlines(field);
  },

  _ensureStreamlines: function (field) {
    const needed = WIND_STREAMLINE_COUNT - this._streamlines.length;
    if (needed <= 0) return;

    for (let i = 0; i < needed; i++) {
      const s = this._spawnStreamline(field);
      if (s) this._streamlines.push(s);
      else break;
    }
  },

  _spawnStreamline: function (field) {
    const map = this._map;
    if (!map || !field) return null;

    const bounds = map.getBounds();
    // Giao bbox field với bbox map
    const minLat = Math.max(field.minLat, bounds.getSouth());
    const maxLat = Math.min(field.maxLat, bounds.getNorth());
    const minLon = Math.max(field.minLon, bounds.getWest());
    const maxLon = Math.min(field.maxLon, bounds.getEast());

    if (!(minLat < maxLat && minLon < maxLon)) {
      return null;
    }

    // Thử một số lần để tìm chỗ có gió đủ mạnh
    for (let k = 0; k < 30; k++) {
      const lat = minLat + Math.random() * (maxLat - minLat);
      const lon = minLon + Math.random() * (maxLon - minLon);

      if (!isLatLngInsideVN(lat, lon)) continue;

      const vec = field.sample(lat, lon);
      if (!vec || !Number.isFinite(vec.s) || vec.s < WIND_STREAMLINE_MIN_SPEED) {
        continue;
      }

      return {
        lat,
        lon,
        points: [{ lat, lon }],
        age: 0,
        idle: 0,
      };
    }

    return null;
  },

  _advanceStreamlines: function (field) {
    const alive = [];
    for (const s of this._streamlines) {
      if (this._stepStreamline(s, field)) {
        alive.push(s);
      }
    }
    this._streamlines = alive;
  },

  _stepStreamline: function (s, field) {
    const lat = s.lat;
    const lon = s.lon;

    if (!isLatLngInsideVN(lat, lon)) {
      return false;
    }

    const vec = field.sample(lat, lon);
    if (!vec || !Number.isFinite(vec.s)) return false;

    const speed = vec.s;
    if (speed < WIND_STREAMLINE_MIN_SPEED) {
      s.idle = (s.idle || 0) + 1;
      if (s.idle > 20) return false;
      // vẫn giữ lại vài frame để không nhảy quá gắt
    } else {
      s.idle = 0;
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
      WIND_STREAMLINE_BASE_STEP_DEG +
      WIND_STREAMLINE_STEP_DEG_RANGE * sNorm;

    const latRad = (lat * Math.PI) / 180;
    let cosLat = Math.cos(latRad);
    if (!Number.isFinite(cosLat) || Math.abs(cosLat) < 0.2) {
      cosLat = cosLat >= 0 ? 0.2 : -0.2;
    }

    const newLat = lat + dirY * stepDeg;
    const newLon = lon + (dirX * stepDeg) / cosLat;

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

    s.lat = newLat;
    s.lon = newLon;
    s.age = (s.age || 0) + 1;

    if (!Array.isArray(s.points)) s.points = [];
    s.points.push({ lat: newLat, lon: newLon });
    if (s.points.length > WIND_STREAMLINE_MAX_POINTS) {
      s.points.shift();
    }

    if (s.age > WIND_STREAMLINE_MAX_AGE) {
      return false;
    }

    return true;
  },

  _renderStreamlines: function () {
    const ctx = this._ctx;
    const canvas = this._canvas;
    const map = this._map;

    if (!ctx || !canvas || !map) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!this._streamlines.length) return;

    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "lighter";

    for (const s of this._streamlines) {
      const pts = s.points;
      const n = pts.length;
      if (n < 2) continue;

      for (let i = 1; i < n; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];

        const c0 = map.latLngToContainerPoint([p0.lat, p0.lon]);
        const c1 = map.latLngToContainerPoint([p1.lat, p1.lon]);

        // alpha tăng dần từ đuôi -> đầu
        const t = i / (n - 1);
        const alpha = t; // đuôi mờ, đầu đậm

        ctx.strokeStyle = "rgba(255,255,255," + alpha.toFixed(3) + ")";
        ctx.beginPath();
        ctx.moveTo(c0.x, c0.y);
        ctx.lineTo(c1.x, c1.y);
        ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = "source-over";
  },

  // gọi khi field thay đổi mạnh (fetch mới)
  onFieldUpdated: function () {
    // reset streamline để seed lại theo trường gió mới
    this._streamlines = [];
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

  // streamline
  if (windStreamlineLayer) {
    window.map.removeLayer(windStreamlineLayer);
    windStreamlineLayer = null;
    window.windStreamlineLayer = null;
  }
  windStreamlineLayer = new WindStreamlineLayer();
  windStreamlineLayer.addTo(window.map);
  window.windStreamlineLayer = windStreamlineLayer;
}

function hideWindLayer() {
  if (!window.map) return;

  if (windCanvasLayer) {
    window.map.removeLayer(windCanvasLayer);
    windCanvasLayer = null;
  }
  if (windStreamlineLayer) {
    window.map.removeLayer(windStreamlineLayer);
    windStreamlineLayer = null;
    window.windStreamlineLayer = null;
  }

  currentWindField = null;
  window.currentWindField = null;
}

window.showWindLayer = showWindLayer;
window.hideWindLayer = hideWindLayer;