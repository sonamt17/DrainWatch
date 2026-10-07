// Wires the data sources, risk model, map and sidebar together.

import { AREAS, NYC_CENTER, RAIN_BENCHMARKS, SEA_LEVEL_PROJECTIONS, TIDE_STATIONS } from './config.js';
import {
  FEMA_FLOOD_ZONE_LAYER,
  FEMA_NFHL,
  fetch311History,
  fetchAlerts,
  fetchFemaZone,
  fetchRainfall,
  fetchRecent311,
  fetchTides,
  geocode,
} from './data.js';
import {
  LEVELS,
  assess,
  distanceKm,
  exposureFromComplaintHistory,
  exposureFromFemaZone,
  levelLabel,
} from './risk.js';
import { tideChartSvg } from './tide-chart.js';

const REFRESH_MS = 15 * 60 * 1000;
const NEARBY_KM = 1;

const SOURCES = {
  tides: { name: 'NOAA Tides & Currents', url: 'https://tidesandcurrents.noaa.gov/' },
  rain: { name: 'Open-Meteo rainfall forecast', url: 'https://open-meteo.com/' },
  alerts: { name: 'National Weather Service alerts', url: 'https://www.weather.gov/' },
  reports: { name: 'NYC 311 flooding reports', url: 'https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9' },
  fema: { name: 'FEMA flood zones', url: 'https://msc.fema.gov/portal/home' },
};

const state = {
  status: {}, // source key -> { ok, message }
  tides: {}, // station key -> tide data
  rain: [], // aligned with AREAS
  alerts: { all: [], byBorough: {} },
  reports: [],
  results: [], // aligned with AREAS
  selectedStation: 'battery',
};

// ---------------- map ----------------

const map = L.map('map', { zoomControl: true }).setView(NYC_CENTER, 11);

const basemap = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 19,
  subdomains: 'abcd',
  className: 'basemap',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);
basemap.on('tileerror', () => {}); // keep console quiet if a tile fails

// FEMA flood zones, drawn by FEMA's own map server as transparent image tiles.
const FemaLayer = L.TileLayer.extend({
  getTileUrl(coords) {
    const size = this.getTileSize();
    const nw = coords.scaleBy(size);
    const se = nw.add(size);
    const crs = this._map.options.crs;
    const a = crs.project(this._map.unproject(nw, coords.z));
    const b = crs.project(this._map.unproject(se, coords.z));
    const q = new URLSearchParams({
      bbox: [a.x, b.y, b.x, a.y].join(','),
      bboxSR: '3857',
      imageSR: '3857',
      size: `${size.x},${size.y}`,
      layers: `show:${FEMA_FLOOD_ZONE_LAYER}`,
      format: 'png32',
      transparent: 'true',
      f: 'image',
    });
    return `${FEMA_NFHL}/export?${q}`;
  },
});
const femaLayer = new FemaLayer('', {
  opacity: 0.55,
  minZoom: 12,
  attribution: 'Flood zones: <a href="https://msc.fema.gov/">FEMA NFHL</a>',
});

const areaLayer = L.layerGroup().addTo(map);
const reportLayer = L.layerGroup().addTo(map);
const stationLayer = L.layerGroup().addTo(map);
const pointLayer = L.layerGroup().addTo(map);

L.control
  .layers(null, {
    'Neighborhood risk': areaLayer,
    '311 flooding reports (7 days)': reportLayer,
    'Tide gauges': stationLayer,
    'FEMA flood zones (zoom in)': femaLayer,
  })
  .addTo(map);

map.on('click', (e) => checkPoint({ lat: e.latlng.lat, lon: e.latlng.lng, label: 'Selected point', borough: null }));

// ---------------- helpers ----------------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function badge(level) {
  return `<span class="badge lvl-${level}">${levelLabel(level)}</span>`;
}

function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t.replace(' ', 'T'));
  return d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function recentReportsNear(lat, lon) {
  if (!state.status.reports || !state.status.reports.ok) return null;
  return state.reports.filter((r) => distanceKm(lat, lon, r.lat, r.lon) <= NEARBY_KM).length;
}

function nearestArea(lat, lon) {
  return AREAS.reduce((best, a) => (distanceKm(lat, lon, a.lat, a.lon) < distanceKm(lat, lon, best.lat, best.lon) ? a : best));
}

function nearestStationKey(lat, lon) {
  return nearestArea(lat, lon).station;
}

