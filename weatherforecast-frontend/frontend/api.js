const API_BASE = window.API_BASE;

// Lấy điểm gần nhất theo click
window.fetchObsNearest = async function (lat, lon) {
  const url = `${API_BASE}/obs/nearest?lat=${lat}&lon=${lon}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("nearest error");
  return await resp.json();
};

// Lấy timeseries
window.fetchObsTimeseries = async function (locationId) {
  const url = `${API_BASE}/obs/timeseries/${locationId}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("timeseries error");
  return await resp.json();
};

// Lấy summary cho Cảnh báo
window.fetchObsSummary = async function (locationId) {
  const url = `${API_BASE}/obs/summary/${locationId}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("summary error");
  return await resp.json();
};
