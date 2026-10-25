// The story player. It opens full screen: the story's text on the left and a
// Leaflet map on the right.
//
// A story is a list of FRAMES:
//   • one frame per hour of the storm ("hour")
//   • floods only: the same storm on 2080s seas ("slr")
//   • one frame per neighborhood in "Who's exposed" ("stop")
// Showing a frame updates the text, colors the map, and zooms in or out.
// Play moves to the next frame every so often; ◀ ▶ jump between the important
// frames (an hour with a sentence, or a neighborhood); the slider picks any frame.

import { AREAS } from '../facts/config.js';
import { floodRaster } from '../models/terrain.js';
import { rasterToImageUrl } from '../page/map.js';
import { esc, level } from '../page/ui.js';
import { beatAt, buildStory, levelAt, storyTime, waterNavdMeters } from './stories.js';

const $ = (id) => document.getElementById(id);

// The edges of New York City: [south-west corner], [north-east corner]
const NYC_BOUNDS = [
  [40.49, -74.26],
  [40.92, -73.7],
];
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Flooded-land colors as [red, green, blue, opacity], each 0–255
const WATER_COLOR = [19, 109, 191, 170]; // blue: under water at this hour
const RISE_COLOR = [255, 110, 20, 215]; // orange: under water only with the extra sea level rise

// How long Play shows each frame, in milliseconds
const HOUR_MS = 400; // an ordinary hour
const BEAT_MS = 2500; // an hour with a sentence, so there's time to read it
const STOP_MS = 3500; // a neighborhood in "Who's exposed"

const INCH_M = 0.0254; // meters in an inch

/**
 * getTerrain(): the elevation grid from terrain.js once it has loaded (null before).
 * onPosition({ frame, frames, chapter, playing }): called whenever the frame changes,
 * so app.js can move the slider and the chapter tabs.
 */
