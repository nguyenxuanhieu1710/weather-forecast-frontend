// info.js
(function (w) {
  // ================== STATE ==================
  const alertState = {
    lastLocationId: null,
    lastSummary: null,
  };

  // ================== GỌI BACKEND PHẦN LATEST ==================
  async function fetchLatestObs(location_id) {
    if (!location_id) return null;
    try {
      const urlLatest = `${API_BASE}/obs/latest`;
      const res = await fetch(urlLatest, { cache: "no-store" });
      if (!res.ok) {
        console.error("[alerts] /obs/latest HTTP status", res.status);
        return null;
      }
      const json = await res.json();
      const arr = Array.isArray(json.data) ? json.data : [];
      const rec = arr.find((item) => item.location_id === location_id);
      if (!rec) {
        console.warn("[alerts] no latest obs for location_id", location_id);
        return null;
      }
      return rec;
    } catch (err) {
      console.error("[alerts] fetchLatestObs failed:", err);
      return null;
    }
  }

  // ================== GỌI BACKEND SUMMARY + GHÉP LATEST ==================
  w.fetchAlertSummary = async function (location_id) {
    console.log("[alerts] fetchAlertSummary location_id =", location_id);
    try {
      const url = `${API_BASE}/obs/summary/${location_id}`;

      const [resSummary, latestObs] = await Promise.all([
        fetch(url, { cache: "no-store" }),
        fetchLatestObs(location_id),
      ]);

      let summary = null;
      if (resSummary.ok) {
        summary = await resSummary.json();
      } else {
        console.error("[alerts] /obs/summary HTTP status", resSummary.status);
      }

      if (!summary && !latestObs) {
        return null;
      }

      if (!summary) {
        summary = {
          found: true,
          obs: {},
          current: { summary_text: "" },
          today: { summary_text: "" },
          alerts: {
            overall_level: "info",
            overall_comment: "Thời tiết tương đối ổn định.",
            hazards: [],
          },
        };
      }

      if (!summary.obs || typeof summary.obs !== "object") {
        summary.obs = {};
      }

      // Bơm số liệu mới nhất từ /obs/latest vào summary.obs
      if (latestObs) {
        summary.obs.temp_c = latestObs.temp_c;
        summary.obs.wind_ms = latestObs.wind_ms;
        summary.obs.wind_dir_deg = latestObs.wind_dir_deg;
        summary.obs.precip_mm = latestObs.precip_mm;
        summary.obs.rel_humidity_pct = latestObs.rel_humidity_pct;
        summary.obs.cloudcover_pct = latestObs.cloudcover_pct;
        summary.obs.surface_pressure_hpa = latestObs.surface_pressure_hpa;
        // Quan trọng: Cập nhật cả thời gian đo mới nhất nếu có
        if (latestObs.valid_at) {
            summary.obs.valid_at = latestObs.valid_at; 
        }
      }

      return summary;
    } catch (err) {
      console.error("[alerts] fetchAlertSummary failed:", err);
      return null;
    }
  };

  // ================== SHOW / HIDE PANEL ==================
  function doShowAlertPanel() {
    const panel = document.getElementById("alert-panel");
    if (!panel) return;
    panel.classList.remove("hidden");
  }

  w.showAlertPanel = function () {
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
  }

  // ================== MAP HANDLER ==================
  w.setAlertLocation = async function (location_id) {
    alertState.lastLocationId = location_id || null;
    if (!location_id) {
      alertState.lastSummary = null;
      w.updateAlertPanel(null);
      return;
    }
    const data = await w.fetchAlertSummary(location_id);
    alertState.lastSummary = data;
    w.updateAlertPanel(data);
  };

  // ================== TOGGLE BUTTON ==================
  const btnToggle = document.getElementById("alert-toggle");
  if (btnToggle) {
    btnToggle.addEventListener("click", async function () {
      const panel = document.getElementById("alert-panel");
      if (!panel) return;

      const isHidden = panel.classList.contains("hidden");
      if (!isHidden) {
        w.hideAlertPanel();
        return;
      }
      if (!alertState.lastSummary && alertState.lastLocationId) {
        const data = await w.fetchAlertSummary(alertState.lastLocationId);
        alertState.lastSummary = data;
        w.updateAlertPanel(data);
      }
      if (!alertState.lastLocationId) {
        w.updateAlertPanel(null);
      }
      doShowAlertPanel();
    });
  }

  // ================== HELPERS ==================
  function getWindDirection(deg) {
    if (deg == null) return "--";
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const index = Math.round(deg / 45) % 8;
    return dirs[index];
  }

  function mapHazardTypeLabel(type) {
    switch (type) {
      case "heavy_rain": return "Mưa lớn";
      case "heat": return "Nắng nóng";
      case "cold": return "Rét hại";
      case "strong_wind": return "Gió mạnh";
      case "thunderstorm": return "Dông lốc";
      case "flood": return "Lũ lụt";
      default: return type || "Khác";
    }
  }

  function mapLevelLabel(level) {
    switch (level) {
      case "low": return "Ít nguy cơ";
      case "medium": return "Cần chú ý";
      case "warning": return "Cảnh báo";
      case "danger": return "Nguy hiểm";
      default: return "Bình thường";
    }
  }

  /**
   * Tính toán xem tại thời điểm 'dateString' (UTC) thì ở VN (GMT+7) là ngày hay đêm.
   * Nếu dateString null -> lấy giờ hiện tại.
   * Đêm quy ước: < 6h sáng hoặc >= 18h tối (theo giờ VN)
   */
  function isNightInVN(dateString) {
    try {
        const d = dateString ? new Date(dateString) : new Date();
        // Lấy giờ UTC (0-23)
        const utcHour = d.getUTCHours();
        // Cộng 7 để ra giờ VN, dùng modulo 24 để quay vòng (ví dụ 18 + 7 = 25 -> 1h sáng)
        const vnHour = (utcHour + 7) % 24;
        
        // Debug để kiểm tra log
        // console.log(`UTC: ${utcHour}, VN Hour: ${vnHour}, isNight: ${vnHour < 6 || vnHour >= 18}`);
        
        return vnHour < 6 || vnHour >= 18;
    } catch (e) {
        console.error("Lỗi tính giờ VN:", e);
        return false; // Mặc định về ngày nếu lỗi
    }
  }

  // ================== RENDER UI ==================
  w.updateAlertPanel = function (data) {
    const boxOverview = document.getElementById("alert-overview");
    const boxToday = document.getElementById("alert-today");
    const boxCurrent = document.getElementById("alert-current");
    const hazardsList = document.getElementById("alert-hazards-list");

    if (!boxOverview || !boxToday || !boxCurrent || !hazardsList) return;

    // --- TRƯỜNG HỢP KHÔNG CÓ DỮ LIỆU ---
    if (!data || !data.obs || data.found === false) {
      boxOverview.innerHTML = `
        <div class="alert-overview-header">
          <span class="alert-badge alert-level-none">
            <i class="fa-solid fa-check-circle" style="margin-right:6px"></i> BÌNH THƯỜNG
          </span>
        </div>
        <p id="alert-overall-comment">Chưa có dữ liệu. Hãy chọn một điểm trên bản đồ.</p>
      `;
      boxToday.innerHTML = `<h3><i class="fa-solid fa-calendar-day"></i> Today's Weather</h3><div>--</div>`;
      boxCurrent.innerHTML = `<h3><i class="fa-solid fa-location-arrow"></i> Current Weather</h3><div>--</div>`;
      hazardsList.innerHTML = `<div class="alert-empty" style="color:#9ca3af; font-style:italic">Không có dữ liệu.</div>`;
      return;
    }

    const obs = data.obs || {};
    const todayText = data.today && data.today.summary_text ? data.today.summary_text : "Không có thông tin dự báo.";
    const currentText = data.current && data.current.summary_text ? data.current.summary_text : "";
    const alerts = data.alerts || {};
    const overallLevel = alerts.overall_level || "none";
    const overallComment = alerts.overall_comment || "Thời tiết ổn định, không có nguy cơ đáng kể.";

    // --- RENDER 1: OVERVIEW ---
    let iconOverview = `<i class="fa-solid fa-check-circle"></i>`;
    if (overallLevel === "warning") iconOverview = `<i class="fa-solid fa-triangle-exclamation"></i>`;
    if (overallLevel === "danger") iconOverview = `<i class="fa-solid fa-skull-crossbones"></i>`;

    boxOverview.innerHTML = `
      <div class="alert-overview-header">
        <span class="alert-badge alert-level-${overallLevel}">
          ${iconOverview} &nbsp; ${mapLevelLabel(overallLevel)}
        </span>
      </div>
      <p id="alert-overall-comment">${overallComment}</p>
    `;

    // --- RENDER 2: TODAY ---
    boxToday.innerHTML = `
      <h3><i class="fa-solid fa-calendar-day"></i> Tổng quan hôm nay</h3>
      <div class="alert-today-line">${todayText}</div>
    `;

    // --- RENDER 3: CURRENT WEATHER ---
    const tempStr = obs.temp_c != null ? `${obs.temp_c.toFixed(1)}°` : "--°";
    const windStr = obs.wind_ms != null ? `${obs.wind_ms.toFixed(1)} m/s` : "--";
    const windDirVal = obs.wind_dir_deg != null ? obs.wind_dir_deg : 0;
    const windDirText = obs.wind_dir_deg != null ? getWindDirection(obs.wind_dir_deg) : "--";
    const rainStr = obs.precip_mm != null ? `${obs.precip_mm.toFixed(1)} mm` : "0 mm";
    const humidityStr = obs.rel_humidity_pct != null ? `${obs.rel_humidity_pct.toFixed(0)}%` : "--%";
    const cloudStr = obs.cloudcover_pct != null ? `${obs.cloudcover_pct.toFixed(0)}%` : "--";
    const pressureStr = obs.surface_pressure_hpa != null ? `${obs.surface_pressure_hpa.toFixed(0)} hPa` : "--";

    // --- LOGIC ICON NGÀY / ĐÊM DỰA VÀO GMT+7 ---
    // Sử dụng obs.valid_at từ Backend để tính
    const hasRain = obs.precip_mm != null && Number.isFinite(obs.precip_mm) && obs.precip_mm > 0;
    const cloudPct = obs.cloudcover_pct != null && Number.isFinite(obs.cloudcover_pct) ? obs.cloudcover_pct : 0;
    
    // Gọi hàm tính giờ VN thay vì lấy giờ máy
    const isNight = isNightInVN(obs.valid_at); 

    let weatherIcon = `<i class="fa-solid fa-sun"></i>`;

    // Có mưa, 30–80% mây → icon nắng + mây + mưa (ngày) hoặc trăng + mây + mưa (đêm)
    if (hasRain && cloudPct >= 30 && cloudPct <= 80) {
      if (isNight) {
        weatherIcon = `<i class="fa-solid fa-cloud-moon-rain" style="color:#3b82f6"></i>`;
      } else {
        weatherIcon = `<i class="fa-solid fa-cloud-sun-rain" style="color:#3b82f6"></i>`;
      }
    }
    // Có mưa → icon mưa
    else if (hasRain) {
      weatherIcon = `<i class="fa-solid fa-cloud-showers-heavy" style="color:#3b82f6"></i>`;
    }
    // Không mưa, mây > 80% → icon mây xám
    else if (!hasRain && cloudPct > 80) {
      weatherIcon = `<i class="fa-solid fa-cloud" style="color:#64748b"></i>`;
    }
    // Không mưa, 30–80% mây → icon nắng + mây (ngày) hoặc trăng + mây (đêm)
    else if (!hasRain && cloudPct >= 30) {
      if (isNight) {
        weatherIcon = `<i class="fa-solid fa-cloud-moon" style="color:#facc15"></i>`;
      } else {
        weatherIcon = `<i class="fa-solid fa-cloud-sun" style="color:#f59e0b"></i>`;
      }
    }
    // Còn lại → trời quang
    else {
      if (isNight) {
        weatherIcon = `<i class="fa-solid fa-moon"></i>`;
      } else {
        weatherIcon = `<i class="fa-solid fa-sun"></i>`;
      }
    }

    boxCurrent.innerHTML = `
      <h3><i class="fa-solid fa-location-arrow"></i> Hiện tại</h3>
      <div class="current-flex-row">
         <div>
            <div class="alert-current-temp">${tempStr}</div>
         </div>
         <div class="current-icon-large">${weatherIcon}</div>
      </div>
      <div class="current-desc-text">${currentText}</div>
      <div class="alert-grid">
        <div class="alert-meta-item">
          <div class="alert-meta-label icon-wind"><i class="fa-solid fa-wind"></i> Gió</div>
          <div class="alert-meta-value">${windStr}</div>
        </div>
        <div class="alert-meta-item">
          <div class="alert-meta-label icon-compass"><i class="fa-regular fa-compass"></i> Hướng gió</div>
          <div class="alert-meta-value-row">
             <div class="wind-arrow-box" style="transform: rotate(${windDirVal + 180}deg);">
                <i class="fa-solid fa-arrow-up"></i>
             </div>
             <span>${windDirText} (${windDirVal}°)</span>
          </div>
        </div>
        <div class="alert-meta-item">
          <div class="alert-meta-label icon-rain"><i class="fa-solid fa-cloud-rain"></i> Mưa (1h)</div>
          <div class="alert-meta-value">${rainStr}</div>
        </div>
        <div class="alert-meta-item">
          <div class="alert-meta-label icon-humidity"><i class="fa-solid fa-droplet"></i> Độ ẩm</div>
          <div class="alert-meta-value">${humidityStr}</div>
        </div>
        <div class="alert-meta-item">
          <div class="alert-meta-label icon-cloud"><i class="fa-solid fa-cloud"></i> Mây</div>
          <div class="alert-meta-value">${cloudStr}</div>
        </div>
        <div class="alert-meta-item">
          <div class="alert-meta-label icon-pressure"><i class="fa-solid fa-gauge-high"></i> Áp suất</div>
          <div class="alert-meta-value">${pressureStr}</div>
        </div>
      </div>
    `;

    // --- RENDER 4: HAZARDS (CẢNH BÁO) ---
    hazardsList.innerHTML = "";
    const hazards = Array.isArray(alerts.hazards) ? alerts.hazards : [];

    if (!hazards.length) {
      hazardsList.innerHTML = `<div class="alert-empty" style="color:#9ca3af; font-style:italic; margin-top:8px;">Không có cảnh báo đặc biệt.</div>`;
      return;
    }

    hazards.forEach((h) => {
      const card = document.createElement("div");
      const level = h.level || "info";
      card.className = `alert-hazard-card alert-level-${level}`;
      let hazIcon = `<i class="fa-solid fa-circle-info"></i>`;
      if (h.type === "heavy_rain") hazIcon = `<i class="fa-solid fa-cloud-showers-water"></i>`;
      if (h.type === "heat") hazIcon = `<i class="fa-solid fa-temperature-arrow-up"></i>`;
      if (h.type === "strong_wind") hazIcon = `<i class="fa-solid fa-wind"></i>`;
      
      const typeLabel = mapHazardTypeLabel(h.type);
      const levelLabel = mapLevelLabel(level);
      const advices = Array.isArray(h.advices) ? h.advices : [];

      card.innerHTML = `
        <div class="hazard-header">
          <div class="hazard-type">${hazIcon} &nbsp; ${typeLabel}</div>
          <div class="hazard-level">${levelLabel}</div>
        </div>
        <div class="hazard-headline">${h.headline || ""}</div>
        <div class="hazard-desc">${h.description || ""}</div>
        ${advices.length ? `<ul class="hazard-advices">${advices.map((a) => `<li>${a}</li>`).join("")}</ul>` : ""}
      `;
      hazardsList.appendChild(card);
    });
  };
})(window);