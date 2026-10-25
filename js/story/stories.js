// The story for each hazard: which replay it tells, the hour-by-hour numbers,
// the sentences ("beats") and the neighborhoods it zooms into. Every number in
// the text is calculated from the replay data, never typed in. Pure: no page, no map.

import { AREAS } from '../facts/config.js';
import { aqiCategory } from '../models/air-risk.js';
import { assessPlace } from '../models/hazards.js';
import { buildScenario, scenarioById, scenarioHourly, SEA_LEVEL_STOPS } from '../models/scenarios.js';

/** Mean higher high water at the Battery is about 2.2 ft (0.68 m) above NAVD88, the datum of the elevation data. */
export const MHHW_NAVD_M = 0.68;
export const FT = 0.3048;

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Friday, 3 p.m." from "2019-07-19T15:00" (AP style). */
export function storyTime(key, { day = true } = {}) {
  const d = new Date(`${key.slice(0, 10)}T12:00:00Z`);
  const h = +key.slice(11, 13);
  const clock = h === 0 ? 'midnight' : h === 12 ? 'noon' : `${h % 12} ${h < 12 ? 'a.m.' : 'p.m.'}`;
  return day ? `${WEEKDAY[d.getUTCDay()]}, ${clock}` : clock;
}

const r0 = (v) => Math.round(v);
const r1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