export function createStoryController({ getTerrain, onPosition }) {
  let story = null; // from buildStory()
  let frames = []; // the list of frames (see the top of this file)
  let frame = 0; // which frame is showing
  let playing = false;
  let timer = null; // Play's setTimeout

  let map = null; // the Leaflet map, made the first time the story opens
  let shapes = null; // the 195 neighborhood outlines, as one Leaflet layer
  let floodImage = null; // the flooded-land picture on the map (floods only)
  let waterKey = ''; // the water level the flood picture shows, so it is only redrawn when it changes
  let zoomedIn = false; // true while the map is zoomed into a neighborhood

  // ---------------- frames ----------------

  function buildFrames() {
    frames = [];
    for (let k = 0; k < story.time.length; k++) frames.push({ type: 'hour', hour: k });
    if (story.slr) frames.push({ type: 'slr', hour: story.peak.index });
    for (let i = 0; i < story.stops.length; i++) frames.push({ type: 'stop', stop: i, hour: story.peak.index });
  }

  /** Important frames: an hour with a sentence, the sea level rise frame, or a neighborhood. */
  function isKeyFrame(f) {
    if (f.type !== 'hour') return true;
    return story.beats.some((b) => !b.slr && b.index === f.hour);
  }

  // ---------------- the text on the left ----------------

  function renderText() {
    $('timeline-kicker').textContent = story.timeline.kicker;
    $('timeline-title').textContent = story.timeline.title;
    $('timeline-dek').textContent = story.timeline.dek;
    $('readout-unit').textContent = story.unit;
    $('beats').innerHTML = story.beats.map((b) => `<li class="beat">${esc(b.text)}</li>`).join('');
    $('story-legend').textContent = story.legend;
    $('timeline-note').textContent = 'Not live data: an approximate replay, rebuilt from ' + story.timeline.source + '.';

    $('exposed-kicker').textContent = story.exposed.kicker;
    $('exposed-title').textContent = story.exposed.title;
    $('exposed-dek').textContent = story.exposed.dek;
    $('exposed-note').textContent = 'Risk at the peak of the storm, from the same model as the dashboard.';
    $('stops').innerHTML = story.stops.map((s) => `<li><span>${esc(s.area.name)}</span>${level(s.level)}</li>`).join('');
  }

  /** The clock, the big number and which sentence and neighborhood are highlighted. */
  function updateText(f) {
    const slr = f.type === 'slr';
    let clock = storyTime(story.time[f.hour]);
    if (slr) clock += ` · +${story.slr.inches} in of sea level rise`;
    $('clock-time').textContent = clock;

    let value = story.citywide[f.hour];
    if (slr) value += story.slr.inches / 12; // inches → feet
    $('readout-num').textContent = story.hazard === 'floods' ? value.toFixed(1) : Math.round(value);

    const beat = f.type === 'stop' ? -1 : beatAt(story, f.hour, slr ? 1 : 0);
    document.querySelectorAll('#beats li').forEach((li, i) => {
      if (i === beat) li.classList.add('on');
      else li.classList.remove('on');
    });
    document.querySelectorAll('#stops li').forEach((li, i) => {
      if (f.type === 'stop' && i === f.stop) li.classList.add('on');
      else li.classList.remove('on');
    });
  }

  // ---------------- the map on the right ----------------

  function makeMap() {
    map = L.map('story-map', { minZoom: 9, maxZoom: 17, zoomSnap: 0.25 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
    map.fitBounds(NYC_BOUNDS, { padding: [16, 16] });
    // Source: https://raw.githubusercontent.com/nycehs/NYC_geography/master/NTA.geo.json (NYC Health Department)
    fetch('data/nyc-ntas.geojson')
      .then((response) => response.json())
      .then((geo) => {
        shapes = L.geoJSON(geo, { style: () => ({ className: 'story-shape' }), interactive: false }).addTo(map);
        drawMap(frames[frame]);
      });
  }

  /** Heat, air, wind: color each neighborhood shape that holds a rated neighborhood. */
  function colorShapes(hour) {
    shapes.eachLayer((layer) => {
      const ids = layer.feature.properties.areas; // the rated neighborhoods inside this shape (usually none)
      let className = 'story-shape';
      if (ids.length > 0) {
        // the worst value among the rated neighborhoods inside this shape
        let value = 0;
        for (const id of ids) {
          const i = AREAS.findIndex((a) => a.id === id);
          value = Math.max(value, story.values[i][hour]);
        }
        className += ' rated lvl-' + levelAt(story, value);
      }
      layer.getElement().setAttribute('class', className);
    });
  }

  /** Floods: paint the land below the water level, plus (orange) the land extra sea level rise adds. */
  function drawWater(feet, extraInches) {
    const grid = getTerrain();
    if (!grid) return; // the elevation data hasn't loaded yet
    const baseM = waterNavdMeters(feet);
    const waterM = baseM + extraInches * INCH_M;
    const key = baseM.toFixed(2) + '|' + waterM.toFixed(2);
    if (key === waterKey) return;
    waterKey = key;
    const raster = floodRaster(grid, baseM, waterM, { base: WATER_COLOR, added: RISE_COLOR });
    if (floodImage) map.removeLayer(floodImage);
    floodImage = L.imageOverlay(rasterToImageUrl(raster), raster.bounds, { interactive: false }).addTo(map);
  }

  function clearMap() {
    if (floodImage) map.removeLayer(floodImage);
    floodImage = null;
    waterKey = '';
    if (shapes) shapes.eachLayer((layer) => layer.getElement().setAttribute('class', 'story-shape'));
  }

  function drawMap(f) {
    if (!map) return;
    if (story.hazard === 'floods') drawWater(story.citywide[f.hour], f.type === 'slr' ? story.slr.inches : 0);
    else if (shapes) colorShapes(f.hour);

    // zoom into a neighborhood, or back out to the whole city
    if (f.type === 'stop') {
      const stop = story.stops[f.stop];
      const html = `<div class="popup"><h4>${esc(stop.area.name)}</h4><p>${level(stop.level)}</p>
        <ul>${stop.drivers.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>`;
      L.popup({ autoPan: false, closeButton: false }).setLatLng([stop.area.lat, stop.area.lon]).setContent(html).openOn(map);
      map.flyTo([stop.area.lat, stop.area.lon], 13, { duration: 1.5 });
      zoomedIn = true;
    } else if (zoomedIn) {
      map.closePopup();
      map.flyToBounds(NYC_BOUNDS, { padding: [16, 16], duration: 1.2 });
      zoomedIn = false;
    }
  }

  // ---------------- moving between frames ----------------

  function show(i) {
    frame = Math.max(0, Math.min(frames.length - 1, i));
    const f = frames[frame];
    updateText(f);
    drawMap(f);
    report();
  }

  function report() {
    if (frames.length === 0) return; // no story yet
    const chapter = frames[frame].type === 'stop' ? 'exposed' : 'timeline';
    onPosition({ frame: frame, frames: frames.length, chapter: chapter, playing: playing });
  }

  /** Play: show the next frame after a short wait, longer on important frames. */
  function scheduleNext() {
    const f = frames[frame];
    let wait = HOUR_MS;
    if (isKeyFrame(f)) wait = BEAT_MS;
    if (f.type === 'stop') wait = STOP_MS;
    timer = setTimeout(() => {
      if (frame >= frames.length - 1) {
        pause();
        return;
      }
      show(frame + 1);
      scheduleNext();
    }, wait);
  }

  function play() {
    playing = true;
    if (frame >= frames.length - 1) show(0); // at the end: start over
    report();
    scheduleNext();
  }

  function pause() {
    playing = false;
    clearTimeout(timer);
    report();
  }

  /** Jump to the next (dir = 1) or previous (dir = -1) important frame. */
  function jump(dir) {
    pause();
    let i = frame + dir;
    while (i > 0 && i < frames.length - 1 && !isKeyFrame(frames[i])) i += dir;
    show(i);
  }

  // ---------------- what app.js can use ----------------

  async function setHazard(h) {
    playing = false;
    clearTimeout(timer);
    story = buildStory(h);
    buildFrames();
    renderText();
    if (map) clearMap();
    show(0);
    return story;
  }

  function open() {
    if (!map) makeMap();
    else map.invalidateSize(); // the map's box was hidden; let Leaflet measure it again
    zoomedIn = false;
    map.fitBounds(NYC_BOUNDS, { padding: [16, 16] });
    show(0);
    play();
  }

  function close() {
    pause();
  }

  return {
    setHazard,
    open,
    close,
    seek: (i) => {
      pause();
      show(i);
    },
    next: () => jump(1),
    prev: () => jump(-1),
    togglePlay: () => (playing ? pause() : play()),
    redraw: () => {
      if (story) drawMap(frames[frame]);
    },
    get firstStopFrame() {
      return frames.findIndex((f) => f.type === 'stop');
    },
    get story() {
      return story;
    },
    get hazard() {
      return story ? story.hazard : null;
    },
  };
}
