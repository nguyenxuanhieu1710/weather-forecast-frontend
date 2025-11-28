// data.js
// Xử lý dữ liệu nhiệt độ, scale, clamp, thống kê

/**
 * Tính min/max nhiệt độ từ list cell (nếu muốn autoscale)
 * @param {Array<{temp_c:number}>} cells
 */
function computeTempRange(cells) {
  if (!cells || !cells.length) return { min: 0, max: 1 };

  let mn = Infinity;
  let mx = -Infinity;

  for (const c of cells) {
    if (typeof c.temp_c !== "number") continue;
    if (c.temp_c < mn) mn = c.temp_c;
    if (c.temp_c > mx) mx = c.temp_c;
  }

  if (!Number.isFinite(mn) || !Number.isFinite(mx)) {
    return { min: 0, max: 1 };
  }

  return { min: mn, max: mx };
}

/**
 * Chuẩn hóa nhiệt độ về [0..1] theo range cố định trong config.js
 * TEMP_MIN_C / TEMP_MAX_C được khai báo global từ config.js
 *
 * @param {number} tC
 */
function normalizeTempFixed(tC) {
  if (!Number.isFinite(tC)) return 0;
  const lo = window.TEMP_MIN_C;
  const hi = window.TEMP_MAX_C;
  if (hi <= lo) return 0;

  const v = (tC - lo) / (hi - lo);
  return Math.max(0, Math.min(1, v));
}

/**
 * Chuẩn hóa theo min/max động của snapshot (không dùng cho heatmap chính)
 *
 * @param {number} tC
 * @param {number} tMin
 * @param {number} tMax
 */
function normalizeTempDynamic(tC, tMin, tMax) {
  if (!Number.isFinite(tC)) return 0;
  if (tMax <= tMin) return 0;

  let v = (tC - tMin) / (tMax - tMin);
  return Math.max(0, Math.min(1, v));
}

/**
 * Lọc cell active: cell.is_active !== false
 * @param {Array} cells
 */
function filterActiveCells(cells) {
  if (!Array.isArray(cells)) return [];
  return cells.filter((c) => c && c.temp_c != null && c.is_active !== false);
}

/**
 * Lọc cell theo vùng VN (mask polygon hoặc bbox)
 * depend: isPointInsideVN(lat,lon) từ layers.js
 *
 * @param {Array<{lat:number,lon:number,temp_c:number}>} cells
 */
function filterCellsInsideVN(cells) {
  if (!Array.isArray(cells)) return [];
  if (typeof window.isPointInsideVN !== "function") return cells;

  return cells.filter((c) => {
    return window.isPointInsideVN(c.lat, c.lon);
  });
}

// Export global
window.computeTempRange = computeTempRange;
window.normalizeTempFixed = normalizeTempFixed;
window.normalizeTempDynamic = normalizeTempDynamic;
window.filterActiveCells = filterActiveCells;
window.filterCellsInsideVN = filterCellsInsideVN;