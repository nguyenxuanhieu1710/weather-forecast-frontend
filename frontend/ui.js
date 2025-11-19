// ui.js
// Chứa các hàm giao diện độc lập: loading, label thời gian, panel chi tiết, search, GPS, timeseries

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
 * - loading: đang fetch
 * - error: lỗi
 * - ok: thành công / xóa message
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
    default:
      el.textContent = "";
      break;
  }
}

/**
 * Panel chi tiết 1 thời điểm (nearest + snapshot)
 */
function updateWeatherDetail(clickLat, clickLon, nearestResult, cell) {
  const panel = document.getElementById("weather-detail");
  if (!panel) return;

  const elTitle    = document.getElementById("detail-location");
  const elTime     = document.getElementById("detail-time");
  const elTemp     = document.getElementById("detail-temp");
  const elRain     = document.getElementById("detail-rain");
  const elWind     = document.getElementById("detail-wind");
  const elWindDir  = document.getElementById("detail-wind-dir");
  const elRH       = document.getElementById("detail-rh");
  const elCloud    = document.getElementById("detail-cloud");
  const elPressure = document.getElementById("detail-pressure");
  const elCoord    = document.getElementById("detail-coord");
  const elNearest  = document.getElementById("detail-nearest");

  panel.style.display = "block";

  // Tọa độ click
  if (elCoord && typeof clickLat === "number" && typeof clickLon === "number") {
    elCoord.textContent = `${clickLat.toFixed(4)}, ${clickLon.toFixed(4)}`;
  }

  // Điểm gần nhất (lat, lon từ nearestResult)
  if (elNearest) {
    if (
      nearestResult &&
      nearestResult.found &&
      typeof nearestResult.lat === "number" &&
      typeof nearestResult.lon === "number"
    ) {
      elNearest.textContent = `${nearestResult.lat.toFixed(
        4
      )}, ${nearestResult.lon.toFixed(4)}`;
    } else {
      elNearest.textContent = "--";
    }
  }

  // Tiêu đề
  if (elTitle) {
    if (nearestResult && nearestResult.name) {
      elTitle.textContent = nearestResult.name;
    } else if (nearestResult && nearestResult.found) {
      elTitle.textContent = "Thông tin điểm quan trắc gần nhất";
    } else {
      elTitle.textContent = "Không có dữ liệu gần điểm này";
    }
  }

  const hasCell = !!cell;

  // Thời gian (valid_at)
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

  // Gió: tốc độ
  if (elWind) {
    if (hasCell && typeof cell.wind_ms === "number") {
      elWind.textContent = `${cell.wind_ms.toFixed(1)} m/s`;
    } else {
      elWind.textContent = "--";
    }
  }

  // Hướng gió
  if (elWindDir) {
    if (hasCell && typeof cell.wind_dir_deg === "number") {
      elWindDir.textContent = `${Math.round(cell.wind_dir_deg)}°`;
    } else {
      elWindDir.textContent = "--";
    }
  }

  // Độ ẩm
  if (elRH) {
    if (hasCell && typeof cell.rel_humidity_pct === "number") {
      elRH.textContent = `${cell.rel_humidity_pct.toFixed(0)} %`;
    } else {
      elRH.textContent = "--";
    }
  }

  // Mây
  if (elCloud) {
    if (hasCell && typeof cell.cloudcover_pct === "number") {
      elCloud.textContent = `${cell.cloudcover_pct.toFixed(0)} %`;
    } else {
      elCloud.textContent = "--";
    }
  }

  // Áp suất bề mặt
  if (elPressure) {
    if (hasCell && typeof cell.surface_pressure_hpa === "number") {
      elPressure.textContent = `${cell.surface_pressure_hpa.toFixed(1)} hPa`;
    } else {
      elPressure.textContent = "--";
    }
  }
}

// ===================== Timeseries Panel (48h cho 1 điểm) =====================

function setTimeseriesStatus(type, msg) {
  const el = document.getElementById("ts-status");
  if (!el) return;

  switch (type) {
    case "loading":
      el.textContent = msg || "Đang tải…";
      break;
    case "error":
      el.textContent = msg || "Lỗi dữ liệu";
      break;
    case "ok":
    default:
      el.textContent = "";
      break;
  }
}

function setTimeseriesLocationName(name) {
  const el = document.getElementById("ts-location-name");
  if (!el) return;
  el.textContent = name || "";
}

