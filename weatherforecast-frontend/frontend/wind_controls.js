// wind_controls.js
// API global cho nút bật/tắt lớp gió

function showWindLayer() {
  if (!window.map) {
    console.error("showWindLayer: map chưa khởi tạo");
    return;
  }

  // nền màu
  if (windCanvasLayer) {
    window.map.removeLayer(windCanvasLayer);
    windCanvasLayer = null;
  }
  windCanvasLayer = new WindCanvasLayer();
  windCanvasLayer.addTo(window.map);

  // hạt gió
  if (windParticleLayer) {
    window.map.removeLayer(windParticleLayer);
    windParticleLayer = null;
  }
  windParticleLayer = new WindParticleLayer();
  windParticleLayer.addTo(window.map);
}

function hideWindLayer() {
  if (!window.map) return;

  if (windCanvasLayer) {
    window.map.removeLayer(windCanvasLayer);
    windCanvasLayer = null;
  }
  if (windParticleLayer) {
    window.map.removeLayer(windParticleLayer);
    windParticleLayer = null;
  }
  currentWindField = null;
  window.currentWindField = null;
}

window.showWindLayer = showWindLayer;
window.hideWindLayer = hideWindLayer;