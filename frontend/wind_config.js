// wind_config.js
// Cấu hình chung + biến global cho lớp gió

// ===================== Cấu hình =====================

// Nội suy nền màu trên canvas
const WIND_SAMPLE_STEP_PX = 4;
const WIND_IDW_K_NEAREST = 6;
const WIND_IDW_POWER = 2.0;

// Lưới trường gió (để sample nhanh + mượt)
const WIND_FIELD_DLAT = 0.1;
const WIND_FIELD_DLON = 0.1;

// Hạt gió
const WIND_PARTICLE_COUNT = 2000;        // số lượng hạt
const WIND_PARTICLE_MAX_AGE = 220;       // số frame sống
const WIND_PARTICLE_SPEED_SCALE = 0.05;  // scale tốc độ -> px mỗi frame

// ===================== Biến toàn cục =====================

let windCanvasLayer = null;    // nền màu gió
let windParticleLayer = null;  // hạt chuyển động
let currentWindField = null;   // trường gió hiện tại
window.currentWindField = null;

/**
 * Wrapper mask Việt Nam:
 *  - Nếu có window.isPointInsideVN(lat,lon) thì dùng
 *  - Nếu không có thì cho true (không giới hạn)
 */
function isLatLngInsideVN(lat, lon) {
  if (typeof window.isPointInsideVN === "function") {
    try {
      return !!window.isPointInsideVN(lat, lon);
    } catch (e) {
      console.warn("isPointInsideVN error:", e);
      return true;
    }
  }
  return true;
}