function setTimeseriesSummary(records) {
  const el = document.getElementById("ts-summary");
  if (!el) return;

  if (!records || !records.length) {
    el.textContent = "";
    return;
  }

  const last = records[records.length - 1];

  let minTemp = +Infinity;
  let maxTemp = -Infinity;
  let sumRain = 0;

  for (const r of records) {
    if (typeof r.temp_c === "number") {
      if (r.temp_c < minTemp) minTemp = r.temp_c;
      if (r.temp_c > maxTemp) maxTemp = r.temp_c;
    }
    if (typeof r.precip_mm === "number") {
      sumRain += r.precip_mm;
    }
  }

  const nowTemp =
    typeof last.temp_c === "number" ? last.temp_c : null;
  const nowWind =
    typeof last.wind_ms === "number" ? last.wind_ms : null;
  const nowRain =
    typeof last.precip_mm === "number" ? last.precip_mm : 0;

  const fmt = (v, unit) =>
    typeof v === "number" && isFinite(v) ? `${v.toFixed(1)}${unit}` : "--";

  el.textContent =
    `Hiện tại: ${fmt(nowTemp, "°C")}, ` +
    `gió ${fmt(nowWind, " m/s")}, ` +
    `mưa giờ gần nhất ${fmt(nowRain, " mm")}. ` +
    `48h: T.min ${fmt(minTemp, "°C")}, ` +
    `T.max ${fmt(maxTemp, "°C")}, ` +
    `tổng mưa ${fmt(sumRain, " mm")}.`;
}

/**
 * Vẽ line chart đơn giản trên canvas
 */
function drawSimpleLine(canvasId, records, field, options = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (!records || !records.length) return;

  const values = records.map((r) =>
    typeof r[field] === "number" ? r[field] : null
  );

  const points = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    points.push({ idx: i, val: values[i] });
  }
  if (!points.length) return;

  let minVal = +Infinity;
  let maxVal = -Infinity;
  for (const p of points) {
    if (p.val < minVal) minVal = p.val;
    if (p.val > maxVal) maxVal = p.val;
  }
  if (!isFinite(minVal) || !isFinite(maxVal)) return;
  if (minVal === maxVal) {
    minVal -= 1;
    maxVal += 1;
  }

  const paddingX = 4;
  const paddingY = 4;
  const innerW = w - paddingX * 2;
  const innerH = h - paddingY * 2;

  ctx.lineWidth = 1;
  ctx.beginPath();

  points.forEach((p, i) => {
    const t = values.length > 1 ? p.idx / (values.length - 1) : 0;
    const x = paddingX + t * innerW;
    const yNorm = (p.val - minVal) / (maxVal - minVal);
    const y = paddingY + innerH * (1 - yNorm);

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  if (options.fill) {
    const lastPoint = points[points.length - 1];
    const firstPoint = points[0];
    const lastT = values.length > 1 ? lastPoint.idx / (values.length - 1) : 0;
    const firstT = values.length > 1 ? firstPoint.idx / (values.length - 1) : 0;
    const xLast = paddingX + lastT * innerW;
    const xFirst = paddingX + firstT * innerW;
    const yBase = paddingY + innerH;

    ctx.lineTo(xLast, yBase);
    ctx.lineTo(xFirst, yBase);
    ctx.closePath();
    const oldAlpha = ctx.globalAlpha;
    ctx.globalAlpha = 0.2;
    ctx.fill();
    ctx.globalAlpha = oldAlpha;
  }
}

function renderTimeseriesCharts(records) {
  drawSimpleLine("ts-temp", records, "temp_c");
  drawSimpleLine("ts-wind", records, "wind_ms");
  drawSimpleLine("ts-rain", records, "precip_mm", { fill: true });
}

// ===================== Search (LocationIQ) =====================

function initSearch() {
  const input = document.getElementById("search-input");
  if (!input) {
    console.error("Không tìm thấy #search-input trong DOM");
    return;
  }

  const iconSearch = document.querySelector(".search-box .ri-search-line");

  let box = document.getElementById("search-suggest");
  if (!box) {
    box = document.createElement("div");
    box.id = "search-suggest";
    box.className = "search-suggest";
    box.hidden = true;
    document.body.appendChild(box);
  }

  const debounce = (fn, ms = 350) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  function currentViewbox() {
    if (!window.map || !map.getBounds) return null;
    const b = map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    return `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;
  }

  function renderSuggest(items) {
    if (!items || !items.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }

    box.innerHTML = items
      .map((it, i) => `<div data-i="${i}">${it.label}</div>`)
      .join("");

    const rect = input.getBoundingClientRect();
    box.style.position = "absolute";
    box.style.top = window.scrollY + rect.bottom + "px";
    box.style.left = window.scrollX + rect.left + "px";
    box.style.width = rect.width + "px";
    box.style.zIndex = 9999;
    box.hidden = false;

    Array.from(box.children).forEach((el, i) => {
      el.onclick = () => {
        const it = items[i];
        flyTo(it.lat, it.lon, it.label);
        box.hidden = true;
      };
    });
  }

  const acFetch = debounce(async (q) => {
    q = (q || "").trim();
    if (q.length < 2) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    try {
      const u = new URL("https://api.locationiq.com/v1/autocomplete");
      const params = { key: LQ_KEY, q, limit: 8, countrycodes: "vn" };
      const vb = currentViewbox();
      if (vb) {
        params.viewbox = vb;
        params.bounded = 1;
      }
      u.search = new URLSearchParams(params);
      const r = await fetch(u);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const items = await r.json();
      const mapped = (Array.isArray(items) ? items : []).map((it) => ({
        lat: +it.lat,
        lon: +it.lon,
        label: it.display_name,
      }));
      renderSuggest(mapped);
    } catch (err) {
      console.error("Search autocomplete error:", err);
      box.hidden = true;
      box.innerHTML = "";
    }
  }, 350);

  async function doSearch(q) {
    q = (q || "").trim();
    if (!q) return;
    try {
      const u = new URL(`https://${LQ_REGION}.locationiq.com/v1/search`);
      const params = {
        key: LQ_KEY,
        q,
        format: "json",
        countrycodes: "vn",
        "accept-language": "vi",
        normalizeaddress: 1,
      };
      const vb = currentViewbox();
      if (vb) {
        params.viewbox = vb;
        params.bounded = 1;
      }
      u.search = new URLSearchParams(params);
      const r = await fetch(u);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (Array.isArray(j) && j.length) {
        const it = j[0];
        flyTo(+it.lat, +it.lon, it.display_name);
      } else {
        alert("Không tìm thấy địa điểm");
      }
    } catch (err) {
      console.error("Search error:", err);
      alert("Lỗi khi gọi API tìm kiếm");
    }
  }

  function flyTo(lat, lon, label) {
    if (!window.map) return;
    const z = map.getZoom ? map.getZoom() : 5;
    const targetZoom = Math.max(z, 11);
    map.flyTo([lat, lon], targetZoom);
    L.marker([lat, lon])
      .addTo(map)
      .bindPopup(`<b>${label || "Địa điểm"}</b>`)
      .openPopup();
  }

  input.addEventListener("input", (e) => acFetch(e.target.value));

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch(input.value);
    } else if (e.key === "Escape") {
      box.hidden = true;
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      box.hidden = true;
    }, 200);
  });

  if (iconSearch) {
    iconSearch.style.cursor = "pointer";
    iconSearch.addEventListener("click", () => {
      doSearch(input.value);
    });
  }

  window.doSearchLocation = doSearch;
}

