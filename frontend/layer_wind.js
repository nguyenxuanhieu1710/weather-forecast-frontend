// ===================== layer_wind.js =====================
// Hiển thị gió kiểu Windy: nền màu liên tục + hạt chuyển động theo hướng gió
// YÊU CẦU CÓ SẴN: map, getLatestObs(), setLegend(), WIND_STOPS, WIND_COLORS

// ===================== Config =====================

// độ phân giải lưới nội suy (độ). Nhỏ hơn = mịn hơn nhưng nặng hơn
const WIND_GRID_DLAT = 0.3;
const WIND_GRID_DLON = 0.3;

// số điểm lân cận dùng cho nội suy IDW
const WIND_IDW_K = 6;
const WIND_IDW_P = 2;

// số hạt, tốc độ hạt
const WIND_PARTICLE_COUNT = 1500;
const WIND_PARTICLE_MAX_AGE = 120; // frame
const WIND_PARTICLE_SPEED_SCALE = 0.010; // điều chỉnh độ dài đường hạt

// ===================== Biến trạng thái =====================

let windGridLayer = null;      // lớp nền màu (GridLayer canvas)
let windParticleLayer = null;  // lớp hạt chuyển động (canvas overlay)
let windField = null;          // trường gió nội suy sẵn (grid u,v,speed)
let windLoading = false;
let windReqId = 0;

// ===================== Helpers nội suy =====================

/**
 * Từ danh sách điểm (obs) tạo trường gió dạng lưới đều để sample rất nhanh.
 * points: [{lat, lon, wind_speed_ms, wind_dir_deg}, ...]
 */
