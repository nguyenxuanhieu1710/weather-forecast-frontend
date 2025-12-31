// info.js
(function (w) {
  // ================== STATE ==================
  const alertState = {
    lastLocationId: null,
    lastSummary: null,
  };

  // ================== LATEST GLOBAL CACHE (CHỈ 1 LẦN CHO TOÀN APP) ==================
  let latestAllMap = null;            // Map<string, object>
  let latestAllInflight = null;       // Promise<Map<string, object>>
  let latestAllTs = 0;                // timestamp cache
  const LATEST_ALL_TTL_MS = 60 * 1000; // 60s

  function normId(x) {
    return x == null ? "" : String(x);
  }

  function asNum(x) {
    if (x === null || x === undefined || x === "") return null;
    const n = (typeof x === "number") ? x : Number(x);
    return Number.isFinite(n) ? n : null;
  }

  async function fetchLatestAllOnce() {
    const now = Date.now();

    // TTL: nếu cache còn mới thì dùng luôn
    if (latestAllMap && (now - latestAllTs) < LATEST_ALL_TTL_MS) return latestAllMap;
    if (latestAllInflight) return await latestAllInflight;

    latestAllInflight = (async () => {
      try {
        const urlLatest = `${API_BASE}/obs/latest`;
        const res = await fetch(urlLatest, { cache: "no-store" });
        if (!res.ok) {
          console.error("[alerts] /obs/latest HTTP status", res.status);
          latestAllMap = new Map();
          latestAllTs = Date.now();
          return latestAllMap;
        }

        const json = await res.json();
        const arr = Array.isArray(json.data) ? json.data : [];

        const m = new Map();
        for (const item of arr) {
          if (!item || item.location_id == null) continue;
          m.set(String(item.location_id), item);
        }

        latestAllMap = m;
        latestAllTs = Date.now();
        return latestAllMap;
      } catch (err) {
        console.error("[alerts] fetchLatestAllOnce failed:", err);
        latestAllMap = new Map();
        latestAllTs = Date.now();
        return latestAllMap;
      } finally {
        latestAllInflight = null;
      }
    })();

    return await latestAllInflight;
  }

  async function getLatestObsFromGlobalCache(location_id) {
    const id = normId(location_id);
    if (!id) return null;
    const m = await fetchLatestAllOnce();
    return m.get(id) || null;
  }

  // ================== FLOOD RISK GLOBAL CACHE (CHỈ 1 LẦN CHO TOÀN APP) ==================
  let floodRiskMap = null;            // Map<string, object>
  let floodRiskInflight = null;       // Promise<Map<string, object>>
  let floodRiskTs = 0;                // timestamp cache
  const FLOOD_RISK_TTL_MS = 60 * 1000; // 60s

  async function fetchFloodRiskLatestOnce() {
    const now = Date.now();
    if (floodRiskMap && (now - floodRiskTs) < FLOOD_RISK_TTL_MS) return floodRiskMap;
    if (floodRiskInflight) return await floodRiskInflight;

    floodRiskInflight = (async () => {
      try {
        const url = `${API_BASE}/obs/flood_risk_latest`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          console.error("[alerts] /obs/flood_risk_latest HTTP status", res.status);
          floodRiskMap = new Map();
          floodRiskTs = Date.now();
          return floodRiskMap;
        }

        const json = await res.json();
        const arr = Array.isArray(json.data) ? json.data : [];

        const m = new Map();
        for (const item of arr) {
          if (!item || item.location_id == null) continue;
          m.set(String(item.location_id), item);
        }

        floodRiskMap = m;
        floodRiskTs = Date.now();
        return floodRiskMap;
      } catch (err) {
        console.error("[alerts] fetchFloodRiskLatestOnce failed:", err);
        floodRiskMap = new Map();
        floodRiskTs = Date.now();
        return floodRiskMap;
      } finally {
        floodRiskInflight = null;
      }
    })();

    return await floodRiskInflight;
  }

  async function getFloodRiskForLocation(location_id) {
    const id = normId(location_id);
    // Mặc định trả về raw là NONE
    if (!id) return { level: "NONE", raw: null };
    const m = await fetchFloodRiskLatestOnce();
    const raw = m.get(id) || null;
    // Trả về level gốc từ API (tiếng Anh) để xử lý hiển thị sau
    return { level: raw?.risk_level || "NONE", raw };
  }


  // ================== GỌI BACKEND SUMMARY + GHÉP LATEST (KHÔNG SPAM) ==================
  w.fetchAlertSummary = async function (location_id) {
    const id = normId(location_id);
    console.log("[alerts] fetchAlertSummary location_id =", id);
    if (!id) return null;

    try {
      const url = `${API_BASE}/obs/summary/${id}`;
      const resSummary = await fetch(url, { cache: "no-store" });

      let summary = null;
      if (resSummary.ok) {
        summary = await resSummary.json();
      } else {
        console.error("[alerts] /obs/summary HTTP status", resSummary.status);
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

      if (!summary.obs || typeof summary.obs !== "object") summary.obs = {};
      const obs = summary.obs;

      // Chỉ fetch latest nếu THIẾU field nào đó
      const missingAny =
        obs.wind_dir_deg == null ||
        obs.rel_humidity_pct == null ||
        obs.cloudcover_pct == null ||
        obs.surface_pressure_hpa == null;

      if (missingAny) {
        const latestObs = await getLatestObsFromGlobalCache(id);
        if (latestObs) {
          // QUAN TRỌNG: chỉ fill field đang thiếu, KHÔNG overwrite temp/wind/precip nếu summary đã có
          if (obs.temp_c == null && latestObs.temp_c != null) obs.temp_c = latestObs.temp_c;
          if (obs.wind_ms == null && latestObs.wind_ms != null) obs.wind_ms = latestObs.wind_ms;
          if (obs.precip_mm == null && latestObs.precip_mm != null) obs.precip_mm = latestObs.precip_mm;

          if (obs.wind_dir_deg == null && latestObs.wind_dir_deg != null) obs.wind_dir_deg = latestObs.wind_dir_deg;
          if (obs.rel_humidity_pct == null && latestObs.rel_humidity_pct != null) obs.rel_humidity_pct = latestObs.rel_humidity_pct;
          if (obs.cloudcover_pct == null && latestObs.cloudcover_pct != null) obs.cloudcover_pct = latestObs.cloudcover_pct;
          if (obs.surface_pressure_hpa == null && latestObs.surface_pressure_hpa != null) obs.surface_pressure_hpa = latestObs.surface_pressure_hpa;

          if (obs.valid_at == null && latestObs.valid_at) obs.valid_at = latestObs.valid_at;
        }
      }

      // (Khuyến nghị) Chuẩn hoá về số để tránh lỗi toFixed khi backend trả string
      obs.temp_c = asNum(obs.temp_c);
      obs.wind_ms = asNum(obs.wind_ms);
      obs.precip_mm = asNum(obs.precip_mm);
      obs.wind_dir_deg = asNum(obs.wind_dir_deg);
      obs.rel_humidity_pct = asNum(obs.rel_humidity_pct);
      obs.cloudcover_pct = asNum(obs.cloudcover_pct);
      obs.surface_pressure_hpa = asNum(obs.surface_pressure_hpa);
      
      // ================== GHÉP THÊM FLOOD RISK ==================
      try {
        const fr = await getFloodRiskForLocation(id);
        summary.flood_risk = {
          level: fr.level,              // NONE/LOW/MEDIUM/HIGH/EXTREME (English)
          valid_at: fr.raw?.valid_at || null,
          rain_1h_mm: asNum(fr.raw?.rain_1h_mm),
          rain_3h_mm: asNum(fr.raw?.rain_3h_mm),
          risk_score: asNum(fr.raw?.risk_score),
        };
      } catch (e) {
        console.warn("[alerts] flood risk fetch failed:", e);
        summary.flood_risk = { level: "NONE", valid_at: null };
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

  // Chuẩn hoá level từ backend về bộ frontend dùng: none|low|medium|warning|danger
  function normalizeLevel(x) {
    const s = (x == null ? "" : String(x)).toLowerCase().trim();

    // Backend hay trả info/watch -> quy về medium theo yêu cầu "Cần chú ý"
    if (s === "watch") return "medium";
    if (s === "info") return "medium";

    if (s === "none" || s === "" || s === "normal" || s === "ok") return "none"; // Fix: return 'none' code, not vietnamese here
    if (s === "low") return "low";
    if (s === "medium") return "medium";
    if (s === "warning") return "warning";
    if (s === "danger") return "danger";

    // fallback
    return "none";
  }

  // Đảm bảo card hazard cũng dùng cùng bộ level
  function normalizeHazardLevel(x) {
    return normalizeLevel(x);
  }


  function isNightInVN(dateString) {
    try {
      const d = dateString ? new Date(dateString) : new Date();
      const utcHour = d.getUTCHours();
      const vnHour = (utcHour + 7) % 24;
      return vnHour < 6 || vnHour >= 18;
    } catch (e) {
      console.error("Lỗi tính giờ VN:", e);
      return false;
    }
  }

  // ================== RENDER UI ==================
  w.updateAlertPanel = function (data) {
    const boxOverview = document.getElementById("alert-overview");
    const boxToday = document.getElementById("alert-today");
    const boxCurrent = document.getElementById("alert-current");
    const hazardsList = document.getElementById("alert-hazards-list");

    if (!boxOverview || !boxToday || !boxCurrent || !hazardsList) return;

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
    const overallLevel = normalizeLevel(alerts.overall_level || "none");
    const overallComment = alerts.overall_comment || "Thời tiết ổn định, không có nguy cơ đáng kể.";

    let iconOverview = `<i class="fa-solid fa-check-circle"></i>`;
    if (overallLevel === "low") iconOverview = `<i class="fa-solid fa-circle-info"></i>`;
    if (overallLevel === "medium") iconOverview = `<i class="fa-solid fa-circle-exclamation"></i>`;
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

    boxToday.innerHTML = `
      <h3><i class="fa-solid fa-calendar-day"></i> Tổng quan hôm nay</h3>
      <div class="alert-today-line">${todayText}</div>
    `;

    // --- Xử lý hiển thị Flood Risk ---
    const flood = data.flood_risk || {};
    const rawFloodLevel = (flood.level || "NONE").toUpperCase();
    
    // Mapping từ API Code sang thông tin hiển thị và CSS class
    const floodMap = {
        "NONE":     { label: "KHÔNG CÓ NGUY CƠ",    css: "none" },
        "LOW":      { label: "NGUY CƠ THẤP",        css: "low" },
        "MEDIUM":   { label: "NGUY CƠ TRUNG BÌNH",  css: "medium" },
        "HIGH":     { label: "NGUY CƠ CAO",         css: "high" },
        "EXTREME":  { label: "NGUY CƠ CỰC CAO",     css: "extreme" }
    };
    
    // Fallback nếu api trả về text lạ
    const floodInfo = floodMap[rawFloodLevel] || floodMap["NONE"];

    const tempStr = obs.temp_c != null ? `${obs.temp_c.toFixed(1)}°` : "--°";
    const windStr = obs.wind_ms != null ? `${obs.wind_ms.toFixed(1)} m/s` : "--";
    const windDirVal = obs.wind_dir_deg != null ? obs.wind_dir_deg : 0;
    const windDirText = obs.wind_dir_deg != null ? getWindDirection(obs.wind_dir_deg) : "--";
    const rainStr = obs.precip_mm != null ? `${obs.precip_mm.toFixed(1)} mm` : "0 mm";
    const humidityStr = obs.rel_humidity_pct != null ? `${obs.rel_humidity_pct.toFixed(0)}%` : "--%";
    const cloudStr = obs.cloudcover_pct != null ? `${obs.cloudcover_pct.toFixed(0)}%` : "--";
    const pressureStr = obs.surface_pressure_hpa != null ? `${obs.surface_pressure_hpa.toFixed(0)} hPa` : "--";

    const hasRain = obs.precip_mm != null && Number.isFinite(obs.precip_mm) && obs.precip_mm > 0;
    const cloudPct = obs.cloudcover_pct != null && Number.isFinite(obs.cloudcover_pct) ? obs.cloudcover_pct : 0;
    const isNight = isNightInVN(obs.valid_at);

    let weatherIcon = `<i class="fa-solid fa-sun"></i>`;
    if (hasRain && cloudPct >= 30 && cloudPct <= 80) {
      weatherIcon = isNight
        ? `<i class="fa-solid fa-cloud-moon-rain" style="color:#3b82f6"></i>`
        : `<i class="fa-solid fa-cloud-sun-rain" style="color:#3b82f6"></i>`;
    } else if (hasRain) {
      weatherIcon = `<i class="fa-solid fa-cloud-showers-heavy" style="color:#3b82f6"></i>`;
    } else if (!hasRain && cloudPct > 80) {
      weatherIcon = `<i class="fa-solid fa-cloud" style="color:#64748b"></i>`;
    } else if (!hasRain && cloudPct >= 30) {
      weatherIcon = isNight
        ? `<i class="fa-solid fa-cloud-moon" style="color:#facc15"></i>`
        : `<i class="fa-solid fa-cloud-sun" style="color:#f59e0b"></i>`;
    } else {
      weatherIcon = isNight ? `<i class="fa-solid fa-moon"></i>` : `<i class="fa-solid fa-sun"></i>`;
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
            <div class="wind-arrow-box" style="transform: rotate(${(windDirVal + 180).toFixed(0)}deg);">
                <i class="fa-solid fa-arrow-up"></i>
            </div>
            <span>${windDirText} (${windDirVal.toFixed(0)}°)</span>
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
        
        <div class="alert-meta-item">
          <div class="alert-meta-label icon-flood"><i class="fa-solid fa-water"></i> Lũ lụt</div>
          <div class="alert-meta-value">
            <span class="flood-badge flood-${floodInfo.css}">${floodInfo.label}</span>
          </div>
        </div>
      </div>
    `;

    
    hazardsList.innerHTML = "";
    const hazards = Array.isArray(alerts.hazards) ? alerts.hazards : [];
    if (!hazards.length) {
      hazardsList.innerHTML = `<div class="alert-empty" style="color:#9ca3af; font-style:italic; margin-top:8px;">Không có cảnh báo đặc biệt.</div>`;
      return;
    }

    hazards.forEach((h) => {
      const card = document.createElement("div");
      const level = normalizeHazardLevel(h.level || "none");
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