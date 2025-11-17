// layer_wind.js
// Hiển thị gió kiểu Windy: nền màu tốc độ + hạt gió theo hướng wind_dir_deg
// Yêu cầu: đã có window.map (Leaflet) và hàm fetchLatestTempGrid() trả về { cells: [...] }
// Mỗi cell: { lat, lon, wind_ms, wind_dir_deg, ... }

// ===================== Cấu hình =====================

// Lưới trường gió (để nội suy + cho particle sample nhanh)
const WIND_FIELD_DLAT = 0.1;
const WIND_FIELD_DLON = 0.1;

// Canvas nền màu: lấy mẫu theo pixel
const WIND_CANVAS_STEP_PX = 4;

// Hạt gió
const WIND_PARTICLE_COUNT = 2000;
const WIND_PARTICLE_MAX_AGE = 180;
const WIND_PARTICLE_SPEED_SCALE = 0.04; // chỉnh độ dài vệt gió

// ===================== Biến toàn cục =====================

let windColorLayer = null;   // nếu bạn vẫn muốn giữ heatmap màu tốc độ gió
let windArrowLayer = null;   // lớp mũi tên tĩnh
let windParticlesLayer = null;
let currentWindField = null;      // trường gió đã nội suy
window.currentWindField = null;   // export global cho particle

// ===================== Helper toán học / dữ liệu =====================

function dist2Deg(lat1, lon1, lat2, lon2) {
  const dLat = lat1 - lat2;
  const dLon = lon1 - lon2;
  return dLat * dLat + dLon * dLon;
}

/**
 * Chuẩn hóa cells → list điểm gió:
 *  - chỉ lấy cell có wind_ms & wind_dir_deg hợp lệ
 *  - nếu có isPointInsideVN thì chỉ giữ điểm trong VN
 * Trả về: [{lat,lon,u,v,s}, ...] với:
 *  - s: speed (m/s)
 *  - u: thành phần Đông (m/s)
 *  - v: thành phần Bắc (m/s)
 */
