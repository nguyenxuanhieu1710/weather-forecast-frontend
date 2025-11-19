// alerts.js
(function (w) {
  function formatTime(iso) {
    if (!iso) return "--:--";
    const d = new Date(iso);
    return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  }
  function degToVNDir(deg) {
    if (typeof deg !== "number" || isNaN(deg)) return "";
    const dirs = ["B","BĐ","Đ","NĐ","N","NT","T","BT"];
    const idx = Math.round(((deg % 360) / 45)) % 8;
    return dirs[idx];
  }

  // Vẽ vào card; true nếu DOM sẵn sàng, false nếu chưa
  function renderToCard(obs) {
    const timeEl = document.getElementById("alert-current-time");
    if (!timeEl) return false;

    const tVal   = document.getElementById("alert-temp-value");
    const tFeel  = document.getElementById("alert-temp-feel");
    const condEl = document.getElementById("alert-condition");
    const shade  = document.getElementById("alert-shade");
    const windEl = document.getElementById("alert-wind");
    const gustEl = document.getElementById("alert-gust");
    const aqiEl  = document.getElementById("alert-aqi");

    timeEl.textContent = formatTime(obs.valid_at);

    if (typeof obs.temp_c === "number") {
      if (tVal)  tVal.textContent  = Math.round(obs.temp_c);
      if (tFeel) tFeel.textContent = Math.round(obs.temp_c) + "°";
      if (shade) shade.textContent = Math.round(obs.temp_c - 1) + "°";
    }

    if (windEl) {
      const spd = typeof obs.wind_ms === "number" ? Math.round(obs.wind_ms*3.6) : null;
      const dir = degToVNDir(obs.wind_dir_deg);
      windEl.textContent = spd!=null ? `${dir?dir+" ": ""}${spd} km/h` : "-- km/h";
    }

    if (gustEl) {
      let g = null;
      if (typeof obs.wind_gust_ms === "number") g = Math.round(obs.wind_gust_ms*3.6);
      else if (typeof obs.wind_ms === "number") g = Math.round(obs.wind_ms*3.6*1.2);
      gustEl.textContent = g!=null ? `${g} km/h` : "-- km/h";
    }

    if (aqiEl) { aqiEl.textContent = "Vừa phải"; aqiEl.className = "alert-aqi-good"; }

    if (condEl) {
      let txt = "Thời tiết hiện tại";
      if (typeof obs.cloudcover_pct === "number") {
        txt = obs.cloudcover_pct < 20 ? "Trời quang" : obs.cloudcover_pct < 60 ? "Ít mây" : "Nhiều mây";
      }
      if (typeof obs.precip_mm === "number" && obs.precip_mm > 0) txt = "Có mưa";
      condEl.textContent = txt;
    }
    return true;
  }

  // Public: nhận obs, cache lại; nếu chưa có DOM thì hẹn vẽ
  function updateAlertFromObs(obs) {
    if (!obs) return;
    w.alertCurrentObs = obs; // cache cho router
    if (renderToCard(obs)) return;

    let tries = 30;
    const t = setInterval(() => {
      if (renderToCard(w.alertCurrentObs)) { clearInterval(t); }
      else if (--tries <= 0) { clearInterval(t); }
    }, 150);
  }

  // Khi người dùng mở tab Cảnh báo, tự vẽ lại từ cache
  const mo = new MutationObserver(() => {
    const panel = document.getElementById("page-alerts");
    const visible = panel && panel.style.display === "block";
    if (visible && w.alertCurrentObs) renderToCard(w.alertCurrentObs);
  });
  mo.observe(document.body, { childList: true, subtree: true });

  w.updateAlertFromObs = updateAlertFromObs;
})(window);
