// wind_canvas_layer.js
// Lớp nền màu gió (canvas)

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