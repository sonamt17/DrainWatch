// HTML for the dashboard: the forecast and alerts tab, the neighborhood table,
// the address report and its safety quick-finder, the Climate Time Machine's
// delta, the neighborhood comparison and map popups. Pure functions of their inputs.

import { AREAS, RAIN_BENCHMARKS, TIDE_STATIONS } from '../facts/config.js';
import { EVAC_ZONE_FINDER } from '../apis/data.js';
import { LEVELS } from '../models/risk.js';
import { FT_PER_M } from '../models/terrain.js';
import { aqiCategory } from '../models/air-risk.js';
import { WIND_THRESHOLDS } from '../models/storm-risk.js';
import { HAZARDS, HAZARD_ORDER, alertsFor } from '../models/hazards.js';
import { esc, exposureWord, fmtTime, level, tideLevelText, windExposureWord } from './ui.js';

const quiet = (text) => `<p class="quiet">${text}</p>`;
/** Live data covers the next 48 hours; a replay covers its own window, so it says nothing. */
const span = (ctx, text = ', next 48 hours') => (ctx.isLive ? text : '');

/** Round a number to a set number of decimals: roundTo(1.256, 2) → 1.26 */
function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * A small table of an hourly forecast: one row every 6 hours.
 * rows: [{ t: time, v: value }, ...] one per hour
 * thresholds: [{ value, label, level }, ...] from lowest to highest, e.g. Advisory, Warning
 */
function hourlyTable(rows, unit, decimals, thresholds) {
  let html = '<table class="table"><thead><tr><th>Time</th><th class="num">Value</th><th>Level</th></tr></thead><tbody>';
  for (let i = 0; i < rows.length; i += 6) {
    const row = rows[i];
    if (row.v === null || row.v === undefined) continue;
    let reached = null;
    for (const t of thresholds) {
      if (row.v >= t.value) reached = t;
    }
    const levelCell = reached ? level(reached.level, reached.label) : '—';
    html += `<tr><td>${esc(fmtTime(row.t))}</td><td class="num">${roundTo(row.v, decimals)}${unit}</td><td>${levelCell}</td></tr>`;
  }
  return html + '</tbody></table>';
}

/** The high tides in the next 48 hours (a reading higher than the ones just before and after it). */
function highTidesTable(tide) {
  // Live predictions are the tide alone, so add the current storm surge on top.
  // Replays already include the surge in their water level.
  let surge = 0;
  if (!tide.includesSurge && tide.surge !== null && tide.surge > 0) surge = tide.surge;
  const t = tide.thresholds;
  const thresholds = [
    { value: t.minor, label: 'Minor flooding', level: 'elevated' },
    { value: t.moderate, label: 'Moderate flooding', level: 'high' },
    { value: t.major, label: 'Major flooding', level: 'severe' },
  ];
  const p = tide.predictions;
  const highs = [];
  for (let i = 1; i < p.length - 1; i++) {
    if (p[i].v >= p[i - 1].v && p[i].v > p[i + 1].v) highs.push({ t: p[i].t, v: p[i].v + surge });
  }
  let html = '<table class="table"><thead><tr><th>High tide</th><th class="num">Water level</th><th>Level</th></tr></thead><tbody>';
  for (const h of highs) {
    let reached = null;
    for (const th of thresholds) {
      if (h.v >= th.value) reached = th;
    }
    const levelCell = reached ? level(reached.level, reached.label) : 'Normal';
    html += `<tr><td>${esc(fmtTime(h.t))}</td><td class="num">${roundTo(h.v, 1)} ft</td><td>${levelCell}</td></tr>`;
  }
  html += '</tbody></table>';
  const what = tide.includesSurge ? 'Reconstructed water level' : surge ? `Predicted tide + ${roundTo(surge, 2)} ft current storm surge` : 'Predicted tide';
  const slr = tide.seaLevelRiseFt ? ` Includes +${Math.round(tide.seaLevelRiseFt * 12)} in of projected sea level rise.` : '';
  return `${html}<p class="note">Feet above normal high tide. ${what}.${slr} Flooding starts at ${roundTo(t.minor, 1)} ft (minor), ${roundTo(t.moderate, 1)} ft (moderate) and ${roundTo(t.major, 1)} ft (major).</p>`;
}

