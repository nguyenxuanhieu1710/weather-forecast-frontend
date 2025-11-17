// wind_particle_layer.js
// Lớp hạt gió (particle) – hạt sống theo lat/lon, không theo pixel

const WindParticleLayer = L.Layer.extend({
  onAdd: function (map) {
    this._map = map;
    this._canvas = L.DomUtil.create("canvas", "meteo-wind-particles");
    const size = map.getSize();
    this._canvas.width = size.x;
    this._canvas.height = size.y;
    this._canvas.style.position = "absolute";
    this._canvas.style.top = "0";
    this._canvas.style.left = "0";
    this._canvas.style.pointerEvents = "none";

    const pane = map.getPane("meteo") || map.getPanes().overlayPane;
    pane.appendChild(this._canvas);

    this._ctx = this._canvas.getContext("2d");
    this._particles = [];
    this._frame = null;

    this._resetParticles();
    this._bindEvents();
    this._loop();
  },

  onRemove: function (map) {
    this._unbindEvents();
    if (this._frame) cancelAnimationFrame(this._frame);
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    this._canvas = null;
    this._ctx = null;
    this._map = null;
    this._particles = [];
  },

  _bindEvents: function () {
    this._onResize    = this._handleResize.bind(this);
    this._onMoveStart = this._handleMoveStart.bind(this);
    this._onMoveEnd   = this._handleMoveEnd.bind(this);

    this._map.on("resize",    this._onResize);
    this._map.on("movestart", this._onMoveStart);
    this._map.on("moveend",   this._onMoveEnd);
  },

  _unbindEvents: function () {
    if (!this._map) return;
    this._map.off("resize",    this._onResize);
    this._map.off("movestart", this._onMoveStart);
    this._map.off("moveend",   this._onMoveEnd);
  },

  _handleResize: function () {
    const size = this._map.getSize();
    this._canvas.width = size.x;
    this._canvas.height = size.y;
    this._resetParticles();
  },

  _handleMoveStart: function () {
    // bắt đầu kéo map: xóa toàn bộ vệt cũ
    if (!this._ctx || !this._canvas) return;
    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
  },

  _handleMoveEnd: function () {
    // thả map: sinh lại hạt theo viewport mới
    this._resetParticles();
  },

  _resetParticles: function () {
    if (!this._map || !this._canvas) return;
    this._particles = [];
    for (let i = 0; i < WIND_PARTICLE_COUNT; i++) {
      this._particles.push(this._randomParticle());
    }
  },

  // Hạt sống trong hệ lat/lon, không phải pixel
  _randomParticle: function () {
    const map = this._map;
    const bounds = map.getBounds();

    let lat = 0;
    let lon = 0;

    // random trong viewport hiện tại + mask VN
    let ok = false;
    for (let i = 0; i < 40; i++) {
      const south = bounds.getSouth();
      const north = bounds.getNorth();
      const west  = bounds.getWest();
      const east  = bounds.getEast();

      lat = south + Math.random() * (north - south);
      lon = west  + Math.random() * (east  - west);

      if (isLatLngInsideVN(lat, lon)) {
        ok = true;
        break;
      }
    }

    // nếu random mãi chưa trúng, lấy tâm bản đồ
    if (!ok) {
      const center = map.getCenter();
      lat = center.lat;
      lon = center.lng;
    }

    return {
      lat,
      lon,
      age: Math.floor(Math.random() * WIND_PARTICLE_MAX_AGE),
      justRespawned: true,
    };
  },

  _respawnParticle: function (p) {
    const np = this._randomParticle();
    p.lat = np.lat;
    p.lon = np.lon;
    p.age = np.age;
    p.justRespawned = true;
  },

  // Di chuyển hạt trong hệ lat/lon
  _evolveParticle: function (p) {
    const field = window.currentWindField;
    if (!field || !this._map) {
      p.age = WIND_PARTICLE_MAX_AGE + 1;
      p.justRespawned = false;
      return;
    }

    if (p.age > WIND_PARTICLE_MAX_AGE) {
      this._respawnParticle(p);
      return;
    }

    // nếu đang ở ngoài VN thì respawn
    if (!isLatLngInsideVN(p.lat, p.lon)) {
      this._respawnParticle(p);
      return;
    }

    const wVec = field.sample(p.lat, p.lon);
    if (!wVec || wVec.s <= 0.05) {
      this._respawnParticle(p);
      return;
    }

    // u,v (m/s) -> dịch chuyển lat/lon (độ)
    // xấp xỉ: 1 độ lat ~ 111320 m
    const metersPerDegLat = 111320;
    const latRad = (p.lat * Math.PI) / 180;
    const metersPerDegLon = metersPerDegLat * Math.cos(latRad || 1e-6);

    // dùng WIND_PARTICLE_SPEED_SCALE như hệ số thời gian (giống dt)
    const dt = WIND_PARTICLE_SPEED_SCALE;

    const dLat = (wVec.v * dt) / metersPerDegLat;
    const dLon = (wVec.u * dt) / metersPerDegLon;

    const newLat = p.lat + dLat;
    const newLon = p.lon + dLon;

    if (!isLatLngInsideVN(newLat, newLon)) {
      this._respawnParticle(p);
      return;
    }

    p.lat = newLat;
    p.lon = newLon;
    p.age += 1;
    p.justRespawned = false;
  },

  _loop: function () {
    if (!this._map || !this._ctx || !this._canvas) return;

    const ctx = this._ctx;
    const size = this._map.getSize();

    // làm mờ frame cũ nhưng giữ trail tương đối dài
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "rgba(0,0,0,0.97)";
    ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);

    // vẽ vệt mới
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";

    for (const p of this._particles) {
      // điểm cũ (theo lat/lon → pixel)
      const pt0 = this._map.latLngToContainerPoint([p.lat, p.lon]);

      this._evolveParticle(p);

      // mới respawn thì không vẽ vệt
      if (p.justRespawned) continue;

      const pt1 = this._map.latLngToContainerPoint([p.lat, p.lon]);

      if (!pt0 || !pt1) {
        continue;
      }

      // nếu ra khỏi canvas thì respawn ở lượt sau
      if (
        pt0.x < 0 || pt0.y < 0 || pt0.x >= size.x || pt0.y >= size.y ||
        pt1.x < 0 || pt1.y < 0 || pt1.x >= size.x || pt1.y >= size.y
      ) {
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(pt0.x, pt0.y);
      ctx.lineTo(pt1.x, pt1.y);
      ctx.stroke();
    }

    this._frame = requestAnimationFrame(this._loop.bind(this));
  },
});
