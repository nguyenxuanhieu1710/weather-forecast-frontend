// layers_wind.js
// Hiển thị gió kiểu Windy: nền màu tốc độ + hạt chuyển động theo hướng gió
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

// Hạt gió
const WIND_PARTICLE_COUNT = 2000;      // số lượng hạt
const WIND_PARTICLE_MAX_AGE = 220;     // số frame sống
const WIND_PARTICLE_SPEED_SCALE = 0.05; // scale tốc độ -> px mỗi frame

// ===================== Biến toàn cục =====================

let windCanvasLayer = null;    // nền màu gió
let windParticleLayer = null;  // hạt chuyển động
let currentWindField = null;   // trường gió hiện tại
window.currentWindField = null;

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

  const insideFn =
    typeof window.isPointInsideVN === "function"
      ? window.isPointInsideVN
      : null;

  const src = [];

  for (const c of cells) {
    if (!c) continue;
    if (typeof c.wind_ms !== "number" || typeof c.wind_dir_deg !== "number") {
      continue;
    }

    const lat = Number(c.lat);
    const lon = Number(c.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    if (insideFn && !insideFn(lat, lon)) continue;

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
 * Xây trường gió đều trên bbox VN bằng IDW + nội suy bilinear:
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

  // Mở biên ra một chút cho nền phủ kín
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

      this._scheduleRedraw();
    } catch (err) {
      console.error("WindCanvasLayer fetch error", err);
      this._cells = [];
      this._field = null;
      currentWindField = null;
      window.currentWindField = null;
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

    const insideFn =
      typeof window.isPointInsideVN === "function"
        ? window.isPointInsideVN
        : null;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const latlng = this._map.containerPointToLatLng([
          x + step / 2,
          y + step / 2,
        ]);
        if (!latlng) continue;

        const lat = latlng.lat;
        const lon = latlng.lng;

        if (insideFn && !insideFn(lat, lon)) continue;

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

// ===================== Lớp hạt gió (particle) =====================

const WindParticleLayer = L.Layer.extend({
  onAdd: function (map) {
    this._map = map;
    this._canvas = L.DomUtil.create("canvas", "meteo-wind-particles");
    const size = map.getSize();
    this._canvas.width = size.x;
    this._canvas.height = size.y;
    this._canvas.style.position = "absolute";
    this._canvas.style.top = "0";
    this._canvas.style.left = "0";
    this._canvas.style.pointerEvents = "none";

    const pane = map.getPane("meteo") || map.getPanes().overlayPane;
    pane.appendChild(this._canvas);

    this._ctx = this._canvas.getContext("2d");
    this._particles = [];
    this._frame = null;

    this._resetParticles();
    this._bindEvents();
    this._loop();
  },

  onRemove: function (map) {
    this._unbindEvents();
    if (this._frame) cancelAnimationFrame(this._frame);
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    this._canvas = null;
    this._ctx = null;
    this._map = null;
    this._particles = [];
  },

  _bindEvents: function () {
    this._onResize = this._handleResize.bind(this);
    this._onMove = this._resetParticles.bind(this);
    this._map.on("resize", this._onResize);
    this._map.on("moveend", this._onMove);
  },

  _unbindEvents: function () {
    if (!this._map) return;
    this._map.off("resize", this._onResize);
    this._map.off("moveend", this._onMove);
  },

  _handleResize: function () {
    const size = this._map.getSize();
    this._canvas.width = size.x;
    this._canvas.height = size.y;
    this._resetParticles();
  },

  _resetParticles: function () {
    if (!this._map || !this._canvas) return;
    const size = this._map.getSize();
    this._particles = [];
    for (let i = 0; i < WIND_PARTICLE_COUNT; i++) {
      this._particles.push(this._randomParticle(size));
    }
  },

  _randomParticle: function (size) {
    return {
      x: Math.random() * size.x,
      y: Math.random() * size.y,
      age: Math.floor(Math.random() * WIND_PARTICLE_MAX_AGE),
      justRespawned: true,
    };
  },

  _respawnParticle: function (p, size) {
    const np = this._randomParticle(size);
    p.x = np.x;
    p.y = np.y;
    p.age = np.age;
    p.justRespawned = true;
  },

  _evolveParticle: function (p, size) {
    const field = window.currentWindField;
    if (!field || !this._map) {
      // Không có trường gió → kill hạt
      p.age = WIND_PARTICLE_MAX_AGE + 1;
      p.justRespawned = false;
      return;
    }

    if (p.age > WIND_PARTICLE_MAX_AGE) {
      this._respawnParticle(p, size);
      return;
    }

    const latlng = this._map.containerPointToLatLng([p.x, p.y]);
    if (!latlng) {
      this._respawnParticle(p, size);
      return;
    }

    const wVec = field.sample(latlng.lat, latlng.lng);
    if (!wVec || wVec.s <= 0.05) {
      this._respawnParticle(p, size);
      return;
    }

    // u,v (m/s) -> dịch chuyển pixel
    const latRad = (latlng.lat * Math.PI) / 180;
    const kx = 1 / Math.cos(latRad || 1e-6);

    const dx = wVec.u * WIND_PARTICLE_SPEED_SCALE * kx;
    const dy = -wVec.v * WIND_PARTICLE_SPEED_SCALE; // v dương Bắc → y giảm

    const nx = p.x + dx;
    const ny = p.y + dy;

    if (nx < 0 || ny < 0 || nx >= size.x || ny >= size.y) {
      this._respawnParticle(p, size);
      return;
    }

    p.x = nx;
    p.y = ny;
    p.age += 1;
    p.justRespawned = false;
  },

  _loop: function () {
    if (!this._map || !this._ctx || !this._canvas) return;

    const ctx = this._ctx;
    const size = this._map.getSize();

    // Làm mờ frame cũ nhưng giữ trail tương đối dài
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "rgba(0,0,0,0.97)";
    ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);

    // Vẽ vệt mới
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    for (const p of this._particles) {
      const x0 = p.x;
      const y0 = p.y;

      this._evolveParticle(p, size);

      if (p.justRespawned) continue;

      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    this._frame = requestAnimationFrame(this._loop.bind(this));
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
  }
  windParticleLayer = new WindParticleLayer();
  windParticleLayer.addTo(window.map);
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
  }
  currentWindField = null;
  window.currentWindField = null;
}

window.showWindLayer = showWindLayer;
window.hideWindLayer = hideWindLayer;