export const STORIES = {
  heat: {
    hazard: 'heat',
    scenario: 'heat-2019',
    metric: 'heatIndex',
    unit: '°F',
    window: { from: '2019-07-19T00:00', hours: 72 },
    heroHour: '2019-07-20T20:00',
    hero: {
      kicker: 'July 20, 2019',
      megaUnit: '°F',
      megaLabel: 'feels like',
      headline: (c) => `New York's hottest weekend in years. At night, it never dropped below ${Math.floor(c.nightLow / 10) * 10}.`,
    },
    timeline: {
      kicker: 'Heat wave · July 19–21, 2019',
      source: 'NOAA weather records', // where the replay's numbers come from
      title: 'Three days, and nights that never cooled off',
      dek: 'Play or drag through the heat wave hour by hour. Each rated neighborhood is colored by how hot it feels there.',
    },
    // map colors: the heat index (°F) where each level starts (Elevated, High, Severe)
    levels: [90, 100, 105],
    legend: 'Colored by how hot it feels: Elevated from 90°F, High from 100°F (Heat Advisory), Severe from 105°F (Extreme Heat Warning).',
    beats: [
      { at: '2019-07-19T15:00', write: (c) => `The thermometer says ${r0(c.temp)}°F, but the humidity makes the hottest blocks feel ${r0(c.value - c.temp)} degrees hotter.` },
      { at: '2019-07-19T23:00', write: (c) => `The sun has been down for hours, and it still feels like ${r0(c.value)}°F.` },
      { at: '2019-07-20T06:00', write: (c) => `Sunrise, and it already feels like ${r0(c.value)}°F.` },
      { at: '2019-07-20T16:00', write: () => 'The city has declared a heat emergency and opened hundreds of cooling centers.' },
      { at: '2019-07-21T05:00', write: (c) => `The coolest hour of the night, and the air is still ${r0(c.temp)}°F.` },
      { at: '2019-07-21T16:00', write: (c) => `A second straight day near ${r0(c.value)}°F.` },
    ],
    exposed: {
      kicker: "Who's exposed",
      title: 'The same heat is not equally dangerous everywhere',
      dek: 'Neighborhoods with less shade, more pavement and fewer air conditioners carry the most risk.',
      steps: [
        { id: 'east-harlem' },
        { id: 'les' },
        { id: 'central-harlem' },
      ],
    },
  },

  floods: {
    hazard: 'floods',
    scenario: 'sandy',
    metric: 'water',
    unit: ' ft',
    window: { from: '2012-10-29T06:00', hours: 16 },
    heroHour: '2012-10-29T18:00',
    hero: {
      kicker: 'October 29, 2012',
      megaUnit: ' ft',
      megaLabel: 'above high tide',
      headline: () => 'Hurricane Sandy pushed New York Harbor into the streets. Higher seas will make the next storm worse.',
    },
    timeline: {
      kicker: 'Hurricane Sandy · October 29, 2012',
      source: 'NOAA tide gauge records', // where the replay's numbers come from
      title: 'The harbor rose all day, then poured into the city',
      dek: 'Play or drag to raise the harbor to its measured level at each hour. Land below the waterline turns blue.',
    },
    legend: 'Blue: land below the water level at that hour (USGS elevation). Orange: the extra land flooded with 2080s seas (NPCC 2019).',
    beats: [
      {
        at: '2012-10-29T08:00',
        write: (c) =>
          `Sandy is still offshore, but its winds are already piling water into the harbor${c.value > c.minor ? `, past the ${r1(c.minor)} ft where minor flooding starts` : `. Minor flooding starts at ${r1(c.minor)} ft`}.`,
      },
      {
        at: '2012-10-29T17:00',
        write: (c) => (c.value > c.minor ? `Still rising, now past the ${r1(c.minor)} ft where minor flooding starts.` : `Still rising toward the ${r1(c.minor)} ft where minor flooding starts.`),
      },
      { at: '2012-10-29T21:00', write: () => 'Seawater pours into subway tunnels, the Battery Tunnel and the Rockaways.' },
      { at: 'slr', write: (c) => `Now run the same storm on the seas projected for the ${c.slr.label}: ${c.slr.inches} inches higher. More of the city goes under.` },
    ],
    exposed: {
      kicker: "Who's exposed",
      title: 'Where the water reached first',
      dek: 'Low-lying neighborhoods on the open water flooded fastest and deepest.',
      steps: [
        { id: 'red-hook' },
        { id: 'rockaway' },
        { id: 'midland-beach' },
      ],
    },
  },

  air: {
    hazard: 'air',
    scenario: 'smoke-2023',
    metric: 'aqi',
    unit: '',
    window: { from: '2023-06-07T00:00', hours: 48 },
    heroHour: '2023-06-07T19:00',
    hero: {
      kicker: 'June 7, 2023',
      megaUnit: '',
      megaLabel: 'Air Quality Index',
      headline: () => "Smoke from Canada's wildfires turned the sky orange and New York's air hazardous.",
    },
    timeline: {
      kicker: 'Canadian wildfire smoke · June 7–8, 2023',
      source: 'EPA air quality records', // where the replay's numbers come from
      title: 'The smoke rolled in, and stayed',
      dek: 'Play or drag through June 7 and 8. Each rated neighborhood is colored by its Air Quality Index.',
    },
    // map colors: the AQI where each level starts (Elevated, High, Severe)
    levels: [51, 101, 151],
    legend: 'Colored by the Air Quality Index: Elevated from 51 (Moderate), High from 101 (Unhealthy for sensitive groups), Severe from 151 (Unhealthy).',
    beats: [
      { at: '2023-06-07T09:00', write: (c) => `The air is "${aqiCategory(c.value)}," and schools cancel outdoor activities.` },
      { at: '2023-06-07T17:00', write: (c) => `"${aqiCategory(c.value)}." For a few hours New York has the worst air of any major city on Earth.` },
      { at: '2023-06-08T09:00', write: (c) => `A day later the air is still "${aqiCategory(c.value)}."` },
    ],
    exposed: {
      kicker: "Who's exposed",
      title: 'Smoke hits hardest where asthma already does',
      dek: 'Neighborhoods with the most asthma emergencies feel bad air first.',
      steps: [
        { id: 'mott-haven' },
        { id: 'hunts-point' },
        { id: 'east-harlem' },
      ],
    },
  },

  wind: {
    hazard: 'wind',
    scenario: 'isaias',
    metric: 'gust',
    unit: ' mph',
    window: { from: '2020-08-04T04:00', hours: 24 },
    heroHour: '2020-08-04T19:00',
    hero: {
      kicker: 'August 4, 2020',
      megaUnit: ' mph',
      megaLabel: 'gusts',
      headline: () => "Tropical Storm Isaias tore through the city's trees in a single afternoon.",
    },
    timeline: {
      kicker: 'Tropical Storm Isaias · August 4, 2020',
      source: 'NOAA weather records', // where the replay's numbers come from
      title: 'The wind built for six hours, then let go',
      dek: 'Play or drag through the day. Each rated neighborhood is colored by its strongest gust.',
    },
    // map colors: the gust speed (mph) where each level starts (Elevated, High, Severe)
    levels: [46, 58, 74],
    legend: 'Colored by gust speed: Elevated from 46 mph (Wind Advisory), High from 58 mph (High Wind Warning), Severe from 74 mph (hurricane force).',
    beats: [
      { at: '2020-08-04T08:00', write: () => 'Isaias races up the coast toward the city, and a Tropical Storm Warning is in effect.' },
      { at: '2020-08-04T12:00', write: () => 'Trees and power lines start coming down.' },
      { at: '2020-08-04T14:00', write: () => 'The strongest gusts hit the shore. More than 250,000 Con Edison customers lose power.' },
      { at: '2020-08-04T20:00', write: () => 'Calm again, but some blocks wait days for the lights to come back.' },
    ],
    exposed: {
      kicker: "Who's exposed",
      title: 'The open shoreline takes the full force',
      dek: 'Neighborhoods facing the ocean and Long Island Sound get the strongest gusts.',
      steps: [
        { id: 'rockaway' },
        { id: 'throgs-neck' },
        { id: 'coney-island' },
      ],
    },
  },
};

const areaIndex = (id) => AREAS.findIndex((a) => a.id === id);

/** Value of a story's metric for one neighborhood across the window. */
function areaMetric(story, series, i) {
  if (story.metric === 'water') return series.water[AREAS[i].station];
  return series.areas[i][story.metric];
}

