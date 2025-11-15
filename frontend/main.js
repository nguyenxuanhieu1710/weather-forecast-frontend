// main.js
// KHÔNG bật heatmap nào mặc định, chỉ bật khi click nút bên trái

function setupLayerButtons() {
  const btnTemp = document.getElementById("btn-layer-temp");
  const btnRain = document.getElementById("btn-layer-rain");
  const btnWind = document.getElementById("btn-layer-wind");
  const btnLocate = document.getElementById("btn-my-location");

  function setActive(mode) {
    if (btnTemp) btnTemp.classList.toggle("active", mode === "temp");
    if (btnRain) btnRain.classList.toggle("active", mode === "rain");
    if (btnWind) btnWind.classList.toggle("active", mode === "wind");
  }

  // NHIỆT ĐỘ
  if (btnTemp) {
    btnTemp.addEventListener("click", () => {
      if (typeof window.hideRainLayer === "function") window.hideRainLayer();
      if (typeof window.showTempLayer === "function") window.showTempLayer();
      setActive("temp");
    });
  }

  // MƯA
  if (btnRain) {
    btnRain.addEventListener("click", () => {
      if (typeof window.hideTempLayer === "function") window.hideTempLayer();
      if (typeof window.showRainLayer === "function") window.showRainLayer();
      setActive("rain");
    });
  }

  // Gió (placeholder)
  if (btnWind) {
    btnWind.addEventListener("click", () => {
      if (typeof window.hideTempLayer === "function") window.hideTempLayer();
      if (typeof window.hideRainLayer === "function") window.hideRainLayer();
      setActive("wind");
      // window.showWindLayer && window.showWindLayer();
    });
  }

  // Vị trí hiện tại (tự xử lý sau)
  if (btnLocate) {
    btnLocate.addEventListener("click", () => {
      // TODO: locate nếu cần
    });
  }

  // KHÔNG set active gì lúc đầu → map trống, chỉ nền OSM
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof window.initMap === "function") {
    window.initMap();
  }
  setupLayerButtons();
});