async function track(key, promise) {
  try {
    const value = await promise;
    state.status[key] = { ok: true };
    return value;
  } catch (err) {
    console.warn(`[DrainWatch] ${key} failed:`, err);
    state.status[key] = { ok: false, message: err.name === 'AbortError' ? 'timed out' : err.message };
    return null;
  }
}

// ---------------- loading ----------------

async function loadAll() {
  document.getElementById('updated').textContent = 'Updating…';
  document.getElementById('refresh-btn').disabled = true;

  const stationKeys = Object.keys(TIDE_STATIONS);
  const [tideList, rain, alerts, reports] = await Promise.all([
    track('tides', Promise.allSettled(stationKeys.map(fetchTides)).then((results) => {
      if (results.every((r) => r.status === 'rejected')) throw results[0].reason;
      return results;
    })),
    track('rain', fetchRainfall(AREAS)),
    track('alerts', fetchAlerts()),
    track('reports', fetchRecent311(7)),
  ]);

  state.tides = {};
  if (tideList) {
    tideList.forEach((r, i) => {
      if (r.status === 'fulfilled') state.tides[stationKeys[i]] = r.value;
    });
    const missing = stationKeys.filter((k) => !state.tides[k]).map((k) => TIDE_STATIONS[k].name);
    if (missing.length) state.status.tides = { ok: true, message: `no data from ${missing.join(', ')}` };
  }
  state.rain = rain || [];
  state.alerts = alerts || { all: [], byBorough: {} };
  state.reports = reports || [];

  state.results = AREAS.map((area, i) => assessArea(area, i));
  render();

  document.getElementById('updated').textContent = `Updated ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  document.getElementById('refresh-btn').disabled = false;
}

function assessArea(area, i) {
  const tide = state.tides[area.station];
  const rain = state.rain[i];
  const result = assess({
    coastalExposure: area.coastalExposure,
    stormwaterExposure: area.stormwaterExposure,
    thresholds: tide ? tide.thresholds : { minor: 99, moderate: 99, major: 99 },
    peakWaterFt: tide ? tide.peak : null,
    maxHourlyRainIn: rain ? rain.maxHourly : null,
    past24hRainIn: rain ? rain.past24 : null,
    alerts: state.alerts.byBorough[area.borough] || [],
    recentComplaints: recentReportsNear(area.lat, area.lon),
  });
  const missing = [];
  if (!tide && area.coastalExposure > 0) missing.push('tides');
  if (!rain) missing.push('rainfall');
  return { area, tide, rain, ...result, missing };
}

// ---------------- rendering ----------------

function render() {
  renderSummary();
  renderAlerts();
  renderTides();
  renderRain();
  renderAreaList();
  renderMap();
  renderSources();
}

function renderSummary() {
  const counts = Object.fromEntries(LEVELS.map((l) => [l.level, 0]));
  for (const r of state.results) counts[r.level]++;
  const worst = state.results.reduce((a, b) => (b.score > a.score ? b : a), state.results[0]);
  const elevated = state.results.filter((r) => r.level !== 'low').length;

  let headline = 'No significant flood risk in the forecast.';
  if (worst.level !== 'low') {
    const what = worst.driver === 'coastal' ? 'high tides / storm surge' : 'heavy rain';
    headline = `Highest risk: <strong>${escapeHtml(worst.area.name)}</strong>, driven by ${what}. ${elevated} of ${state.results.length} neighborhoods are above low risk.`;
  }

  document.getElementById('summary-body').className = '';
  document.getElementById('summary-body').innerHTML = `
    <div class="summary-top">${badge(worst.level)}<p>${headline}</p></div>
    <ul class="level-counts">
      ${LEVELS.map((l) => `<li class="lvl-${l.level}"><strong>${counts[l.level]}</strong><span>${l.label}</span></li>`).join('')}
    </ul>
    <p class="muted small">${state.results.length} neighborhoods · next 48 hours</p>`;
}

function renderAlerts() {
  const el = document.getElementById('alerts-body');
  if (!state.status.alerts.ok) {
    el.innerHTML = `<p class="warn">Couldn't reach the National Weather Service. Check <a href="https://www.weather.gov/okx/" target="_blank" rel="noopener">weather.gov/okx</a>.</p>`;
    return;
  }
  const alerts = state.alerts.all;
  if (!alerts.length) {
    el.className = 'muted';
    el.textContent = 'No active flood, coastal or tropical alerts for NYC.';
    return;
  }
  el.className = '';
  el.innerHTML = `<ul class="alert-list">${alerts
    .map(
      (a) => `<li class="alert sev-${a.severity}">
        <strong>${escapeHtml(a.event)}</strong>
        <span>${escapeHtml(a.boroughs.join(', '))}${a.ends ? ` · until ${escapeHtml(fmtTime(a.ends))}` : ''}</span>
      </li>`,
    )
    .join('')}</ul>`;
}

