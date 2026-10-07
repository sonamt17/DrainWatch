// Fetchers for the live, public data sources. None of these require an API key.
//
//   NOAA CO-OPS      – observed + predicted water levels (tides & storm surge)
//   Open-Meteo       – hourly rainfall forecast
//   NWS (weather.gov)– active flood / coastal / tropical alerts
//   NYC Open Data    – 311 street flooding & sewer backup reports
//   NYC GeoSearch    – address lookup
//   FEMA NFHL        – flood zone at a point
//
// Every fetcher throws on failure; app.js catches per source so one outage
// doesn't take down the whole dashboard.

import { BOROUGH_SAME, NYC_OPEN_DATA_APP_TOKEN, TIDE_STATIONS } from './config.js';
import { classifyAlert, peakWaterLevel, thresholdsFromGreatDiurnalRange } from './risk.js';

const NY_TZ = 'America/New_York';
const FLOOD_311_WHERE = "complaint_type='Sewer' AND (descriptor like '%Flood%' OR descriptor like '%Backup%')";

export const FEMA_NFHL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer';
export const FEMA_FLOOD_ZONE_LAYER = 28;

async function fetchJson(url, { timeoutMs = 20000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Date parts in New York local time. */
function nyParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute') };
}

/** "2026-09-28T14:00" style local timestamp, used to line up Open-Meteo hours. */
export function nyHourKey(date = new Date()) {
  const p = nyParts(date);
  return `${p.y}-${p.m}-${p.d}T${p.h}:00`;
}

/** Parse NOAA's "2026-09-28 14:06" local string into minutes for comparisons. */
function noaaMinutes(t) {
  return Date.parse(t.replace(' ', 'T') + 'Z') / 60000;
}

// ---------------- NOAA tides ----------------

const NOAA = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

function noaaUrl(stationId, params) {
  const q = new URLSearchParams({
    station: stationId,
    datum: 'MHHW', // heights relative to the average higher high tide
    units: 'english',
    time_zone: 'lst_ldt',
    format: 'json',
    application: 'DrainWatch',
    ...params,
  });
  return `${NOAA}?${q}`;
}

/**
 * Latest observed water level and the next 48 h of predicted tides for a station.
 * Heights are feet above MHHW, so 0 = a normal high tide.
 */
export async function fetchTides(stationKey) {
  const station = TIDE_STATIONS[stationKey];
  const start = nyParts(new Date(Date.now() - 60 * 60 * 1000));
  const begin = `${start.y}${start.m}${start.d} ${start.h}:${start.min}`;

  const [obs, pred] = await Promise.all([
    fetchJson(noaaUrl(station.id, { product: 'water_level', date: 'latest' })).catch(() => null),
    fetchJson(noaaUrl(station.id, { product: 'predictions', begin_date: begin, range: '49' })),
  ]);
  if (pred.error) throw new Error(pred.error.message);

  const predictions = pred.predictions.map((p) => ({ t: p.t, v: parseFloat(p.v) }));
  const latestRow = obs && obs.data && obs.data[0];
  const latest = latestRow && latestRow.v !== '' ? { t: latestRow.t, v: parseFloat(latestRow.v) } : null;

  let predictedAtObs = null;
  if (latest) {
    const target = noaaMinutes(latest.t);
    let best = Infinity;
    for (const p of predictions) {
      const diff = Math.abs(noaaMinutes(p.t) - target);
      if (diff < best) {
        best = diff;
        predictedAtObs = p.v;
      }
    }
    if (best > 30) predictedAtObs = null;
  }

  const surge = latest && predictedAtObs != null ? Math.round((latest.v - predictedAtObs) * 100) / 100 : null;
  return {
    station,
    stationKey,
    thresholds: thresholdsFromGreatDiurnalRange(station.greatDiurnalRangeFt),
    latest,
    surge,
    predictions,
    peak: peakWaterLevel(
      predictions.map((p) => p.v),
      latest ? latest.v : null,
      predictedAtObs,
    ),
  };
}

// ---------------- Open-Meteo rainfall ----------------

/**
 * Hourly rainfall for many points in one request.
 * Returns one entry per point: { maxHourly, maxHourlyTime, next48Total, past24, hourly }.
 */
export async function fetchRainfall(points) {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(','),
    longitude: points.map((p) => p.lon.toFixed(4)).join(','),
    hourly: 'precipitation',
    precipitation_unit: 'inch',
    timezone: NY_TZ,
    past_days: '1',
    forecast_days: '3',
  });
  const json = await fetchJson(`https://api.open-meteo.com/v1/forecast?${q}`);
  const list = Array.isArray(json) ? json : [json];
  const nowKey = nyHourKey();

  return list.map((loc) => {
    const times = loc.hourly.time;
    const values = loc.hourly.precipitation.map((v) => v ?? 0);
    let now = times.indexOf(nowKey);
    if (now < 0) now = times.findIndex((t) => t > nowKey);
    if (now < 0) now = times.length - 1;

    const past = values.slice(Math.max(0, now - 24), now);
    const nextIdx = [...Array(Math.min(48, times.length - now)).keys()].map((i) => now + i);
    let maxHourly = 0;
    let maxHourlyTime = null;
    for (const i of nextIdx) {
      if (values[i] > maxHourly) {
        maxHourly = values[i];
        maxHourlyTime = times[i];
      }
    }
    return {
      maxHourly: round2(maxHourly),
      maxHourlyTime,
      next48Total: round2(nextIdx.reduce((s, i) => s + values[i], 0)),
      past24: round2(past.reduce((s, v) => s + v, 0)),
      hourly: nextIdx.map((i) => ({ t: times[i], v: values[i] })),
    };
  });
}

