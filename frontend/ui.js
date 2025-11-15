// ui.js
// Chứa các hàm giao diện độc lập: toggle panel, hiển thị trạng thái dữ liệu, v.v.

function showLoading(flag) {
  const el = document.getElementById("loading");
  if (!el) return;
  el.style.display = flag ? "flex" : "none";
}

function setObsTimeLabel(t) {
  const el = document.getElementById("info-obs-time");
  if (!el) return;
  if (!t) {
    el.textContent = "";
    return;
  }
  el.textContent = "Quan trắc: " + t;
}

/**
 * Hiển thị trạng thái snapshot nhiệt độ:
 * - đang fetch
 * - lỗi
 * - thành công
 */
function showSnapshotStatus(type) {
  const el = document.getElementById("snapshot-status");
  if (!el) return;

  switch (type) {
    case "loading":
      el.textContent = "Đang tải dữ liệu...";
      break;
    case "error":
      el.textContent = "Lỗi dữ liệu";
      break;
    case "ok":
      el.textContent = "";
      break;
    default:
      el.textContent = "";
  }
}

function updateWeatherDetail(clickLat, clickLon, nearestResult, cell) {
  const panel = document.getElementById("weather-detail");
  if (!panel) return;

  const elTitle = document.getElementById("detail-location");
  const elTime = document.getElementById("detail-time");
  const elTemp = document.getElementById("detail-temp");
  const elRain = document.getElementById("detail-rain");
  const elWind = document.getElementById("detail-wind");
  const elCoord = document.getElementById("detail-coord");

  // luôn hiện panel khi có click hợp lệ
  panel.style.display = "block";

  // Tọa độ click
  if (elCoord) {
    elCoord.textContent =
      `${clickLat.toFixed(4)}, ${clickLon.toFixed(4)}`;
  }

  // Tiêu đề: điểm gần nhất
  if (elTitle) {
    if (nearestResult && nearestResult.found &&
        typeof nearestResult.lat === "number" &&
        typeof nearestResult.lon === "number") {
      elTitle.textContent =
        `Điểm gần nhất: ${nearestResult.lat.toFixed(4)}, ${nearestResult.lon.toFixed(4)}`;
    } else {
      elTitle.textContent = "Không có dữ liệu gần điểm này";
    }
  }

  const hasCell = !!cell;

  // Thời gian (valid_at), không ghi chữ "Quan trắc"
  if (elTime) {
    elTime.textContent =
      hasCell && cell.valid_at ? String(cell.valid_at) : "--";
  }

  // Nhiệt độ
  if (elTemp) {
    elTemp.textContent =
      hasCell && typeof cell.temp_c === "number"
        ? `${cell.temp_c.toFixed(1)} °C`
        : "--";
  }

  // Lượng mưa
  if (elRain) {
    elRain.textContent =
      hasCell && typeof cell.precip_mm === "number"
        ? `${cell.precip_mm.toFixed(1)} mm`
        : "--";
  }

  // Gió: tốc độ + hướng nếu có
  if (elWind) {
    let txt = "--";
    if (hasCell && typeof cell.wind_ms === "number") {
      txt = `${cell.wind_ms.toFixed(1)} m/s`;
      if (typeof cell.wind_dir_deg === "number") {
        txt += ` (${Math.round(cell.wind_dir_deg)}°)`;
      }
    }
    elWind.textContent = txt;
  }
}

/**
 * Bật/tắt giao diện điều khiển nếu cần
 */
function toggleControls(flag) {
  const el = document.getElementById("topbar");
  if (!el) return;
  el.style.opacity = flag ? "1" : "0.3";
}

// Export global
window.showLoading = showLoading;
window.setObsTimeLabel = setObsTimeLabel;
window.showSnapshotStatus = showSnapshotStatus;
window.updateWeatherDetail = updateWeatherDetail;
window.toggleControls = toggleControls;
