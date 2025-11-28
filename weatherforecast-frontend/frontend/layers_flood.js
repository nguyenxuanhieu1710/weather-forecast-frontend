// layers_flood.js
// Heatmap nguy cơ lũ lụt từ API /obs/flood_risk_latest

(function (w) {
  if (!w.L) {
    console.warn("Leaflet chưa sẵn sàng, layers_flood.js bỏ qua");
    return;
  }

  // Khớp backend của bạn
  const FLOOD_API_URL = `${w.API_BASE || ""}/obs/flood_risk_latest`;

  let floodLayer = null;
  let floodCache = null;
  let floodValidAt = null;

  function clamp01(x) {
    if (!Number.isFinite(x)) return 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  // Chuyển risk_level text → số nếu cần
  function levelToScore(level) {
    if (!level || typeof level !== "string") return null;
    const key = level.toUpperCase();
    switch (key) {
      case "LOW":
        return 2;     // nhẹ
      case "MODERATE":
        return 3;     // vừa
      case "HIGH":
        return 4;     // cao
      case "EXTREME":
      case "VERY_HIGH":
        return 5;     // rất cao
      default:
        return null;
    }
  }

  // Chuẩn hóa risk_score (1–5) hoặc từ risk_level → [0,1]
  function normalizeFloodValue(row) {
    let score = null;

    if (row.risk_score != null && Number.isFinite(row.risk_score)) {
      score = row.risk_score;
    } else {
      const fromLevel = levelToScore(row.risk_level);
      if (fromLevel != null) score = fromLevel;
    }

    if (score == null) return 0;

    // giả sử thang điểm tối đa 5
    const v = score / 5;
    return clamp01(v);
  }

  async function fetchFloodLatest() {
    try {
      const res = await fetch(FLOOD_API_URL);
      if (!res.ok) throw new Error("FLOOD API error");

      const js = await res.json();
      const arr = Array.isArray(js.data) ? js.data : [];
      const first = arr[0];

      floodCache = arr;
      floodValidAt = first && first.valid_at ? first.valid_at : null;

      w._FLOOD_RAW = js; // debug
      return arr;
    } catch (err) {
      console.error("[FLOOD] fetchFloodLatest failed", err);
      return null;
    }
  }

  function buildHeatPoints(arr) {
    if (!Array.isArray(arr)) return [];

    const pts = [];

    for (const row of arr) {
      const lat = row.lat;
      const lon = row.lon;

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const v = normalizeFloodValue(row);
      if (v <= 0) continue;

      // L.heatLayer dùng [lat, lon, intensity]
      pts.push([lat, lon, v]);
    }

    return pts;
  }

  async function ensureFloodLayer() {
    if (!w.map) {
      console.warn("[FLOOD] map chưa sẵn sàng");
      return null;
    }

    if (!floodCache) {
      const arr = await fetchFloodLatest();
      if (!arr) return null;
    }

    const pts = buildHeatPoints(floodCache);
    if (!pts.length) {
      console.warn("[FLOOD] không có điểm flood hợp lệ");
      return null;
    }

    if (floodLayer) {
      floodLayer.setLatLngs(pts);
      return floodLayer;
    }

    floodLayer = L.heatLayer(pts, {
      radius: 22,
      blur: 16,
      maxZoom: 10
    });

    return floodLayer;
  }

  async function showFloodLayer() {
    try {
      const layer = await ensureFloodLayer();
      if (!layer || !w.map) return;

      if (!w.map.hasLayer(layer)) {
        layer.addTo(w.map);
      }

      // nếu muốn hiển thị time ở đâu đó, dùng floodValidAt
      // ví dụ: cập nhật một thẻ nhỏ dưới map
      if (floodValidAt && w.document) {
        const el = document.getElementById("fb-now-summary");
        if (el && !el.dataset._floodTouched) {
          el.dataset._floodTouched = "1";
          el.textContent = `Nguy cơ lũ lụt (thời điểm: ${floodValidAt})`;
        }
      }
    } catch (err) {
      console.error("[FLOOD] showFloodLayer error", err);
    }
  }

  function hideFloodLayer() {
    if (floodLayer && w.map && w.map.hasLayer(floodLayer)) {
      w.map.removeLayer(floodLayer);
    }
  }

  function updateFloodForTime(_isoTime) {
    // hiện tại chỉ dùng snapshot mới nhất
  }

  w.showFloodLayer = showFloodLayer;
  w.hideFloodLayer = hideFloodLayer;
  w.updateFloodForTime = updateFloodForTime;
})(window);
