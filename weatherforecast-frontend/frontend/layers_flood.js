// layers_flood.js
// Heatmap NGUY CƠ LŨ LỤT bằng canvas + IDW
// Dùng risk_score từ backend (0..~9), clamp về [0, 5],
// chuẩn hóa 0–5 -> [0,1], màu: vàng -> cam -> đỏ -> tím theo mức nguy hiểm tăng dần.

const FLOOD_SAMPLE_STEP_PX = 6;   // kích thước ô vẽ trên màn hình (pixel)
const FLOOD_IDW_POWER = 2.0;      // số mũ IDW
const FLOOD_IDW_K_NEAREST = 8;    // số điểm lân cận dùng cho IDW

let floodCanvasLayer = null;

// ============================
// Helper: khoảng cách + IDW
// ============================

function dist2DegFlood(lat1, lon1, lat2, lon2) {
  const dLat = lat1 - lat2;
  const dLon = lon1 - lon2;
  return dLat * dLat + dLon * dLon;
}

/**
 * IDW trên risk_score.
 * - Lấy tối đa K điểm gần nhất (K = FLOOD_IDW_K_NEAREST).
 * - Nếu quá gần 1 điểm thì trả trực tiếp score của điểm đó.
 */
function idwFloodAt(lat, lon, cells) {
  if (!cells || !cells.length) return null;

  const nearestList = [];

  for (const c of cells) {
    let v = c.risk_score;
    if (v == null || !Number.isFinite(v)) {
      // fallback từ risk_level nếu risk_score bị thiếu
      v = riskLevelToScoreFallback(c.risk_level);
      if (v == null) continue;
    }

    const d2 = dist2DegFlood(lat, lon, c.lat, c.lon);
    nearestList.push({ cell: c, d2, v });
  }

  if (!nearestList.length) return null;

  nearestList.sort((a, b) => a.d2 - b.d2);

  // Nếu điểm nội suy trùng với 1 location (d2 ~ 0) thì lấy luôn score
  if (nearestList[0].d2 < 1e-10) {
    return nearestList[0].v;
  }

  const k = Math.min(FLOOD_IDW_K_NEAREST, nearestList.length);

  let num = 0;
  let den = 0;
  for (let i = 0; i < k; i++) {
    const { d2, v } = nearestList[i];
    if (d2 <= 0) continue;
    const w = 1 / Math.pow(d2, FLOOD_IDW_POWER / 2);
    num += w * v;
    den += w;
  }

  if (den === 0) {
    return nearestList[0].v;
  }
  return num / den;
}

// ============================
// Chuẩn hóa score + màu sắc
// ============================

/**
 * Fallback nếu risk_score thiếu: map risk_level -> score thô
 * (NONE=0, LOW=1, MODERATE=3, HIGH=5, VERY_HIGH=7).
 * Sau đó vẫn sẽ clamp vào [0,5].
 */
function riskLevelToScoreFallback(level) {
  if (!level) return null;
  const lvl = String(level).toUpperCase();
  switch (lvl) {
    case "NONE":
      return 0;
    case "LOW":
      return 1;
    case "MODERATE":
      return 3;
    case "HIGH":
      return 5;
    case "VERY_HIGH":
      return 7;
    default:
      return null;
  }
}

/**
 * Chuẩn hóa risk_score:
 * - Backend có thể cho score 0..9 (do elev_score + rain3_score + rain1_bonus).
 * - Frontend ép về [0,5] để biểu diễn màu.
 */
