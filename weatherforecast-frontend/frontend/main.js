// main.js
// Map, layer, search, timebar theo kiến trúc TimeState + ForecastBar

// =============================================================
// LAYER STATE + NÚT BÊN TRÁI / GPS / ALERT PANEL
// =============================================================

// trạng thái lớp đang bật: "temp" | "rain" | "radar-rain" | "wind" | null
let currentLayerMode = null;

// Cập nhật chip + legend lớp dữ liệu
function updateLayerInfo(mode) {
  // Gộp "radar-rain" về "radar" cho legend
  const logicalMode = mode === "radar-rain" ? "radar" : mode;
  currentLayerMode = logicalMode;

  const chip = document.getElementById("layer-chip");
  const legend = document.getElementById("layer-legend");
  if (!chip || !legend) return;

  if (!logicalMode) {
    chip.textContent = "Lớp: không bật";
    legend.innerHTML = "";
    legend.classList.add("hidden");
    return;
  }

  legend.classList.remove("hidden");

  if (logicalMode === "temp") {
    chip.textContent = "Lớp: Nhiệt độ (°C)";
    legend.innerHTML = `
      <div class="legend-title">Nhiệt độ không khí</div>
      <div class="legend-gradient legend-temp"></div>
      <div class="legend-row">
        <span>Lạnh</span>
        <span>Mát</span>
        <span>Ấm</span>
        <span>Nóng</span>
      </div>
    `;
  } else if (logicalMode === "rain") {
    chip.textContent = "Lớp: Lượng mưa (mm)";
    legend.innerHTML = `
      <div class="legend-title">Lượng mưa trong 1 giờ</div>
      <div class="legend-row">
        <div class="legend-label">
          <span class="legend-dot legend-dot-rain"></span>
          <span>0 – 1 mm</span>
        </div>
        <span>Mưa nhỏ</span>
      </div>
      <div class="legend-row">
        <div class="legend-label">
          <span class="legend-dot legend-dot-rain"></span>
          <span>1 – 5 mm</span>
        </div>
        <span>Mưa vừa</span>
      </div>
      <div class="legend-row">
        <div class="legend-label">
          <span class="legend-dot legend-dot-rain"></span>
          <span>5 – 20 mm</span>
        </div>
        <span>Mưa to</span>
      </div>
      <div class="legend-row">
        <div class="legend-label">
          <span class="legend-dot legend-dot-rain"></span>
          <span>&gt; 20 mm</span>
        </div>
        <span>Mưa rất to</span>
      </div>
    `;
  } else if (logicalMode === "radar") {
    chip.textContent = "Lớp: Radar mưa (3 giờ gần nhất)";
    legend.innerHTML = `
      <div class="legend-title">Radar mưa (3h gần nhất)</div>
      <div class="legend-row">
        <span>Khu vực sáng màu</span>
        <span>→ mưa yếu</span>
      </div>
      <div class="legend-row">
        <span>Khu vực đậm màu</span>
        <span>→ mưa vừa / mưa to</span>
      </div>
    `;
  } else if (logicalMode === "wind") {
    chip.textContent = "Lớp: Gió (m/s)";
    legend.innerHTML = `
      <div class="legend-title">Hướng và tốc độ gió</div>
      <div class="legend-row">
        <div class="legend-label">
          <span class="legend-dot legend-dot-wind"></span>
          <span>Mũi tên chỉ hướng gió thổi tới</span>
        </div>
      </div>
      <div class="legend-row">
        <span>Tốc độ càng lớn</span>
        <span>→ mũi tên/hiệu ứng càng mạnh</span>
      </div>
    `;
  }
}

