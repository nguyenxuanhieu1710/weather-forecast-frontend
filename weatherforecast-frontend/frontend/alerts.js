// alerts.js
(function (w) {
  // ================== STATE ==================
  const alertState = {
    lastLocationId: null,   // location_id cuối cùng user click trên map
    lastSummary: null,      // cache dữ liệu summary cho location đó
  };

  // ================== GỌI BACKEND ==================
  // GET /obs/summary/<location_id>
  w.fetchAlertSummary = async function (location_id) {
    console.log("[alerts] fetchAlertSummary location_id =", location_id);
    try {
      const url = `${API_BASE}/obs/summary/${location_id}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        console.error("[alerts] HTTP status", res.status);
        return null;
      }
      const json = await res.json();
      console.log("[alerts] summary =", json);
      return json;
    } catch (err) {
      console.error("[alerts] fetchAlertSummary failed:", err);
      return null;
    }
  };

  // ================== SHOW / HIDE PANEL ==================
  function doShowAlertPanel() {
    console.log("[alerts] doShowAlertPanel");
    const panel = document.getElementById("alert-panel");
    if (!panel) {
      console.error("[alerts] #alert-panel không tồn tại trong DOM");
      return;
    }
    panel.classList.remove("hidden");
  }

  w.showAlertPanel = function () {
    // Hàm này bây giờ chỉ mở panel, KHÔNG tự gọi fetch hay update.
    doShowAlertPanel();
  };

  w.hideAlertPanel = function () {
    const panel = document.getElementById("alert-panel");
    if (!panel) return;
    panel.classList.add("hidden");
  };

  const btnClose = document.getElementById("alert-close");
  if (btnClose) {
    btnClose.onclick = w.hideAlertPanel;
  } else {
    console.warn("[alerts] Không tìm thấy #alert-close");
  }

  // ================== MAP → CHỈ CẬP NHẬT DỮ LIỆU, KHÔNG MỞ PANEL ==================
  // Gọi hàm này từ handler click map:
  //   window.setAlertLocation(location_id);
  w.setAlertLocation = async function (location_id) {
    console.log("[alerts] setAlertLocation =", location_id);
    alertState.lastLocationId = location_id || null;

    if (!location_id) {
      alertState.lastSummary = null;
      w.updateAlertPanel(null);
      return;
    }

    const data = await w.fetchAlertSummary(location_id);
    alertState.lastSummary = data;
    w.updateAlertPanel(data);
    // KHÔNG showAlertPanel ở đây → chỉ chuẩn bị dữ liệu
  };

  // ================== NÚT “CẢNH BÁO” MỚI MỞ PANEL ==================
  // Giả định trong HTML có nút/tab mở cảnh báo: id="alert-toggle"
  const btnToggle = document.getElementById("alert-toggle");
  if (btnToggle) {
    btnToggle.addEventListener("click", async function () {
      const panel = document.getElementById("alert-panel");
      if (!panel) return;

      const isOpen = !panel.classList.contains("hidden");
      if (isOpen) {
        // nếu đang mở thì click nữa là đóng
        w.hideAlertPanel();
        return;
      }

      // Nếu chưa có summary nhưng đã có location_id → fetch trước khi mở
      if (!alertState.lastSummary && alertState.lastLocationId) {
        const data = await w.fetchAlertSummary(alertState.lastLocationId);
        alertState.lastSummary = data;
        w.updateAlertPanel(data);
      }

      // Nếu không có location nào → hiển thị trạng thái “chưa có dữ liệu”
      if (!alertState.lastLocationId) {
        w.updateAlertPanel(null);
      }

      doShowAlertPanel();
    });
  } else {
    console.warn("[alerts] Không tìm thấy #alert-toggle (nút mở Cảnh báo)");
  }

  // ================== HELPERS UI ==================
  function mapHazardTypeLabel(type) {
    switch (type) {
      case "heavy_rain":
        return "Mưa lớn";
      case "heat":
        return "Nắng nóng";
      case "cold":
        return "Rét / lạnh";
      case "strong_wind":
        return "Gió mạnh";
      default:
        return type || "Khác";
    }
  }

  function mapLevelLabel(level) {
    switch (level) {
      case "info":
        return "THÔNG TIN";
      case "watch":
        return "THEO DÕI";
      case "warning":
        return "CẢNH BÁO";
      case "danger":
        return "RẤT NGUY HIỂM";
      case "none":
      default:
        return "BÌNH THƯỜNG";
    }
  }

  // ================== RENDER UI CHÍNH ==================
  w.updateAlertPanel = function (data) {
    console.log("[alerts] updateAlertPanel data =", data);

    const boxOverview = document.getElementById("alert-overview");
    const boxToday = document.getElementById("alert-today");
    const boxCurrent = document.getElementById("alert-current");
    const hazardsList = document.getElementById("alert-hazards-list");

    if (!boxOverview || !boxToday || !boxCurrent || !hazardsList) {
      console.error(
        "[alerts] Thiếu phần tử DOM: #alert-overview / #alert-today / #alert-current / #alert-hazards-list"
      );
      return;
    }

    // ========== TRƯỜNG HỢP KHÔNG CÓ DỮ LIỆU ==========
    if (!data || !data.obs || data.found === false) {
      boxOverview.innerHTML = `
        <div class="alert-overview-header">
          <span id="alert-overall-badge" class="alert-badge alert-level-none">
            BÌNH THƯỜNG
          </span>
        </div>
        <p id="alert-overall-comment">
          Chưa có dữ liệu cảnh báo cho vị trí này. Hãy chọn một điểm trên bản đồ.
        </p>
      `;

      boxToday.innerHTML = `
        <h3>Today's Weather</h3>
        <div class="alert-today-line">Không có dữ liệu</div>
      `;

      boxCurrent.innerHTML = `
        <h3>Current Weather</h3>
        <div class="alert-current-temp">--°C</div>
        <div>Không có dữ liệu</div>
      `;

      hazardsList.innerHTML = `
        <div class="alert-empty">
          Không có nguy cơ đáng kể được ghi nhận ở thời điểm hiện tại.
        </div>
      `;
      return;
    }

    const obs = data.obs || {};
    const todayText =
      data.today && data.today.summary_text ? data.today.summary_text : "--";
    const currentText =
      data.current && data.current.summary_text ? data.current.summary_text : "";

    const alerts = data.alerts || {};
    const overallLevel = alerts.overall_level || "none";
    const overallComment =
      alerts.overall_comment ||
      "Thời tiết nhìn chung ổn định, không có nguy cơ đáng kể.";

    // ========== OVERVIEW (CẤP ĐỘ TỔNG, COMMENT) ==========
    boxOverview.innerHTML = `
      <div class="alert-overview-header">
        <span
          id="alert-overall-badge"
          class="alert-badge alert-level-${overallLevel}"
        >
          ${mapLevelLabel(overallLevel)}
        </span>
      </div>
      <p id="alert-overall-comment">${overallComment}</p>
    `;

    // ========== TODAY'S WEATHER (giữ phong cách AccuWeather) ==========
    boxToday.innerHTML = `
      <h3>Today's Weather</h3>
      <div class="alert-today-line">${todayText}</div>
    `;

    // ========== CURRENT WEATHER (số liệu chi tiết) ==========
    const tempStr =
      obs.temp_c != null && !Number.isNaN(obs.temp_c)
        ? `${obs.temp_c.toFixed(1)}°C`
        : "--°C";

    const windStr =
      obs.wind_ms != null && !Number.isNaN(obs.wind_ms)
        ? `${obs.wind_ms.toFixed(1)} m/s`
        : "-- m/s";

    const rainStr =
      obs.precip_mm != null && !Number.isNaN(obs.precip_mm)
        ? `${obs.precip_mm.toFixed(1)} mm`
        : "-- mm";

    const cloudStr =
      obs.cloudcover_pct != null && !Number.isNaN(obs.cloudcover_pct)
        ? `${obs.cloudcover_pct.toFixed(0)}%`
        : "--%";

    const pressureStr =
      obs.surface_pressure_hpa != null &&
      !Number.isNaN(obs.surface_pressure_hpa)
        ? `${obs.surface_pressure_hpa.toFixed(1)} hPa`
        : "-- hPa";

    boxCurrent.innerHTML = `
      <h3>Current Weather</h3>
      <div class="alert-current-temp">${tempStr}</div>
      <div>${currentText}</div>

      <div class="alert-meta-row">
        <div class="alert-meta-col">
          <div class="alert-meta-label">Wind</div>
          <div class="alert-meta-value">${windStr}</div>
        </div>
        <div class="alert-meta-col">
          <div class="alert-meta-label">Rain (last hour)</div>
          <div class="alert-meta-value">${rainStr}</div>
        </div>
      </div>

      <div class="alert-meta-row">
        <div class="alert-meta-col">
          <div class="alert-meta-label">Cloud</div>
          <div class="alert-meta-value">${cloudStr}</div>
        </div>
        <div class="alert-meta-col">
          <div class="alert-meta-label">Pressure</div>
          <div class="alert-meta-value">${pressureStr}</div>
        </div>
      </div>
    `;

    // ========== DANH SÁCH HAZARDS (MỖI NGUY CƠ MỘT THẺ) ==========
    hazardsList.innerHTML = "";
    const hazards = Array.isArray(alerts.hazards) ? alerts.hazards : [];

    if (!hazards.length) {
      hazardsList.innerHTML = `
        <div class="alert-empty">
          Không có nguy cơ đáng kể được phát hiện trong giờ quan trắc gần nhất.
        </div>
      `;
      return;
    }

    hazards.forEach((h) => {
      const card = document.createElement("div");
      const level = h.level || "info";
      card.className = `alert-hazard-card alert-level-${level}`;

      const typeLabel = mapHazardTypeLabel(h.type);
      const levelLabel = mapLevelLabel(level);
      const headline = h.headline || "";
      const desc = h.description || "";
      const advices = Array.isArray(h.advices) ? h.advices : [];

      card.innerHTML = `
        <div class="hazard-header">
          <div class="hazard-type">${typeLabel}</div>
          <div class="hazard-level">${levelLabel}</div>
        </div>
        <div class="hazard-headline">${headline}</div>
        <div class="hazard-desc">${desc}</div>
        ${
          advices.length
            ? `
          <ul class="hazard-advices">
            ${advices.map((a) => `<li>${a}</li>`).join("")}
          </ul>
        `
            : ""
        }
      `;
      hazardsList.appendChild(card);
    });
  };
})(window);
