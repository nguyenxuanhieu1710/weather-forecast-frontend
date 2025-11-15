// ===================== Config & Globals =====================

// Backend của bạn
const API_BASE = "http://100.123.92.116:8000";
const LQ_KEY = "pk.c4d167c79573b11c6022ab79ad7fd9a0";
const LQ_REGION = "us1";

// ===================== Cache =====================
let latestObs = null;
let tempPtsCache = null;
let tempCacheAt = 0;
const TEMP_TTL_MS = 3 * 60 * 1000; // 3 phút

// ===================== Map / Layers =====================
let map;
let baseLightLayer;      // chỉ còn 1 nền duy nhất

let tempLayer = null;
let rainLayer = null;
let windLayer = null;

let vietnamMask = null;
let layerReqId = 0;

// ===================== Legend state =====================
let rwLegend = null;
