// How the API layer reads real Environment Agency responses: normalisation, caching and the
// shipped fallback files. Uses the captured responses in tests/fixtures/ea.json (see helpers/).
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../dist/js/api.js';
import { STATIONS } from '../../dist/js/config.js';
import { installEA, freezeClock, unfreezeClock, fx, FIXTURE_NOW, ALERT_NEAR, ALERT_FAR } from './helpers/ea-stub.mjs';

const DIGLIS = STATIONS.find(s => s.id === '2085');
beforeEach(() => { api.resetForTests(); freezeClock(); });
afterEach(() => unfreezeClock());

test('getFloods: numeric severity, most severe first, https polygons, safe defaults, tidal flag', async () => {
  installEA({ floods: [
    { floodAreaID: 'A', description: 'Alert area', severityLevel: '3', severity: 'Flood alert', timeRaised: '2026-10-18T10:00:00', floodArea: { polygon: 'http://x.example/p', riverOrSea: 'River X', county: 'Countyshire' } },
    { floodAreaID: 'B', floodArea: { label: 'Named by label' }, severityLevel: 1, severity: 'Severe Flood Warning', timeSeverityChanged: '2026-10-18T11:00:00', isTidal: true },
    { floodAreaID: 'C', severityLevel: 4, severity: 'Warning no longer in force' },
  ] });
  const { items, fetchedAt } = await api.getFloods();
  assert.equal(fetchedAt, FIXTURE_NOW);
  assert.deepEqual(items.map(i => i.id), ['B', 'A', 'C'], 'most severe (1) first, removed (4) last');
  const [b, a, c] = items;
  assert.equal(a.severityLevel, 3, 'a string severity becomes a number');
  assert.equal(a.polygon, 'https://x.example/p', 'http polygon URLs are upgraded');
  assert.deepEqual([a.river, a.county], ['River X', 'Countyshire']);
  assert.equal(b.area, 'Named by label', 'falls back to the area label');
  assert.equal(b.tidal, true);
  assert.ok(Number.isFinite(b.changed), 'timeSeverityChanged stands in when there is no message time');
  assert.match(b.polygon, /\/id\/floodAreas\/B\/polygon$/, 'no polygon given: the EA polygon URL is derived');
  assert.deepEqual([c.river, c.county, c.message, c.tidal], [null, null, '', false], 'missing fields get safe defaults');
});

test('getFloodAreas: warning areas (FWF) are told apart from alert areas, polygons upgraded to https', async () => {
  installEA();
  const areas = await api.getFloodAreas();
  assert.equal(areas.length, 2);
  const byId = Object.fromEntries(areas.map(a => [a.id, a]));
  assert.equal(byId['031FWFSE440'].type, 'warning');
  assert.equal(byId['031WAF108'].type, 'alert');
  assert.ok(areas.every(a => a.polygon.startsWith('https://')));
});

test('normaliseStation: measures as one object or as an array are both understood; a missing item falls back to config', () => {
  const real = fx.stations['2085'];
  const level = [].concat(real.measures).find(m => /level-stage-i-15_min-mASD$/.test(m['@id']));
  const other = { ...level, '@id': level['@id'].replace('level-stage-i-15_min-mASD', 'level-downstage-i-15_min-mASD'), parameter: 'other' };
  const many = api.normaliseStation({ ...real, measures: [other, level] }, DIGLIS);
  assert.equal(many.levelMeasure, '2085-level-stage-i-15_min-mASD', 'the stage level is picked out of several measures');
  const one = api.normaliseStation({ ...real, measures: level }, DIGLIS);
  assert.equal(one.levelMeasure, '2085-level-stage-i-15_min-mASD');
  assert.equal(one.scale.high, 2.8);
  assert.ok(one.latest && Number.isFinite(one.latest[1]), 'the EA latest reading is carried');
  const none = api.normaliseStation(null, DIGLIS);
  assert.deepEqual([none.id, none.label, none.levelMeasure, none.latest, none.scale], ['2085', 'Diglis', null, null, null]);
  assert.equal(none.hydrology, DIGLIS.hydrology);
});

test('getStations: one gauge failing leaves the others, flagged, never throws', async () => {
  installEA({ fail: u => /\/stations\/2001\.json/.test(u) && 503 });
  const s = await api.getStations();
  assert.equal(s.length, 7);
  const bad = s.find(x => x.id === '2001');
  assert.ok(bad.error && bad.latest === null);
  assert.equal(s.filter(x => x.latest).length, 6);
});

test('getReadings: cached inside the refresh window, then only the recent hours are fetched and merged without duplicates', async () => {
  const { urls } = installEA();
  const measure = '2085-level-stage-i-15_min-mASD';
  const since = FIXTURE_NOW - 25 * 3600000;
  const first = await api.getReadings(measure, since);
  assert.ok(first.length > 90);
  const n = () => urls.filter(u => u.includes('/readings')).length;
  assert.equal(n(), 1);
  await api.getReadings(measure, since);
  assert.equal(n(), 1, 'a second call inside the refresh window does not refetch');
  mock.timers.tick(6 * 60000); // past the 5 minute refresh window
  const again = await api.getReadings(measure, since);
  assert.equal(n(), 2);
  const sinceParam = new URL(urls.filter(u => u.includes('/readings')).at(-1)).searchParams.get('since');
  assert.ok(Date.parse(sinceParam) >= first.at(-1)[0] - 3 * 3600000 - 15 * 60000, `only the recent hours are fetched (since ${sinceParam})`);
  assert.equal(again.length, first.length, 'overlapping points are merged, not duplicated');
  assert.deepEqual(again.map(p => p[0]), [...new Set(again.map(p => p[0]))].sort((a, b) => a - b), 'sorted and unique');
});

test('getRange: older than four weeks reads the Hydrology archive, recent days the live API, a long range both', async () => {
  const { urls } = installEA();
  const st = api.normaliseStation(fx.stations['2085'], DIGLIS);
  const old = await api.getRange(st, FIXTURE_NOW - 40 * 86400000, FIXTURE_NOW - 29 * 86400000);
  assert.deepEqual(old.sources, ['EA Hydrology archive']);
  assert.ok(old.data.length > 0 && old.data.every(p => Number.isFinite(p[1])));
  assert.ok(urls.some(u => u.includes('/hydrology/') && u.includes(`${DIGLIS.hydrology}-level-i-900-m-qualified`)));
  const both = await api.getRange(st, FIXTURE_NOW - 40 * 86400000, FIXTURE_NOW);
  assert.deepEqual([...both.sources].sort(), ['EA Hydrology archive', 'EA real-time API']);
});

test('getSnapshotFallback: the shipped all-gauge file covers every gauge; without it the older files still give Diglis and Bewdley', async () => {
  installEA();
  const all = await api.getSnapshotFallback();
  assert.ok(Number.isFinite(all.capturedAt));
  assert.equal(Object.values(all.series).filter(s => s.length).length, 7);
  assert.equal(all.stations['2085'].scale.high, 2.8, 'station metadata (typical range) comes with it');
  api.resetForTests();
  installEA({ missing: ['fallback-snapshot'] });
  const old = await api.getSnapshotFallback();
  assert.deepEqual(Object.keys(old.series).filter(k => old.series[k].length).sort(), ['2001', '2085']);
});
