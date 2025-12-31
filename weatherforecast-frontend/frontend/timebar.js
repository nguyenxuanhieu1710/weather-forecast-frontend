// timebar.js
// Thanh forecast kiểu Windy, hỗ trợ:
//  - Backend V2: { found, location, base_time, back_hours, forward_hours, count, steps: [ { valid_at, source, temp_c, precip_mm, wind_ms, cloudcover_pct, ... } ] }
//  - Backend V1: { location_id, count, data: [ { valid_at, temp_c, precip_mm, wind_ms, cloudcover_pct, ... } ] }
//  - Backend cũ: { steps/time_steps, snapshots, ... }
//
// Nguồn dữ liệu: "obs" (quan trắc) hoặc "fcst" (dự báo).
// Dùng local time để chia ngày, header ngày luôn khớp với track giờ.

(function (w) {
  // ===== DAILY state (cache theo location) =====
  let dailyCache = {
    locId: null,
    data: null, // payload /obs/daily
    ts: 0,
  };

  let dailyPopupEl = null;

  function ensureDailyPopup() {
    if (dailyPopupEl) return dailyPopupEl;

    const el = document.createElement("div");
    el.id = "fb-daily-popup";
    el.className = "fb-daily-popup hidden";
    el.innerHTML = `
      <div class="fb-daily-popup-card">
        <div class="wx-head">
          <div>
            <div id="fb-daily-title" class="wx-title"></div>
            <div id="fb-daily-sub" class="wx-sub"></div>
          </div>
          <button id="fb-daily-close" class="wx-close" type="button" aria-label="Đóng">✕</button>
        </div>
        <div id="fb-daily-body" class="wx-rows"></div>
      </div>
    `;

    const bar = document.getElementById("forecast-bar") || document.body;
    bar.appendChild(el);

    el.querySelector("#fb-daily-close")?.addEventListener("click", hideDailyPopup);

    // click ra ngoài -> đóng
    document.addEventListener("click", (ev) => {
      if (!dailyPopupEl || dailyPopupEl.classList.contains("hidden")) return;
      const card = dailyPopupEl.querySelector(".fb-daily-popup-card");
      if (card && !card.contains(ev.target)) hideDailyPopup();
    });

    dailyPopupEl = el;
    return el;
  }

  function hideDailyPopup() {
    if (!dailyPopupEl) return;
    dailyPopupEl.classList.add("hidden");
  }

  function getSelectedLocationIdForDaily(raw) {
    const ts = w.TimeState;
    if (ts && typeof ts.getLocationId === "function") {
      const v = ts.getLocationId();
      if (v) return v;
    }
    return (
      w.selectedLocationId ||
      raw?.location?.id ||
      raw?.location_id ||
      w.lastSummaryData?.location?.id ||
      w.lastTimeseriesData?.location?.id ||
      w.lastTimeseriesData?.location_id ||
      null
    );
  }

  async function fetchDaily(locId) {
    const base = (typeof w.API_BASE === "string" && w.API_BASE) ? w.API_BASE : "/api";
    const url = `${base}/obs/daily/${locId}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  function formatDailyHtml(day) {
    const f0 = (x) => (typeof x === "number" ? x.toFixed(0) : "–");
    const f1 = (x) => (typeof x === "number" ? x.toFixed(1) : "–");
    const f2 = (x) => (typeof x === "number" ? x.toFixed(2) : "–");

    return `
      <div class="wx-row">
        <div class="wx-k">Kind</div>
        <div class="wx-v wx-tabular">${day.kind || "–"}</div>
      </div>

      <div class="wx-row">
        <div class="wx-k">Giờ có dữ liệu</div>
        <div class="wx-v wx-tabular">${f0(day.hour_count)}/24</div>
      </div>


      <div class="wx-sep"></div>

      <div class="wx-row">
        <div class="wx-k">Nhiệt độ min / max</div>
        <div class="wx-v wx-tabular">${f1(day.temp_min_c)}°C / ${f1(day.temp_max_c)}°C</div>
      </div>

      <div class="wx-row">
        <div class="wx-k">Nhiệt độ TB</div>
        <div class="wx-v wx-tabular">${f1(day.temp_mean_c)}°C</div>
      </div>

      <div class="wx-row">
        <div class="wx-k">Tổng mưa</div>
        <div class="wx-v wx-tabular">${f2(day.precip_sum_mm)} mm</div>
      </div>

      <div class="wx-row">
        <div class="wx-k">Gió TB</div>
        <div class="wx-v wx-tabular">${f2(day.wind_mean_ms)} m/s</div>
      </div>

      <div class="wx-row">
        <div class="wx-k">Mây TB</div>
        <div class="wx-v wx-tabular">${f0(day.cloudcover_mean_pct)}%</div>
      </div>
    `;
  }

  async function showDailyPopupForDate(localDateStr, anchorEl) {
    const locId = getSelectedLocationIdForDaily(w.lastTimeseriesData);
    if (!locId) return;

    const popup = ensureDailyPopup();

    // cache theo (locId)
    const needFetch = dailyCache.locId !== locId || !dailyCache.data;

    if (needFetch) {
      try {
        const data = await fetchDaily(locId);
        dailyCache = { locId, data, ts: Date.now() };
        w.lastDailyData = data; // debug
      } catch (e) {
        const title = popup.querySelector("#fb-daily-title");
        const body = popup.querySelector("#fb-daily-body");
        const sub = popup.querySelector("#fb-daily-sub");

        if (title) title.textContent = `${localDateStr}`;
        if (sub) sub.textContent = "Vietnam";
        if (body) body.innerHTML = `<div class="fb-daily-error">Không lấy được daily: ${String(e.message || e)}</div>`;

        popup.classList.remove("hidden");
        positionDailyPopup(popup, anchorEl);
        return;
      }
    }

    const payload = dailyCache.data;
    const sub = popup.querySelector("#fb-daily-sub");
    if (sub) sub.textContent = (payload?.station_name || payload?.location?.name || "Vietnam");

    const day = Array.isArray(payload?.days)
      ? payload.days.find((x) => x && x.date === localDateStr)
      : null;

    const title = popup.querySelector("#fb-daily-title");
    const body = popup.querySelector("#fb-daily-body");

    if (title) title.textContent = `${localDateStr}`;

    if (!day) {
      if (body) body.innerHTML = `<div class="fb-daily-error">Không có dữ liệu cho ngày này.</div>`;
    } else {
      if (body) body.innerHTML = formatDailyHtml(day);
    }

    popup.classList.remove("hidden");
    positionDailyPopup(popup, anchorEl);
  }

  function positionDailyPopup(popup, anchorEl) {
    const card = popup.querySelector(".fb-daily-popup-card");
    if (!card) return;

    if (!anchorEl) {
      card.style.left = "50%";
      card.style.transform = "translateX(-50%)";
      return;
    }

    const r = anchorEl.getBoundingClientRect();
    const bar = document.getElementById("forecast-bar");
    const br = bar ? bar.getBoundingClientRect() : { left: 0, top: 0 };

    const x = (r.left + r.right) / 2 - br.left;
    card.style.left = `${Math.max(12, x - 180)}px`;
    card.style.transform = "none";
  }

  // series: { time_steps, temp_c, rain_mm, wind_ms, cloud_pct, meta[], sources[] }
  let series = null;

  let trackEl, trackWrapEl, daysRowEl, cursorEl;
  let nowCellIndex = -1;
  let nowDatetimeEl, nowSummaryEl;
  let btnPrev, btnNext, btnPlay, btnToggle;
  let playTimer = null;
  let isPlaying = false;

  const CELL_WIDTH_PX = 42;

  function fmtDayLabel(d) {
    return d.toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" });
  }
  function fmtHour(d) {
    return d.toLocaleTimeString("vi-VN", { hour: "2-digit", hour12: false });
  }
  function fmtNowLabel(d) {
    return d.toLocaleString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function localDayKey(d) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return y + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }

  function getSteps() {
    if (!series || !Array.isArray(series.time_steps)) return [];
    return series.time_steps;
  }

  function getCellElements() {
    return trackEl ? trackEl.querySelectorAll(".fb-cell") : [];
  }

  function tempToColor(t, tMin, tMax) {
    if (typeof t !== "number" || isNaN(t)) return "#64748b";
    if (tMin === tMax) return "#f97316";

    let x = (t - tMin) / (tMax - tMin);
    x = Math.max(0, Math.min(1, x));

    if (x < 0.33) return lerpColor("#38bdf8", "#22c55e", x / 0.33);
    if (x < 0.66) return lerpColor("#22c55e", "#facc15", (x - 0.33) / 0.33);
    return lerpColor("#facc15", "#f97316", (x - 0.66) / 0.34);
  }

  function lerpColor(c1, c2, t) {
    const a = hexToRgb(c1);
    const b = hexToRgb(c2);
    if (!a || !b) return c1;
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const b2 = Math.round(a.b + (b.b - a.b) * t);
    return "rgb(" + r + "," + g + "," + b2 + ")";
  }

  function hexToRgb(hex) {
    if (!hex) return null;
    const m = hex.replace("#", "");
    if (m.length !== 6) return null;
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return { r, g, b };
  }

  function pickIcon(meta, rainVal, dateObj) {
    const hasRain = typeof rainVal === "number" && Number.isFinite(rainVal) && rainVal > 0;
    const cloud = typeof meta?.cloudcover_pct === "number" && Number.isFinite(meta.cloudcover_pct) ? meta.cloudcover_pct : 0;

    const d = dateObj instanceof Date ? dateObj : new Date();
    const h = d.getHours();
    const isNight = h < 6 || h >= 18;

    if (hasRain && cloud >= 30 && cloud <= 80) return isNight ? "🌧️" : "🌦️";
    if (hasRain) return "🌧️";
    if (!hasRain && cloud > 80) return "☁️";
    if (!hasRain && cloud >= 30) return isNight ? "☁️" : "🌤️";
    return isNight ? "🌙" : "🌞";
  }

  function normalizeSeries(raw) {
    if (!raw) return null;

    // === Backend V2 ===
    if (Array.isArray(raw.steps) && raw.steps.length && raw.steps[0] && typeof raw.steps[0] === "object" && "valid_at" in raw.steps[0]) {
      const steps = [], temps = [], rains = [], winds = [], clouds = [], meta = [], sources = [];
      for (const obj of raw.steps) {
        if (!obj || !obj.valid_at) continue;
        steps.push(String(obj.valid_at));
        temps.push(typeof obj.temp_c === "number" ? obj.temp_c : null);
        rains.push(typeof obj.precip_mm === "number" ? obj.precip_mm : null);
        winds.push(typeof obj.wind_ms === "number" ? obj.wind_ms : null);
        clouds.push(typeof obj.cloudcover_pct === "number" ? obj.cloudcover_pct : null);
        sources.push(typeof obj.source === "string" ? obj.source : null);
        meta.push({
          temp_c: obj.temp_c,
          precip_mm: obj.precip_mm,
          wind_ms: obj.wind_ms,
          cloudcover_pct: obj.cloudcover_pct,
          rel_humidity_pct: obj.rel_humidity_pct,
          wind_dir_deg: obj.wind_dir_deg,
          surface_pressure_hpa: obj.surface_pressure_hpa,
          source: obj.source || null,
        });
      }
      if (!steps.length) return null;
      return { time_steps: steps, temp_c: temps, rain_mm: rains, wind_ms: winds, cloud_pct: clouds, meta, sources };
    }

    // === Backend V1 ===
    if (Array.isArray(raw.data)) {
      const steps = [], temps = [], rains = [], winds = [], clouds = [], meta = [], sources = [];
      for (const obj of raw.data) {
        if (!obj || !obj.valid_at) continue;
        steps.push(String(obj.valid_at));
        temps.push(typeof obj.temp_c === "number" ? obj.temp_c : null);
        rains.push(typeof obj.precip_mm === "number" ? obj.precip_mm : null);
        winds.push(typeof obj.wind_ms === "number" ? obj.wind_ms : null);
        clouds.push(typeof obj.cloudcover_pct === "number" ? obj.cloudcover_pct : null);
        sources.push(typeof obj.source === "string" ? obj.source : null);
        meta.push({
          temp_c: obj.temp_c,
          precip_mm: obj.precip_mm,
          wind_ms: obj.wind_ms,
          cloudcover_pct: obj.cloudcover_pct,
          rel_humidity_pct: obj.rel_humidity_pct,
          wind_dir_deg: obj.wind_dir_deg,
          surface_pressure_hpa: obj.surface_pressure_hpa,
          source: obj.source || null,
        });
      }
      if (!steps.length) return null;
      return { time_steps: steps, temp_c: temps, rain_mm: rains, wind_ms: winds, cloud_pct: clouds, meta, sources };
    }

    // === Backend cũ ===
    const steps = raw.time_steps || raw.steps || [];
    if (!Array.isArray(steps) || !steps.length) return null;

    let tempArr = raw.temp_c;
    let rainArr = raw.rain_mm;
    let windArr = raw.wind_ms;
    const meta = [];
    const sources = [];

    if (Array.isArray(raw.snapshots)) {
      const snaps = raw.snapshots;
      const len = Math.min(steps.length, snaps.length);

      tempArr = new Array(len);
      rainArr = new Array(len);
      windArr = new Array(len);

      for (let i = 0; i < len; i++) {
        const s = snaps[i] || {};
        const obs = s.obs || s;

        const t = obs.temp_c;
        const r = obs.rain_mm != null ? obs.rain_mm : obs.precip_mm;
        const wv = obs.wind_ms;
        const c = obs.cloudcover_pct;

        tempArr[i] = typeof t === "number" ? t : null;
        rainArr[i] = typeof r === "number" ? r : null;
        windArr[i] = typeof wv === "number" ? wv : null;

        meta.push({
          temp_c: tempArr[i],
          precip_mm: rainArr[i],
          wind_ms: windArr[i],
          cloudcover_pct: typeof c === "number" ? c : null,
          source: null,
        });
        sources.push(null);
      }
    }

    return {
      time_steps: steps,
      temp_c: Array.isArray(tempArr) ? tempArr : [],
      rain_mm: Array.isArray(rainArr) ? rainArr : [],
      wind_ms: Array.isArray(windArr) ? windArr : [],
      cloud_pct: [],
      meta,
      sources,
    };
  }

  function renderDaysRow() {
    if (!daysRowEl) return;
    daysRowEl.innerHTML = "";

    const steps = getSteps();
    if (!steps.length) return;

    // ✅ Sync TimeState theo dữ liệu đã lưu (không dùng biến raw ngoài scope)
    try {
      const raw = w.lastTimeseriesData;
      const locId =
        raw?.location?.id ||
        raw?.location_id ||
        w.lastSummaryData?.location?.id ||
        null;

      if (w.TimeState) {
        if (typeof w.TimeState.setLocationId === "function" && locId) w.TimeState.setLocationId(locId);
        if (typeof w.TimeState.initTimeSteps === "function") w.TimeState.initTimeSteps(steps);
      }
    } catch (_) {}

    let cellWidth = CELL_WIDTH_PX;
    if (trackEl && trackEl.firstElementChild) {
      const rect = trackEl.firstElementChild.getBoundingClientRect();
      if (rect && rect.width && isFinite(rect.width)) cellWidth = rect.width;
    }

    const groups = [];
    let curKey = null, curCount = 0, curDate = null;

    for (const iso of steps) {
      const d = new Date(iso);
      const key = localDayKey(d);
      if (key !== curKey) {
        if (curKey !== null) groups.push({ key: curKey, date: curDate, count: curCount });
        curKey = key;
        curDate = d;
        curCount = 1;
      } else {
        curCount += 1;
      }
    }
    if (curKey !== null) groups.push({ key: curKey, date: curDate, count: curCount });

    daysRowEl.style.display = "flex";
    daysRowEl.style.flexWrap = "nowrap";

    groups.forEach((g, idx) => {
      const groupEl = document.createElement("div");
      groupEl.className = "fb-day-group-head";
      groupEl.style.flex = "0 0 " + g.count * cellWidth + "px";
      groupEl.classList.add(idx % 2 === 0 ? "fb-day-even" : "fb-day-odd");

      const titleEl = document.createElement("div");
      titleEl.className = "fb-day-group-title";
      titleEl.textContent = fmtDayLabel(g.date);

      groupEl.style.cursor = "pointer";
      groupEl.title = "Xem thống kê theo ngày";
      groupEl.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        showDailyPopupForDate(g.key, groupEl);
      });

      groupEl.appendChild(titleEl);
      daysRowEl.appendChild(groupEl);
    });
  }

  function renderTrack() {
    if (!trackEl) return;
    trackEl.innerHTML = "";

    const steps = getSteps();
    if (!steps.length) return;

    const temps = series.temp_c || [];
    const rains = series.rain_mm || [];
    const winds = series.wind_ms || [];
    const metas = series.meta || [];

    const tempsValid = temps.filter((v) => typeof v === "number");
    const rainsValid = rains.filter((v) => typeof v === "number");

    const tMin = tempsValid.length ? Math.min(...tempsValid) : 0;
    const tMax = tempsValid.length ? Math.max(...tempsValid) : 0;
    const rMax = rainsValid.length ? Math.max(...rainsValid) : 0;

    let prevDayKey = null;
    let dayIndex = -1;

    steps.forEach((iso, idx) => {
      const d = new Date(iso);
      const dayKey = localDayKey(d);

      let isDayStart = false;
      if (dayKey !== prevDayKey) {
        dayIndex += 1;
        isDayStart = true;
        prevDayKey = dayKey;
      }

      const cell = document.createElement("div");
      cell.className = "fb-cell";
      cell.dataset.index = idx;

      // ===== SOURCE + FUTURE STYLE (obs / fcst / none) =====
      const tMs = Date.parse(iso);
      const isFuture = Number.isFinite(tMs) ? (tMs > Date.now()) : false;

      const srcRaw = (series.sources && series.sources[idx] != null)
        ? String(series.sources[idx]).toLowerCase()
        : null;

      // Chuẩn hoá nguồn: chỉ chấp nhận obs|fcst|none
      let src = (srcRaw === "obs" || srcRaw === "fcst" || srcRaw === "none") ? srcRaw : null;

      // fallback CHỈ khi không có source (null/undefined/khác):
      // - nếu tương lai => fcst, quá khứ => obs
      // - nhưng nếu backend đã trả "none" thì giữ nguyên none
      if (src == null) src = (isFuture ? "fcst" : "obs");

      // Gán class/stripe theo src
      if (src === "obs") {
        cell.classList.add("fb-src-obs");
        const srcBar = document.createElement("div");
        srcBar.className = "fb-cell-srcbar obs";
        cell.appendChild(srcBar);
      } else if (src === "fcst") {
        cell.classList.add("fb-src-fcst");
        const srcBar = document.createElement("div");
        srcBar.className = "fb-cell-srcbar fcst";
        cell.appendChild(srcBar);
      } else if (src === "none") {
        // không hiển thị thanh màu, không add fb-src-*
        cell.classList.add("fb-src-none"); // optional: để bạn style riêng nếu muốn
      }

      // tuỳ bạn: vẫn đánh dấu tương lai (kể cả none) để UI “mờ” hơn
      if (isFuture) cell.classList.add("fb-cell-future");



      const dayClass = dayIndex % 2 === 0 ? "fb-day-even" : "fb-day-odd";
      cell.classList.add(dayClass);
      if (isDayStart) cell.classList.add("fb-day-start");

      const hourEl = document.createElement("div");
      hourEl.className = "fb-cell-hour";
      hourEl.textContent = fmtHour(d);

      const iconEl = document.createElement("div");
      iconEl.className = "fb-cell-icon";
      const rainVal = rains[idx];
      const meta = metas[idx] || null;
      iconEl.textContent = pickIcon(meta, rainVal, d);

      const tempDot = document.createElement("div");
      tempDot.className = "fb-cell-temp-dot";
      const tVal = temps[idx];
      if (typeof tVal === "number") tempDot.style.background = tempToColor(tVal, tMin, tMax);

      const tempText = document.createElement("div");
      tempText.className = "fb-cell-temp-text";
      tempText.textContent = typeof tVal === "number" ? tVal.toFixed(1) : "–";

      const windEl = document.createElement("div");
      windEl.className = "fb-cell-wind";
      const wVal = winds[idx];
      windEl.textContent = typeof wVal === "number" ? wVal.toFixed(2) : "";

      const rainBar = document.createElement("div");
      rainBar.className = "fb-cell-rain-bar";
      if (typeof rainVal === "number" && rainVal > 0 && rMax > 0) {
        const h = 4 + (rainVal / rMax) * 18;
        rainBar.style.height = h + "px";
      } else {
        rainBar.style.height = "0px";
      }

      cell.appendChild(hourEl);
      cell.appendChild(iconEl);
      cell.appendChild(tempDot);
      cell.appendChild(tempText);
      cell.appendChild(windEl);
      cell.appendChild(rainBar);

      cell.addEventListener("click", () => {
        if (w.TimeState && typeof w.TimeState.setCurrentIndex === "function") {
          w.TimeState.setCurrentIndex(idx);
        }
      });

      trackEl.appendChild(cell);
    });
  }

  function syncDaysScroll() {
    if (!trackWrapEl || !daysRowEl) return;
    const x = trackWrapEl.scrollLeft || 0;
    daysRowEl.scrollLeft = x;
  }

  function scrollCellIntoView(cell) {
    if (!trackWrapEl || !cell) return;

    const wrap = trackWrapEl;
    const wrapRect = wrap.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();

    let targetScroll = wrap.scrollLeft;

    const leftMargin = 40;
    const rightMargin = 40;

    if (cellRect.left < wrapRect.left + leftMargin) {
      targetScroll -= wrapRect.left + leftMargin - cellRect.left;
    } else if (cellRect.right > wrapRect.right - rightMargin) {
      targetScroll += cellRect.right - (wrapRect.right - rightMargin);
    } else {
      return;
    }

    wrap.scrollTo({ left: targetScroll, behavior: "smooth" });
    syncDaysScroll();
  }

  function updateNowCursor() {
    if (!cursorEl || !trackWrapEl || !trackEl || !series) return;

    const steps = getSteps();
    if (!steps.length) return;

    const now = new Date();

    let currentIdx = -1;
    let tStart = null;
    let tEnd = null;

    for (let i = 0; i < steps.length; i++) {
      const t1 = new Date(steps[i]);
      const t2 = i < steps.length - 1 ? new Date(steps[i + 1]) : new Date(t1.getTime() + 3600000);
      if (now >= t1 && now < t2) {
        currentIdx = i;
        tStart = t1;
        tEnd = t2;
        break;
      }
    }

    if (currentIdx === -1) {
      cursorEl.style.display = "none";
      if (nowCellIndex !== -1 && trackEl) {
        const oldCell = trackEl.querySelector('.fb-cell[data-index="' + nowCellIndex + '"]');
        if (oldCell) oldCell.classList.remove("fb-cell-now");
      }
      nowCellIndex = -1;
      return;
    }

    cursorEl.style.display = "block";

    const cell = trackEl.querySelector('.fb-cell[data-index="' + currentIdx + '"]');
    if (!cell) return;

    const duration = tEnd.getTime() - tStart.getTime();
    const elapsed = now.getTime() - tStart.getTime();
    const ratio = duration > 0 ? elapsed / duration : 0;

    const wrapRect = trackWrapEl.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const relX = cellRect.left - wrapRect.left + cellRect.width * ratio;

    cursorEl.style.left = relX + "px";

    if (trackEl) {
      if (nowCellIndex !== -1 && nowCellIndex !== currentIdx) {
        const oldCell = trackEl.querySelector('.fb-cell[data-index="' + nowCellIndex + '"]');
        if (oldCell) oldCell.classList.remove("fb-cell-now");
      }
      if (nowCellIndex !== currentIdx) {
        cell.classList.add("fb-cell-now");
        nowCellIndex = currentIdx;
      }
    }
  }

  function syncFromTimeState() {
    if (!w.TimeState || !trackEl || !series) return;
    if (typeof w.TimeState.getCurrentIndex !== "function") return;

    const steps = getSteps();
    if (!steps.length) return;

    let idx = w.TimeState.getCurrentIndex();
    if (typeof idx !== "number" || isNaN(idx)) return;
    if (idx < 0 || idx >= steps.length) return;

    const iso = steps[idx];
    const d = new Date(iso);
    if (isNaN(d)) return;

    const cells = getCellElements();
    cells.forEach((c) => c.classList.remove("active"));
    const active = trackEl.querySelector('.fb-cell[data-index="' + idx + '"]');
    if (active) {
      active.classList.add("active");
      scrollCellIntoView(active);
    }

    updateNowCursor();

    if (nowDatetimeEl) nowDatetimeEl.textContent = fmtNowLabel(d);

    if (nowSummaryEl) {
      const temps = series.temp_c || [];
      const rains = series.rain_mm || [];
      const winds = series.wind_ms || [];
      const metas = series.meta || [];
      const sources = series.sources || [];

      const t = temps[idx];
      const r = rains[idx];
      const wv = winds[idx];

      const meta = metas[idx] || {};
      const cloud = meta.cloudcover_pct;
      const hum = meta.rel_humidity_pct;
      const wdir = meta.wind_dir_deg;
      const pres = meta.surface_pressure_hpa;

      const srcRaw = sources[idx];
      const src = typeof srcRaw === "string" ? srcRaw.toLowerCase() : null;

      const parts = [];

      if (src === "obs") parts.push(`<span style="color:#38bdf8;">Nguồn: Quan trắc</span>`);
      else if (src === "fcst") parts.push(`<span style="color:#facc15;">Nguồn: Dự báo</span>`);
      else if (src === "none") parts.push(`<span style="color:#94a3b8;">Nguồn: Không có dữ liệu</span>`);


      if (typeof t === "number") parts.push(`<span style="color:#f472b6;">Nhiệt độ ${t.toFixed(1)}°C</span>`);
      if (typeof wv === "number") parts.push(`<span style="color:#60a5fa;">Gió ${wv.toFixed(2)} m/s</span>`);
      if (typeof r === "number") parts.push(`<span style="color:#4ade80;">Mưa ${r.toFixed(2)} mm</span>`);
      if (typeof cloud === "number") parts.push(`<span style="color:#a5b4fc;">Mây ${cloud.toFixed(0)}%</span>`);
      if (typeof wdir === "number") parts.push(`<span style="color:#fde047;">Hướng gió ${wdir.toFixed(0)}°</span>`);
      if (typeof hum === "number") parts.push(`<span style="color:#2dd4bf;">Độ ẩm ${hum.toFixed(0)}%</span>`);
      if (typeof pres === "number") parts.push(`<span style="color:#f9a8d4;">Áp suất ${pres.toFixed(1)} hPa</span>`);

      nowSummaryEl.innerHTML = parts.join(", ");
    }
  }

  function togglePlay() {
    const steps = getSteps();
    if (!steps.length || !w.TimeState) return;
    if (typeof w.TimeState.getCurrentIndex !== "function") return;
    if (typeof w.TimeState.setCurrentIndex !== "function") return;

    if (isPlaying) {
      clearInterval(playTimer);
      playTimer = null;
      isPlaying = false;
      if (btnPlay) btnPlay.innerHTML = '<i class="ri-play-fill"></i>';
      return;
    }

    isPlaying = true;
    if (btnPlay) btnPlay.innerHTML = '<i class="ri-pause-fill"></i>';

    playTimer = setInterval(() => {
      const cur = w.TimeState.getCurrentIndex();
      const next = (cur + 1) % steps.length;
      w.TimeState.setCurrentIndex(next);
    }, 1500);
  }

  function goPrev() {
    if (!w.TimeState || typeof w.TimeState.setCurrentIndex !== "function") return;
    if (typeof w.TimeState.getCurrentIndex !== "function") return;
    const steps = getSteps();
    if (!steps.length) return;
    const cur = w.TimeState.getCurrentIndex();
    w.TimeState.setCurrentIndex(Math.max(0, cur - 1));
  }

  function goNext() {
    if (!w.TimeState || typeof w.TimeState.setCurrentIndex !== "function") return;
    if (typeof w.TimeState.getCurrentIndex !== "function") return;
    const steps = getSteps();
    if (!steps.length) return;
    const cur = w.TimeState.getCurrentIndex();
    w.TimeState.setCurrentIndex(Math.min(steps.length - 1, cur + 1));
  }

  function setupForecastBar() {
    trackEl = document.getElementById("fb-track");
    daysRowEl = document.getElementById("fb-row-days");
    cursorEl = document.getElementById("fb-cursor");
    nowDatetimeEl = document.getElementById("fb-now-datetime");
    nowSummaryEl = document.getElementById("fb-now-summary");
    btnPrev = document.getElementById("fb-prev");
    btnNext = document.getElementById("fb-next");
    btnPlay = document.getElementById("fb-play");
    btnToggle = document.getElementById("fb-toggle");

    trackWrapEl = trackEl ? trackEl.parentElement : null;

    if (!trackEl || !cursorEl || !trackWrapEl) return;

    if (btnPrev) btnPrev.addEventListener("click", goPrev);
    if (btnNext) btnNext.addEventListener("click", goNext);
    if (btnPlay) btnPlay.addEventListener("click", togglePlay);

    if (btnToggle) {
      btnToggle.addEventListener("click", () => {
        const bar = document.getElementById("forecast-bar");
        if (!bar) return;
        const collapsed = bar.classList.toggle("fb-collapsed");
        btnToggle.innerHTML = collapsed
          ? '<i class="ri-arrow-up-s-line"></i>'
          : '<i class="ri-arrow-down-s-line"></i>';
      });
    }

    if (trackWrapEl && daysRowEl) {
      trackWrapEl.addEventListener("scroll", () => {
        syncDaysScroll();
        updateNowCursor();
      });
      syncDaysScroll();
    }

    if (w.TimeState && typeof w.TimeState.onTimeChange === "function") {
      w.TimeState.onTimeChange(syncFromTimeState);
    }
  }

  function setForecastSeries(raw, opts) {
    const bar = document.getElementById("forecast-bar");
    if (bar) bar.classList.remove("fb-collapsed"); 

    w.lastTimeseriesData = raw || null;

    series = null;
    if (trackEl) trackEl.innerHTML = "";
    if (daysRowEl) daysRowEl.innerHTML = "";

    series = normalizeSeries(raw);
    if (!series) return;

    renderTrack();
    renderDaysRow();

    const steps = getSteps();
    if (!steps.length) return;

    // chọn index: preserveIso nếu có, còn lại bám theo giờ hiện tại
    let targetIdx = 0;
    const preserveIso = opts && typeof opts.preserveIso === "string" ? opts.preserveIso : null;

    if (preserveIso) {
      const t0 = new Date(preserveIso).getTime();
      if (isFinite(t0)) {
        let best = 0, bestDiff = Infinity;
        for (let i = 0; i < steps.length; i++) {
          const t = new Date(steps[i]).getTime();
          const diff = Math.abs(t - t0);
          if (diff < bestDiff) { bestDiff = diff; best = i; }
        }
        targetIdx = best;
      }
    } else {
      const nowMs = Date.now();

      let inBox = -1;
      for (let i = 0; i < steps.length; i++) {
        const t1 = Date.parse(steps[i]);
        const t2 = (i < steps.length - 1) ? Date.parse(steps[i + 1]) : (t1 + 3600000);
        if (Number.isFinite(t1) && Number.isFinite(t2) && nowMs >= t1 && nowMs < t2) {
          inBox = i; break;
        }
      }

      if (inBox !== -1) targetIdx = inBox;
      else {
        const tFirst = Date.parse(steps[0]);
        const tLast = Date.parse(steps[steps.length - 1]);
        if (Number.isFinite(tFirst) && nowMs < tFirst) targetIdx = 0;
        else if (Number.isFinite(tLast) && nowMs > tLast) targetIdx = steps.length - 1;
      }
    }

    if (w.TimeState && typeof w.TimeState.setCurrentIndex === "function") {
      w.TimeState.setCurrentIndex(targetIdx);
    } else {
      syncFromTimeState();
    }

    syncDaysScroll();
    updateNowCursor();
  }

  w.setupForecastBar = setupForecastBar;
  w.setForecastSeries = setForecastSeries;

  w.__timebar = {
    syncFromTimeState,
    updateNowCursor,
    getSteps,
  };
})(window);
