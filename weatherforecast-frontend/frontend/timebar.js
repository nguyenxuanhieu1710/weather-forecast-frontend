// timebar.js
// Thanh forecast kiểu Windy, hỗ trợ:
//  - Backend mới: { location_id, count, data: [ { valid_at, temp_c, precip_mm, wind_ms, cloudcover_pct, ... } ] }
//  - Backend cũ:  { steps/time_steps, snapshots, ... }
// Dùng local time để chia ngày, header ngày luôn khớp với track giờ.

(function (w) {
  // series: { time_steps, temp_c, rain_mm, wind_ms, cloud_pct, meta[] }
  let series = null;

  let trackEl, trackWrapEl, daysRowEl, cursorEl;
  let nowDatetimeEl, nowSummaryEl;
  let btnPrev, btnNext, btnPlay, btnToggle;
  let playTimer = null;
  let isPlaying = false;

  // PHẢI khớp với CSS (.fb-track grid-auto-columns, .fb-cell width)
  const CELL_WIDTH_PX = 42;

  // ================= Helpers thời gian =================

  function fmtDayLabel(d) {
    return d.toLocaleDateString("vi-VN", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    });
  }

  function fmtHour(d) {
    return d.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      hour12: false,
    });
  }

  function fmtNowLabel(d) {
    return d.toLocaleString("vi-VN", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // key ngày theo LOCAL TIME
  function localDayKey(d) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return (
      y +
      "-" +
      (m < 10 ? "0" + m : m) +
      "-" +
      (day < 10 ? "0" + day : day)
    );
  }

  function getSteps() {
    if (!series || !Array.isArray(series.time_steps)) return [];
    return series.time_steps;
  }

  function getCellElements() {
    return trackEl ? trackEl.querySelectorAll(".fb-cell") : [];
  }

  // ================= Temp → màu gradient =================

  function tempToColor(t, tMin, tMax) {
    if (typeof t !== "number" || isNaN(t)) return "#64748b";

    if (tMin === tMax) {
      return "#f97316";
    }

    let x = (t - tMin) / (tMax - tMin);
    if (x < 0) x = 0;
    if (x > 1) x = 1;

    if (x < 0.33) {
      const y = x / 0.33;
      return lerpColor("#38bdf8", "#22c55e", y); // xanh dương → xanh lá
    } else if (x < 0.66) {
      const y = (x - 0.33) / 0.33;
      return lerpColor("#22c55e", "#facc15", y); // xanh lá → vàng
    } else {
      const y = (x - 0.66) / 0.34;
      return lerpColor("#facc15", "#f97316", y); // vàng → cam
    }
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

  // ================= Icon thời tiết =================

  function pickIcon(meta, rainVal) {
    const rain = typeof rainVal === "number" ? rainVal : 0;
    const cloud = typeof meta?.cloudcover_pct === "number" ? meta.cloudcover_pct : 0;

    // Quy tắc hiển thị đúng chuẩn (Windy/LAMMA/OpenMeteo)
    if (rain >= 7) return "⛈";       // mưa lớn / giông mạnh
    if (rain >= 1) return "🌧";       // mưa vừa
    if (rain > 0)  return "🌦";       // mưa rất nhẹ

    // Không mưa → dùng cloud cover
    if (cloud >= 85) return "☁";      // trời u ám
    if (cloud >= 40) return "⛅";      // mây rải rác

    return "☀";                       // nắng
  }


  // ================= Chuẩn hoá dữ liệu backend =================

  function normalizeSeries(raw) {
    if (!raw) return null;

    // Backend mới
    if (Array.isArray(raw.data)) {
      const list = raw.data;
      const steps = [];
      const temps = [];
      const rains = [];
      const winds = [];
      const clouds = [];
      const meta = [];

      for (const obj of list) {
        if (!obj || !obj.valid_at) continue;
        steps.push(String(obj.valid_at));
        temps.push(typeof obj.temp_c === "number" ? obj.temp_c : null);
        rains.push(typeof obj.precip_mm === "number" ? obj.precip_mm : null);
        winds.push(typeof obj.wind_ms === "number" ? obj.wind_ms : null);
        clouds.push(
          typeof obj.cloudcover_pct === "number" ? obj.cloudcover_pct : null
        );
        meta.push({
          temp_c: obj.temp_c,
          precip_mm: obj.precip_mm,
          wind_ms: obj.wind_ms,
          cloudcover_pct: obj.cloudcover_pct,
        });
      }

      if (!steps.length) return null;

      return {
        time_steps: steps,
        temp_c: temps,
        rain_mm: rains,
        wind_ms: winds,
        cloud_pct: clouds,
        meta: meta,
      };
    }

    // Backend cũ
    const steps = raw.time_steps || raw.steps || [];
    if (!Array.isArray(steps) || !steps.length) return null;

    let tempArr = raw.temp_c;
    let rainArr = raw.rain_mm;
    let windArr = raw.wind_ms;
    const meta = [];

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
        const w = obs.wind_ms;
        const c = obs.cloudcover_pct;

        tempArr[i] = typeof t === "number" ? t : null;
        rainArr[i] = typeof r === "number" ? r : null;
        windArr[i] = typeof w === "number" ? w : null;
        meta.push({
          temp_c: tempArr[i],
          precip_mm: rainArr[i],
          wind_ms: windArr[i],
          cloudcover_pct: typeof c === "number" ? c : null,
        });
      }
    }

    return {
      time_steps: steps,
      temp_c: Array.isArray(tempArr) ? tempArr : [],
      rain_mm: Array.isArray(rainArr) ? rainArr : [],
      wind_ms: Array.isArray(windArr) ? windArr : [],
      cloud_pct: [],
      meta: meta,
    };
  }

  // ================= Header chia NGÀY theo local time =================

  function renderDaysRow() {
    if (!daysRowEl) return;
    daysRowEl.innerHTML = "";

    const steps = getSteps();
    if (!steps.length) return;

    // gom các bước theo ngày LOCAL
    const groups = [];
    let curKey = null;
    let curCount = 0;
    let curDate = null;

    steps.forEach((iso) => {
      const d = new Date(iso);
      const key = localDayKey(d);

      if (key !== curKey) {
        if (curKey !== null) {
          groups.push({ key: curKey, date: curDate, count: curCount });
        }
        curKey = key;
        curDate = d;
        curCount = 1;
      } else {
        curCount += 1;
      }
    });

    if (curKey !== null) {
      groups.push({ key: curKey, date: curDate, count: curCount });
    }

    daysRowEl.style.display = "flex";
    daysRowEl.style.flexWrap = "nowrap";
    daysRowEl.style.transform = "translateX(0px)";

    groups.forEach((g, idx) => {
      const groupEl = document.createElement("div");
      groupEl.className = "fb-day-group-head";
      // width = số giờ * CELL_WIDTH_PX, khớp hoàn toàn với track
      groupEl.style.flex = "0 0 " + g.count * CELL_WIDTH_PX + "px";

      if (idx % 2 === 0) groupEl.classList.add("fb-day-even");
      else groupEl.classList.add("fb-day-odd");

      const titleEl = document.createElement("div");
      titleEl.className = "fb-day-group-title";
      titleEl.textContent = fmtDayLabel(g.date);

      groupEl.appendChild(titleEl);
      daysRowEl.appendChild(groupEl);
    });
  }

  // ================= Track giờ =================

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

      const dayClass = dayIndex % 2 === 0 ? "fb-day-even" : "fb-day-odd";
      cell.classList.add(dayClass);
      if (isDayStart) {
        cell.classList.add("fb-day-start");
      }

      // giờ
      const hourEl = document.createElement("div");
      hourEl.className = "fb-cell-hour";
      hourEl.textContent = fmtHour(d);

      // icon
      const iconEl = document.createElement("div");
      iconEl.className = "fb-cell-icon";
      const rainVal = rains[idx];
      const meta = metas[idx] || null;
      iconEl.textContent = pickIcon(meta, rainVal);

      // temp chấm + số
      const tempDot = document.createElement("div");
      tempDot.className = "fb-cell-temp-dot";
      const tVal = temps[idx];
      if (typeof tVal === "number") {
        const c = tempToColor(tVal, tMin, tMax);
        tempDot.style.background = c;
      }

      const tempText = document.createElement("div");
      tempText.className = "fb-cell-temp-text";
      tempText.textContent = typeof tVal === "number" ? String(tVal) : "–";

      // gió
      const windEl = document.createElement("div");
      windEl.className = "fb-cell-wind";
      const wVal = winds[idx];
      windEl.textContent = typeof wVal === "number" ? String(wVal) : "";

      // mưa
      const rainBar = document.createElement("div");
      rainBar.className = "fb-cell-rain-bar";
      if (typeof rainVal === "number" && rMax > 0) {
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

      // click cell → cập nhật TimeState → ô đó sẽ được highlight trong syncFromTimeState
      cell.addEventListener("click", () => {
        if (w.TimeState && typeof TimeState.setCurrentIndex === "function") {
          TimeState.setCurrentIndex(idx);
        }
      });

      trackEl.appendChild(cell);
    });
  }

  // ================= Đồng bộ scroll header ngày với track giờ =================

  function syncDaysScroll() {
    if (!trackWrapEl || !daysRowEl) return;
    const x = trackWrapEl.scrollLeft || 0;
    daysRowEl.style.transform = "translateX(" + -x + "px)";
  }

  function scrollCellIntoView(cell) {
    if (!trackWrapEl || !cell) return;

    const wrap = trackWrapEl;
    const wrapRect = wrap.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();

    let targetScroll = wrap.scrollLeft;

    // chừa margin 40px hai bên
    const leftMargin = 40;
    const rightMargin = 40;

    if (cellRect.left < wrapRect.left + leftMargin) {
      targetScroll -= wrapRect.left + leftMargin - cellRect.left;
    } else if (cellRect.right > wrapRect.right - rightMargin) {
      targetScroll += cellRect.right - (wrapRect.right - rightMargin);
    } else {
      // đã nằm trong viewport
      return;
    }

    wrap.scrollTo({
      left: targetScroll,
      behavior: "smooth",
    });

    // đồng bộ header ngay lập tức để không thấy lệch
    syncDaysScroll();
  }

  // ================= Sync TimeState → UI =================

  function syncFromTimeState() {
    if (!w.TimeState || !trackEl || !series) return;
    if (typeof TimeState.getCurrentIndex !== "function") return;

    const steps = getSteps();
    if (!steps.length) return;

    let idx = TimeState.getCurrentIndex();
    if (typeof idx !== "number" || isNaN(idx)) return;
    if (idx < 0 || idx >= steps.length) return;

    const iso = steps[idx];
    const d = new Date(iso);
    if (isNaN(d)) return;

    // highlight cell
    const cells = getCellElements();
    cells.forEach((c) => c.classList.remove("active"));
    const active = trackEl.querySelector('.fb-cell[data-index="' + idx + '"]');
    if (active) {
      active.classList.add("active");
      scrollCellIntoView(active);

      // cập nhật vị trí cursor
      if (trackWrapEl && cursorEl) {
        const wrapRect = trackWrapEl.getBoundingClientRect();
        const cellRect = active.getBoundingClientRect();
        const relX = cellRect.left - wrapRect.left + cellRect.width / 2;
        cursorEl.style.left = relX + "px";
      }
    }

    // header text
    if (nowDatetimeEl) nowDatetimeEl.textContent = fmtNowLabel(d);

    if (nowSummaryEl) {
      const temps = series.temp_c || [];
      const rains = series.rain_mm || [];
      const winds = series.wind_ms || [];

      const t = temps[idx];
      const wVal = winds[idx];
      const rVal = rains[idx];

      const parts = [];
      if (typeof t === "number") parts.push("Nhiệt độ ~" + t.toFixed(2) + "°C");
      if (typeof wVal === "number")
        parts.push("gió " + wVal.toFixed(2) + " m/s");
      if (typeof rVal === "number" && rVal > 0.05)
        parts.push("mưa " + rVal.toFixed(2) + " mm");

      nowSummaryEl.textContent = parts.join(", ") || "Không có dữ liệu";
    }
  }

  // ================= Prev / Next / Play =================

  function togglePlay() {
    const steps = getSteps();
    if (!steps.length || !w.TimeState) return;
    if (typeof TimeState.getCurrentIndex !== "function") return;
    if (typeof TimeState.setCurrentIndex !== "function") return;

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
      const cur = TimeState.getCurrentIndex();
      const next = (cur + 1) % steps.length;
      TimeState.setCurrentIndex(next);
    }, 1500);
  }

  function goPrev() {
    if (!w.TimeState || typeof TimeState.setCurrentIndex !== "function") return;
    if (typeof TimeState.getCurrentIndex !== "function") return;
    const steps = getSteps();
    if (!steps.length) return;
    const cur = TimeState.getCurrentIndex();
    const next = Math.max(0, cur - 1);
    TimeState.setCurrentIndex(next);
  }

  function goNext() {
    if (!w.TimeState || typeof TimeState.setCurrentIndex !== "function") return;
    if (typeof TimeState.getCurrentIndex !== "function") return;
    const steps = getSteps();
    if (!steps.length) return;
    const cur = TimeState.getCurrentIndex();
    const next = Math.min(steps.length - 1, cur + 1);
    TimeState.setCurrentIndex(next);
  }

  // ================= Public API =================

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

    // wrapper chứa track – chính là element có scrollbar
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

    // đồng bộ scroll: kéo thanh cuộn → hàng ngày trượt tương ứng
    if (trackWrapEl && daysRowEl) {
      trackWrapEl.addEventListener("scroll", syncDaysScroll);
      syncDaysScroll();
    }

    if (w.TimeState && typeof TimeState.onTimeChange === "function") {
      TimeState.onTimeChange(syncFromTimeState);
    }
  }

  function setForecastSeries(raw) {
    series = normalizeSeries(raw);
    if (!series) return;

    renderDaysRow();
    renderTrack();
    syncDaysScroll();
    syncFromTimeState();
  }

  w.setupForecastBar = setupForecastBar;
  w.setForecastSeries = setForecastSeries;
})(window);