function extractWindPoints(cells) {
  if (!Array.isArray(cells)) return [];

  const insideFn =
    typeof window.isPointInsideVN === "function" ? window.isPointInsideVN : null;

  const out = [];

  for (const c of cells) {
    if (!c) continue;
    if (typeof c.wind_ms !== "number" || typeof c.wind_dir_deg !== "number") {
      continue;
    }

    const lat = Number(c.lat);
    const lon = Number(c.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    if (insideFn && !insideFn(lat, lon)) continue;

    const s = Math.max(0, Number(c.wind_ms));

    // wind_dir_deg: hướng gió THỔI TỪ (0 = từ Bắc).
    // Vector chuyển động (TO) quay thêm 180° rồi đổi sang u,v
    const dirTo = (c.wind_dir_deg + 180) % 360;
    const rad = (dirTo * Math.PI) / 180;

    const u = s * Math.sin(rad); // về phía Đông
    const v = s * Math.cos(rad); // về phía Bắc

    out.push({ lat, lon, u, v, s });
  }

  return out;
}

/**
 * Xây trường gió đều trên bbox VN bằng IDW + nội suy bilinear
 * Trả về object:
 * {
 *   minLat,maxLat,minLon,maxLon,
 *   nLat,nLon,
 *   u,v,s,          // lưới Float32Array
 *   minS,maxS,      // speed min/max
 *   sample(lat,lon) // -> {u,v,s}
 * }
 */
function buildWindField(cells) {
  const src = extractWindPoints(cells);
  if (!src.length) return null;

  // bbox
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

  // mở rộng nhẹ để nền phủ kín VN
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

  // lấy k lân cận theo khoảng cách trong độ
  const K = 6;
  const POWER = 2.0;

  function kNearest(lat, lon) {
    const arr = [];
    for (const p of src) {
      const d2 = dist2Deg(lat, lon, p.lat, p.lon);
      arr.push({ p, d2 });
    }
    arr.sort((a, b) => a.d2 - b.d2);
    return arr.slice(0, Math.min(K, arr.length));
  }

  // IDW trên toàn lưới
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

  // range tốc độ cho màu
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

/**
 * speed -> [r,g,b,a] theo gradient kiểu Windy
 * chậm: xanh, vừa: vàng, mạnh: đỏ/tím
 */
function windSpeedToRGBA(field, speed) {
  if (!field) return [0, 0, 0, 0];

  const minS = field.minS;
  const maxS = field.maxS <= minS ? minS + 1 : field.maxS;

  let v = (speed - minS) / (maxS - minS);
  v = Math.max(0, Math.min(1, v));

  const gamma = 0.8; // làm nổi vùng gió vừa
  v = Math.pow(v, gamma);

  const stops = [
    { v: 0.0, r: 10, g: 20, b: 90 },   // dark blue
    { v: 0.3, r: 20, g: 120, b: 120 }, // green-cyan
    { v: 0.6, r: 180, g: 210, b: 60 }, // yellowish
    { v: 0.8, r: 220, g: 120, b: 40 }, // orange
    { v: 1.0, r: 200, g: 40, b: 140 }, // magenta
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

const WindColorCanvasLayer = L.Layer.extend({
  initialize: function () {
    this._map = null;
    this._canvas = null;
    this._ctx = null;
    this._field = null;
    this._redrawRequested = false;
  },

  onAdd: function (map) {
    this._map = map;
    this._initCanvas();

    const pane = map.getPane("meteo") || map.getPanes().overlayPane;
    pane.appendChild(this._canvas);

    this._reset();
    this._fetchAndBuildField();

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
    this._field = null;
  },

  _initCanvas: function () {
    if (this._canvas) return;
    const canvas = (this._canvas = L.DomUtil.create(
      "canvas",
      "meteo-wind-color"
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

  _fetchAndBuildField: async function () {
    try {
      // Dùng chung API với nhiệt độ: fetchLatestTempGrid()
      // Yêu cầu backend trả cả wind_ms & wind_dir_deg trong cells
      let cells = [];

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

      const field = buildWindField(cells);
      this._field = field;
      currentWindField = field;
      window.currentWindField = field || null;

      this._scheduleRedraw();
    } catch (err) {
      console.error("WindColorCanvasLayer fetch error", err);
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
    const step = WIND_CANVAS_STEP_PX;

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

// ===================== Lớp mũi tên gió tĩnh =====================

const WindArrowLayer = L.Layer.extend({
  initialize: function () {
    this._map = null;
    this._group = L.layerGroup();
  },

  onAdd: function (map) {
    this._map = map;
    this._group.addTo(map);
    this._loadAndRender();
  },

  onRemove: function (map) {
    if (this._group) {
      this._group.removeFrom(map);
      this._group.clearLayers();
    }
    this._map = null;
  },

  _loadAndRender: async function () {
    try {
      let cells = [];

      // LẤY DỮ LIỆU GIÓ TỪ BACKEND
      if (typeof window.fetchLatestTempGrid === "function") {
        const state = await window.fetchLatestTempGrid(false);
        cells = state && Array.isArray(state.cells) ? state.cells : [];
      } else if (typeof window.getLatestObs === "function") {
        const obs = await window.getLatestObs();
        cells = Array.isArray(obs) ? obs : [];
      }

      const insideFn =
        typeof window.isPointInsideVN === "function"
          ? window.isPointInsideVN
          : null;

      this._group.clearLayers();

      for (const c of cells) {
        if (!c) continue;
        if (typeof c.wind_ms !== "number" || typeof c.wind_dir_deg !== "number") {
          continue;
        }

        const lat = Number(c.lat);
        const lon = Number(c.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        if (insideFn && !insideFn(lat, lon)) continue;

        const speed = Math.max(0, c.wind_ms);

        // wind_dir_deg: hướng gió THỔI TỪ → mũi tên CHỈ TỚI = +180°
        const angleTo = (c.wind_dir_deg + 180) % 360;

        // scale mũi tên theo tốc độ (tuỳ ý)
        const scale = 0.6 + Math.min(speed, 20) / 20; // 0.6 → 1.6

        const icon = L.divIcon({
          className: "wind-arrow-icon",
          html: `<div class="wind-arrow" style="transform: rotate(${angleTo}deg) scale(${scale});"></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });

        L.marker([lat, lon], { icon }).addTo(this._group);
      }
    } catch (err) {
      console.error("WindArrowLayer load error", err);
      this._group.clearLayers();
    }
  },
});

// ===================== Lớp hạt gió (particle) =====================

const WindParticlesLayer = L.Layer.extend({
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

  _evolveParticle: function (p, size) {
    const field = window.currentWindField;
    if (!field || !this._map) {
      p.age = WIND_PARTICLE_MAX_AGE + 1;
      p.justRespawned = false;
      return;
    }

    if (p.age > WIND_PARTICLE_MAX_AGE) {
      const np = this._randomParticle(size);
      p.x = np.x;
      p.y = np.y;
      p.age = np.age;
      p.justRespawned = true;
      return;
    }

    const latlng = this._map.containerPointToLatLng([p.x, p.y]);
    const wVec = field.sample(latlng.lat, latlng.lng);

    if (!wVec || wVec.s <= 0.05) {
      p.age = WIND_PARTICLE_MAX_AGE + 1;
      p.justRespawned = false;
      return;
    }

    // u,v (m/s) -> dịch chuyển pixel
    const latRad = (latlng.lat * Math.PI) / 180;
    const kx = 1 / Math.cos(latRad || 1e-6);

    const dx = wVec.u * WIND_PARTICLE_SPEED_SCALE * kx;
    const dy = -wVec.v * WIND_PARTICLE_SPEED_SCALE; // v dương Bắc -> y giảm

    const nx = p.x + dx;
    const ny = p.y + dy;

    if (nx < 0 || ny < 0 || nx >= size.x || ny >= size.y) {
      p.age = WIND_PARTICLE_MAX_AGE + 1;
      p.justRespawned = false;
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

    // Làm mờ frame cũ nhưng giữ vệt dài hơn
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "rgba(0,0,0,0.93)";  // 0.93 thay vì 0.90 → trail dài hơn
    ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);

    // Vẽ vệt gió mới
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";

    for (const p of this._particles) {
      const x0 = p.x;
      const y0 = p.y;

      this._evolveParticle(p, size);

      // hạt vừa respawn thì bỏ qua frame đầu để không vẽ đường từ vị trí cũ
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

  // Xoá lớp cũ nếu có
  if (windColorLayer) {
    window.map.removeLayer(windColorLayer);
    windColorLayer = null;
  }
  if (windArrowLayer) {
    window.map.removeLayer(windArrowLayer);
    windArrowLayer = null;
  }

  // 1) Nền màu tốc độ gió (tuỳ bạn, muốn bỏ thì comment 3 dòng này)
  if (typeof WindColorCanvasLayer === "function") {
    windColorLayer = new WindColorCanvasLayer();
    windColorLayer.addTo(window.map);
  }

  // 2) Lớp mũi tên tĩnh
  windArrowLayer = new WindArrowLayer();
  windArrowLayer.addTo(window.map);
}

function hideWindLayer() {
  if (!window.map) return;

  if (windColorLayer) {
    window.map.removeLayer(windColorLayer);
    windColorLayer = null;
  }
  if (windArrowLayer) {
    window.map.removeLayer(windArrowLayer);
    windArrowLayer = null;
  }
}

window.showWindLayer = showWindLayer;
window.hideWindLayer = hideWindLayer;