function renderTides() {
  const select = document.getElementById('station-select');
  if (!select.options.length) {
    select.innerHTML = Object.entries(TIDE_STATIONS)
      .map(([k, s]) => `<option value="${k}">${escapeHtml(s.name)}</option>`)
      .join('');
    select.value = state.selectedStation;
    select.addEventListener('change', () => {
      state.selectedStation = select.value;
      renderTides();
    });
  }

  const el = document.getElementById('tide-body');
  const tide = state.tides[state.selectedStation];
  if (!tide) {
    el.className = '';
    el.innerHTML = `<p class="warn">No tide data from NOAA for this station right now.</p>`;
    return;
  }
  const t = tide.thresholds;
  const surgeText =
    tide.surge == null ? '—' : `${tide.surge > 0 ? '+' : ''}${tide.surge.toFixed(2)} ft`;
  el.className = '';
  el.innerHTML = `
    <dl class="stats">
      <div><dt>Now</dt><dd>${tide.latest ? `${tide.latest.v.toFixed(2)} ft` : '—'}</dd></div>
      <div><dt>Surge</dt><dd>${surgeText}</dd></div>
      <div><dt>48 h peak</dt><dd>${tide.peak != null ? `${tide.peak.toFixed(2)} ft` : '—'}</dd></div>
    </dl>
    ${tideChartSvg(tide)}
    <p class="muted small">Flood thresholds: minor ${t.minor} ft · moderate ${t.moderate} ft · major ${t.major} ft
      (NOAA derived). Hurricane Sandy peaked around 9 ft above MHHW at the Battery.</p>`;
}

function renderRain() {
  const el = document.getElementById('rain-body');
  if (!state.rain.length) {
    el.className = '';
    el.innerHTML = `<p class="warn">Couldn't load the rainfall forecast.</p>`;
    return;
  }
  let maxIdx = 0;
  state.rain.forEach((r, i) => {
    if (r.maxHourly > state.rain[maxIdx].maxHourly) maxIdx = i;
  });
  const top = state.rain[maxIdx];
  const total = Math.max(...state.rain.map((r) => r.next48Total));
  const past = Math.max(...state.rain.map((r) => r.past24));
  const pct = Math.min(100, (top.maxHourly / RAIN_BENCHMARKS.sewerDesign) * 100);

  el.className = '';
  el.innerHTML = `
    <dl class="stats">
      <div><dt>Peak rate</dt><dd>${top.maxHourly.toFixed(2)} in/hr</dd></div>
      <div><dt>Next 48 h</dt><dd>${total.toFixed(2)} in</dd></div>
      <div><dt>Past 24 h</dt><dd>${past.toFixed(2)} in</dd></div>
    </dl>
    <div class="meter" role="img" aria-label="Peak rain rate is ${pct.toFixed(0)}% of sewer design capacity">
      <div class="meter-fill" style="width:${pct}%"></div>
    </div>
    <p class="muted small">${pct.toFixed(0)}% of the ~${RAIN_BENCHMARKS.sewerDesign} in/hr most NYC sewers are built to handle${
      top.maxHourly > 0 ? ` · peak ${escapeHtml(fmtTime(top.maxHourlyTime))} near ${escapeHtml(AREAS[maxIdx].name)}` : ''
    }. Hourly forecasts smooth out short cloudbursts, so real peaks can be higher.</p>`;
}

function renderAreaList() {
  const sorted = [...state.results].sort((a, b) => b.score - a.score || a.area.name.localeCompare(b.area.name));
  const list = document.getElementById('area-list');
  list.innerHTML = sorted
    .map(
      (r) => `<li>
        <button type="button" class="area-row" data-id="${r.area.id}">
          <span class="dot lvl-${r.level}"></span>
          <span class="area-name">${escapeHtml(r.area.name)}<small>${escapeHtml(r.area.borough)}</small></span>
          <span class="area-level">${levelLabel(r.level)}</span>
        </button>
      </li>`,
    )
    .join('');
  list.querySelectorAll('.area-row').forEach((btn) =>
    btn.addEventListener('click', () => {
      const r = state.results.find((x) => x.area.id === btn.dataset.id);
      map.flyTo([r.area.lat, r.area.lon], 14, { duration: 0.8 });
      r.marker.openPopup();
    }),
  );
}