function setupLayerButtons() {
  const btnTemp         = document.getElementById("btn-layer-temp");
  const btnRain         = document.getElementById("btn-layer-rain");
  const btnRadarRain    = document.getElementById("btn-radar-rain");
  const btnWind         = document.getElementById("btn-layer-wind");
  const btnLocate       = document.getElementById("btn-my-location");   // nút GPS nổi
  const btnLocateHeader = document.getElementById("btn-gps-header");    // nút GPS topbar
  const btnAlert        = document.getElementById("btn-alert");

  // mode: "temp" | "rain" | "radar-rain" | "wind" | null
  function setActive(mode) {
    if (btnTemp)      btnTemp.classList.toggle("active", mode === "temp");
    if (btnRain)      btnRain.classList.toggle("active", mode === "rain");
    if (btnRadarRain) btnRadarRain.classList.toggle("active", mode === "radar-rain");
    if (btnWind)      btnWind.classList.toggle("active", mode === "wind");

    updateLayerInfo(mode);
  }

  // ===== TEMP =====
  if (btnTemp) {
    btnTemp.addEventListener("click", () => {
      const isActive = btnTemp.classList.contains("active");
      if (isActive) {
        setActive(null);
        if (window.hideTempLayer) window.hideTempLayer();
      } else {
        setActive("temp");
        if (window.hideRainLayer)  window.hideRainLayer();
        // radar off
        if (typeof window.stopRainRadar === "function") {
          window.stopRainRadar();
        } else if (typeof window.hideRainRadar === "function") {
          window.hideRainRadar();
        }
        if (window.hideWindLayer)  window.hideWindLayer();
        if (window.showTempLayer)  window.showTempLayer();
      }
    });
  }

  // ===== RAIN (canvas IDW – mưa hiện tại) =====
  if (btnRain) {
    btnRain.addEventListener("click", () => {
      const isActive = btnRain.classList.contains("active");
      if (isActive) {
        setActive(null);
        if (window.hideRainLayer) window.hideRainLayer();
      } else {
        setActive("rain");
        if (window.hideTempLayer)  window.hideTempLayer();
        if (window.hideWindLayer)  window.hideWindLayer();

        // tắt radar nếu đang chạy
        if (btnRadarRain) btnRadarRain.classList.remove("active");
        if (typeof window.stopRainRadar === "function") {
          window.stopRainRadar();
        } else if (typeof window.hideRainRadar === "function") {
          window.hideRainRadar();
        }

        if (window.showRainLayer)  window.showRainLayer();
      }
    });
  }

  // ===== RADAR MƯA (rain_frames animation) =====
  if (btnRadarRain) {
    btnRadarRain.addEventListener("click", () => {
      const isActive = btnRadarRain.classList.contains("active");

      if (isActive) {
        // tắt radar
        setActive(null);
        if (typeof window.stopRainRadar === "function") {
          window.stopRainRadar();
        } else if (typeof window.hideRainRadar === "function") {
          window.hideRainRadar();
        }
      } else {
        setActive("radar-rain");

        // tắt các lớp khác
        if (btnRain) btnRain.classList.remove("active");
        if (window.hideTempLayer)  window.hideTempLayer();
        if (window.hideRainLayer)  window.hideRainLayer();
        if (window.hideWindLayer)  window.hideWindLayer();

        // bật radar: ưu tiên startRainRadar(3) nếu có (format file cũ), fallback showRainRadar()
        if (typeof window.startRainRadar === "function") {
          window.startRainRadar(3);
        } else if (typeof window.showRainRadar === "function") {
          window.showRainRadar();
        } else {
          console.warn("Radar mưa: chưa có startRainRadar/showRainRadar trên window.");
        }
      }
    });
  }

  // ===== WIND =====
  if (btnWind) {
    btnWind.addEventListener("click", () => {
      const isActive = btnWind.classList.contains("active");
      if (isActive) {
        setActive(null);
        if (window.hideWindLayer) window.hideWindLayer();
      } else {
        setActive("wind");
        if (window.hideTempLayer)  window.hideTempLayer();
        if (window.hideRainLayer)  window.hideRainLayer();

        // tắt radar
        if (btnRadarRain) btnRadarRain.classList.remove("active");
        if (typeof window.stopRainRadar === "function") {
          window.stopRainRadar();
        } else if (typeof window.hideRainRadar === "function") {
          window.hideRainRadar();
        }

        if (window.showWindLayer)  window.showWindLayer();
      }
    });
  }

  // ===== GPS: vị trí người dùng =====
  async function handleLocateClick(btn) {
    if (!navigator.geolocation) {
      console.warn("Trình duyệt không hỗ trợ Geolocation");
      return;
    }

    if (btn) btn.disabled = true;

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (btn) btn.disabled = false;

        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        // 1) Đưa map về đúng vị trí user
        if (window.map && window.map.setView) {
          window.map.setView([lat, lon], 8);
        }

        // 2) Vẽ marker vị trí user
        try {
          if (window.map && window.L) {
            if (window._gpsMarker) {
              window.map.removeLayer(window._gpsMarker);
            }
            window._gpsMarker = L.circleMarker([lat, lon], {
              radius: 6,
              color: "#f97316",
              weight: 2,
              fillColor: "#f97316",
              fillOpacity: 0.9,
            }).addTo(window.map);
          }
        } catch (e) {
          console.error("GPS marker error", e);
        }

        // 3) Gọi nearest
        let nearest = null;
        let cell = null;
        let locationId = null;

        try {
          if (typeof window.fetchNearestTemp === "function") {
            nearest = await window.fetchNearestTemp(lat, lon);
          }
        } catch (err) {
          console.error("[GPS] fetchNearestTemp failed", err);
        }

        if (nearest && nearest.found && nearest.location_id) {
          locationId = String(nearest.location_id);
          if (typeof window.findCellByLocationId === "function") {
            cell = window.findCellByLocationId(locationId);
          }
        }

        window.lastNearestResult = nearest || null;
        window.lastLocationId = locationId || null;
        window.lastCell = cell || null;

        // 4) Đổ lên card chi tiết
        if (typeof window.updateWeatherDetail === "function") {
          window.updateWeatherDetail(lat, lon, nearest, cell);
        }

        // 5) timeseries cho TimeBar
        if (locationId && typeof window.loadTimeSeriesForLocation === "function") {
          try {
            await window.loadTimeSeriesForLocation(locationId);
          } catch (err) {
            console.error("[GPS] loadTimeSeriesForLocation failed", err);
          }
        }

        // 6) Chuẩn bị dữ liệu cho panel Cảnh báo, KHÔNG mở panel
        if (locationId && typeof window.setAlertLocation === "function") {
          try {
            await window.setAlertLocation(locationId);
          } catch (err) {
            console.error("[GPS] setAlertLocation failed", err);
          }
        }
      },
      (err) => {
        if (btn) btn.disabled = false;
        console.error("Geolocation error:", err);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }

  if (btnLocate) {
    btnLocate.addEventListener("click", () => handleLocateClick(btnLocate));
  }

  if (btnLocateHeader) {
    btnLocateHeader.addEventListener("click", () =>
      handleLocateClick(btnLocateHeader)
    );
  }

  // ===== ALERT PANEL (Cảnh báo trên topbar) =====
  if (btnAlert) {
    btnAlert.addEventListener("click", () => {
      const panel = document.getElementById("alert-panel");
      if (!panel) return;

      const hidden = panel.classList.contains("hidden");
      if (hidden) {
        if (window.showAlertPanel) window.showAlertPanel();   // chỉ mở, không fetch (data đã chuẩn bị)
      } else {
        if (window.hideAlertPanel) window.hideAlertPanel();
      }
    });
  }

  // trạng thái ban đầu: không lớp nào bật
  updateLayerInfo(null);
}

