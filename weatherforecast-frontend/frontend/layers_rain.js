// layers_rain.js
// Heatmap lượng mưa (precip_mm) dùng IDW + canvas giống nhiệt độ
// + hỗ trợ "radar mưa" (animation nhiều frame từ /obs/rain_frames)

// Dùng cùng bbox & VN mask như layers.js
// Giả định window.isPointInsideVN và window.filterCellsInsideVN đã được set

// IDW config cho mưa
const RAIN_SAMPLE_STEP_PX = 6;
const RAIN_IDW_POWER = 2.0;
const RAIN_IDW_K_NEAREST = 8;

// trạng thái chung
let rainCanvasLayer = null;
const rainRadarState = {
  frames: [],
  index: 0,
  stopFlag: false,
};

// ============================================================
// IDW + COLOR CHO MƯA
// ============================================================

/**
 * Return {rMin, rMax} cho mưa, bỏ qua 0, rất nhỏ
 */
function computeRainRange(cells) {
  if (!cells || !cells.length) return { rMin: 0, rMax: 1 };

  let minPos = Infinity;
  let maxPos = 0;

  for (const c of cells) {
    if (c.precip_mm == null || !Number.isFinite(c.precip_mm)) continue;
    const p = c.precip_mm;
    if (p <= 0) continue;
    if (p < minPos) minPos = p;
    if (p > maxPos) maxPos = p;
  }

  if (!Number.isFinite(minPos) || maxPos <= 0) {
    return { rMin: 0, rMax: 1 };
  }

  const span = maxPos - minPos || maxPos || 1;
  return {
    rMin: 0,                   // 0 = không mưa
    rMax: maxPos + 0.2 * span, // mở nhẹ headroom
  };
}

/**
 * IDW cho mưa
 */
function idwRainAt(lat, lon, cells) {
  if (!cells || !cells.length) return null;

  const nearestList = [];

  for (const c of cells) {
    if (c.precip_mm == null) continue;
    const dLat = lat - c.lat;
    const dLon = lon - c.lon;
    const d2 = dLat * dLat + dLon * dLon;
    nearestList.push({ cell: c, d2 });
  }

  if (!nearestList.length) return null;

  nearestList.sort((a, b) => a.d2 - b.d2);
  const k = Math.min(RAIN_IDW_K_NEAREST, nearestList.length);

  if (nearestList[0].d2 < 1e-8) {
    return nearestList[0].cell.precip_mm;
  }

  let num = 0;
  let den = 0;
  for (let i = 0; i < k; i++) {
    const { cell, d2 } = nearestList[i];
    if (d2 <= 0) continue;
    const w = 1 / Math.pow(d2, RAIN_IDW_POWER / 2);
    num += w * cell.precip_mm;
    den += w;
  }

  if (den === 0) {
    return nearestList[0].cell.precip_mm;
  }
  return num / den;
}

/**
 * Chuẩn hóa lượng mưa về [0,1], 0 = không mưa
 */
function normalizeRain(p, rMin, rMax) {
  if (p == null || !Number.isFinite(p)) return 0;
  if (p <= 0) return 0;
  if (rMax <= rMin) return 1;

  const v = (p - rMin) / (rMax - rMin);
  const vClamped = Math.max(0, Math.min(1, v));
  const gamma = 0.9; // kéo dãn vùng mưa vừa
  return Math.pow(vClamped, gamma);
}

/**
 * Gradient lượng mưa:
 *  0      → transparent (không vẽ)
 *  0.15   → xanh nhạt
 *  0.4    → xanh dương
 *  0.7    → tím
 *  1.0    → tím đậm
 */
