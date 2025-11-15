// layers.js
// Heatmap NHIỆT ĐỘ bằng canvas + IDW, KHÔNG tự bật khi load

const TEMP_SAMPLE_STEP_PX = 6;
const IDW_POWER = 2.0;
const IDW_K_NEAREST = 8;

let tempCanvasLayer = null;

// ---------- Trợ giúp hình học / VN mask ----------

function dist2Deg(lat1, lon1, lat2, lon2) {
  const dLat = lat1 - lat2;
  const dLon = lon1 - lon2;
  return dLat * dLat + dLon * dLon;
}

function bboxOfGeometry(geom) {
  let minLat = Infinity,
      minLon = Infinity,
      maxLat = -Infinity,
      maxLon = -Infinity;

  function scanCoords(coords) {
    for (const c of coords) {
      if (Array.isArray(c[0])) {
        scanCoords(c);
      } else {
        const lon = c[0];
        const lat = c[1];

        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }
    }
  }

  scanCoords(geom.coordinates);
  return { minLat, maxLat, minLon, maxLon };
}


let VN_BBOX = null;

function pointInPolygonSimple(lat, lon, geom) {
  if (!geom || !geom.type) return true;
  const pt = [lon, lat];

  function pnpoly(coords, pt) {
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const xi = coords[i][0],
        yi = coords[i][1];
      const xj = coords[j][0],
        yj = coords[j][1];

      const intersect =
        yi > pt[1] !== yj > pt[1] &&
        pt[0] <
          ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-12) +
            xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  if (geom.type === "Polygon") {
    const rings = geom.coordinates;
    if (!pnpoly(rings[0], pt)) return false;
    for (let i = 1; i < rings.length; i++) {
      if (pnpoly(rings[i], pt)) return false;
    }
    return true;
  }

  if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) {
      const outer = poly[0];
      if (!outer) continue;
      if (pnpoly(outer, pt)) return true;
    }
    return false;
  }

  return true;
}

window.isPointInsideVN = function (lat, lon) {
  const geom = window.VN_GEOMETRY;
  if (!geom) return true;

  if (!VN_BBOX) VN_BBOX = bboxOfGeometry(geom);
  if (
    lat < VN_BBOX.minLat - 0.5 ||
    lat > VN_BBOX.maxLat + 0.5 ||
    lon < VN_BBOX.minLon - 0.5 ||
    lon > VN_BBOX.maxLon + 0.5
  ) {
    return false;
  }

  return pointInPolygonSimple(lat, lon, geom);
};

// ---------- IDW cho NHIỆT ĐỘ ----------

function idwTempAt(lat, lon, cells) {
  if (!cells || !cells.length) return null;

  const k = Math.min(IDW_K_NEAREST, cells.length);
  const nearestList = [];

  for (const c of cells) {
    if (c.temp_c == null) continue;
    const d2 = dist2Deg(lat, lon, c.lat, c.lon);
    nearestList.push({ cell: c, d2 });
  }

  if (!nearestList.length) return null;

  nearestList.sort((a, b) => a.d2 - b.d2);

  if (nearestList[0].d2 < 1e-8) {
    return nearestList[0].cell.temp_c;
  }

  let num = 0;
  let den = 0;
  for (let i = 0; i < Math.min(k, nearestList.length); i++) {
    const { cell, d2 } = nearestList[i];
    if (d2 <= 0) continue;
    const w = 1 / Math.pow(d2, IDW_POWER / 2);
    num += w * cell.temp_c;
    den += w;
  }

  if (den === 0) {
    return nearestList[0].cell.temp_c;
  }
  return num / den;
}

// công khai để popup có thể dùng chung nếu muốn
window.idwTempAtForPopup = idwTempAt;

// ---------- Màu nhiệt độ ----------

function tempValueToRGBA(v) {
  v = Math.max(0, Math.min(1, v));

  // xanh dương → cyan → vàng → cam → đỏ
  const stops = [
    { v: 0.0, r: 0, g: 32, b: 255 },
    { v: 0.25, r: 0, g: 180, b: 255 },
    { v: 0.5, r: 255, g: 255, b: 160 },
    { v: 0.75, r: 255, g: 160, b: 0 },
    { v: 1.0, r: 220, g: 0, b: 0 }
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

      // alpha: lạnh rất trong, nóng đậm
      let a;
      if (v < 0.4) {
        a = 0.45;
      } else if (v < 0.7) {
        a = 0.65;
      } else if (v < 0.9) {
        a = 0.85;
      } else {
        a = 0.95;
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

// ---------- Lớp Leaflet canvas cho NHIỆT ĐỘ ----------

const TempCanvasLayer = L.Layer.extend({
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
      "meteo-temp-canvas"
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
      const state = await window.fetchLatestTempGrid(false);
      let cells = state.cells || [];

      // dùng helper từ data.js nếu có
      if (window.filterActiveCells) {
        cells = window.filterActiveCells(cells);
      }
      if (window.filterCellsInsideVN) {
        cells = window.filterCellsInsideVN(cells);
      }

      this._cells = cells;
      this._scheduleRedraw();
      window.setObsTimeLabel?.(state.obsTime || null);
      window.showSnapshotStatus?.("ok");
    } catch (err) {
      console.error("TempCanvasLayer fetch error", err);
      this._cells = [];
      this._scheduleRedraw();
      window.showSnapshotStatus?.("error");
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
    const step = TEMP_SAMPLE_STEP_PX;

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

        if (!window.isPointInsideVN(lat, lon)) continue;

        const t = idwTempAt(lat, lon, cells);
        if (t == null || !Number.isFinite(t)) continue;

        const v = window.normalizeTempFixed
          ? window.normalizeTempFixed(t)
          : 0;
        const [r, g, b, a] = tempValueToRGBA(v);

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

// ---------- API global cho main.js / nút UI ----------

window.showTempLayer = function () {
  if (!window.map) return;
  if (tempCanvasLayer) {
    window.map.removeLayer(tempCanvasLayer);
    tempCanvasLayer = null;
  }
  tempCanvasLayer = new TempCanvasLayer();
  tempCanvasLayer.addTo(window.map);
};

window.hideTempLayer = function () {
  if (!window.map) return;
  if (tempCanvasLayer) {
    window.map.removeLayer(tempCanvasLayer);
    tempCanvasLayer = null;
  }
};
