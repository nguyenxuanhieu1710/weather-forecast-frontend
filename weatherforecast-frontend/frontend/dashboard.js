// dashboard.js
(function (w) {
  async function fetchObsOverview() {
    const url = `${API_BASE}/obs/overview`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`obs_overview HTTP ${res.status}`);
    }
    return await res.json();
  }

  function formatTemp(v) {
    if (v == null || Number.isNaN(v)) return "--°C";
    const n = Number(v);
    return `${n.toFixed(1)}°C`;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
  }

  // Sinh đoạn tóm tắt từ overview
  function buildSummaryText(data) {
    if (!data || data.count_locations == null || data.count_locations === 0) {
      return "Chưa có dữ liệu quan trắc để tổng hợp.";
    }

    const temp = data.temp || {};
    const rain = data.rain || {};
    const wind = data.wind || {};

    const avg = typeof temp.avg_c === "number" ? temp.avg_c : null;
    const hot35 = temp.hot_count_ge_35 || 0;
    const hot37 = temp.hot_count_ge_37 || 0;
    const raining = rain.raining_count || 0;
    const heavyRain = rain.heavy_rain_count || 0;
    const strongWind = wind.strong_wind_count || 0;

    const parts = [];

    // Phần nhiệt độ
    if (avg != null) {
      if (avg <= 18) {
        parts.push(`Nhiệt độ trung bình toàn quốc khoảng ${avg.toFixed(1)}°C, trời khá lạnh.`);
      } else if (avg <= 24) {
        parts.push(`Nhiệt độ trung bình khoảng ${avg.toFixed(1)}°C, thời tiết mát mẻ, dễ chịu.`);
      } else if (avg <= 30) {
        parts.push(`Nhiệt độ trung bình khoảng ${avg.toFixed(1)}°C, trời ấm, hơi nóng vào trưa.`);
      } else {
        parts.push(`Nhiệt độ trung bình khoảng ${avg.toFixed(1)}°C, thời tiết nóng trên diện rộng.`);
      }
    }

    if (hot37 > 0) {
      parts.push(`Có ${hot37} điểm xuất hiện nắng nóng gay gắt (≥ 37°C).`);
    } else if (hot35 > 0) {
      parts.push(`Khoảng ${hot35} điểm có nắng nóng (≥ 35°C).`);
    }

    // Phần mưa
    if (heavyRain > 0) {
      parts.push(`Có ${heavyRain} điểm đang có mưa vừa đến mưa to (≥ 5mm/h).`);
    } else if (raining > 0) {
      parts.push(`Khoảng ${raining} điểm có mưa, phân bố rải rác.`);
    } else {
      parts.push(`Không ghi nhận điểm nào đang có mưa.`);
    }

    // Phần gió
    if (strongWind > 0) {
      parts.push(`Có ${strongWind} điểm có gió mạnh (≥ 10 m/s), cần chú ý an toàn khi di chuyển ngoài trời.`);
    } else {
      parts.push(`Chưa ghi nhận khu vực có gió mạnh đáng kể.`);
    }

    return parts.join(" ");
  }

  async function initHomeDashboard() {
    const homePanel = document.getElementById("page-home");
    if (!homePanel) return;

    try {
      const data = await fetchObsOverview();
      console.log("[dashboard] obs_overview =", data);

      // Thời gian & số điểm
      if (data.obs_time) {
        const d = new Date(data.obs_time);
        const label = d.toLocaleString("vi-VN", {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
          day: "2-digit",
          month: "2-digit",
        });
        setText("home-obs-time", "Quan trắc: " + label);
      } else {
        setText("home-obs-time", "Quan trắc: --");
      }

      setText(
        "home-obs-count",
        "Số điểm: " + (data.count_locations ?? "--")
      );

      // Tóm tắt nhanh
      const summary = buildSummaryText(data);
      setText("home-summary-text", summary);

      // Nhiệt độ
      const temp = data.temp || {};
      setText("home-temp-avg", formatTemp(temp.avg_c));
      setText("home-temp-max", formatTemp(temp.max_c));
      setText("home-temp-min", formatTemp(temp.min_c));

      if (temp.hottest && temp.hottest.name) {
        setText(
          "home-temp-max-loc",
          `${temp.hottest.name} (${temp.hottest.lat.toFixed(
            1
          )}, ${temp.hottest.lon.toFixed(1)})`
        );
      } else {
        setText("home-temp-max-loc", "--");
      }

      if (temp.coldest && temp.coldest.name) {
        setText(
          "home-temp-min-loc",
          `${temp.coldest.name} (${temp.coldest.lat.toFixed(
            1
          )}, ${temp.coldest.lon.toFixed(1)})`
        );
      } else {
        setText("home-temp-min-loc", "--");
      }

      // Mưa
      const rain = data.rain || {};
      setText(
        "home-rain-count",
        rain.raining_count != null ? String(rain.raining_count) : "--"
      );
      setText(
        "home-rain-heavy-count",
        rain.heavy_rain_count != null ? String(rain.heavy_rain_count) : "--"
      );

      // Nắng nóng
      setText(
        "home-hot-35",
        temp.hot_count_ge_35 != null ? String(temp.hot_count_ge_35) : "--"
      );
      setText(
        "home-hot-37",
        temp.hot_count_ge_37 != null ? String(temp.hot_count_ge_37) : "--"
      );

      // Gió mạnh
      const wind = data.wind || {};
      setText(
        "home-strong-wind",
        wind.strong_wind_count != null ? String(wind.strong_wind_count) : "--"
      );
    } catch (err) {
      console.error("[dashboard] initHomeDashboard error:", err);
      setText("home-obs-time", "Quan trắc: lỗi dữ liệu");
      setText("home-obs-count", "Số điểm: --");
      setText(
        "home-summary-text",
        "Không lấy được dữ liệu tổng quan từ backend."
      );
    }
  }

  w.initHomeDashboard = initHomeDashboard;
})(window);