function block(title, body) {
  return `<section><h3 class="h3">${esc(title)}</h3>${body}</section>`;
}

function worstIndex(list, key) {
  let best = -1;
  (list || []).forEach((x, i) => {
    if (x && x[key] != null && (best < 0 || x[key] > list[best][key])) best = i;
  });
  return best;
}

function alertsBlock(hazard, inputs, failed) {
  if (failed) return block('Weather alerts', quiet(`Couldn't reach the National Weather Service. Check <a href="https://www.weather.gov/okx/" target="_blank" rel="noopener">weather.gov/okx</a>.`));
  const alerts = alertsFor(inputs.alerts, hazard);
  if (!alerts.length) return block('Weather alerts', quiet(`No active ${HAZARDS[hazard].noun} alerts for New York City.`));
  return block(
    'Weather alerts',
    `<ul class="alerts">${alerts
      .map(
        (a) => `<li><strong>${esc(a.event)}</strong>
          <span>${esc(a.boroughs.length === 5 ? 'All five boroughs' : a.boroughs.join(', '))}${a.ends ? ` · until ${esc(fmtTime(a.ends))}` : ''}</span></li>`,
      )
      .join('')}</ul>`,
  );
}

function floodBlocks(ctx) {
  const { inputs, selectedStation } = ctx;
  const out = [];
  const tide = inputs.tides ? inputs.tides[selectedStation] : null;
  const options = Object.entries(TIDE_STATIONS)
    .map(([k, s]) => `<option value="${k}"${k === selectedStation ? ' selected' : ''}>${esc(s.name)}</option>`)
    .join('');
  let tideBody = `<label class="note">Tide gauge <select id="station-select">${options}</select></label>`;
  if (!tide) tideBody += quiet('No tide data from NOAA for this gauge right now.');
  else {
    tideBody += `<p class="stat-line">${tide.peak.toFixed(1)} ft<small>peak above normal high tide${span(ctx)}</small></p>
      ${highTidesTable(tide)}`;
  }
  out.push(block('Tide and storm surge', tideBody));

  const w = inputs.weather;
  const i = worstIndex(w, 'maxHourly');
  if (!w || i < 0) out.push(block('Rain', quiet("Couldn't load the rainfall forecast.")));
  else {
    const top = w[i];
    const pct = Math.round((top.maxHourly / RAIN_BENCHMARKS.sewerDesign) * 100);
    out.push(
      block(
        'Rain',
        `<p class="stat-line">${top.maxHourly.toFixed(2)} in/hr<small>peak, ${pct}% of what most sewers can drain</small></p>
        ${hourlyTable(top.hourly.map((r) => ({ t: r.t, v: r.precip })), ' in', 2, [
            { value: 0.5, label: 'Heavy', level: 'elevated' },
            { value: 1, label: 'Intense', level: 'high' },
            { value: RAIN_BENCHMARKS.sewerDesign, label: 'Sewers full', level: 'severe' },
          ])}
        <p class="note">Near ${esc(AREAS[i].name)}${top.maxHourlyTime ? `, heaviest ${esc(fmtTime(top.maxHourlyTime))}` : ''}. Hourly forecasts smooth out short cloudbursts, so real peaks can be higher.</p>`,
      ),
    );
  }
  return out;
}

function heatBlocks(ctx) {
  const { inputs } = ctx;
  const w = inputs.weather;
  const i = worstIndex(w, 'maxHeatIndex');
  if (!w || i < 0) return [block('Heat index', quiet("Couldn't load the temperature forecast."))];
  const top = w[i];
  return [
    block(
      `Heat index${span(ctx)}`,
      `<p class="stat-line">${Math.round(top.maxHeatIndex)}°F<small>peak feels-like · low ${top.overnightLow != null ? Math.round(top.overnightLow) : '—'}°F</small></p>
      ${hourlyTable(top.hourly.map((r) => ({ t: r.t, v: r.hi })), '°F', 0, [
          { value: 90, label: 'Hot', level: 'elevated' },
          { value: 100, label: 'Advisory', level: 'high' },
          { value: 105, label: 'Warning', level: 'severe' },
        ])}
      <p class="note">Temperature plus humidity near ${esc(AREAS[i].name)}, the hottest tracked neighborhood${top.maxHeatIndexTime ? `, peaking ${esc(fmtTime(top.maxHeatIndexTime))}` : ''}.</p>`,
    ),
  ];
}

