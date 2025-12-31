// main.js
// Map, layer, search, timebar theo kiến trúc TimeState + ForecastBar

// =============================================================
// LAYER STATE + NÚT BÊN TRÁI / GPS / ALERT PANEL
// =============================================================

// trạng thái lớp đang bật: "temp" | "rain" | "radar-rain" | "wind" | "flood" | null
let currentLayerMode = null;

// Cập nhật chip + legend lớp dữ liệu
function updateLayerInfo(mode) {
  // Gộp "radar-rain" về "radar"
  const logicalMode = mode === "radar-rain" ? "radar" : mode;
  currentLayerMode = logicalMode;

  const chip = document.getElementById("layer-chip");
  const legend = document.getElementById("layer-legend");
  if (!chip || !legend) return;

  if (!logicalMode) {
    chip.textContent = "Lớp: Tắt";
    legend.innerHTML = "";
    legend.classList.add("hidden");
    return;
  }

  legend.classList.remove("hidden");

  // Helper function tạo dòng legend
  const createRow = (colorClass, range, desc) => `
    <div class="legend-row">
      <div class="legend-label">
        <span class="legend-swatch ${colorClass}"></span>
        <span>${range}</span>
      </div>
      <span class="legend-desc">${desc}</span>
    </div>`;

  switch (logicalMode) {
    case "temp":
      chip.textContent = "Lớp: Nhiệt độ (°C)";
      legend.innerHTML = `
        <div class="legend-title">Nhiệt độ không khí (°C)</div>

        <!-- Thanh gradient đúng với tempValueToRGBA -->
        <div class="legend-row" style="align-items:center; gap:8px;">

          <span style="font-size:11px; color:#cbd5e1; white-space:nowrap;">Lạnh</span>

          <div
            style="
              width:180px;
              height:10px;
              border-radius:999px;
              border:1px solid rgba(148,163,184,0.6);
              background: linear-gradient(
                to right,
                rgb(0, 32, 255) 0%,
                rgb(0, 180, 255) 25%,
                rgb(255, 255, 160) 50%,
                rgb(255, 160, 0) 75%,
                rgb(220, 0, 0) 100%
              );
            "
          ></div>

          <span style="font-size:11px; color:#cbd5e1; white-space:nowrap;">Nóng</span>
        </div>

        <div class="legend-row" style="margin-top:4px; font-size:11px; color:#cbd5e1; justify-content:space-between; width:180px; margin-left:auto; margin-right:auto;">
          <span>10°C</span>
          <span>20°C</span>
          <span>30°C</span>
          <span>40°C</span>
        </div>
      `;
      break;



    case "rain":
      chip.textContent = "Lớp: Mưa (mm/1h)";
      legend.innerHTML = `
        <div class="legend-title">Lượng mưa (1 giờ, mm)</div>

        <!-- Thanh gradient (giữ nguyên kích thước 180px) -->
        <div class="legend-row" style="align-items:center; gap:8px;">

          <span style="font-size:11px; color:#cbd5e1; white-space:nowrap;">
            Không / rất nhỏ
          </span>

          <div
            style="
              width:180px;
              height:10px;
              border-radius:999px;
              border:1px solid rgba(148,163,184,0.6);
              background: linear-gradient(
                to right,
                rgb(173, 216, 230) 15%,  /* light blue ~ mưa yếu */
                rgb(30, 144, 255) 40%,   /* dodger blue ~ mưa vừa */
                rgb(123, 104, 238) 70%,  /* medium slate blue ~ mưa to */
                rgb(186, 85, 211) 100%   /* medium orchid ~ mưa rất to */
              );
            "
          ></div>

          <span style="font-size:11px; color:#cbd5e1; white-space:nowrap;">
            Mưa rất to
          </span>
        </div>

        <!-- Vạch mốc cường độ mưa tuyệt đối, khớp với đơn vị backend -->
        <div
          class="legend-row"
          style="
            margin-top:4px;
            font-size:11px;
            color:#cbd5e1;
            justify-content:space-between;
            width:180px;
            margin-left:auto;
            margin-right:auto;
          "
        >
          <span>0 mm</span>
          <span>0.5 mm</span>
          <span>5 mm</span>
          <span>≥20 mm</span>
        </div>
      `;
      break;



    case "radar":
      chip.textContent = "Lớp: Radar mưa";
      legend.innerHTML = `
        <div class="legend-title">Radar mưa (6 giờ gần đây)</div>
        <div style="font-size:9px; color:#94a3b8; margin-bottom:4px;">
          Màu đậm hơn = vùng mưa mạnh hơn
        </div>

        <!-- Thanh gradient (giữ width 180px, dùng lại màu rainValueToRGBA) -->
        <div class="legend-row" style="align-items:center; gap:8px;">

          <span style="font-size:11px; color:#cbd5e1; white-space:nowrap;">
            Không / rất nhỏ
          </span>

          <div
            style="
              width:180px;
              height:10px;
              border-radius:999px;
              border:1px solid rgba(148,163,184,0.6);
              background: linear-gradient(
                to right,
                rgb(173, 216, 230) 15%,  /* light blue – mưa yếu */
                rgb(30, 144, 255) 40%,   /* dodger blue – mưa vừa */
                rgb(123, 104, 238) 70%,  /* medium slate blue – mưa to */
                rgb(186, 85, 211) 100%   /* medium orchid – mưa rất to */
              );
            "
          ></div>

          <span style="font-size:11px; color:#cbd5e1; white-space:nowrap;">
            Mưa rất to
          </span>
        </div>

        <!-- Mốc định tính, phù hợp với normalizeRain (không gán số mm/dBZ cứng) -->
        <div
          class="legend-row"
          style="
            margin-top:4px;
            font-size:11px;
            color:#cbd5e1;
            justify-content:space-between;
            width:180px;
            margin-left:auto;
            margin-right:auto;
          "
        >
          <span>Không mưa</span>
          <span>Mưa yếu</span>
          <span>Mưa vừa</span>
          <span>Mưa to / rất to</span>
        </div>
      `;
      break;


    case "wind":
      chip.textContent = "Lớp: Gió (m/s)";
      legend.innerHTML = `
        <div class="legend-title">Tốc độ gió (m/s)</div>

        <!-- Thanh gradient khớp logic windSpeedToRGBA, giữ width 180px -->
        <div class="legend-row" style="align-items:center; gap:8px;">

          <span style="font-size:11px; color:#cbd5e1; white-space:nowrap;">
            Nhẹ
          </span>

          <div
            style="
              width:180px;
              height:10px;
              border-radius:999px;
              border:1px solid rgba(148,163,184,0.6);
              background: linear-gradient(
                to right,
                rgb(10, 20, 90) 0%,     /* dark blue – gió rất yếu */
                rgb(20, 120, 120) 30%,  /* green-cyan – gió nhẹ/vừa */
                rgb(180, 210, 60) 60%,  /* vàng – gió vừa/mạnh */
                rgb(220, 120, 40) 80%,  /* cam – gió mạnh */
                rgb(200, 40, 140) 100%  /* magenta – gió rất mạnh */
              );
            "
          ></div>

          <span style="font-size:11px; color:#cbd5e1; white-space:nowrap;">
            Rất mạnh
          </span>
        </div>

        <!-- Vạch mốc tốc độ gió (m/s), tuyệt đối, khớp đơn vị backend -->
        <div
          class="legend-row"
          style="
            margin-top:4px;
            font-size:11px;
            color:#cbd5e1;
            justify-content:space-between;
            width:180px;
            margin-left:auto;
            margin-right:auto;
          "
        >
          <span>0 m/s</span>
          <span>5 m/s</span>
          <span>10 m/s</span>
          <span>≥20 m/s</span>
        </div>
      `;
      break;


    case "flood":
      chip.textContent = "Lớp: Nguy cơ lũ";
      legend.innerHTML = `
        <div class="legend-title">Chỉ số rủi ro lũ lụt</div>
        ${createRow("flood-none", "< 1", "Thấp")}
        ${createRow("flood-low", "1 – 3", "Chú ý")}
        ${createRow("flood-med", "3 – 5", "Trung bình")}
        ${createRow("flood-high", "5 – 7", "Cao")}
        ${createRow("flood-vhigh", "≥ 7", "Rất cao")}
      `;
      break;
  }
}