function areaPopup(r) {
  const a = r.area;
  return `
    <div class="popup">
      <h3>${escapeHtml(a.name)}</h3>
      <p class="muted">${escapeHtml(a.borough)}</p>
      <p>${badge(r.level)} <span class="muted">score ${r.score.toFixed(1)} / 4</span></p>
      <ul>${r.reasons.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
      <table class="mini">
        <tr><th></th><th>Exposure</th><th>Risk now</th></tr>
        <tr><td>Coastal</td><td>${exposureWord(a.coastalExposure)}</td><td>${r.coastal.toFixed(1)}</td></tr>
        <tr><td>Stormwater</td><td>${exposureWord(a.stormwaterExposure)}</td><td>${r.stormwater.toFixed(1)}</td></tr>
      </table>
      ${r.missing.length ? `<p class="warn small">Missing data: ${r.missing.join(', ')}</p>` : ''}
    </div>`;
}

function exposureWord(n) {
  return ['Minimal', 'Low', 'Moderate', 'High'][n] || '—';
}

function renderMap() {
  areaLayer.clearLayers();
  for (const r of state.results) {
    const marker = L.circleMarker([r.area.lat, r.area.lon], {
      radius: 9 + r.score * 2,
      className: `area-marker lvl-${r.level}`,
      weight: 2,
      fillOpacity: 0.75,
      bubblingMouseEvents: false,
    })
      .bindPopup(areaPopup(r))
      .bindTooltip(`${r.area.name}: ${levelLabel(r.level)}`);
    r.marker = marker;
    areaLayer.addLayer(marker);
  }

  reportLayer.clearLayers();
  for (const rep of state.reports) {
    const m = L.circleMarker([rep.lat, rep.lon], { radius: 3, className: 'report-marker', weight: 1, fillOpacity: 0.8, bubblingMouseEvents: false }).bindPopup(
      `<strong>${escapeHtml(rep.descriptor)}</strong><br>${escapeHtml(rep.address)}<br><span class="muted">${escapeHtml(fmtTime(rep.created))}</span>`,
    );
    reportLayer.addLayer(m);
  }

  stationLayer.clearLayers();
  for (const [key, s] of Object.entries(TIDE_STATIONS)) {
    const tide = state.tides[key];
    const text = tide && tide.latest ? `${tide.latest.v.toFixed(2)} ft vs MHHW` : 'no data';
    const m = L.marker([s.lat, s.lon], {
      icon: L.divIcon({ className: 'station-icon', html: '<span>≈</span>', iconSize: [22, 22] }),
    }).bindPopup(`<strong>${escapeHtml(s.name)}</strong> tide gauge<br>${text}<br><a href="https://tidesandcurrents.noaa.gov/stationhome.html?id=${s.id}" target="_blank" rel="noopener">NOAA station ${s.id}</a>`);
    stationLayer.addLayer(m);
  }

  document.getElementById('legend').innerHTML =
    `<strong>Flood risk</strong>` +
    LEVELS.map((l) => `<span><i class="dot lvl-${l.level}"></i>${l.label}</span>`).join('') +
    `<span><i class="dot report"></i>311 report</span>`;
}

function renderSources() {
  const el = document.getElementById('source-status');
  el.innerHTML = Object.entries(SOURCES)
    .map(([key, s]) => {
      const st = state.status[key];
      const icon = !st ? '○' : st.ok ? '●' : '✕';
      const cls = !st ? 'idle' : st.ok ? (st.message ? 'partial' : 'ok') : 'fail';
      const note = !st ? 'used for address checks' : st.message ? escapeHtml(st.message) : st.ok ? 'live' : '';
      return `<li class="${cls}"><span aria-hidden="true">${icon}</span> <a href="${s.url}" target="_blank" rel="noopener">${s.name}</a> <span class="muted">${note}</span></li>`;
    })
    .join('');
}

function renderClimate() {
  document.getElementById('slr-body').innerHTML = SEA_LEVEL_PROJECTIONS.map(
    (p) => `<tr><td>${p.period}</td><td>${p.low}–${p.high} in</td><td>${p.highEnd} in</td></tr>`,
  ).join('');
}