// ---------------- NWS alerts ----------------

/** Active flood-related NWS alerts, grouped by borough. */
export async function fetchAlerts() {
  const json = await fetchJson('https://api.weather.gov/alerts/active?area=NY', {
    headers: { Accept: 'application/geo+json' },
  });
  const byBorough = Object.fromEntries(Object.keys(BOROUGH_SAME).map((b) => [b, []]));
  const all = [];
  for (const f of json.features || []) {
    const p = f.properties;
    const cls = classifyAlert(p.event || '');
    if (!cls) continue;
    const same = (p.geocode && p.geocode.SAME) || [];
    const boroughs = Object.entries(BOROUGH_SAME)
      .filter(([, code]) => same.includes(code))
      .map(([b]) => b);
    if (boroughs.length === 0) continue;
    const alert = { event: p.event, headline: p.headline || p.event, ends: p.ends || p.expires || null, ...cls, boroughs };
    all.push(alert);
    for (const b of boroughs) byBorough[b].push(alert);
  }
  return { all, byBorough };
}

// ---------------- NYC 311 ----------------

const SOCRATA_311 = 'https://data.cityofnewyork.us/resource/erm2-nwe9.json';

function socrataHeaders() {
  return NYC_OPEN_DATA_APP_TOKEN ? { 'X-App-Token': NYC_OPEN_DATA_APP_TOKEN } : {};
}

/** Socrata "floating timestamp" in NY local time, e.g. 2026-09-21T00:00:00 */
function socrataDaysAgo(days) {
  const p = nyParts(new Date(Date.now() - days * 86400000));
  return `${p.y}-${p.m}-${p.d}T${p.h}:${p.min}:00`;
}

/** 311 flooding reports citywide in the last `days` days. */
export async function fetchRecent311(days = 7) {
  const q = new URLSearchParams({
    $select: 'unique_key,created_date,descriptor,incident_address,borough,latitude,longitude',
    $where: `${FLOOD_311_WHERE} AND created_date > '${socrataDaysAgo(days)}' AND latitude IS NOT NULL`,
    $order: 'created_date DESC',
    $limit: '3000',
  });
  const rows = await fetchJson(`${SOCRATA_311}?${q}`, { headers: socrataHeaders() });
  return rows.map((r) => ({
    id: r.unique_key,
    created: r.created_date,
    descriptor: r.descriptor,
    address: r.incident_address || '',
    borough: r.borough,
    lat: parseFloat(r.latitude),
    lon: parseFloat(r.longitude),
  }));
}

/** Count of 311 flooding reports within `meters` of a point over the past year. */
export async function fetch311History(lat, lon, meters = 500) {
  const q = new URLSearchParams({
    $select: 'count(*) as n',
    $where: `${FLOOD_311_WHERE} AND created_date > '${socrataDaysAgo(365)}' AND within_circle(location, ${lat}, ${lon}, ${meters})`,
  });
  const rows = await fetchJson(`${SOCRATA_311}?${q}`, { headers: socrataHeaders() });
  return rows.length ? parseInt(rows[0].n, 10) : 0;
}

// ---------------- Address search ----------------

export async function geocode(text) {
  const q = new URLSearchParams({ text, size: '5' });
  const json = await fetchJson(`https://geosearch.planninglabs.nyc/v2/search?${q}`);
  return (json.features || []).map((f) => ({
    label: f.properties.label,
    borough: f.properties.borough,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
}

// ---------------- FEMA flood zone ----------------

/** FEMA National Flood Hazard Layer zone at a point, e.g. { zone: 'AE', subtype: null }. */
export async function fetchFemaZone(lat, lon) {
  const q = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FLD_ZONE,ZONE_SUBTY,STATIC_BFE',
    returnGeometry: 'false',
    f: 'json',
  });
  const json = await fetchJson(`${FEMA_NFHL}/${FEMA_FLOOD_ZONE_LAYER}/query?${q}`);
  if (json.error) throw new Error(json.error.message);
  const attrs = json.features && json.features[0] && json.features[0].attributes;
  if (!attrs) return { zone: null, subtype: null, bfe: null };
  const bfe = attrs.STATIC_BFE != null && attrs.STATIC_BFE > -9999 ? attrs.STATIC_BFE : null;
  return { zone: attrs.FLD_ZONE, subtype: attrs.ZONE_SUBTY, bfe };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