function setupLayerButtons() {
  const btnTemp         = document.getElementById("btn-layer-temp");
  const btnRain         = document.getElementById("btn-layer-rain");
  const btnRadarRain    = document.getElementById("btn-radar-rain");
  const btnWind         = document.getElementById("btn-layer-wind");
  const btnFloodFab     = document.getElementById("fab-flood");         // FAB lũ lụt
  const btnLocate       = document.getElementById("btn-my-location");   // nút GPS nổi
  const btnLocateHeader = document.getElementById("btn-gps-header");    // nút GPS topbar
  const btnAlert        = document.getElementById("btn-alert");

  // mode: "temp" | "rain" | "radar-rain" | "wind" | "flood" | null
  function setActive(mode) {
    if (btnTemp)      btnTemp.classList.toggle("active", mode === "temp");
    if (btnRain)      btnRain.classList.toggle("active", mode === "rain");
    if (btnRadarRain) btnRadarRain.classList.toggle("active", mode === "radar-rain");
    if (btnWind)      btnWind.classList.toggle("active", mode === "wind");
    if (btnFloodFab)  btnFloodFab.classList.toggle("active", mode === "flood");

    // tắt/bật layer thực tế
    if (mode !== "temp"  && window.hideTempLayer)  window.hideTempLayer();
    if (mode !== "rain"  && window.hideRainLayer)  window.hideRainLayer();
    if (mode !== "wind"  && window.hideWindLayer)  window.hideWindLayer();
    if (mode !== "flood" && window.hideFloodLayer) window.hideFloodLayer?.();

    // radar riêng
    if (mode !== "radar-rain") {
      if (typeof window.stopRainRadar === "function") {
        window.stopRainRadar();
      } else if (typeof window.hideRainRadar === "function") {
        window.hideRainRadar();
      }
    }

    if (mode === "temp"   && window.showTempLayer)   window.showTempLayer();
    if (mode === "rain"   && window.showRainLayer)   window.showRainLayer();
    if (mode === "wind"   && window.showWindLayer)   window.showWindLayer();
    if (mode === "flood"  && window.showFloodLayer)  window.showFloodLayer();
    if (mode === "radar-rain") {
      if (typeof window.startRainRadar === "function") {
        window.startRainRadar(3);
      } else if (typeof window.showRainRadar === "function") {
        window.showRainRadar();
      }
    }

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

  // ===== FLOOD (FAB lũ lụt) =====
  if (btnFloodFab) {
    btnFloodFab.addEventListener("click", () => {
      const isOn = currentLayerMode === "flood";

      if (isOn) {
        // tắt chế độ lũ
        setActive(null);
      } else {
        // bật chế độ lũ: tắt các lớp khác, radar
        setActive("flood");
      }
    });
  }


  // ===== GPS: vị trí người dùng =====
  function handleLocateClick(btn) {
    if (!navigator.geolocation) {
      console.warn("Trình duyệt không hỗ trợ Geolocation");
      return;
    }

    if (btn) btn.disabled = true;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (btn) btn.disabled = false;

        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        // 1) Đưa map về đúng vị trí user
        if (window.map && window.map.setView) {
          window.map.setView([lat, lon], 13);
        }

        // 2) KHÔNG vẽ circleMarker riêng cho GPS nữa
        //    Thay vào đó, giả lập click lên map tại vị trí này
        if (window.map && window.L) {
          const latlng = L.latLng(lat, lon);
          // Giả lập sự kiện click giống như user bấm vào bản đồ
          window.map.fire("click", { latlng });
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
    const base =
      (typeof window.API_BASE === "string" && window.API_BASE) ? window.API_BASE : "/api";

    // Nếu backend của bạn hỗ trợ back/fwd thì nên set cố định để luôn đủ dải giờ
    const url = `${base}/obs/timeseries/${locationId}`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`timeseries HTTP ${res.status}`);

    let js = await res.json();

    // (1) Nếu backend trả mảng steps thuần -> wrap lại để timebar normalize được
    if (Array.isArray(js)) {
      js = { steps: js };
    }

    // (2) Set locationId vào TimeState để toàn app sync đúng điểm
    if (window.TimeState && typeof window.TimeState.setLocationId === "function") {
      window.TimeState.setLocationId(locationId);
    }

    // (3) initTimeSteps nếu muốn (timebar.js cũng có thể init, nhưng giữ ở đây không sao)
    let steps = [];
    if (Array.isArray(js.data)) steps = js.data.map((d) => d.valid_at);
    else if (Array.isArray(js.time_steps)) steps = js.time_steps.slice();
    else if (Array.isArray(js.steps)) steps = js.steps.map((s) => (s?.valid_at ? s.valid_at : s)).slice();

    if (window.TimeState && typeof window.TimeState.initTimeSteps === "function" && steps.length) {
      window.TimeState.initTimeSteps(steps);
    }

    // Render timebar
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