function rainValueToRGBA(v) {
  v = Math.max(0, Math.min(1, v));

  const stops = [
    { v: 0.0,  r: 0,   g: 0,   b: 0   }, // alpha 0
    { v: 0.15, r: 173, g: 216, b: 230 }, // light blue
    { v: 0.4,  r: 30,  g: 144, b: 255 }, // dodger blue
    { v: 0.7,  r: 123, g: 104, b: 238 }, // medium slate blue
    { v: 1.0,  r: 186, g: 85,  b: 211 }  // medium orchid
  ];

  let r, g, b;

  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i];
    const s1 = stops[i + 1];
    if (v >= s0.v && v <= s1.v) {
      const t = (v - s0.v) / (s1.v - s0.v || 1);
      r = s0.r + (s1.r - s0.r) * t;
      g = s0.g + (s1.g - s0.g) * t;
      b = s0.b + (s1.b - s0.b) * t;

      let a;
      if (v < 0.15) {
        a = 0.0;
      } else if (v < 0.4) {
        a = 0.35;
      } else if (v < 0.7) {
        a = 0.6;
      } else if (v < 0.9) {
        a = 0.8;
      } else {
        a = 0.95;
      }

      return [
        Math.round(r),
        Math.round(g),
        Math.round(b),
        Math.round(a * 255),
      ];
    }
  }

  const last = stops[stops.length - 1];
  return [last.r, last.g, last.b, Math.round(0.95 * 255)];
}

// ============================================================
// LỚP Leaflet CANVAS CHO MƯA (STATIC + RADAR DÙNG CHUNG)
// ============================================================