function airBlocks(ctx) {
  const { inputs } = ctx;
  const a = inputs.air;
  const i = worstIndex(a, 'peakAqi');
  if (!a || i < 0) return [block('Air Quality Index', quiet("Couldn't load the air quality forecast."))];
  const top = a[i];
  return [
    block(
      `Air Quality Index${span(ctx)}`,
      `<p class="stat-line">${Math.round(top.peakAqi)}<small>peak AQI, ${esc(aqiCategory(top.peakAqi))} · now ${top.currentAqi != null ? Math.round(top.currentAqi) : '—'}</small></p>
      ${hourlyTable(top.hourly.map((r) => ({ t: r.t, v: r.aqi })), '', 0, [
          { value: 50, label: 'Moderate', level: 'elevated' },
          { value: 100, label: 'Sensitive', level: 'high' },
          { value: 150, label: 'Unhealthy', level: 'severe' },
        ])}
      <p class="note">Near ${esc(AREAS[i].name)}. Mostly ${top.dominant === 'ozone' ? 'ozone (smog)' : 'fine particles (PM2.5), the main pollutant in wildfire smoke'}.</p>`,
    ),
  ];
}

function windBlocks(ctx) {
  const { inputs } = ctx;
  const w = inputs.weather;
  const i = worstIndex(w, 'maxGust');
  if (!w || i < 0) return [block('Wind gusts', quiet("Couldn't load the wind forecast."))];
  const top = w[i];
  const thunder = top.weatherCodes.some((c) => c >= 95);
  return [
    block(
      `Wind gusts${span(ctx)}`,
      `<p class="stat-line">${Math.round(top.maxGust)} mph<small>peak gust · ${thunder ? 'thunderstorms possible' : 'no thunderstorms forecast'}</small></p>
      ${hourlyTable(top.hourly.map((r) => ({ t: r.t, v: r.gust })), ' mph', 0, [
          { value: WIND_THRESHOLDS.advisoryGust, label: 'Advisory', level: 'elevated' },
          { value: WIND_THRESHOLDS.warningGust, label: 'Warning', level: 'high' },
          { value: WIND_THRESHOLDS.hurricaneGust, label: 'Hurricane', level: 'severe' },
        ])}
      <p class="note">Near ${esc(AREAS[i].name)}${top.maxGustTime ? `, strongest ${esc(fmtTime(top.maxGustTime))}` : ''}. Gusts of ${WIND_THRESHOLDS.warningGust}+ mph bring down trees and power lines.</p>`,
    ),
  ];
}

const BLOCKS = { floods: floodBlocks, heat: heatBlocks, air: airBlocks, wind: windBlocks };

/** ctx: { hazard, inputs, status, selectedStation, isLive, pending } */
export function detailsHtml(ctx) {
  if (ctx.pending) return block('Forecast', quiet('Loading live data…'));
  const failedAlerts = ctx.isLive && ctx.status.alerts && !ctx.status.alerts.ok;
  return [alertsBlock(ctx.hazard, ctx.inputs, failedAlerts), ...BLOCKS[ctx.hazard](ctx)].join('');
}

// ---------------- table, legend ----------------

