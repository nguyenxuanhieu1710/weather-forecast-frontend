// api.js

const API_BASE = "http://100.123.92.116:8000/api";

// Lấy điểm gần nhất theo click
window.fetchObsNearest = async function(lat, lon) {
  const url = `${API_BASE}/obs/nearest?lat=${lat}&lon=${lon}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("nearest error");
  return await resp.json(); // giả sử trả { location_id, lat, lon, ... }
};

// Lấy timeseries 48h cho 1 location_id
window.fetchObsTimeseries = async function(locationId) {
  const url = `${API_BASE}/obs/timeseries/${locationId}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("timeseries error");
  return await resp.json(); // mảng records
};