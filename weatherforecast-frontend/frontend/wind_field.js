// wind_field.js
// Xử lý dữ liệu, trường gió, màu gió

// ===================== Helper toán học / dữ liệu =====================

function dist2DegWind(lat1, lon1, lat2, lon2) {
  const dLat = lat1 - lat2;
  const dLon = lon1 - lon2;
  return dLat * dLat + dLon * dLon;
}

/**
 * Chuẩn hóa dữ liệu gió từ cells:
 *  - lọc cell có wind_ms & wind_dir_deg hợp lệ
 *  - nếu có mask VN thì lọc trong VN
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
 * Xây trường gió đều trên bbox VN bằng IDW + nội suy bilinear.
 * Trả về object có hàm sample(lat, lon) -> {u,v,s}
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

  // Mở biên một chút cho nền phủ kín
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