// ===================== GPS / Geolocation =====================

function initGPS() {
  const btn = document.getElementById("btn-gps");
  if (!btn) {
    console.error("Không tìm thấy #btn-gps trong DOM");
    return;
  }

  if (!navigator.geolocation) {
    console.warn("Trình duyệt không hỗ trợ Geolocation");
    btn.disabled = true;
    btn.title = "Trình duyệt không hỗ trợ định vị";
    return;
  }

  let isBusy = false;

  btn.addEventListener("click", () => {
    if (isBusy) return;
    isBusy = true;
    btn.classList.add("loading");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        isBusy = false;
        btn.classList.remove("loading");

        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        if (!window.map) {
          console.error("Map chưa sẵn sàng");
          return;
        }

        // 1. Di chuyển map
        const curZoom = map.getZoom ? map.getZoom() : 5;
        const targetZoom = Math.max(curZoom, 11);
        map.flyTo([lat, lon], targetZoom);

        // 2. Marker vị trí hiện tại
        if (window.currentGPSMarker) {
          map.removeLayer(window.currentGPSMarker);
        }

        window.currentGPSMarker = L.circleMarker([lat, lon], {
          radius: 8,
          color: "#3388ff",
          weight: 2,
          fillColor: "#3388ff",
          fillOpacity: 0.85,
        })
          .addTo(map)
          .bindPopup(
            `<b>Vị trí của bạn</b><br>Lat: ${lat.toFixed(
              4
            )}<br>Lon: ${lon.toFixed(4)}`
          )
          .openPopup();

        // 3. Giả lập click vào map tại đúng vị trí GPS
        //    → chạy initMapClickForTimeseries() trong main.js
        if (typeof map.fire === "function" && typeof L !== "undefined") {
          map.fire("click", { latlng: L.latLng(lat, lon) });
        }
      },
      (err) => {
        isBusy = false;
        btn.classList.remove("loading");
        console.error("Geolocation error:", err);

        let msg = "Không lấy được vị trí GPS.";
        if (err.code === 1) msg += " Bạn đã chặn quyền truy cập vị trí.";
        if (err.code === 2) msg += " Vị trí không khả dụng.";
        if (err.code === 3) msg += " Quá thời gian chờ.";
        alert(msg);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  });
}



