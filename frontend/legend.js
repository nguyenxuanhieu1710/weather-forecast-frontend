// ===================== Legend =====================

function setLegend(title, stops, colors, unit) {
  if (rwLegend) map.removeControl(rwLegend);

  const ctrl = L.control({ position: "bottomleft" });

  ctrl.onAdd = () => {
    const div = L.DomUtil.create("div", "legend");
    div.style.cssText =
      "padding:10px 12px;background:rgba(15,23,42,.95);border-radius:12px;" +
      "box-shadow:0 12px 32px rgba(0,0,0,.6);color:#e5e7eb;border:1px solid rgba(148,163,184,.4);";

    const bar = `linear-gradient(to right, ${colors.join(",")})`;

    const ticks = stops
      .map((_, i) => {
        const pct = (i / (stops.length - 1)) * 100;
        return `<span style="position:absolute;left:${pct}%;bottom:-4px;width:1px;height:6px;background:#9ca3af;transform:translateX(-0.5px)"></span>`;
      })
      .join("");

    const labels = `
      <div style="display:flex;justify-content:space-between;gap:14px;flex:1;
                  font-size:11px;font-variant-numeric:tabular-nums;color:#cbd5f5;">
        ${stops.map((s) => `<span>${s}</span>`).join("")}
      </div>
      <div style="margin-left:10px;font-size:11px;color:#9ca3af;white-space:nowrap">${unit}</div>`;

    div.innerHTML = `
      <div style="font-weight:600;color:#e5e7eb;margin-bottom:6px">${title}</div>
      <div style="position:relative;height:12px;border-radius:8px;background:${bar};
                  box-shadow:inset 0 0 0 1px rgba(15,23,42,.6);margin-bottom:6px">${ticks}</div>
      <div style="display:flex;align-items:center">${labels}</div>`;

    L.DomEvent.disableClickPropagation(div);
    return div;
  };

  ctrl.addTo(map);
  rwLegend = ctrl;
}

function clearLegend() {
  if (rwLegend) {
    map.removeControl(rwLegend);
    rwLegend = null;
  }
}
