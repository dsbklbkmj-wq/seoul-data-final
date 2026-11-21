/* 서울 인구 밀도 역사 1995–2025  (Leaflet 1.9) */
(function () {
  'use strict';

  // ---------------- 설정 ----------------
  const GEO_LOCAL = 'data/seoul_districts.geojson';
  const GEO_CDN = 'https://cdn.jsdelivr.net/gh/southkorea/seoul-maps@master/juso/2015/json/seoul_municipalities_geo_simple.json';
  const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';
  const BASE_INTERVAL = 900; // 1x 속도에서 1년당 ms
  const DENSITY_BREAKS = [10000, 14000, 18000, 22000, 26000];
  const DENSITY_COLORS = ['#eef2fb', '#cfdbf5', '#a9c0ec', '#7ea0e1', '#4f7bd6', '#2563eb'];
  const SEOUL_CENTER = [37.5665, 126.978];

  // ---------------- 상태 ----------------
  const state = {
    years: [], startYear: 1995, endYear: 2025, year: 1995,
    playing: false, timer: null, speed: 1, scale: 10000, mode: 'dots', hovered: null
  };
  const data = { pop: {}, area: {}, nameEng: {}, districts: [], geo: null, totalArea: 0 };
  const dots = {};   // name -> { geom, bbox, rng, pool: [], markers: [] }
  let map, geoLayer, dotRenderer, centerMarker;

  // ---------------- DOM ----------------
  const $ = (id) => document.getElementById(id);
  const el = {
    slider: $('yearSlider'), yearLabel: $('yearLabel'), ticks: $('ticks'),
    play: $('playBtn'), prev: $('prevBtn'), next: $('nextBtn'),
    speedChips: $('speedChips'), modeChips: $('modeChips'), scale: $('scaleSelect'),
    legendDotText: $('legendDotText'), legendDensity: $('legendDensity'), ramp: $('ramp'), rampLabels: $('rampLabels'),
    statsYear: $('statsYear'), statTotal: $('statTotal'), statDensity: $('statDensity'), statYoy: $('statYoy'), statSince: $('statSince'),
    tooltip: $('tooltip'), overlay: $('overlay'), overlayMsg: $('overlayMsg')
  };

  // ---------------- 유틸 ----------------
  const fmt = (n) => (n == null || isNaN(n)) ? '–' : Math.round(n).toLocaleString('ko-KR');
  const fmtSigned = (n) => (n == null || isNaN(n)) ? '–' : (n > 0 ? '+' : (n < 0 ? '−' : '')) + Math.abs(Math.round(n)).toLocaleString('ko-KR');
  const fmtPct = (n) => (n == null || isNaN(n)) ? '' : ' (' + (n > 0 ? '+' : '') + n.toFixed(1) + '%)';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function parseCSV(text) {
    text = String(text).replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
    const header = lines[0].split(',').map((s) => s.trim());
    return lines.slice(1).map((line) => {
      const cells = line.split(',').map((s) => s.trim());
      const row = {};
      header.forEach((h, i) => { row[h] = cells[i]; });
      return row;
    });
  }

  // 점-다각형 포함 판정 (ray casting)
  function pointInRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
        (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  function pointInPolygon(pt, coords) {
    if (!pointInRing(pt, coords[0])) return false;
    for (let k = 1; k < coords.length; k++) {
      if (pointInRing(pt, coords[k])) return false;
    }
    return true;
  }
  function pointInGeom(pt, geom) {
    if (geom.type === 'Polygon') return pointInPolygon(pt, geom.coordinates);
    if (geom.type === 'MultiPolygon') return geom.coordinates.some((p) => pointInPolygon(pt, p));
    return false;
  }
  function bboxOf(geom) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const walk = (c) => {
      if (typeof c[0] === 'number') {
        if (c[0] < b[0]) b[0] = c[0];
        if (c[1] < b[1]) b[1] = c[1];
        if (c[0] > b[2]) b[2] = c[0];
        if (c[1] > b[3]) b[3] = c[1];
      } else {
        c.forEach(walk);
      }
    };
    walk(geom.coordinates);
    return b;
  }

  // ---------------- 데이터 접근 ----------------
  function getPop(name, year) {
    const d = data.pop[name];
    if (!d) return null;
    const v = d[year];
    return (v == null || isNaN(v)) ? null : v;
  }
  function getDensity(name, year) {
    const p = getPop(name, year), a = data.area[name];
    return (p == null || !a) ? null : p / a;
  }
  function getTotal(year) {
    let s = 0, any = false;
    data.districts.forEach((n) => {
      const p = getPop(n, year);
      if (p != null) { s += p; any = true; }
    });
    return any ? s : null;
  }
  function densityColor(d) {
    if (d == null) return '#ffffff';
    let i = 0;
    while (i < DENSITY_BREAKS.length && d >= DENSITY_BREAKS[i]) i++;
    return DENSITY_COLORS[i];
  }

  // ---------------- 지도 스타일 ----------------
  function styleFor(feature) {
    const name = feature.properties.SIG_KOR_NM;
    const showDensity = state.mode !== 'dots';
    const hovered = state.hovered === name;
    return {
      color: hovered ? '#111111' : '#2b2f3a',
      weight: hovered ? 2.4 : 1.1,
      fillColor: showDensity ? densityColor(getDensity(name, state.year)) : '#ffffff',
      fillOpacity: showDensity ? (state.mode === 'both' ? 0.5 : 0.8) : (hovered ? 0.18 : 0.03)
    };
  }

  function dotRadius() {
    const z = map.getZoom();
    return Math.max(3.5, Math.min(14, 6 * Math.pow(1.35, z - 11)));
  }

  // ---------------- 점(코호트) 관리 ----------------
  function ensurePool(name, n) {
    const d = dots[name];
    while (d.pool.length < n) {
      let tries = 0, placed = false;
      while (!placed && tries < 3000) {
        tries++;
        const x = d.bbox[0] + d.rng() * (d.bbox[2] - d.bbox[0]);
        const y = d.bbox[1] + d.rng() * (d.bbox[3] - d.bbox[1]);
        if (pointInGeom([x, y], d.geom)) {
          d.pool.push([y, x]);
          placed = true;
        }
      }
      if (!placed) d.pool.push([(d.bbox[1] + d.bbox[3]) / 2, (d.bbox[0] + d.bbox[2]) / 2]);
    }
  }

  function updateDots(animate) {
    const showDots = state.mode !== 'density';
    const r = dotRadius();
    data.districts.forEach((name) => {
      const d = dots[name];
      if (!d) return;
      const p = getPop(name, state.year);
      const target = (showDots && p != null) ? Math.round(p / state.scale) : 0;
      const cur = d.markers.length;
      if (target > cur) {
        ensurePool(name, target);
        for (let i = cur; i < target; i++) {
          const m = L.circleMarker(d.pool[i], {
            renderer: dotRenderer,
            radius: r,
            color: '#2563eb',
            weight: 1.6,
            fill: true,
            fillColor: '#ffffff',
            fillOpacity: 0.85,
            interactive: false,
            className: animate ? 'dot dot-in' : 'dot'
          }).addTo(map);
          d.markers.push(m);
        }
      } else if (target < cur) {
        const removed = d.markers.splice(target);
        removed.forEach((m) => {
          if (animate && m._path) {
            m._path.classList.add('dot-out');
            setTimeout(() => { map.removeLayer(m); }, 420);
          } else {
            map.removeLayer(m);
          }
        });
      }
    });
  }

  function resizeDots() {
    const r = dotRadius();
    Object.keys(dots).forEach((name) => {
      dots[name].markers.forEach((m) => m.setRadius(r));
    });
  }

  // ---------------- 패널/통계/범례 ----------------
  function updateStats() {
    const y = state.year;
    const total = getTotal(y), prev = getTotal(y - 1), first = getTotal(state.startYear);
    el.statsYear.textContent = y;
    el.statTotal.textContent = fmt(total);
    el.statDensity.textContent = (total != null && data.totalArea) ? fmt(total / data.totalArea) : '–';

    const yoy = (total != null && prev != null) ? total - prev : null;
    el.statYoy.textContent = yoy == null ? '–' : fmtSigned(yoy) + fmtPct(prev ? (yoy / prev) * 100 : null);
    el.statYoy.className = 'v ' + (yoy > 0 ? 'up' : (yoy < 0 ? 'down' : ''));

    const since = (total != null && first != null) ? total - first : null;
    el.statSince.textContent = since == null ? '–' : fmtSigned(since) + fmtPct(first ? (since / first) * 100 : null);
    el.statSince.className = 'v ' + (since > 0 ? 'up' : (since < 0 ? 'down' : ''));

    if (centerMarker) {
      const icon = centerMarker.getIcon();
      icon.options.html = '<div class="center-label">서울<br>' + fmt(total) + '</div>';
      centerMarker.setIcon(icon);
    }
  }

  function updateLegend() {
    el.legendDotText.textContent = '점 1개 = ' + fmt(state.scale) + '명';
    $('legendDot').classList.toggle('hidden', state.mode === 'density');
    el.legendDensity.classList.toggle('hidden', state.mode === 'dots');
    if (!el.ramp.children.length) {
      DENSITY_COLORS.forEach((c) => {
        const s = document.createElement('span');
        s.style.background = c;
        el.ramp.appendChild(s);
      });
      const labels = ['<' + (DENSITY_BREAKS[0] / 1000) + 'k']
        .concat(DENSITY_BREAKS.map((b) => (b / 1000) + 'k'));
      el.rampLabels.innerHTML = labels.map((t) => '<span>' + t + '</span>').join('');
    }
  }

  function buildTicks() {
    el.ticks.innerHTML = '';
    const ys = [];
    for (let y = state.startYear; y <= state.endYear; y++) {
      if (y % 5 === 0 || y === state.startYear || y === state.endYear) ys.push(y);
    }
    ys.forEach((y) => {
      const s = document.createElement('span');
      s.textContent = y;
      el.ticks.appendChild(s);
    });
  }

  // ---------------- 툴팁 ----------------
  function tooltipHTML(name) {
    const y = state.year;
    const p = getPop(name, y), prev = getPop(name, y - 1), first = getPop(name, state.startYear);
    const dens = getDensity(name, y);
    const yoy = (p != null && prev != null) ? p - prev : null;
    const since = (p != null && first != null) ? p - first : null;
    const cls = (v) => v > 0 ? 'up' : (v < 0 ? 'down' : '');
    return '<h3>' + name + '<small>' + (data.nameEng[name] || '') + ' · ' + y + '</small></h3>' +
      '<table>' +
      '<tr><td>인구</td><td>' + fmt(p) + ' 명</td></tr>' +
      '<tr><td>인구밀도</td><td>' + fmt(dens) + ' 명/km²</td></tr>' +
      '<tr><td>면적</td><td>' + (data.area[name] || '–') + ' km²</td></tr>' +
      '<tr><td>전년 대비</td><td class="' + cls(yoy) + '">' + (yoy == null ? '–' : fmtSigned(yoy) + fmtPct(prev ? (yoy / prev) * 100 : null)) + '</td></tr>' +
      '<tr><td>' + state.startYear + '년 대비</td><td class="' + cls(since) + '">' + (since == null ? '–' : fmtSigned(since) + fmtPct(first ? (since / first) * 100 : null)) + '</td></tr>' +
      '<tr><td>점 개수</td><td>' + (p == null ? '–' : Math.round(p / state.scale)) + ' 개</td></tr>' +
      '</table>';
  }
  function positionTooltip(e) {
    const wrap = el.tooltip.parentElement.getBoundingClientRect();
    let x = e.originalEvent.clientX - wrap.left + 14;
    let y = e.originalEvent.clientY - wrap.top + 14;
    const tw = el.tooltip.offsetWidth, th = el.tooltip.offsetHeight;
    if (x + tw > wrap.width - 10) x = x - tw - 28;
    if (y + th > wrap.height - 10) y = y - th - 28;
    el.tooltip.style.left = x + 'px';
    el.tooltip.style.top = y + 'px';
  }

  // ---------------- 연도 제어 ----------------
  function setYear(y, animate) {
    y = Math.max(state.startYear, Math.min(state.endYear, y));
    state.year = y;
    el.slider.value = y;
    el.yearLabel.textContent = y;
    updateDots(animate !== false);
    if (geoLayer) geoLayer.setStyle(styleFor);
    updateStats();
    if (state.hovered) el.tooltip.innerHTML = tooltipHTML(state.hovered);
  }

  function stop() {
    state.playing = false;
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    el.play.textContent = '▶ 재생';
  }
  function play() {
    if (state.playing) return;
    if (state.year >= state.endYear) setYear(state.startYear, false);
    state.playing = true;
    el.play.textContent = '■ 정지';
    state.timer = setInterval(() => {
      if (state.year >= state.endYear) { stop(); return; }
      setYear(state.year + 1, true);
    }, BASE_INTERVAL / state.speed);
  }
  function togglePlay() { state.playing ? stop() : play(); }

  function bindControls() {
    el.slider.addEventListener('input', (e) => { stop(); setYear(parseInt(e.target.value, 10), true); });
    el.play.addEventListener('click', togglePlay);
    el.prev.addEventListener('click', () => { stop(); setYear(state.year - 1, true); });
    el.next.addEventListener('click', () => { stop(); setYear(state.year + 1, true); });

    el.speedChips.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      state.speed = parseFloat(b.dataset.speed);
      el.speedChips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
      if (state.playing) { stop(); play(); }
    });

    el.modeChips.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      state.mode = b.dataset.mode;
      el.modeChips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
      updateLegend();
      updateDots(true);
      geoLayer.setStyle(styleFor);
    });

    el.scale.addEventListener('change', (e) => {
      state.scale = parseInt(e.target.value, 10);
      updateLegend();
      updateDots(true);
      if (state.hovered) el.tooltip.innerHTML = tooltipHTML(state.hovered);
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowLeft') { stop(); setYear(state.year - 1, true); }
      if (e.code === 'ArrowRight') { stop(); setYear(state.year + 1, true); }
    });
  }

  // ---------------- 초기화 ----------------
  function initMap() {
    map = L.map('map', { zoomControl: false, attributionControl: false, minZoom: 9, maxZoom: 15 });
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer(TILE_URL, { subdomains: 'abcd', maxZoom: 19 }).addTo(map);

    geoLayer = L.geoJSON(data.geo, {
      style: styleFor,
      onEachFeature: (feature, layer) => {
        const name = feature.properties.SIG_KOR_NM;
        layer.on({
          mouseover: (e) => {
            state.hovered = name;
            layer.setStyle(styleFor(feature));
            layer.bringToFront();
            el.tooltip.innerHTML = tooltipHTML(name);
            el.tooltip.style.display = 'block';
            positionTooltip(e);
          },
          mousemove: positionTooltip,
          mouseout: () => {
            state.hovered = null;
            layer.setStyle(styleFor(feature));
            el.tooltip.style.display = 'none';
          }
        });
      }
    }).addTo(map);

    dotRenderer = L.svg({ padding: 0.5 }).addTo(map);
    map.fitBounds(geoLayer.getBounds(), { padding: [20, 20] });

    centerMarker = L.marker(SEOUL_CENTER, {
      interactive: false,
      icon: L.divIcon({ className: '', html: '<div class="center-label">서울</div>', iconSize: [120, 34], iconAnchor: [60, 17] })
    }).addTo(map);

    // 자치구별 점 풀 준비 (시드 고정 → 연도 바뀌어도 기존 점 위치 유지)
    data.geo.features.forEach((f) => {
      const name = f.properties.SIG_KOR_NM;
      dots[name] = {
        geom: f.geometry,
        bbox: bboxOf(f.geometry),
        rng: mulberry32(hashStr(String(f.properties.SIG_CD || name))),
        pool: [], markers: []
      };
    });

    map.on('zoomend', resizeDots);
  }

  async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
    return res.text();
  }
  const IS_FILE = location.protocol === 'file:';

  async function loadGeo() {
    if (!IS_FILE) {
      try {
        return JSON.parse(await fetchText(GEO_LOCAL));
      } catch (e) {
        console.warn('로컬 GeoJSON 없음, CDN에서 불러옵니다.', e.message);
      }
    }
    return JSON.parse(await fetchText(GEO_CDN));
  }

  // 데이터: 1순위 <script>로 임베드된 data/*.js (file:// 에서도 동작), 2순위 CSV fetch
  async function loadCSV(embeddedVar, url) {
    if (typeof window[embeddedVar] === 'string' && window[embeddedVar].trim()) {
      return window[embeddedVar];
    }
    if (IS_FILE) {
      throw new Error('data/' + embeddedVar.toLowerCase().replace('seoul_', '').replace('_csv', '.js') +
        ' 가 로드되지 않았습니다. CSV를 수정했다면 python scripts/build_data.py 를 실행하세요.');
    }
    return fetchText(url);
  }

  async function init() {
    try {
      const [popText, distText, geo] = await Promise.all([
        loadCSV('SEOUL_POPULATION_CSV', 'data/population.csv'),
        loadCSV('SEOUL_DISTRICTS_CSV', 'data/districts.csv'),
        loadGeo()
      ]);
      data.geo = geo;

      parseCSV(distText).forEach((r) => {
        data.area[r.name] = parseFloat(r.area_km2);
        data.nameEng[r.name] = r.name_eng;
      });

      const rows = parseCSV(popText);
      const header = Object.keys(rows[0]).filter((h) => h !== 'year');
      data.districts = header;
      header.forEach((n) => { data.pop[n] = {}; });
      rows.forEach((r) => {
        const y = parseInt(r.year, 10);
        if (isNaN(y)) return;
        state.years.push(y);
        header.forEach((n) => { data.pop[n][y] = parseInt(r[n], 10); });
      });
      state.years.sort((a, b) => a - b);
      state.startYear = state.years[0];
      state.endYear = state.years[state.years.length - 1];
      state.year = state.startYear;
      data.totalArea = header.reduce((s, n) => s + (data.area[n] || 0), 0);

      el.slider.min = state.startYear;
      el.slider.max = state.endYear;
      el.slider.value = state.startYear;
      buildTicks();

      initMap();
      bindControls();
      updateLegend();
      setYear(state.startYear, false);
      el.overlay.style.display = 'none';
    } catch (err) {
      console.error(err);
      const hint = IS_FILE
        ? '지도 경계(GeoJSON)는 인터넷에서 불러오므로 네트워크 연결이 필요합니다.<br>' +
          '그래도 안 되면 터미널에서 <code>python -m http.server 8000</code> 실행 후 <code>http://localhost:8000</code> 으로 접속하세요.'
        : '<code>data/population.js</code>, <code>data/districts.js</code> 파일이 있는지, ' +
          'GeoJSON 다운로드(인터넷 연결)가 가능한지 확인하세요.';
      el.overlayMsg.innerHTML =
        '<strong>데이터를 불러오지 못했습니다.</strong><br>' +
        '<small style="color:#9a3412">' + err.message + '</small><br><br>' + hint;
    }
  }

  init();
})();
