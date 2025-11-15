// ===================== Color helpers =====================

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
  const a = hexToRgb(c1);
  const b = hexToRgb(c2);
  const r = Math.round(lerp(a.r, b.r, t));
  const g = Math.round(lerp(a.g, b.g, t));
  const bb = Math.round(lerp(a.b, b.b, t));
  return `rgb(${r},${g},${bb})`;
}

function makeStopColorScale(stops, colors) {
  return function (v) {
    if (!Number.isFinite(v)) return "rgba(0,0,0,0)";
    if (v <= stops[0]) return colors[0];
    const last = stops.length - 1;
    if (v >= stops[last]) return colors[last];

    for (let i = 0; i < last; i++) {
      const s0 = stops[i];
      const s1 = stops[i + 1];
      if (v >= s0 && v <= s1) {
        const t = (v - s0) / (s1 - s0 || 1e-9);
        return lerpColor(colors[i], colors[i + 1], t);
      }
    }
    return colors[last];
  };
}

// ===================== Color scales =====================

const TEMP_STOPS = [-5, 0, 10, 20, 25, 30, 35, 40];
const TEMP_COLORS = [
  "#2c7fb8",
  "#7fcdbb",
  "#edf8b1",
  "#fed976",
  "#fd8d3c",
  "#f03b20",
  "#bd0026",
  "#800026"
];
const tempColorScale = makeStopColorScale(TEMP_STOPS, TEMP_COLORS);

const RAIN_STOPS = [0, 2, 5, 10, 20, 30, 50];
const RAIN_COLORS = [
  "#e6f4ff",
  "#b3dcff",
  "#7fbfff",
  "#5f8bff",
  "#3b5bff",
  "#7a3cff",
  "#b400ff"
];
const rainColorScale = makeStopColorScale(RAIN_STOPS, RAIN_COLORS);

const WIND_STOPS = [0, 3, 6, 10, 15, 25, 40];
const WIND_COLORS = [
  "#eff3ff",
  "#c6dbef",
  "#9ecae1",
  "#6baed6",
  "#3182bd",
  "#08519c",
  "#08306b"
];
const windColorScale = makeStopColorScale(WIND_STOPS, WIND_COLORS);