// ---------------- address / point check ----------------

const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const pointResult = document.getElementById('point-result');

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = searchInput.value.trim();
  if (!text) return;
  searchResults.innerHTML = '<p class="muted small">Searching…</p>';
  try {
    const matches = await geocode(text);
    if (!matches.length) {
      searchResults.innerHTML = '<p class="warn small">No NYC address found. Try adding the borough.</p>';
      return;
    }
    if (matches.length === 1) {
      searchResults.innerHTML = '';
      checkPoint(matches[0]);
      return;
    }
    searchResults.innerHTML = `<ul class="matches">${matches
      .map((m, i) => `<li><button type="button" data-i="${i}">${escapeHtml(m.label)}</button></li>`)
      .join('')}</ul>`;
    searchResults.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        searchResults.innerHTML = '';
        checkPoint(matches[+b.dataset.i]);
      }),
    );
  } catch (err) {
    searchResults.innerHTML = `<p class="warn small">Address search is unavailable right now (${escapeHtml(err.message)}).</p>`;
  }
});

let pointRequest = 0;

async function checkPoint(place) {
  const id = ++pointRequest;
  const { lat, lon } = place;
  const borough = place.borough || nearestArea(lat, lon).borough;
  const stationKey = nearestStationKey(lat, lon);

  pointLayer.clearLayers();
  const marker = L.marker([lat, lon]).addTo(pointLayer);
  map.flyTo([lat, lon], Math.max(map.getZoom(), 14), { duration: 0.8 });
  pointResult.innerHTML = `<p class="muted small">Checking ${escapeHtml(place.label)}…</p>`;

  const [fema, history, rainList] = await Promise.all([
    track('fema', fetchFemaZone(lat, lon)),
    fetch311History(lat, lon).catch(() => null),
    fetchRainfall([{ lat, lon }]).catch(() => null),
  ]);
  if (id !== pointRequest) return; // a newer check started
  renderSources();

  const tide = state.tides[stationKey];
  const rain = rainList && rainList[0];
  const coastalExposure = fema ? exposureFromFemaZone(fema.zone, fema.subtype) : nearestArea(lat, lon).coastalExposure;
  const stormwaterExposure = exposureFromComplaintHistory(history);

  const r = assess({
    coastalExposure,
    stormwaterExposure,
    thresholds: tide ? tide.thresholds : { minor: 99, moderate: 99, major: 99 },
    peakWaterFt: tide ? tide.peak : null,
    maxHourlyRainIn: rain ? rain.maxHourly : null,
    past24hRainIn: rain ? rain.past24 : null,
    alerts: state.alerts.byBorough[borough] || [],
    recentComplaints: recentReportsNear(lat, lon),
  });

  const zoneText = !fema
    ? 'FEMA lookup failed — using the nearest neighborhood rating'
    : fema.zone
      ? `FEMA zone <strong>${escapeHtml(fema.zone)}</strong>${fema.subtype ? ` (${escapeHtml(fema.subtype.toLowerCase())})` : ''}${
          /^[AV]/i.test(fema.zone) ? ' — in the 1% annual chance (100-year) floodplain' : ''
        }`
      : 'Outside mapped FEMA flood zones';

  const html = `
    <div class="point-card">
      <h3>${escapeHtml(place.label)}</h3>
      <p>${badge(r.level)} <span class="muted">score ${r.score.toFixed(1)} / 4 · ${escapeHtml(borough)}</span></p>
      <ul>${r.reasons.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
      <dl class="facts">
        <dt>Coastal exposure</dt><dd>${exposureWord(coastalExposure)} · ${zoneText}</dd>
        <dt>Stormwater exposure</dt><dd>${exposureWord(stormwaterExposure)} · ${
          history == null ? '311 history unavailable' : `${history} flooding reports within 500 m in the past year`
        }</dd>
        <dt>Tide gauge</dt><dd>${escapeHtml(TIDE_STATIONS[stationKey].name)}</dd>
      </dl>
      <p class="muted small">FEMA's effective maps date from 2007; NYC's 2015 preliminary maps and future sea level rise extend the floodplain further.</p>
    </div>`;
  pointResult.innerHTML = html;
  marker.bindPopup(html, { maxWidth: 320 });
}

// ---------------- start ----------------

document.getElementById('refresh-btn').addEventListener('click', loadAll);
renderClimate();
loadAll();
setInterval(loadAll, REFRESH_MS);
