// colors.js
// Mapping v -> màu heatmap, palette, alpha

const HEAT_ALPHA_MIN = 0.0;
const HEAT_ALPHA_MAX = 0.9;

/**
 * Map v in [0..1] -> RGB (xanh → vàng → đỏ)
 * @param {number} v
 * @returns {{r:number,g:number,b:number,a:number}}
 */
function heatColor(v) {
  v = Math.max(0, Math.min(1, v));

  let r, g, b;

  if (v < 0.5) {
    // 0 -> xanh / 0.5 -> vàng
    const t = v / 0.5;
    r = 255 * t;
    g = 255;
    b = 255 * (1 - t);
  } else {
    // 0.5 -> vàng / 1 -> đỏ
    const t = (v - 0.5) / 0.5;
    r = 255;
    g = 255 * (1 - t);
    b = 0;
  }

  const a = HEAT_ALPHA_MIN + (HEAT_ALPHA_MAX - HEAT_ALPHA_MIN) * v;

  return {
    r: Math.round(r),
    g: Math.round(g),
    b: Math.round(b),
    a: Math.round(a * 255)
  };
}

/**
 * Map nhiệt độ (°C) -> RGBA
 * theo scale cố định từ config.js
 *
 * @param {number} tC
 */
function tempToRGBA(tC) {
  const v = window.normalizeTempFixed(tC);
  return heatColor(v);
}

/**
 * Tạo gradient bar (legend) dạng canvas linear
 *
 * @param {HTMLCanvasElement} canvas
 */
function drawHeatLegend(canvas) {
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  const img = ctx.createImageData(w, h);
  const data = img.data;

  for (let x = 0; x < w; x++) {
    const v = x / (w - 1);
    const { r, g, b, a } = heatColor(v);
    for (let y = 0; y < h; y++) {
      const idx = (y * w + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }

  ctx.putImageData(img, 0, 0);
}

window.heatColor = heatColor;
window.tempToRGBA = tempToRGBA;
window.drawHeatLegend = drawHeatLegend;
