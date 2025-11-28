// layers_rain_radar.js
// Radar mưa 3 giờ gần nhất (rain_frames) – animation HeatLayer đơn giản

let rainRadarFrames = [];
let rainRadarLayers = [];
let rainRadarIndex  = 0;
let rainRadarTimer  = null;
let rainRadarActive = false;

const RAIN_RADAR_INTERVAL_MS = 600; // tốc độ chuyển frame

async function fetchRainFrames() {
  const url = `${API_BASE}/obs/rain_frames?past_hours=3`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error("fetchRainFrames failed", res.status);
    return [];
  }

  const js = await res.json();
  const frames = Array.isArray(js.frames) ? js.frames : [];

  // Chuẩn hóa về dạng: [{valid_at, layerPoints: [[lat,lon,intensity], ...]}]
  return frames.map((f) => {
    const pts = Array.isArray(f.points) ? f.points : [];
    const layerPoints = pts
      .filter((p) => typeof p.lat === "number" && typeof p.lon === "number")
      .map((p) => {
        const mm = typeof p.precip_mm === "number" ? p.precip_mm : 0;
        const cap = 20;
        const intensity = Math.min(mm / cap, 1);
        return [p.lat, p.lon, intensity];
      });

    return {
      valid_at: f.valid_at || null,
      layerPoints,
    };
  });
}

function clearRainRadarLayers() {
  if (!window.map) return;
  rainRadarLayers.forEach((lyr) => {
    try {
      window.map.removeLayer(lyr);
    } catch (_) {}
  });
  rainRadarLayers = [];
}

function buildRainRadarLayers() {
  if (!window.map) return;
  clearRainRadarLayers();

  rainRadarLayers = rainRadarFrames.map((frame) =>
    L.heatLayer(frame.layerPoints, {
      radius: 22,
      blur: 16,
      maxZoom: 8,
      minOpacity: 0.3,
    })
  );
}

function showRainRadarFrame(idx) {
  if (!window.map || !rainRadarLayers.length) return;

  rainRadarLayers.forEach((lyr, i) => {
    if (window.map.hasLayer(lyr)) {
      window.map.removeLayer(lyr);
    }
  });

  const layer = rainRadarLayers[idx];
  if (layer) {
    layer.addTo(window.map);
  }
}

function startRainRadarAnimation() {
  if (!rainRadarLayers.length) return;
  if (rainRadarTimer) {
    clearInterval(rainRadarTimer);
    rainRadarTimer = null;
  }

  rainRadarIndex = 0;
  showRainRadarFrame(rainRadarIndex);

  rainRadarTimer = setInterval(() => {
    if (!rainRadarActive || !rainRadarLayers.length) return;
    rainRadarIndex = (rainRadarIndex + 1) % rainRadarLayers.length;
    showRainRadarFrame(rainRadarIndex);
  }, RAIN_RADAR_INTERVAL_MS);
}

async function showRainRadar() {
  if (!window.map) {
    console.error("showRainRadar: map chưa khởi tạo");
    return;
  }

  rainRadarActive = true;

  if (!rainRadarFrames.length) {
    try {
      rainRadarFrames = await fetchRainFrames();
    } catch (err) {
      console.error("showRainRadar fetch error", err);
      rainRadarFrames = [];
    }
  }

  if (!rainRadarFrames.length) {
    console.warn("Không có dữ liệu rain_frames để vẽ radar");
    return;
  }

  buildRainRadarLayers();
  startRainRadarAnimation();
}

function hideRainRadar() {
  rainRadarActive = false;

  if (rainRadarTimer) {
    clearInterval(rainRadarTimer);
    rainRadarTimer = null;
  }
  clearRainRadarLayers();
}

window.showRainRadar = showRainRadar;
window.hideRainRadar = hideRainRadar;