// ================= CẢNH BÁO THỜI TIẾT =================

// Quy tắc cảnh báo cho 1 điểm quan trắc
const ALERT_RULES = [
  {
    id: "heat",
    severity: "high",
    condition: p => p.temp_c >= 37,
    title: "Nắng nóng gay gắt",
    message: "Nhiệt độ trên 37°C. Hạn chế ở ngoài trời lâu, uống đủ nước."
  },
  {
    id: "hot",
    severity: "medium",
    condition: p => p.temp_c >= 34 && p.temp_c < 37,
    title: "Trời nóng",
    message: "Nhiệt độ cao, nên mặc đồ thoáng mát, tránh hoạt động mạnh ngoài trời."
  },
  {
    id: "heavy_rain",
    severity: "high",
    condition: p => p.precip_mm >= 30,
    title: "Mưa rất to",
    message: "Lượng mưa lớn, có nguy cơ ngập úng. Hạn chế di chuyển qua vùng trũng."
  },
  {
    id: "rain",
    severity: "low",
    condition: p => p.precip_mm >= 5 && p.precip_mm < 30,
    title: "Có mưa",
    message: "Mang theo áo mưa hoặc ô khi ra ngoài."
  },
  {
    id: "strong_wind",
    severity: "medium",
    condition: p => p.wind_ms >= 10, // ~36 km/h
    title: "Gió mạnh",
    message: "Gió mạnh, lưu ý khi di chuyển bằng xe máy hoặc đường biển."
  }
];

function buildAlertsForPoint(obs) {
  if (!obs) return [];
  const result = [];
  for (const rule of ALERT_RULES) {
    try {
      if (rule.condition(obs)) {
        result.push({
          id: rule.id,
          severity: rule.severity,
          title: rule.title,
          message: rule.message
        });
      }
    } catch (e) {
      // bỏ qua rule lỗi
    }
  }
  return result;
}

// Tạo danh sách cảnh báo từ danh sách điểm quan trắc
function buildAlertsFromObsList(obsList) {
  if (!Array.isArray(obsList)) return [];
  const all = [];

  for (const obs of obsList) {
    const alerts = buildAlertsForPoint(obs);
    for (const a of alerts) {
      all.push({
        ...a,
        lat: obs.lat,
        lon: obs.lon,
        temp_c: obs.temp_c,
        precip_mm: obs.precip_mm,
        wind_ms: obs.wind_ms
      });
    }
  }

  // gộp theo id (mỗi loại cảnh báo lấy nhiều điểm, giữ tối đa vài điểm)
  const grouped = {};
  for (const a of all) {
    if (!grouped[a.id]) grouped[a.id] = [];
    grouped[a.id].push(a);
  }

  const merged = [];
  for (const id in grouped) {
    const list = grouped[id];
    // sort điểm theo "mức độ mạnh" (ví dụ nhiệt độ cao nhất, mưa nhiều nhất)
    list.sort((x, y) => {
      return (y.temp_c || 0) - (x.temp_c || 0)
           || (y.precip_mm || 0) - (x.precip_mm || 0)
           || (y.wind_ms || 0) - (x.wind_ms || 0);
    });
    merged.push({
      ...list[0],
      count: list.length
    });
  }

  // sắp mức độ cảnh báo
  const severityRank = { high: 3, medium: 2, low: 1 };
  merged.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
  return merged;
}

// Render lên trang "Cảnh báo"
function renderAlertsPageFromObsList(obsList) {
  const container = document.getElementById("alerts-list");
  if (!container) return;

  const alerts = buildAlertsFromObsList(obsList);
  if (!alerts.length) {
    container.innerHTML = "<p>Hiện không có cảnh báo đáng chú ý.</p>";
    return;
  }

  const parts = alerts.map(a => {
    const cls = "alert-card alert-" + a.severity;
    const locText = a.lat && a.lon
      ? `Vị trí: ${a.lat.toFixed(3)}, ${a.lon.toFixed(3)}`
      : "";
    const extra = a.count && a.count > 1
      ? `Ghi nhận tại ${a.count} điểm quan trắc.`
      : "";

    return `
      <div class="${cls}">
        <div class="alert-card-header">
          <div class="alert-title">${a.title}</div>
          <div class="alert-badge">${a.severity.toUpperCase()}</div>
        </div>
        <p class="alert-message">${a.message}</p>
        <div class="alert-meta">
          ${locText} ${extra}
        </div>
      </div>
    `;
  });

  container.innerHTML = parts.join("");
}

// expose ra global để file khác gọi
window.renderAlertsPageFromObsList = renderAlertsPageFromObsList;