const RainCanvasLayer = L.Layer.extend({
  initialize: function () {
    this._map = null;
    this._canvas = null;
    this._ctx = null;
    this._cells = [];
    this._redrawRequested = false;
    this._rMin = 0;
    this._rMax = 1;
  },

  onAdd: function (map) {
    this._map = map;
    this._initCanvas();
    const pane = map.getPane("meteo") || map.getPanes().overlayPane;
    pane.appendChild(this._canvas);

    this._reset();
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
      "meteo-rain-canvas"
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

  /**
   * Set cells bên ngoài (static snapshot hoặc frame radar) rồi vẽ lại
   * cells: [{lat, lon, precip_mm}, ...]
   */
  setCells: function (cells) {
    this._cells = Array.isArray(cells) ? cells : [];
    const range = computeRainRange(this._cells);
    this._rMin = range.rMin;
    this._rMax = range.rMax;
    this._scheduleRedraw();
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
    const step = RAIN_SAMPLE_STEP_PX;

    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;

    const rMin = this._rMin;
    const rMax = this._rMax;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const latlng = this._map.containerPointToLatLng([
          x + step / 2,
          y + step / 2,
        ]);
        if (!latlng) continue;

        const lat = latlng.lat;
        const lon = latlng.lng;

        if (typeof window.isPointInsideVN === "function") {
          if (!window.isPointInsideVN(lat, lon)) continue;
        }

        const p = idwRainAt(lat, lon, cells);
        if (!p || p <= 0.01) continue;

        const v = normalizeRain(p, rMin, rMax);
        const [r, g, b, a] = rainValueToRGBA(v);

        for (let yy = y; yy < y + step && yy < h; yy++) {
          for (let xx = x; xx < x + step && xx < w; xx++) {
            const idx = (yy * w + xx) * 4;
            data[idx]     = r;
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

// ============================================================
// RADAR MƯA: FETCH FRAMES TỪ BACKEND /obs/rain_frames
// ============================================================

/**
 * Backend:
 * {
 *   "frame_count": 6,
 *   "frames": [
 *     {
 *       "valid_at": "...",
 *       "cells": [{ "lat": .., "lon": .., "precip_mm": .. }, ...]
 *     },
 *     ...
 *   ]
 * }
 */
async function fetchRainFramesFromAPI(pastHours = 3) {
  const url = `${API_BASE}/obs/rain_frames?past_hours=${pastHours}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    console.error("[rainRadar] HTTP", res.status);
    return [];
  }
  const json = await res.json();
  const frames = Array.isArray(json.frames) ? json.frames : [];
  // giữ frame có cells (kể cả precip_mm = 0)
  return frames.filter(
    (f) => Array.isArray(f.cells) && f.cells.length > 0
  );
}

function applyRainRadarFrame(index) {
  if (!rainCanvasLayer || !rainRadarState.frames.length) return;
  const frame = rainRadarState.frames[index];
  if (!frame) return;

  const cellsRaw = frame.cells || [];
  const cells = cellsRaw
    .map((c) => {
      const lat = Number(c.lat);
      const lon = Number(c.lon);
      const p = c.precip_mm != null ? Number(c.precip_mm) : 0;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon, precip_mm: p };
    })
    .filter(Boolean);

  rainCanvasLayer.setCells(cells);
}

/**
 * Bắt đầu radar mưa (animation, vòng lặp, dừng 1 nhịp ở frame cuối)
 */
async function startRainRadar(pastHours = 3) {
  if (!window.map) {
    console.error("startRainRadar: map chưa khởi tạo");
    return;
  }

  stopRainRadar(); // dừng cái cũ nếu có

  if (!rainCanvasLayer) {
    rainCanvasLayer = new RainCanvasLayer();
    rainCanvasLayer.addTo(window.map);
  }

  const frames = await fetchRainFramesFromAPI(pastHours);
  if (!frames.length) {
    console.warn("[rainRadar] Không có frame mưa nào trong past_hours");
    return;
  }

  rainRadarState.frames = frames;
  rainRadarState.index = 0;
  rainRadarState.stopFlag = false;

  applyRainRadarFrame(rainRadarState.index);

  const speed = 800;  // ms / frame
  const pauseLast = 2000; // nghỉ ở frame cuối

  async function loop() {
    const n = rainRadarState.frames.length;
    if (!n) return;

    while (!rainRadarState.stopFlag) {
      for (let i = 0; i < n; i++) {
        if (rainRadarState.stopFlag) return;
        rainRadarState.index = i;
        applyRainRadarFrame(i);
        await new Promise((res) => setTimeout(res, speed));
      }

      // pause ở frame cuối
      if (rainRadarState.stopFlag) return;
      await new Promise((res) => setTimeout(res, pauseLast));
    }
  }

  loop();
}

/**
 * Dừng radar mưa (animation), giữ canvas nhưng không play nữa
 */
function stopRainRadar() {
  rainRadarState.stopFlag = true;
  rainRadarState.frames = [];
  rainRadarState.index = 0;
}

// ============================================================
// STATIC MƯA HIỆN TẠI (IDW từ /obs/latest grid)
// ============================================================

async function showRainLayer() {
  if (!window.map) {
    console.error("showRainLayer: map chưa khởi tạo");
    return;
  }

  // tắt radar nếu đang chạy, chuyển về static snapshot
  stopRainRadar();

  if (!rainCanvasLayer) {
    rainCanvasLayer = new RainCanvasLayer();
    rainCanvasLayer.addTo(window.map);
  }

  try {
    const state = await window.fetchLatestTempGrid(false);
    let cells = state.cells || [];

    if (typeof window.filterCellsInsideVN === "function") {
      cells = window.filterCellsInsideVN(cells);
    }

    const rainCells = cells
      .map((c) => ({
        lat: c.lat,
        lon: c.lon,
        precip_mm:
          c.precip_mm != null ? Number(c.precip_mm) : 0,
      }))
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));

    rainCanvasLayer.setCells(rainCells);
  } catch (err) {
    console.error("showRainLayer: fetchLatestTempGrid error", err);
    if (rainCanvasLayer) {
      rainCanvasLayer.setCells([]);
    }
  }
}

function hideRainLayer() {
  stopRainRadar();
  if (!window.map) return;
  if (rainCanvasLayer) {
    window.map.removeLayer(rainCanvasLayer);
    rainCanvasLayer = null;
  }
}

// ============================================================
// EXPORT GLOBAL – khớp với main.js mới
// ============================================================

window.showRainLayer = showRainLayer;
window.hideRainLayer = hideRainLayer;
window.startRainRadar = startRainRadar;
window.stopRainRadar = stopRainRadar;

// Optional wrapper cho main.js cũ (nếu có dùng)
window.showRainRadar = () => startRainRadar(3);
window.hideRainRadar = stopRainRadar;
