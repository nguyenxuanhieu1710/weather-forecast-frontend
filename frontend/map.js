// ===================== Việt Nam border mask (Natural Earth) =====================

function loadVietnamBoundary() {
  // Dùng file Natural Earth đã tải về: ne_10m_admin_0_countries.geojson
  fetch("ne_10m_admin_0_countries.geojson")
    .then((r) => r.json())
    .then((data) => {
      if (!data || !Array.isArray(data.features)) {
        console.error("Natural Earth: dữ liệu không hợp lệ");
        return;
      }

      // Tìm Việt Nam trong bộ admin_0
      const vn = data.features.find((f) => {
        const p = f.properties || {};
        return (
          p.SOV_A3 === "VNM" ||
          p.ADM0_A3 === "VNM" ||
          p.ISO_A3 === "VNM" ||
          p.NAME === "Vietnam" ||
          p.NAME_LONG === "Vietnam"
        );
      });

      if (!vn) {
        console.error("Không tìm thấy Vietnam trong Natural Earth admin_0");
        return;
      }

      // Lưu geometry toàn VN để layers.js dùng cắt heatmap
      window.VN_GEOMETRY = vn.geometry;

      // Vẽ border VN lên map
      vietnamMask = L.geoJSON(vn, {
        pane: "meteo",
        style: {
          color: "#4b5563",
          weight: 1.2,
          fillOpacity: 0
        }
      }).addTo(map);
    })
    .catch((err) => {
      console.error("Lỗi load Natural Earth geojson:", err);
    });
}

// ===================== Map init =====================

function initMap() {
  map = L.map("map", {
    zoomControl: false,
    minZoom: 4,
    maxZoom: 18
  }).setView([16, 106], 5.5);

  // Chỉ dùng OSM, không dùng vệ tinh
  baseLightLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 20,
      attribution: "© OpenStreetMap contributors"
    }
  );

  baseLightLayer.addTo(map);

  L.control
    .zoom({
      position: "bottomright"
    })
    .addTo(map);

  map.createPane("meteo");
  map.getPane("meteo").style.zIndex = 420;
  map.getPane("meteo").style.mixBlendMode = "normal";

  map.on("click", (e) => {
    fetchAndShowWeatherFromObs(e.latlng.lat, e.latlng.lng);
  });

  loadVietnamBoundary();
  hideDetail();
}
