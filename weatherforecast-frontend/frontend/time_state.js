// time_state.js
// Quản lý trạng thái thời gian chung cho map/layers/forecast-bar

(function (w) {
  /** @type {string[]} */
  let timeSteps = [];      // Mảng ISO time từng giờ, đã sort tăng dần
  /** @type {number} */
  let currentIndex = 0;    // Index hiện tại trong timeSteps
  /** @type {Function[]} */
  const listeners = [];    // Các callback sẽ được gọi khi thời gian đổi

  // thêm state
  let locationId = null;

  function setLocationId(id) {
    locationId = id != null ? String(id) : null;
  }

  function getLocationId() {
    return locationId;
  }


  // ==========================
  // Khởi tạo danh sách thời gian
  // ==========================
  function initTimeSteps(list) {
    timeSteps = Array.isArray(list) ? list.slice() : [];
    timeSteps.sort((a, b) => (Date.parse(a) || 0) - (Date.parse(b) || 0));
    if (!timeSteps.length) {
      currentIndex = 0;
      return;
    }

    // Chọn index gần "bây giờ" nhất làm mặc định
    const now = Date.now();
    let bestIdx = 0;
    let bestDiff = Infinity;

    timeSteps.forEach((iso, i) => {
      const t = new Date(iso).getTime();
      const diff = Math.abs(t - now);
      if (!isNaN(t) && diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    });

    currentIndex = bestIdx;
    notify();
  }

  // ==========================
  // Getter cơ bản
  // ==========================
  function getTimeSteps() {
    return timeSteps;
  }

  function getCurrentIndex() {
    return currentIndex;
  }

  function getCurrentTime() {
    return timeSteps[currentIndex] || null;
  }

  // ==========================
  // Đặt index tuyệt đối
  // ==========================
  function setCurrentIndex(idx) {
    if (!timeSteps.length) return;

    if (idx < 0) idx = 0;
    if (idx >= timeSteps.length) idx = timeSteps.length - 1;

    if (idx === currentIndex) return; // không đổi thì thôi

    currentIndex = idx;
    notify();
  }

  // ==========================
  // Điều hướng theo ngày / trong ngày
  // ==========================

  // Lấy key ngày từ ISO: "YYYY-MM-DD"
  function getDayKey(iso) {
    if (typeof iso !== "string") return "";
    return iso.slice(0, 10);
  }

  // Danh sách các dayKey duy nhất theo thứ tự thời gian
  function getDayKeyList() {
    const keys = [];
    let last = null;
    for (const iso of timeSteps) {
      const k = getDayKey(iso);
      if (!k) continue;
      if (k !== last) {
        keys.push(k);
        last = k;
      }
    }
    return keys;
  }

  /**
   * Nhảy trong CÙNG MỘT NGÀY (step = +1, -1, ...).
   * Nếu vượt biên sang ngày khác → bỏ qua, không đổi.
   * Dùng cho nút Prev/Next kiểu "chạy trong block ngày".
   */
  function jumpWithinDay(step) {
    if (!timeSteps.length || !step) return;

    const cur = currentIndex;
    const curIso = timeSteps[cur];
    if (!curIso) return;

    const curDay = getDayKey(curIso);
    let next = cur + step;

    if (next < 0 || next >= timeSteps.length) return;

    const nextIso = timeSteps[next];
    const nextDay = getDayKey(nextIso);

    if (!nextDay || nextDay !== curDay) {
      // sang ngày khác → không làm gì
      return;
    }

    setCurrentIndex(next);
  }

  /**
   * Nhảy tới ĐẦU MỘT NGÀY khác, theo offset tương đối:
   *   dayOffset = 0  → đầu ngày hiện tại
   *   dayOffset = +1 → đầu ngày KẾ TIẾP
   *   dayOffset = -1 → đầu ngày TRƯỚC
   * Nếu vượt biên → kẹp về đầu/cuối.
   */
  function jumpToDayStart(dayOffset) {
    if (!timeSteps.length) return;

    const curIso = timeSteps[currentIndex];
    if (!curIso) return;

    const curDay = getDayKey(curIso);
    const dayKeys = getDayKeyList();
    if (!dayKeys.length) return;

    let pos = dayKeys.indexOf(curDay);
    if (pos < 0) pos = 0;

    const offset = typeof dayOffset === "number" ? dayOffset : 0;
    let targetPos = pos + offset;

    if (targetPos < 0) targetPos = 0;
    if (targetPos >= dayKeys.length) targetPos = dayKeys.length - 1;

    const targetDay = dayKeys[targetPos];

    // Tìm index đầu tiên của dayKey đó
    const idx = timeSteps.findIndex((iso) => getDayKey(iso) === targetDay);
    if (idx >= 0) {
      setCurrentIndex(idx);
    }
  }

  // ==========================
  // Đăng ký listener
  // ==========================
  function onTimeChange(fn) {
    if (typeof fn === "function") listeners.push(fn);
  }

  // Gọi tất cả listener khi currentIndex đổi
  function notify() {
    const t = getCurrentTime();
    listeners.forEach((fn) => {
      try {
        fn(t, currentIndex, timeSteps);
      } catch (e) {
        console.error("time listener error", e);
      }
    });
  }

  // ==========================
  // Public API
  // ==========================
  w.TimeState = {
    initTimeSteps,
    getTimeSteps,
    getCurrentIndex,
    getCurrentTime,
    setCurrentIndex,
    onTimeChange,

    // NEW
    setLocationId,
    getLocationId,
    // Điều hướng nâng cao cho forecast-bar kiểu Windy
    jumpWithinDay,
    jumpToDayStart,
  };
})(window);