function buildWindField(points) {
  if (!points || !points.length) return null;

  // Tính bbox
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const p of points) {
    if (typeof p.lat !== "number" || typeof p.lon !== "number") continue;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  // tăng nhẹ biên cho đẹp
  minLat -= 0.5;
  maxLat += 0.5;
  minLon -= 0.5;
  maxLon += 0.5;

  const nLat = Math.max(2, Math.round((maxLat - minLat) / WIND_GRID_DLAT) + 1);
  const nLon = Math.max(2, Math.round((maxLon - minLon) / WIND_GRID_DLON) + 1);

  const u = new Array(nLat);
  const v = new Array(nLat);
  const s = new Array(nLat);
  for (let i = 0; i < nLat; i++) {
    u[i] = new Float32Array(nLon);
    v[i] = new Float32Array(nLon);
    s[i] = new Float32Array(nLon);
  }

  // Chuẩn bị vector gió của các trạm
  const src = [];
  for (const p of points) {
    if (
      typeof p.lat !== "number" ||
      typeof p.lon !== "number" ||
      typeof p.wind_speed_ms !== "number" ||
      typeof p.wind_dir_deg !== "number"
    ) {
      continue;
    }
    // dir_deg: hướng gió thổi TỪ đâu tới đâu (meteo). Ta cần vector TO.
    const rad = (p.wind_dir_deg * Math.PI) / 180;
    const uu = p.wind_speed_ms * Math.sin(rad); // kinh tuyến đông dương
    const vv = p.wind_speed_ms * Math.cos(rad); // vĩ tuyến bắc dương
    src.push({ lat: p.lat, lon: p.lon, u: uu, v: vv, s: p.wind_speed_ms });
  }
  if (!src.length) return null;

  // Hàm tìm k lân cận cho một điểm (lat,lon)
  function kNearest(lat, lon) {
    const arr = [];
    for (const p of src) {
      const dLat = lat - p.lat;
      const dLon = lon - p.lon;
      const d2 = dLat * dLat + dLon * dLon;
      arr.push({ p, d2 });
    }
    arr.sort((a, b) => a.d2 - b.d2);
    return arr.slice(0, Math.min(WIND_IDW_K, arr.length));
  }

  // Nội suy IDW trên toàn lưới
  for (let iy = 0; iy < nLat; iy++) {
    const lat = minLat + (iy / (nLat - 1)) * (maxLat - minLat);
    for (let ix = 0; ix < nLon; ix++) {
      const lon = minLon + (ix / (nLon - 1)) * (maxLon - minLon);
      const neighbors = kNearest(lat, lon);

      let ww = 0,
        sumU = 0,
        sumV = 0,
        sumS = 0;

      for (const { p, d2 } of neighbors) {
        let w;
        if (d2 === 0) {
          w = 1e6;
        } else {
          w = 1 / Math.pow(d2, WIND_IDW_P / 2);
        }
        ww += w;
        sumU += p.u * w;
        sumV += p.v * w;
        sumS += p.s * w;
      }

      if (ww === 0) {
        u[iy][ix] = 0;
        v[iy][ix] = 0;
        s[iy][ix] = 0;
      } else {
        u[iy][ix] = sumU / ww;
        v[iy][ix] = sumV / ww;
        s[iy][ix] = sumS / ww;
      }
    }
  }

  // Hàm sample bilinear trên lưới
  function sample(lat, lon) {
    if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) {
      return { u: 0, v: 0, s: 0 };
    }
    const ty = (lat - minLat) / (maxLat - minLat);
    const tx = (lon - minLon) / (maxLon - minLon);

    const y = ty * (nLat - 1);
    const x = tx * (nLon - 1);

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, nLon - 1);
    const y1 = Math.min(y0 + 1, nLat - 1);

    const fx = x - x0;
    const fy = y - y0;

    function bilinear(arr) {
      const v00 = arr[y0][x0];
      const v10 = arr[y0][x1];
      const v01 = arr[y1][x0];
      const v11 = arr[y1][x1];
      const a = v00 * (1 - fx) + v10 * fx;
      const b = v01 * (1 - fx) + v11 * fx;
      return a * (1 - fy) + b * fy;
    }

    const uu = bilinear(u);
    const vv = bilinear(v);
    const ss = bilinear(s);
    return { u: uu, v: vv, s: ss };
  }

  // Range speed để scale legend / màu
  let minS = Infinity;
  let maxS = -Infinity;
  for (let iy = 0; iy < nLat; iy++) {
    for (let ix = 0; ix < nLon; ix++) {
      const sv = s[iy][ix];
      if (sv < minS) minS = sv;
      if (sv > maxS) maxS = sv;
    }
  }
  if (!Number.isFinite(minS) || !Number.isFinite(maxS)) {
    minS = 0;
    maxS = 1;
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

// Map [minS,maxS] -> [0,1]
function normWindSpeed(field, speed) {
  const min = field.minS;
  const max = field.maxS;
  if (max <= min) return 0;
  let t = (speed - min) / (max - min);
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return t;
}

// Lấy màu theo stops + colors (linear)
function getWindColor(field, speed) {
  const t = normWindSpeed(field, speed);
  // WIND_STOPS: [0..1] hoặc giá trị (min..max) – xử lý cả hai
  const stops = WIND_STOPS;
  const colors = WIND_COLORS;

  if (!stops || !colors || stops.length !== colors.length) return "#000000";

  let tt = t;
  // Nếu stops không trong [0..1] thì convert
  const minStop = stops[0];
  const maxStop = stops[stops.length - 1];
  if (!(minStop === 0 && maxStop === 1)) {
    if (maxStop === minStop) {
      tt = 0;
    } else {
      tt = (speed - minStop) / (maxStop - minStop);
      if (tt < 0) tt = 0;
      if (tt > 1) tt = 1;
    }
  }

  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i];
    const s1 = stops[i + 1];
    let t0 = s0;
    let t1 = s1;
    if (!(minStop === 0 && maxStop === 1)) {
      t0 = (s0 - minStop) / (maxStop - minStop);
      t1 = (s1 - minStop) / (maxStop - minStop);
    }
    if (tt >= t0 && tt <= t1) {
      const f = t1 === t0 ? 0 : (tt - t0) / (t1 - t0);
      return mixColor(colors[i], colors[i + 1], f);
    }
  }
  return colors[colors.length - 1];
}

// trộn 2 màu hex
function mixColor(c1, c2, f) {
  function h2i(h, i) {
    return parseInt(h.substr(i, 2), 16);
  }
  const r = Math.round(h2i(c1, 1) * (1 - f) + h2i(c2, 1) * f);
  const g = Math.round(h2i(c1, 3) * (1 - f) + h2i(c2, 3) * f);
  const b = Math.round(h2i(c1, 5) * (1 - f) + h2i(c2, 5) * f);
  return (
    "#" +
    ("0" + r.toString(16)).slice(-2) +
    ("0" + g.toString(16)).slice(-2) +
    ("0" + b.toString(16)).slice(-2)
  );
}

// ===================== Lớp nền màu gió (GridLayer) =====================

const WindSpeedLayer = L.GridLayer.extend({
  createTile: function (coords, done) {
    const tileSize = this.getTileSize();
    const canvas = L.DomUtil.create("canvas");
    canvas.width = tileSize.x;
    canvas.height = tileSize.y;
    const ctx = canvas.getContext("2d");

    if (!windField) {
      done(null, canvas);
      return canvas;
    }

    const imgData = ctx.createImageData(tileSize.x, tileSize.y);
    const data = imgData.data;

    const bounds = this._tileCoordsToBounds(coords);
    const west = bounds.getWest();
    const east = bounds.getEast();
    const north =
