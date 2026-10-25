// One place that knows how each hazard tab turns inputs into neighborhood results,
// a citywide headline and the KPI tiles. No DOM or network here, so live data and
// historical replays share it and it can be tested on its own.
//
// inputs: { tides, weather[], air[], alerts[], reports[] | null }, with arrays aligned with AREAS.

import { AREAS } from '../facts/config.js';
import { assess, classifyAlert, distanceKm, LEVELS } from './risk.js';
import { assessHeat, classifyHeatAlert } from './heat-risk.js';
import { assessAir, classifyAirAlert } from './air-risk.js';
import { assessStorm, classifyWindAlert } from './storm-risk.js';

export const HAZARD_ORDER = ['floods', 'heat', 'air', 'wind'];

export const HAZARDS = {
  floods: { id: 'floods', label: 'Floods', title: 'Flood risk', noun: 'flood' },
  heat: { id: 'heat', label: 'Heat', title: 'Heat risk', noun: 'heat' },
  air: { id: 'air', label: 'Air quality', title: 'Air quality risk', noun: 'air quality' },
  wind: { id: 'wind', label: 'Wind & storms', title: 'Wind & storm risk', noun: 'wind' },
};

const CLASSIFIERS = { floods: classifyAlert, heat: classifyHeatAlert, air: classifyAirAlert, wind: classifyWindAlert };

const NEARBY_KM = 1;

/** NWS alerts relevant to one hazard (optionally one borough), each tagged with its severity. */
export function alertsFor(alerts, hazard, borough = null) {
  const out = [];
  for (const a of alerts || []) {
    if (borough && !a.boroughs.includes(borough)) continue;
    const tag = CLASSIFIERS[hazard](a.event);
    if (tag) out.push({ ...a, ...tag });
  }
  return out;
}

export function reportsNear(reports, lat, lon) {
  if (!reports) return null;
  return reports.filter((r) => distanceKm(lat, lon, r.lat, r.lon) <= NEARBY_KM).length;
}

/** Score one neighborhood-like place for one hazard. `i` indexes the weather/air arrays. */
export function assessPlace(hazard, place, inputs, i, overrides = {}) {
  const weather = overrides.weather ?? (inputs.weather ? inputs.weather[i] : null);
  const air = overrides.air ?? (inputs.air ? inputs.air[i] : null);
  const alerts = alertsFor(inputs.alerts, hazard, place.borough);
  const missing = [];

  if (hazard === 'floods') {
    const tide = inputs.tides ? inputs.tides[place.station] : null;
    if (!tide && place.coastalExposure > 0) missing.push('tides');
    if (!weather) missing.push('rainfall');
    const r = assess({
      coastalExposure: overrides.coastalExposure ?? place.coastalExposure,
      stormwaterExposure: overrides.stormwaterExposure ?? place.stormwaterExposure,
      thresholds: tide ? tide.thresholds : { minor: 99, moderate: 99, major: 99 },
      peakWaterFt: tide ? tide.peak : null,
      maxHourlyRainIn: weather ? weather.maxHourly : null,
      past24hRainIn: weather ? weather.past24 : null,
      alerts,
      recentComplaints: reportsNear(inputs.reports, place.lat, place.lon),
    });
    return { area: place, ...r, tide, weather, missing };
  }

  if (hazard === 'heat') {
    if (!weather) missing.push('temperature');
    const r = assessHeat({ hvi: place.hvi, maxHeatIndex: weather?.maxHeatIndex, overnightLow: weather?.overnightLow, alerts });
    return { area: place, ...r, weather, missing };
  }

  if (hazard === 'air') {
    if (!air) missing.push('air quality');
    const r = assessAir({ asthma: place.asthma, currentAqi: air?.currentAqi, peakAqi: air?.peakAqi, dominant: air?.dominant, alerts });
    return { area: place, ...r, air, missing };
  }

  if (!weather) missing.push('wind');
  const r = assessStorm({
    windExposure: place.windExposure,
    maxGust: weather?.maxGust,
    maxSustained: weather?.maxWind,
    weatherCodes: weather?.weatherCodes,
    alerts,
  });
  return { area: place, ...r, weather, missing };
}

export function assessAll(hazard, inputs) {
  return AREAS.map((area, i) => assessPlace(hazard, area, inputs, i));
}

/** Has this hazard got the data it needs to say anything at all? */
export function hasData(hazard, inputs) {
  if (hazard === 'floods') return Boolean((inputs.weather && inputs.weather.length) || Object.keys(inputs.tides || {}).length);
  if (hazard === 'air') return Boolean(inputs.air && inputs.air.length);
  return Boolean(inputs.weather && inputs.weather.length);
}

const DRIVER_TEXT = {
  coastal: 'high tides and storm surge',
  stormwater: 'heavy rain',
  heat: 'heat and humidity',
  pm2_5: 'fine particle pollution',
  ozone: 'ozone (smog)',
  air: 'poor air quality',
  wind: 'damaging wind',
  thunder: 'thunderstorms',
};

/**
 * Citywide picture for the hero band: worst place, level counts, a headline
 * sentence.
 */
export function citySummary(hazard, results, inputs) {
  const counts = Object.fromEntries(LEVELS.map((l) => [l.level, 0]));
  for (const r of results) counts[r.level]++;
  const worst = results.reduce((a, b) => (b.score > a.score ? b : a), results[0]);
  const atRisk = results.filter((r) => r.level === 'high' || r.level === 'severe').length;
  const aboveLow = results.filter((r) => r.level !== 'low').length;
  const alerts = alertsFor(inputs.alerts, hazard);
  const available = hasData(hazard, inputs);

  let headline;
  if (!available) headline = 'Live data is unavailable right now.';
  else if (worst.level === 'low') headline = `No significant ${HAZARDS[hazard].noun} risk in the next 48 hours.`;
  else {
    const what = DRIVER_TEXT[worst.driver] || 'current conditions';
    const top = results.filter((r) => r.level === worst.level).sort((a, b) => b.score - a.score);
    if (top.length === results.length) {
      headline = `${levelWord(worst.level)} risk citywide: all ${results.length} neighborhoods, driven by ${what}.`;
    } else if (top.length > 1) {
      const names = top.slice(0, 3).map((r) => r.area.name);
      const more = top.length > 3 ? `${names.join(', ')} and ${top.length - 3} more` : listText(names);
      headline = `${levelWord(worst.level)} risk in ${top.length} neighborhoods, including ${more}, driven by ${what}.`;
    } else {
      const tail = aboveLow === 1 ? 'It is the only neighborhood above low risk.' : `${aboveLow} of ${results.length} neighborhoods are above low risk.`;
      headline = `Highest risk in ${worst.area.name}, driven by ${what}. ${tail}`;
    }
  }

  return { worst, counts, atRisk, aboveLow, alerts, available, headline };
}

function levelWord(level) {
  return LEVELS.find((l) => l.level === level).label;
}

function listText(items) {
  return items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Index of the AREAS entry nearest a point. */
export function nearestAreaIndex(lat, lon) {
  let best = 0;
  AREAS.forEach((a, i) => {
    if (distanceKm(lat, lon, a.lat, a.lon) < distanceKm(lat, lon, AREAS[best].lat, AREAS[best].lon)) best = i;
  });
  return best;
}