function normalizeFloodValue(score) {
  if (!Number.isFinite(score)) return 0;

  const clamped = Math.max(0, Math.min(5, score));
  const t = clamped / 5; // 0 -> 5 => 0 -> 1

  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

/**
 * Map vNorm ∈ [0,1] -> màu RGBA
 * 0.0  → vàng   (nguy cơ thấp)
 * 0.33 → cam
 * 0.66 → đỏ
 * 1.0  → tím   (nguy cơ cực cao)
 */
function floodValueToRGBA(vNorm) {
  let v = vNorm;
  if (v < 0) v = 0;
  if (v > 1) v = 1;

  const stops = [
    { v: 0.0, r: 250, g: 204, b: 21 },  // vàng  #facc15
    { v: 0.33, r: 249, g: 115, b: 22 }, // cam   #f97316
    { v: 0.66, r: 220, g: 38,  b: 38 }, // đỏ    #dc2626
    { v: 1.0, r: 126, g: 34,  b: 206 }  // tím   #7e22ce
  ];

  let r, g, b, a;

  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i];
    const s1 = stops[i + 1];
    if (v >= s0.v && v <= s1.v) {
      const t = (v - s0.v) / (s1.v - s0.v || 1);

      r = s0.r + (s1.r - s0.r) * t;
      g = s0.g + (s1.g - s0.g) * t;
      b = s0.b + (s1.b - s0.b) * t;

      // Alpha tăng theo mức nguy hiểm
      if (v < 0.15) {
        a = 0.20; // gần như không nguy hiểm
      } else if (v < 0.35) {
        a = 0.40;
      } else if (v < 0.65) {
        a = 0.65;
      } else if (v < 0.85) {
        a = 0.8;
      } else {
        a = 0.92;
      }

      return [
        Math.round(r),
        Math.round(g),
        Math.round(b),
        Math.round(a * 255)
      ];
    }
  }

  const last = stops[stops.length - 1];
  return [last.r, last.g, last.b, Math.round(0.9 * 255)];
}

// ============================
// Lớp Leaflet canvas
// ============================

const FloodCanvasLayer = L.Layer.extend({
  initialize: function () {
    this._map = null;
    this._canvas = null;
    this._ctx = null;
    this._cells = [];
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
  },

  _initCanvas: function () {
    if (this._canvas) return;
    const canvas = (this._canvas = L.DomUtil.create(
      "canvas",
      "meteo-flood-canvas"
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
      const base = window.API_BASE;
      const url = `${base}/obs/flood_risk_latest`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const js = await res.json();

      let cells = js.data || [];

      // lọc trong VN nếu có hàm filter
      if (typeof window.filterCellsInsideVN === "function") {
        cells = window.filterCellsInsideVN(cells);
      }

      this._cells = cells;
      this._scheduleRedraw();

      // đồng bộ thời gian hiển thị nếu muốn
      let latestTime = null;
      if (cells.length) latestTime = cells[0].valid_at || null;
      if (latestTime && typeof window.setObsTimeLabel === "function") {
        window.setObsTimeLabel(latestTime);
      }
      if (typeof window.showSnapshotStatus === "function") {
        window.showSnapshotStatus("ok");
      }
    } catch (err) {
      console.error("FloodCanvasLayer fetch error", err);
      this._cells = [];
      this._scheduleRedraw();
      if (typeof window.showSnapshotStatus === "function") {
        window.showSnapshotStatus("error");
      }
    }
  },

  _draw: function () {
    if (!this._map || !this._ctx || !this._canvas) return;

    const ctx = this._ctx;
    const canvas = this._canvas;
    const size = this._map.getSize();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cells = this._cells;
    if (!cells || !cells.length) return;

    const w = size.x;
    const h = size.y;
    const step = FLOOD_SAMPLE_STEP_PX;

    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const latlng = this._map.containerPointToLatLng([
          x + step / 2,
          y + step / 2
        ]);
        if (!latlng) continue;

        const lat = latlng.lat;
        const lon = latlng.lng;

        // mask Việt Nam nếu có
        if (
          typeof window.isPointInsideVN === "function" &&
          !window.isPointInsideVN(lat, lon)
        ) {
          continue;
        }

        const riskScore = idwFloodAt(lat, lon, cells);
        if (riskScore == null || !Number.isFinite(riskScore)) continue;

        const vNorm = normalizeFloodValue(riskScore);

        // nếu quá nhỏ thì bỏ qua để map không bị phủ mờ toàn bộ
        if (vNorm < 0.05) continue;

        const [r, g, b, a] = floodValueToRGBA(vNorm);

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
  }
});

// ============================
// API global cho main.js / UI
// ============================

window.showFloodLayer = function () {
  if (!window.map) return;
  if (floodCanvasLayer) {
    window.map.removeLayer(floodCanvasLayer);
    floodCanvasLayer = null;
  }
  floodCanvasLayer = new FloodCanvasLayer();
  floodCanvasLayer.addTo(window.map);
};

window.hideFloodLayer = function () {
  if (!window.map) return;
  if (floodCanvasLayer) {
    window.map.removeLayer(floodCanvasLayer);
    floodCanvasLayer = null;
  }
};