/** The 1–2 facts each annotation shows next to the risk level, from the story's own hours. */
function driversFor(hazard, area, series, i) {
  const out = [];
  const peakOf = (arr) => Math.max(...arr);
  if (hazard === 'heat') {
    const row = series.areas[i];
    const nightLow = Math.min(...row.temp.filter((_, k) => +series.time[k].slice(11, 13) <= 7 && series.time[k] > series.time[0].slice(0, 10) + 'T23'));
    out.push(`Heat Vulnerability Index ${area.hvi} of 5`);
    out.push(`Felt like ${Math.round(peakOf(row.heatIndex))}°F; nights no cooler than ${Math.round(nightLow)}°F`);
  } else if (hazard === 'floods') {
    out.push(`Coastal flood exposure: ${['minimal', 'low', 'moderate', 'high'][area.coastalExposure]}`);
    out.push(`Water peaked ${r1(peakOf(series.water[area.station]))} ft above high tide nearby`);
  } else if (hazard === 'air') {
    const peak = peakOf(series.areas[i].aqi);
    out.push(`Asthma burden ${area.asthma} of 5`);
    out.push(`AQI peaked at ${Math.round(peak)}, "${aqiCategory(peak)}"`);
  } else {
    out.push(['', 'Sheltered streets', 'Waterfront and big trees', 'Open shoreline'][area.windExposure]);
    out.push(`Gusts up to ${Math.round(peakOf(series.areas[i].gust))} mph`);
  }
  return out;
}

/** Everything the page needs to tell one hazard's story. */
export function buildStory(hazard) {
  const story = STORIES[hazard];
  const scenario = scenarioById(story.scenario);
  const series = scenarioHourly(story.scenario, story.window.from, story.window.hours);
  const inputs = buildScenario(story.scenario);
  const values = AREAS.map((_, i) => areaMetric(story, series, i));
  const citywide = series.time.map((_, k) => (story.metric === 'water' ? series.water.battery[k] : Math.max(...values.map((v) => v[k]))));

  let peakIndex = 0;
  citywide.forEach((v, k) => {
    if (v > citywide[peakIndex]) peakIndex = k;
  });
  const hottest = values.reduce((best, v, i) => (Math.max(...v) > Math.max(...values[best]) ? i : best), 0);
  // the night after the peak: the next 16 hours' early-morning temperatures
  const nightLow = Math.min(...series.areas[hottest].temp.filter((_, k) => k > peakIndex && k <= peakIndex + 16 && +series.time[k].slice(11, 13) <= 7));
  const slrStop = SEA_LEVEL_STOPS.find((s) => s.id === '2080s');
  const minor = inputs.tides.battery.thresholds.minor;

  const beats = story.beats.map((b) => {
    const index = b.at === 'slr' ? peakIndex : series.time.indexOf(b.at);
    if (index < 0) throw new Error(`${hazard}: beat ${b.at} is outside the story window`);
    const ctx = { key: series.time[index], value: citywide[index], temp: series.areas[hottest].temp[index], minor, slr: slrStop };
    return { index, slr: b.at === 'slr', text: b.write(ctx) };
  });

  const stops = story.exposed.steps.map((step) => {
    const i = areaIndex(step.id);
    const area = AREAS[i];
    const r = assessPlace(hazard, area, inputs, i);
    return { area, level: r.level, score: r.score, drivers: driversFor(hazard, area, series, i) };
  });

  const heroIndex = Math.max(0, series.time.indexOf(story.heroHour));
  return {
    ...story,
    scenarioMeta: scenario,
    time: series.time,
    water: series.water,
    values, // per neighborhood (AREAS order) per hour
    citywide,
    peak: { index: peakIndex, value: citywide[peakIndex], key: series.time[peakIndex] },
    heroIndex,
    beats,
    stops,
    slr: hazard === 'floods' ? slrStop : null,
    mega: Math.round(citywide[peakIndex]),
    headline: story.hero.headline({ nightLow }),
  };
}

/** The color level of a value on the story map: 'low', 'elevated', 'high' or 'severe'. */
export function levelAt(story, value) {
  const [elevated, high, severe] = story.levels;
  if (value >= severe) return 'severe';
  if (value >= high) return 'high';
  if (value >= elevated) return 'elevated';
  return 'low';
}

/** A beat stays on screen until the clock is more than this many hours past it. */
export const BEAT_HOURS = 1;

/**
 * Which beat's text to show at a story hour (−1 for none): the latest beat the
 * clock has reached, but only while the clock is within BEAT_HOURS of it, so the
 * text never describes a different hour from the clock above it. Uses the same
 * rounded hour as the clock. The sea level beat shows while the sea is rising.
 */
export function beatAt(story, hourF, slr = 0) {
  const hour = Math.round(hourF); // the hour the clock shows
  let beat = -1;
  story.beats.forEach((b, i) => {
    if (b.slr ? slr > 0.05 : hour >= b.index) beat = i;
  });
  if (beat < 0 || story.beats[beat].slr) return beat;
  return hour - story.beats[beat].index <= BEAT_HOURS ? beat : -1;
}

/** Water level at the Battery (ft above MHHW) → metres NAVD88, the elevation data's datum. */
export function waterNavdMeters(ftAboveMhhw) {
  return MHHW_NAVD_M + ftAboveMhhw * FT;
}
