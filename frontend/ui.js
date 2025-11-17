// ui.js
// Chứa các hàm giao diện độc lập: toggle panel, hiển thị trạng thái dữ liệu, v.v.

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
 * - đang fetch
 * - lỗi
 * - thành công
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
      el.textContent = "";
      break;
    default:
      el.textContent = "";
  }
}

function updateWeatherDetail(clickLat, clickLon, nearestResult, cell) {
  const panel = document.getElementById("weather-detail");
  if (!panel) return;

  const elTitle = document.getElementById("detail-location");
  const elTime = document.getElementById("detail-time");
  const elTemp = document.getElementById("detail-temp");
  const elRain = document.getElementById("detail-rain");
  const elWind = document.getElementById("detail-wind");
  const elCoord = document.getElementById("detail-coord");

  // luôn hiện panel khi có click hợp lệ
  panel.style.display = "block";

  // Tọa độ click
  if (elCoord) {
    elCoord.textContent =
      `${clickLat.toFixed(4)}, ${clickLon.toFixed(4)}`;
  }

  // Tiêu đề: điểm gần nhất
  if (elTitle) {
    if (nearestResult && nearestResult.found &&
        typeof nearestResult.lat === "number" &&
        typeof nearestResult.lon === "number") {
      elTitle.textContent =
        `Điểm gần nhất: ${nearestResult.lat.toFixed(4)}, ${nearestResult.lon.toFixed(4)}`;
    } else {
      elTitle.textContent = "Không có dữ liệu gần điểm này";
    }
  }

  const hasCell = !!cell;

  // Thời gian (valid_at), không ghi chữ "Quan trắc"
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

  // Gió: tốc độ + hướng nếu có
  if (elWind) {
    let txt = "--";
    if (hasCell && typeof cell.wind_ms === "number") {
      txt = `${cell.wind_ms.toFixed(1)} m/s`;
      if (typeof cell.wind_dir_deg === "number") {
        txt += ` (${Math.round(cell.wind_dir_deg)}°)`;
      }
    }
    elWind.textContent = txt;
  }
}

/**
 * Bật/tắt giao diện điều khiển nếu cần
 */
function toggleControls(flag) {
  const el = document.getElementById("topbar");
  if (!el) return;
  el.style.opacity = flag ? "1" : "0.3";
}

// ===================== Search (LocationIQ) =====================

function initSearch() {
  const input = document.getElementById("search-input");
  if (!input) {
    console.error("Không tìm thấy #search-input trong DOM");
    return;
  }

  // Icon kính lúp trong ô search (nếu muốn bấm được)
  const iconSearch = document.querySelector(".search-box .ri-search-line");

  // Tạo box gợi ý nếu chưa có
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

    // Đặt box ngay dưới ô input
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

  // Gán event
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
    // Delay một chút để click vào item vẫn ăn
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

  // Expose global nếu cần dùng lại
  window.doSearchLocation = doSearch;
}

// Export global
window.showLoading = showLoading;
window.setObsTimeLabel = setObsTimeLabel;
window.showSnapshotStatus = showSnapshotStatus;
window.updateWeatherDetail = updateWeatherDetail;
window.toggleControls = toggleControls;
window.initSearch = initSearch;


// Export global
window.showLoading = showLoading;
window.setObsTimeLabel = setObsTimeLabel;
window.showSnapshotStatus = showSnapshotStatus;
window.updateWeatherDetail = updateWeatherDetail;
window.toggleControls = toggleControls;
