// ===================== Detail panel =====================

function showDetail({ name, time, tempC, rainMm, windMs, lat, lon }) {
  document.getElementById("detail-location").textContent =
    name || "Điểm quan trắc";
  document.getElementById("detail-time").textContent = time || "--";
  document.getElementById("detail-temp").textContent =
    tempC != null && Number.isFinite(tempC) ? `${tempC.toFixed(1)} °C` : "--";
  document.getElementById("detail-rain").textContent =
    rainMm != null && Number.isFinite(rainMm) ? `${rainMm.toFixed(1)} mm` : "--";
  document.getElementById("detail-wind").textContent =
    windMs != null && Number.isFinite(windMs) ? `${windMs.toFixed(1)} m/s` : "--";
  document.getElementById("detail-coord").textContent =
    lat != null &&
    lon != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lon)
      ? `${lat.toFixed(4)}, ${lon.toFixed(4)}`
      : "--";
}

function hideDetail() {
  showDetail({
    name: "Chọn một điểm trên bản đồ",
    time: "--",
    tempC: null,
    rainMm: null,
    windMs: null,
    lat: null,
    lon: null
  });
}

// ===================== Search helper =====================

async function doSearchLocation(query) {
  const q = (query || "").trim();
  if (!q) return;

  try {
    const url = new URL(`https://${LQ_REGION}.locationiq.com/v1/search`);
    const params = {
      key: LQ_KEY,
      q,
      format: "json",
      countrycodes: "vn",
      "accept-language": "vi",
      normalizeaddress: 1
    };
    url.search = new URLSearchParams(params);

    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (Array.isArray(j) && j.length) {
      const it = j[0];
      const lat = +it.lat;
      const lon = +it.lon;
      map.flyTo([lat, lon], Math.max(map.getZoom(), 14));
      L.marker([lat, lon])
        .addTo(map)
        .bindPopup(`<b>${it.display_name}</b>`)
        .openPopup();
    }
  } catch (err) {
    console.error("Lỗi search LocationIQ:", err);
  }
}

// ===================== UI Events =====================

function initUIEvents() {
  const navBtns = document.querySelectorAll(".nav-btn");
  const pageHome = document.getElementById("page-home");
  const pageNotify = document.getElementById("page-notify");
  const pageInfo = document.getElementById("page-info");
  const pageMap = document.getElementById("page-map");

  const hideAllPanels = () => {
    if (pageHome) pageHome.style.display = "none";
    if (pageNotify) pageNotify.style.display = "none";
    if (pageInfo) pageInfo.style.display = "none";
  };

  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      navBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const page = btn.dataset.page;
      hideAllPanels();

      if (page === "home" && pageHome) {
        pageHome.style.display = "block";
      } else if (page === "notify" && pageNotify) {
        pageNotify.style.display = "block";
      } else if (page === "info" && pageInfo) {
        pageInfo.style.display = "block";
      } else if (page === "map" && pageMap) {
        // chỉ map
      }
    });
  });

  document
    .getElementById("detail-close")
    .addEventListener("click", () => hideDetail());

  const loginModal = document.getElementById("login-modal");
  document.getElementById("btn-login").addEventListener("click", () => {
    loginModal.classList.add("show");
  });
  document.getElementById("login-close").addEventListener("click", () => {
    loginModal.classList.remove("show");
  });

  loginModal.addEventListener("click", (e) => {
    if (e.target === loginModal) loginModal.classList.remove("show");
  });

  document.getElementById("login-submit").addEventListener("click", () => {
    const email = document.getElementById("login-email").value;
    const pw = document.getElementById("login-password").value;
    console.log("Login demo:", email, pw);
    loginModal.classList.remove("show");
  });

  document.getElementById("btn-layer-temp").addEventListener("click", () => {
    toggleTempLayer();
  });

  document.getElementById("btn-layer-rain").addEventListener("click", () => {
    toggleRainLayer();
  });

  document.getElementById("btn-layer-wind").addEventListener("click", () => {
    toggleWindLayer();
  });

  document.getElementById("btn-my-location").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], 11);
      L.marker([latitude, longitude])
        .addTo(map)
        .bindPopup("Vị trí của bạn")
        .openPopup();
    });
  });

  // KHÔNG CÒN btn-basemap, không đăng ký sự kiện gì cho nó

  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        const q = e.target.value.trim();
        if (!q) return;
        doSearchLocation(q);
      }
    });
  }
}
