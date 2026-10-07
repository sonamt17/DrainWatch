// Run with:  node --test
// Uses only Node's built-in test runner — nothing to install.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assess,
  classifyAlert,
  coastalHazard,
  exposureFromFemaZone,
  levelFor,
  peakWaterLevel,
  rainfallHazard,
  thresholdsFromGreatDiurnalRange,
} from '../js/risk.js';

const battery = thresholdsFromGreatDiurnalRange(5.1);

const calm = {
  coastalExposure: 3,
  stormwaterExposure: 3,
  thresholds: battery,
  peakWaterFt: 0.2,
  maxHourlyRainIn: 0,
  past24hRainIn: 0,
  alerts: [],
  recentComplaints: 0,
};

test('NOAA thresholds for the Battery are about 1.8 / 2.8 / 4.0 ft above MHHW', () => {
  assert.ok(Math.abs(battery.minor - 1.84) < 0.05, `minor ${battery.minor}`);
  assert.ok(Math.abs(battery.moderate - 2.78) < 0.05, `moderate ${battery.moderate}`);
  assert.ok(Math.abs(battery.major - 4.04) < 0.05, `major ${battery.major}`);
});

test('coastal hazard steps up through the thresholds', () => {
  assert.equal(coastalHazard(null, battery), 0);
  assert.equal(coastalHazard(0.5, battery), 0);
  assert.equal(coastalHazard(1.5, battery), 1);
  assert.equal(coastalHazard(2.0, battery), 2);
  assert.equal(coastalHazard(3.0, battery), 3);
  assert.equal(coastalHazard(9.0, battery), 4);
});

test('rainfall hazard uses intensity bands and saturated ground', () => {
  assert.equal(rainfallHazard(0), 0);
  assert.equal(rainfallHazard(0.2), 1);
  assert.equal(rainfallHazard(0.6), 2);
  assert.equal(rainfallHazard(1.2), 3);
  assert.equal(rainfallHazard(2.0), 4);
  assert.equal(rainfallHazard(0.6, 2.0), 3);
  assert.equal(rainfallHazard(0, 3.0), 0, 'no rain coming means no bump');
});

test('alerts are classified by kind and severity', () => {
  assert.deepEqual(classifyAlert('Coastal Flood Warning'), { kind: 'coastal', severity: 'warning' });
  assert.deepEqual(classifyAlert('Flash Flood Watch'), { kind: 'stormwater', severity: 'watch' });
  assert.deepEqual(classifyAlert('Hurricane Warning'), { kind: 'coastal', severity: 'warning' });
  assert.equal(classifyAlert('Heat Advisory'), null);
});

test('a calm day is low risk everywhere', () => {
  const r = assess(calm);
  assert.equal(r.level, 'low');
  assert.equal(r.driver, 'none');
});

test('a storm surge at major flood stage is severe for a coastal area', () => {
  const r = assess({ ...calm, peakWaterFt: 5 });
  assert.equal(r.level, 'severe');
  assert.equal(r.driver, 'coastal');
});

test('an inland area ignores storm surge but reacts to cloudbursts', () => {
  const inland = { ...calm, coastalExposure: 0, stormwaterExposure: 3 };
  assert.equal(assess({ ...inland, peakWaterFt: 5 }).level, 'low');
  const r = assess({ ...inland, maxHourlyRainIn: 2 });
  assert.equal(r.level, 'severe');
  assert.equal(r.driver, 'stormwater');
});

test('exposure scales the hazard', () => {
  const low = assess({ ...calm, coastalExposure: 1, peakWaterFt: 3 });
  const high = assess({ ...calm, coastalExposure: 3, peakWaterFt: 3 });
  assert.ok(low.score < high.score);
});

test('NWS warnings and 311 reports raise the score', () => {
  const base = assess({ ...calm, maxHourlyRainIn: 0.6 });
  const warned = assess({
    ...calm,
    maxHourlyRainIn: 0.6,
    alerts: [{ event: 'Flash Flood Warning', kind: 'stormwater', severity: 'warning' }],
  });
  const reported = assess({ ...calm, maxHourlyRainIn: 0.6, recentComplaints: 20 });
  assert.ok(warned.score > base.score);
  assert.ok(reported.score > base.score);
});

test('score never exceeds 4', () => {
  const r = assess({
    ...calm,
    peakWaterFt: 12,
    alerts: [{ event: 'Storm Surge Warning', kind: 'coastal', severity: 'warning' }],
    recentComplaints: 100,
  });
  assert.equal(r.score, 4);
});

test('peak water level adds positive surge to the predicted tide', () => {
  assert.equal(peakWaterLevel([0.1, 0.8, -3], 1.0, 0.4), 1.4);
  assert.equal(peakWaterLevel([0.1, 0.8, -3], 0.0, 0.4), 0.8, 'negative surge is ignored');
  assert.equal(peakWaterLevel([], 1.2, null), 1.2);
});

test('levels and FEMA zones map as expected', () => {
  assert.equal(levelFor(0.5), 'low');
  assert.equal(levelFor(1), 'elevated');
  assert.equal(levelFor(2.5), 'high');
  assert.equal(levelFor(3.9), 'severe');
  assert.equal(exposureFromFemaZone('VE', null), 3);
  assert.equal(exposureFromFemaZone('AE', null), 3);
  assert.equal(exposureFromFemaZone('X', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD'), 1);
  assert.equal(exposureFromFemaZone('X', 'AREA OF MINIMAL FLOOD HAZARD'), 0);
  assert.equal(exposureFromFemaZone(null, null), 0);
});