// =============================================================
// FETCH TIMESERIES CHO 1 ĐIỂM
// =============================================================
async function loadTimeSeriesForLocation(locationId) {
  try {
    const url = `${API_BASE}/obs/timeseries/${locationId}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("timeseries error");
    const js = await res.json();

    // Backend: { location_id, count, data: [ { valid_at, temp_c, ... }, ... ] }
    let steps = [];
    if (Array.isArray(js.data)) {
      steps = js.data.map((d) => d.valid_at);
    } else if (Array.isArray(js.time_steps)) {
      steps = js.time_steps.slice();
    } else if (Array.isArray(js.steps)) {
      steps = js.steps.slice();
    }

    if (window.TimeState && typeof TimeState.initTimeSteps === "function") {
      TimeState.initTimeSteps(steps);
    }

    if (typeof window.setForecastSeries === "function") {
      window.setForecastSeries(js);
    }

    window._CURRENT_TS = js;
  } catch (err) {
    console.error("loadTimeSeriesForLocation", err);
  }
}
window.loadTimeSeriesForLocation = loadTimeSeriesForLocation;

// =============================================================
// PAGE TABS: HOME / THÔNG BÁO / THÔNG TIN CHUNG (OVERLAY TRÊN MAP)
// =============================================================
// =============================================================
// PAGE TABS: HOME / THÔNG BÁO / THÔNG TIN CHUNG (OVERLAY TRÊN MAP)
// Home chỉ hiện khi bấm nút Home
// =============================================================
function setupPageTabs() {
  const pageHome   = document.getElementById("page-home");
  const pageNotify = document.getElementById("page-notify");
  const pageInfo   = document.getElementById("page-info");

  const btnHome   = document.getElementById("nav-home");
  const btnNotify = document.getElementById("nav-notify");
  const btnInfo   = document.getElementById("nav-info");

  const homeClose   = document.getElementById("home-close");
  const notifyClose = document.getElementById("notify-close");
  const infoClose   = document.getElementById("info-close");

  const overlays = [pageHome, pageNotify, pageInfo];

  function setActiveNav(targetBtn) {
    const navBtns = document.querySelectorAll(".topbar-nav .nav-btn");
    navBtns.forEach((b) => b.classList.remove("active"));
    if (targetBtn) targetBtn.classList.add("active");
  }

  function hideAllOverlays() {
    overlays.forEach((el) => {
      if (!el) return;
      el.classList.remove("page-active");
      el.style.display = "none";
    });
  }

  function showOverlay(elToShow, activeBtn) {
    overlays.forEach((el) => {
      if (!el) return;
      const show = el === elToShow;
      el.classList.toggle("page-active", show);
      el.style.display = show ? "block" : "none";
    });
    setActiveNav(activeBtn);
  }

  // Nút Home
  if (btnHome) {
    btnHome.addEventListener("click", () => {
      if (!pageHome) return;
      const isVisible =
        pageHome.style.display !== "none" &&
        pageHome.classList.contains("page-active");
      if (isVisible) {
        hideAllOverlays();
        setActiveNav(null);
      } else {
        showOverlay(pageHome, btnHome);
        if (typeof window.initHomeDashboard === "function") {
          window.initHomeDashboard();
        }
      }
    });
  }

  // Nút Thông báo
  if (btnNotify) {
    btnNotify.addEventListener("click", () => {
      if (!pageNotify) return;
      const isVisible =
        pageNotify.style.display !== "none" &&
        pageNotify.classList.contains("page-active");
      if (isVisible) {
        hideAllOverlays();
        setActiveNav(null);
      } else {
        showOverlay(pageNotify, btnNotify);
        if (typeof window.renderNotifyHistory === "function") {
          window.renderNotifyHistory();
        }
      }
    });
  }

  // Nút Thông tin chung
  if (btnInfo) {
    btnInfo.addEventListener("click", () => {
      if (!pageInfo) return;
      const isVisible =
        pageInfo.style.display !== "none" &&
        pageInfo.classList.contains("page-active");
      if (isVisible) {
        hideAllOverlays();
        setActiveNav(null);
      } else {
        showOverlay(pageInfo, btnInfo);
      }
    });
  }

  // Close buttons
  function wireClose(btn) {
    if (!btn) return;
    btn.addEventListener("click", () => {
      hideAllOverlays();
      setActiveNav(null);
    });
  }
  wireClose(homeClose);
  wireClose(notifyClose);
  wireClose(infoClose);

  // Ban đầu: không panel nào mở, chỉ có map
  hideAllOverlays();
  setActiveNav(null);
}


// =============================================================
// KHỞI ĐỘNG APP (search + layer + timebar, map init)
// =============================================================
document.addEventListener("DOMContentLoaded", () => {
  if (typeof window.initSearch === "function") window.initSearch();

  setupLayerButtons();
  setupPageTabs();

  if (typeof window.setupForecastBar === "function") {
    window.setupForecastBar();
  }

  if (window.TimeState && typeof TimeState.onTimeChange === "function") {
    TimeState.onTimeChange((tIso) => {
      if (typeof window.updateLayersForTime === "function") {
        window.updateLayersForTime(tIso);
      }
      if (typeof window.updateDetailPanelForTime === "function") {
        window.updateDetailPanelForTime(tIso);
      }
    });
  }

  if (typeof window.initMapIfNeeded === "function") {
    window.initMapIfNeeded();
  } else if (typeof window.initMap === "function") {
    window.initMap();
  }
});


// =============================================================
// NOTIFY DEMO (GIẢ LẬP LỊCH SỬ THÔNG BÁO)
// =============================================================
(function () {
  const STORAGE_KEY = "weather_notify_history";

  function getHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (e) {
      console.warn("Cannot parse notify history", e);
      return [];
    }
  }

  function saveHistory(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("Cannot save notify history", e);
    }
  }

  function ensureDemoData() {
    const list = getHistory();
    if (list.length === 0) {
      const now = new Date().toLocaleString("vi-VN");
      list.push({
        time: now,
        text: "Sáng nay trời mưa nhẹ tại Hà Nội, nhiệt độ khoảng 22°C. Nhớ mang ô.",
      });
      list.push({
        time: now,
        text: "Khu vực Nhà (VD: Hà Nội) có khả năng mưa trong 3 giờ tới.",
      });
      saveHistory(list);
    }
  }

  function renderNotifyHistory() {
    ensureDemoData();
    const list = getHistory();
    const container = document.getElementById("notify-history");
    if (!container) return;

    container.innerHTML = "";

    if (list.length === 0) {
      container.textContent = "Chưa có thông báo nào.";
      return;
    }

    list
      .slice()
      .reverse()
      .forEach((item) => {
        const div = document.createElement("div");
        div.className = "notify-history-item";
        div.innerHTML = `
          <div class="notify-history-time">${item.time || ""}</div>
          <div class="notify-history-text">${item.text || ""}</div>
        `;
        container.appendChild(div);
      });
  }

  window.renderNotifyHistory = renderNotifyHistory;
})();