export function rankingRowsHtml(results, available, { limit = Infinity } = {}) {
  const sorted = [...results].sort((a, b) => b.score - a.score || a.area.name.localeCompare(b.area.name));
  return sorted
    .slice(0, limit)
    .map(
      (r, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td class="name"><button type="button" class="row-link" data-id="${r.area.id}">${esc(r.area.name)}</button> <small>${esc(r.area.borough)}</small></td>
        <td>${available ? level(r.level) : level('none')}</td>
        <td class="num">${available ? r.score.toFixed(1) : '—'}</td>
      </tr>`,
    )
    .join('');
}

/** flood: the flooded-land layer is on; slr: sea level rise is added on top. */
export function legendHtml({ flood = false, slr = false } = {}) {
  let html = `<span class="small-label">Risk</span>${LEVELS.map((l) => level(l.level, l.label)).join('')}<span class="unrated">Not rated</span>`;
  if (flood) {
    html += `<span class="legend-break"></span><span class="flood-key slate-square">Under water at the peak</span>`;
    if (slr) html += `<span class="flood-key orange-square">Added by sea level rise</span><span class="flood-key dashed-outline">Hit harder by the rise</span>`;
  }
  return html;
}

// ---------------- popups ----------------

function detailLines(hazard, r) {
  const a = r.area;
  if (hazard === 'floods') return [`Coastal exposure: ${exposureWord(a.coastalExposure)}`, `Stormwater exposure: ${exposureWord(a.stormwaterExposure)}`];
  if (hazard === 'heat') return [`Heat Vulnerability Index ${a.hvi} of 5`, r.weather && r.weather.maxHeatIndex != null ? `Feels like up to ${Math.round(r.weather.maxHeatIndex)}°F` : null];
  if (hazard === 'air') return [`Asthma burden ${a.asthma} of 5`, r.air && r.air.peakAqi != null ? `AQI up to ${Math.round(r.air.peakAqi)}` : null];
  return [windExposureWord(a.windExposure), r.weather && r.weather.maxGust != null ? `Gusts up to ${Math.round(r.weather.maxGust)} mph` : null];
}

export function areaPopupHtml(hazard, r, available, ntaName) {
  return `<div class="popup">
    <p class="small-label">${esc(r.area.borough)}${ntaName && ntaName !== r.area.name ? ` · ${esc(ntaName)}` : ''}</p>
    <h4>${esc(r.area.name)}</h4>
    <p>${available ? `${level(r.level)} <span class="note">score ${r.score.toFixed(1)} of 4</span>` : level('none')}</p>
    ${available ? `<ul>${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <p class="note" style="margin-top:8px">${detailLines(hazard, r).filter(Boolean).map(esc).join(' · ')}</p>
  </div>`;
}

export function stationPopupHtml(key, s, tide) {
  const text = tide && tide.latest ? tideLevelText(tide.latest.v, 2) : 'No data right now';
  return `<div class="popup"><p class="small-label">NOAA tide gauge</p><h4>${esc(s.name)}</h4><p>${esc(text)}</p>
    <p><a href="https://tidesandcurrents.noaa.gov/stationhome.html?id=${s.id}" target="_blank" rel="noopener">Station ${s.id}</a></p></div>`;
}

export function reportPinPopupHtml(rep) {
  return `<div class="popup"><p class="small-label">311 report · ${esc(fmtTime(rep.created))}</p><h4>${esc(rep.descriptor)}</h4><p class="note">${esc(rep.address)}</p></div>`;
}

// ---------------- the address report ----------------

/**
 * rep: { place, borough, nearest, loading, fema, history, stationName,
 *        results: { hazard: result }, available: { hazard: bool } }
 */
export function reportHtml(rep, currentHazard) {
  const rows = HAZARD_ORDER.map((h) => {
    const r = rep.results[h];
    const ok = rep.available[h];
    const why = !r ? 'Checking…' : ok ? r.reasons[0] : 'Live data unavailable';
    return `<tr data-hazard="${h}"${h === currentHazard ? ' class="here"' : ''}>
      <td class="name">${esc(HAZARDS[h].label)}</td>
      <td>${r ? level(ok ? r.level : 'none') : level('none', '…')}</td>
      <td class="why">${esc(why)}</td>
    </tr>`;
  }).join('');

  return `<article class="report">
    <div class="report-title">
      <p class="small-label">Your address</p>
      <h3>${esc(rep.place.label)}</h3>
      <p class="note">${esc(rep.borough)} · nearest rated neighborhood: ${esc(rep.nearest.name)}</p>
      <button type="button" class="report-close" id="report-close">Clear this address</button>
    </div>
    <div class="report-body">
      <table class="table">
        <thead><tr><th scope="col">Hazard</th><th scope="col">Risk</th><th scope="col">Why</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${currentHazard === 'floods' ? refugeHtml(rep) : ''}
      <p class="note space-above">Flood ratings use this exact spot. Heat, air and wind use the forecast here and the nearest rated neighborhood's vulnerability. FEMA's official flood maps are from 2007, so with today's higher seas the real flood area can be bigger than they show.</p>
    </div>
  </article>`;
}

// ---------------- safety quick-finder ----------------

const ft = (m) => Math.round(m * FT_PER_M);
const miles = (km) => {
  const mi = km * 0.621371;
  return mi < 0.1 ? 'less than 0.1 mi' : `${mi < 1 ? mi.toFixed(1) : mi.toFixed(mi < 10 ? 1 : 0)} mi`;
};

function evacText(rep) {
  if (rep.evacLoading) return 'Checking NYC Emergency Management…';
  if (!rep.evac) return `Couldn't reach the city's zone map. <a href="${EVAC_ZONE_FINDER}" target="_blank" rel="noopener">Look it up in the Zone Finder ↗</a>`;
  if (!rep.evac.zone) return '<b>Not in a hurricane evacuation zone.</b> Still follow any order from the city.';
  const z = rep.evac.zone;
  const when = z === '1' ? 'the first zone ordered to leave before a coastal storm' : `leave whenever the city orders zones 1–${z} out`;
  return `<b>Zone ${esc(z)}</b>: ${when}.`;
}

/**
 * rep.terrain: { here: { m } | null, higher: { km, direction, m, name } | null,
 *                sandyM, futureM, futureLabel } | null (still loading)
 */
function refugeHtml(rep) {
  const t = rep.terrain;
  let ground = 'Checking elevation…';
  let higher = '';
  if (t && !t.here) ground = 'No elevation data at this spot.';
  else if (t) {
    const gap = ft(t.here.m - t.sandyM);
    ground = `<b>${ft(t.here.m)} ft</b> above sea level, ${gap >= 0 ? `${gap} ft above` : `<b>${-gap} ft below</b>`} Sandy's storm tide (${ft(t.sandyM)} ft)`;
    if (t.here.m < t.futureM) ground += `, and below it with ${esc(t.futureLabel)} seas`;
    ground += '.';
    if (t.onHighGround) higher = '<b>You are on high ground.</b> Above Sandy plus 2080s seas, with room to spare.';
    else if (!t.higher) higher = 'No high ground within 12 km on the elevation map.';
    else {
      const h = t.higher;
      const dir = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${rep.place.lat.toFixed(5)}%2C${rep.place.lon.toFixed(5)}%3B${h.lat.toFixed(5)}%2C${h.lon.toFixed(5)}`;
      higher = `<b>${miles(h.km)} ${esc(h.direction)}</b>, ${ft(h.m)} ft up${h.name ? `, in ${esc(h.name)}` : ''}.
        <span class="refuge-actions"><button type="button" class="link-btn" id="refuge-show">Show on map</button> <a href="${dir}" target="_blank" rel="noopener">Walking route ↗</a></span>`;
    }
  }
  const links = [
    { href: EVAC_ZONE_FINDER, label: 'Evacuation Zone Finder' },
    { href: 'https://www.nyc.gov/notifynyc', label: 'Notify NYC alerts' },
    { href: 'https://www.floodhelpny.org/', label: 'FloodHelpNY' },
    { href: 'https://portal.311.nyc.gov/', label: 'NYC 311' },
  ];
  return `<section class="refuge">
    <h4 class="card-title">Safety quick-finder</h4>
    <dl class="refuge-list">
      <dt>Evacuation zone</dt><dd>${evacText(rep)}</dd>
      <dt>Ground here</dt><dd>${ground}</dd>
      ${t && t.here ? `<dt>Higher ground</dt><dd>${higher}</dd>` : ''}
    </dl>
    <p class="refuge-links">${links.map((l) => `<a class="pill-button" href="${l.href}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}</p>
    <p class="note">Higher ground means at least ${ft(t ? t.safeM : 6)} ft above sea level on USGS elevation data (~110 m cells). It is a direction to head, not a shelter. In a real storm, follow the city's evacuation orders and call 311 for your evacuation center.</p>
  </section>`;
}

// ---------------- Climate Time Machine ----------------

/**
 * d: { inches, label, peakBefore, peakAfter, stationName, counts: { before, after },
 *      changes: [{ name, from, to }], flood: { baseKm2, addedKm2 } | null, scenarioName }
 */
export function timeMachineDeltaHtml(d) {
  const sevBefore = d.counts.before.severe;
  const sevAfter = d.counts.after.severe;
  const highBefore = d.counts.before.high + sevBefore;
  const highAfter = d.counts.after.high + sevAfter;
  const sign = (n, unit = '') => (n > 0 ? `+${n}${unit}` : `${n}${unit}`);
  const stat = (label, before, after, fmt = (x) => x, unit = '') => `<div class="delta-stat">
      <span class="small-label">${esc(label)}</span>
      <span class="delta-nums"><span class="before">${fmt(before)}</span><span class="arrow">→</span><b>${fmt(after)}</b>${unit ? `<small>${unit}</small>` : ''}</span>
    </div>`;
  const pct = d.flood && d.flood.baseKm2 ? Math.round((d.flood.addedKm2 / d.flood.baseKm2) * 100) : null;
  return `<p class="delta-head">${esc(d.scenarioName)} <b>${sign(d.inches, ' in')}</b> of sea level rise</p>
    <div class="delta-grid">
      ${stat(`Peak water, ${d.stationName}`, d.peakBefore, d.peakAfter, (x) => x.toFixed(1), 'ft')}
      ${stat('High or Severe', highBefore, highAfter, (x) => x, 'places')}
      ${d.flood ? stat('Land under water', d.flood.baseKm2, d.flood.baseKm2 + d.flood.addedKm2, (x) => Math.round(x), 'km²') : ''}
    </div>
    ${d.flood && d.flood.addedKm2 > 0.5 ? `<p class="note">The rise alone puts another <b>${Math.round(d.flood.addedKm2)} km²</b> of the city under water${pct != null ? ` (${sign(pct, '%')})` : ''}, shown in orange on the map.</p>` : ''}
    ${
      d.changes.length
        ? `<p class="small-label space-above">Risk goes up in ${d.changes.length} neighborhood${d.changes.length === 1 ? '' : 's'}</p>
           <ul class="delta-list">${d.changes
             .map((c) => `<li><button type="button" class="row-link" data-id="${c.id}">${esc(c.name)}</button> ${level(c.from)}<span class="arrow">→</span>${level(c.to)}</li>`)
             .join('')}</ul>`
        : `<p class="note">${
            d.counts.before.severe
              ? 'Every neighborhood this storm already rates Severe stays Severe; the rise shows up as how much more land goes under water.'
              : 'No neighborhood changes risk level at this much rise. Try a storm replay or more inches.'
          }</p>`
    }
    ${
      d.wetter && d.wetter.length
        ? `<p class="small-label space-above">Most newly flooded land</p>
           <ul class="delta-list three-columns">${d.wetter
             .map(
               (w) => `<li><button type="button" class="row-link" data-id="${w.id}">${esc(w.name)}</button>
                 <span class="wet-bar"><span class="wet-base" style="width:${w.baseShare * 100}%"></span><span class="wet-added" style="width:${w.addedShare * 100}%"></span></span>
                 <span class="num">+${Math.round(w.addedShare * 100)}%</span></li>`,
             )
             .join('')}</ul>
           <p class="note">Share of each neighborhood's land under water: slate before the rise, orange added by it. Outlined in orange on the map.</p>`
        : ''
    }`;
}

// ---------------- neighborhood vs. neighborhood ----------------

/**
 * c: { a, b: { area, results: { hazard: result }, available, elev: { medianM, shareSandy, shareFuture } | null },
 *      futureLabel }
 */
export function compareHtml(c) {
  const rows = [];
  const bar = (v, max, worse) => `<span class="cmp-bar${worse ? ' worse' : ''}" style="--w:${max ? Math.max(2, (v / max) * 100) : 0}%"></span>`;
  // one row: label, values for A and B, a numeric for the bars, and which way is worse
  const row = (label, va, vb, na, nb, { max, higherIsWorse = true, hazard = null } = {}) => {
    const worseA = na != null && nb != null && (higherIsWorse ? na > nb : na < nb);
    const worseB = na != null && nb != null && (higherIsWorse ? nb > na : nb < na);
    rows.push(`<div class="cmp-row"${hazard ? ` data-hazard="${hazard}"` : ''}>
      <div class="cmp-side left-side${worseA ? ' is-worse' : ''}"><span class="cmp-val">${va}</span>${na != null ? bar(na, max, worseA) : ''}</div>
      <div class="cmp-label">${esc(label)}</div>
      <div class="cmp-side right-side${worseB ? ' is-worse' : ''}">${nb != null ? bar(nb, max, worseB) : ''}<span class="cmp-val">${vb}</span></div>
    </div>`);
    return worseA ? 'a' : worseB ? 'b' : null;
  };
  const tally = { a: 0, b: 0 };
  const count = (who) => who && tally[who]++;

  rows.push('<p class="cmp-group small-label">Risk with these conditions</p>');
  for (const h of HAZARD_ORDER) {
    const ra = c.a.results[h];
    const rb = c.b.results[h];
    const ok = c.a.available[h];
    const show = (r) => (ok ? `${level(r.level)} <small class="num">${r.score.toFixed(1)}</small>` : level('none'));
    count(row(HAZARDS[h].label, show(ra), show(rb), ok ? ra.score : null, ok ? rb.score : null, { max: 4, hazard: h }));
  }

  rows.push('<p class="cmp-group small-label">Who lives with it</p>');
  const A = c.a.area;
  const B = c.b.area;
  count(row('Heat Vulnerability Index', `${A.hvi} of 5`, `${B.hvi} of 5`, A.hvi, B.hvi, { max: 5 }));
  count(row('Asthma burden', `${A.asthma} of 5`, `${B.asthma} of 5`, A.asthma, B.asthma, { max: 5 }));
  count(row('Coastal flood exposure', exposureWord(A.coastalExposure), exposureWord(B.coastalExposure), A.coastalExposure, B.coastalExposure, { max: 3 }));
  count(row('Stormwater exposure', exposureWord(A.stormwaterExposure), exposureWord(B.stormwaterExposure), A.stormwaterExposure, B.stormwaterExposure, { max: 3 }));
  row('Wind exposure', windExposureWord(A.windExposure), windExposureWord(B.windExposure), A.windExposure, B.windExposure, { max: 3 });

  rows.push('<p class="cmp-group small-label">The ground underneath</p>');
  const ea = c.a.elev;
  const eb = c.b.elev;
  if (ea && eb) {
    const maxFt = Math.max(ft(ea.medianM), ft(eb.medianM), 1);
    count(row('Typical elevation', `${ft(ea.medianM)} ft`, `${ft(eb.medianM)} ft`, ft(ea.medianM), ft(eb.medianM), { max: maxFt, higherIsWorse: false }));
    const p = (x) => `${Math.round(x * 100)}%`;
    count(row("Land below Sandy's storm tide", p(ea.shareSandy), p(eb.shareSandy), ea.shareSandy, eb.shareSandy, { max: 1 }));
    row(`…with ${c.futureLabel} seas`, p(ea.shareFuture), p(eb.shareFuture), ea.shareFuture, eb.shareFuture, { max: 1 });
  } else rows.push(`<p class="note">${c.elevLoading ? 'Loading elevation data…' : 'Elevation data unavailable.'}</p>`);

  const verdict =
    tally.a === tally.b
      ? `${esc(A.name)} and ${esc(B.name)} come out even on these measures.`
      : `<b>${esc((tally.a > tally.b ? A : B).name)}</b> is worse off on ${Math.max(tally.a, tally.b)} of ${tally.a + tally.b} measures where they differ.`;

  return `<div class="cmp-names">
      <div class="cmp-name left-side"><span class="cmp-tag">A</span><b>${esc(A.name)}</b><small>${esc(A.borough)}</small></div>
      <div></div>
      <div class="cmp-name right-side"><b>${esc(B.name)}</b><small>${esc(B.borough)}</small><span class="cmp-tag">B</span></div>
    </div>
    <p class="cmp-verdict">${verdict}</p>
    <div class="cmp-rows">${rows.join('')}</div>
    <p class="note">Darker bars mark the side that is worse off. Elevation: USGS 3DEP; share of each neighborhood's land below the water level, ignoring walls and drainage.</p>`;
}

