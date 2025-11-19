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

  if (btnTemp) {
    btnTemp.addEventListener("click", () => {
      if (typeof window.hideRainLayer === "function") window.hideRainLayer();
      if (typeof window.hideWindLayer === "function") window.hideWindLayer();
      if (typeof window.showTempLayer === "function") window.showTempLayer();
      setActive("temp");
    });
  }

  if (btnRain) {
    btnRain.addEventListener("click", () => {
      if (typeof window.hideTempLayer === "function") window.hideTempLayer();
      if (typeof window.hideWindLayer === "function") window.hideWindLayer();
      if (typeof window.showRainLayer === "function") window.showRainLayer();
      setActive("rain");
    });
  }

  if (btnWind) {
    btnWind.addEventListener("click", () => {
      if (typeof window.hideTempLayer === "function") window.hideTempLayer();
      if (typeof window.hideRainLayer === "function") window.hideRainLayer();
      setActive("wind");
      if (typeof window.showWindLayer === "function") window.showWindLayer();
    });
  }

  if (btnLocate) {
    btnLocate.addEventListener("click", () => {
      // TODO locate nếu cần
    });
  }
}

// ===================== Map click → nearest + timeseries =====================

function initMapClickForTimeseries() {
  if (!window.map || !map.on) {
    console.warn("Map chưa sẵn sàng để gắn click timeseries");
    return;
  }
  if (
    typeof window.fetchObsNearest !== "function" ||
    typeof window.fetchObsTimeseries !== "function"
  ) {
    console.warn("Thiếu fetchObsNearest / fetchObsTimeseries (api.js)");
    return;
  }

  map.on("click", async function (e) {
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;

    const tsPanel = document.getElementById("timeseries-panel");
    if (tsPanel) tsPanel.style.display = "block";

    if (typeof window.setTimeseriesStatus === "function") {
      setTimeseriesStatus("loading");
    }
    if (typeof window.setTimeseriesLocationName === "function") {
      setTimeseriesLocationName("");
    }
    if (typeof window.setTimeseriesSummary === "function") {
      setTimeseriesSummary([]);
    }
    if (typeof window.renderTimeseriesCharts === "function") {
      renderTimeseriesCharts([]);
    }

    try {
      const nearest = await window.fetchObsNearest(lat, lon);

      if (typeof window.updateWeatherDetail === "function") {
        updateWeatherDetail(lat, lon, nearest, nearest);
      }

      const name =
        nearest && typeof nearest.lat === "number"
          ? `(${nearest.lat.toFixed(3)}, ${nearest.lon.toFixed(3)})`
          : "Điểm quan trắc";

      if (typeof window.setTimeseriesLocationName === "function") {
        setTimeseriesLocationName(nearest.name || name);
      }

      if (!nearest.location_id) {
        if (typeof window.setTimeseriesStatus === "function") {
          setTimeseriesStatus("error", "Thiếu location_id");
        }
        return;
      }

      const records = await window.fetchObsTimeseries(nearest.location_id);

      if (typeof window.setTimeseriesSummary === "function") {
        setTimeseriesSummary(records);
      }
      if (typeof window.renderTimeseriesCharts === "function") {
        renderTimeseriesCharts(records);
      }
      if (typeof window.setTimeseriesStatus === "function") {
        setTimeseriesStatus("ok");
      }
    } catch (err) {
      console.error("Lỗi click map / timeseries:", err);
      if (typeof window.setTimeseriesStatus === "function") {
        setTimeseriesStatus("error", "Lỗi khi tải timeseries");
      }
    }
  });
}

// ============================================================
// ================  ROUTER PAGE (SỬA LẠI) ====================
// ============================================================

function setupPageRouter() {
  const buttons = document.querySelectorAll(".nav-btn[data-page]");
  const pages = document.querySelectorAll(".page-panel");
  const closeBtns = document.querySelectorAll(".page-close");

  function hideAllPages() {
    pages.forEach(p => (p.style.display = "none"));
    buttons.forEach(b => b.classList.remove("active"));
  }

  function showPage(pageId) {
    pages.forEach(p => {
      p.style.display = p.id === "page-" + pageId ? "block" : "none";
    });

    buttons.forEach(b => {
      b.classList.toggle("active", b.dataset.page === pageId);
    });

    if (pageId === "alerts") {
      if (window.latestObs && window.renderAlertsPageFromObsList) {
        window.renderAlertsPageFromObsList(window.latestObs);
      }
    }
  }

  // khởi tạo: tắt hết overlay
  hideAllPages();

  // click menu: nếu đang mở thì tắt, nếu đang tắt thì mở
  buttons.forEach(b => {
    b.addEventListener("click", () => {
      const page = b.dataset.page;
      const panel = document.getElementById("page-" + page);
      const isVisible = panel && panel.style.display === "block";

      if (isVisible) {
        hideAllPages();
      } else {
        showPage(page);
      }
    });
  });

  // click nút đóng trong panel → tắt hết
  closeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      hideAllPages();
    });
  });
}


// ============================================================
// ============  KHỞI TẠO — tải obs + router ===================
// ============================================================

async function loadInitialObs() {
  if (typeof window.fetchLatestObs === "function") {
    const res = await window.fetchLatestObs();
    window.latestObs = res?.data || [];
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof window.initMap === "function") window.initMap();
  if (typeof window.initSearch === "function") window.initSearch();
  if (typeof window.initGPS === "function") window.initGPS();

  setupLayerButtons();
  initMapClickForTimeseries();

  await loadInitialObs();
  setupPageRouter();
});
