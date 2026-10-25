// The story's pure parts: map math and the data-driven story text. Run with:  node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centroid, inGeometry, kmBetween, project } from '../js/story/geo.js';
import { beatAt, buildStory, levelAt, storyTime, STORIES, waterNavdMeters } from '../js/story/stories.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('projection is in kilometres', () => {
  const [x, y] = project(-73.94, 40.7);
  close(x, 0, 1e-9);
  close(y, 0, 1e-9);
  // Battery to Central Park North is about 13.5 km
  close(kmBetween(-74.0142, 40.7006, -73.9524, 40.7968), 12.0, 1.5, 'Battery → 110th St');
});

test('point-in-polygon honors holes, and centroids land inside squares', () => {
  const square = { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]] };
  assert.equal(inGeometry(3, 3, square), true);
  assert.equal(inGeometry(1.5, 1.5, square), false, 'inside the hole');
  assert.equal(inGeometry(5, 5, square), false);
  const [cx, cy] = centroid({ type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] });
  close(cx, 1, 1e-9);
  close(cy, 1, 1e-9);
});

test('every story builds, and its copy is computed from the replay', () => {
  for (const hazard of Object.keys(STORIES)) {
    const s = buildStory(hazard);
    assert.equal(s.time.length, s.window.hours, hazard);
    assert.ok(s.beats.every((b) => b.index >= 0 && b.text.length > 20 && !b.text.includes('..')), `${hazard} beats`);
    assert.equal(s.stops.length, 3);
    assert.ok(s.stops.every((e) => ['low', 'elevated', 'high', 'severe'].includes(e.level) && e.drivers.length >= 2));
  }
  const heat = buildStory('heat');
  assert.equal(heat.mega, 106);
  assert.match(heat.headline, /never dropped below 80/);
  assert.ok(heat.beats.some((b) => /coolest hour/.test(b.text)));
  const floods = buildStory('floods');
  close(floods.peak.value, 9, 0.2, 'Sandy peaks near 9 ft above MHHW');
  close(waterNavdMeters(floods.peak.value), 3.44, 0.1, 'about 11.3 ft NAVD88 at the Battery');
});

test('story times read like a newspaper', () => {
  assert.equal(storyTime('2019-07-19T15:00'), 'Friday, 3 p.m.');
  assert.equal(storyTime('2019-07-20T12:00'), 'Saturday, noon');
  assert.equal(storyTime('2019-07-19T23:00', { day: false }), '11 p.m.');
});

test('beat text never repeats or contradicts the clock above it', () => {
  const timeLead = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|midnight|noon|\d{1,2} [ap]\.m\.)/i;
  for (const hazard of Object.keys(STORIES)) {
    const s = buildStory(hazard);
    for (const b of s.beats) assert.doesNotMatch(b.text, timeLead, `${hazard}: "${b.text}" starts with a time`);
    // the first beat adds something: it doesn't restate the readout's number for that hour
    const first = s.beats[0];
    const v = s.citywide[first.index];
    const shown = hazard === 'floods' ? v.toFixed(1) : String(Math.round(v));
    assert.ok(!first.text.includes(shown), `${hazard}: first beat repeats the readout (${shown})`);
  }
});

test('a beat fades once the clock is more than an hour past it', () => {
  const s = buildStory('heat');
  const [b0, b1] = s.beats;
  assert.equal(beatAt(s, b0.index - 0.6), -1, 'nothing while the clock shows the hour before');
  assert.equal(beatAt(s, b0.index - 0.4), 0, 'on as soon as the clock shows its hour');
  assert.equal(beatAt(s, b0.index + 1), 0, 'still on an hour later');
  assert.equal(beatAt(s, b0.index + 1.6), -1, 'gone once the clock is two hours past');
  assert.equal(beatAt(s, b1.index + 0.2), 1);
  const f = buildStory('floods');
  const slrBeat = f.beats.findIndex((b) => b.slr);
  assert.equal(beatAt(f, f.peak.index, 0.5), slrBeat, 'the sea level beat shows while the sea rises');
});

test('map colors follow each story\'s level cutoffs', () => {
  const heat = buildStory('heat'); // Elevated 90°F, High 100°F, Severe 105°F
  assert.equal(levelAt(heat, 85), 'low');
  assert.equal(levelAt(heat, 90), 'elevated');
  assert.equal(levelAt(heat, 104), 'high');
  assert.equal(levelAt(heat, 106), 'severe');
  for (const hazard of ['heat', 'air', 'wind']) assert.equal(buildStory(hazard).levels.length, 3, hazard);
});
