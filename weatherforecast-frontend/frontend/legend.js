// legend.js
// Vẽ thanh màu nhiệt độ và hiển thị range TEMP_MIN_C → TEMP_MAX_C

function initLegend() {
  const wrap = document.getElementById("legend-wrap");
  if (!wrap) return;

  const canvas = document.getElementById("legend-canvas");
  if (!canvas) return;

  // Vẽ gradient (từ colors.js)
  window.drawHeatLegend(canvas);

  // Update label min/max
  const lbMin = document.getElementById("legend-min");
  const lbMax = document.getElementById("legend-max");

  if (lbMin) lbMin.textContent = `${window.TEMP_MIN_C}°C`;
  if (lbMax) lbMax.textContent = `${window.TEMP_MAX_C}°C`;
}

window.initLegend = initLegend;