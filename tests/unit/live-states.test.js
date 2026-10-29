// The live data service's state machine (live.js): what the visitor is shown, in order, when the
// EA is healthy, slow, partly failing or unreachable. Each case below is a real incident or a
// near miss: slow reading history (26 Oct), the early draw, partial-live retries, a late flood-area
// list, and the outage fallback (20 Oct).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../dist/js/api.js';
import { createLive } from '../../dist/js/live.js';
import { installEA, freezeClock, unfreezeClock, until, ALERT_NEAR, ALERT_FAR } from './helpers/ea-stub.mjs';

let live;
beforeEach(() => { api.resetForTests(); freezeClock(); live = null; });
afterEach(() => { live?.stop(); unfreezeClock(); });

const gaugesWithReadings = () => Object.values(live.series).filter(s => s.length).length;
const READINGS = /\/readings\?/;

test('healthy: live with all seven gauges, the warnings and (independently) the local flood-area list', async () => {
  installEA({ floods: [ALERT_NEAR, ALERT_FAR] });
  live = createLive();
  await live.refresh();
  assert.equal(live.status.mode, 'live');
  assert.ok(!live.status.partial);
  assert.equal(live.status.error, null);
  assert.equal(gaugesWithReadings(), 7);
  assert.deepEqual(live.floods.items.map(f => f.id).sort(), ['031WAF108', '031WAT217']);
  await until(() => live.localAreas);
  assert.ok(live.localAreas.has('031WAF108') && !live.localAreas.has('031WAT217'));
  assert.equal(live.primary().scale.high, 2.8);
});

test('concurrent refreshes share one set of requests', async () => {
  const { log } = installEA({ delay: () => 5 });
  live = createLive();
  await Promise.all([live.refresh(), live.refresh(), live.refresh()]);
  assert.equal(log.filter(x => x === 'start station 2085').length, 1);
  assert.equal(log.filter(x => x === 'start floods').length, 1);
});

test('early draw: Diglis shows as soon as its own data arrives and its history starts loading at once', async () => {
  const slowGauges = u => (/\/stations\/(?!2085\.json)\w+\.json/.test(u) ? 150 : 0);
  const { log } = installEA({ delay: slowGauges, floods: [ALERT_FAR] });
  live = createLive();
  const knownAtEarlyDraw = [];
  live.on('update', d => { log.push(d.metadata ? 'update early' : 'update'); if (d.metadata) knownAtEarlyDraw.push(live.stations.filter(s => s.latest).map(s => s.id)); });
  await live.refresh();
  const early = log.indexOf('update early');
  assert.ok(early >= 0, 'an early update was emitted');
  assert.ok(early < log.indexOf('done station 2001'), 'drawn before the slow gauges answered');
  assert.deepEqual(knownAtEarlyDraw[0], ['2085'], 'at that moment only Diglis is known');
  assert.ok(log.indexOf('start readings 2085') < log.indexOf('done station 2001'), "Diglis's history starts before the slow gauges answer");
  assert.equal(log.filter(x => x === 'start readings 2085').length, 1, 'and is not requested twice');
  assert.equal(live.status.mode, 'live');
  assert.equal(gaugesWithReadings(), 7, 'everything fills in afterwards');
});

test('slow reading history never blanks the page: the warnings and latest values come first, the history joins later', async () => {
  const { log } = installEA({ delay: u => (READINGS.test(u) ? 120 : 0), floods: [ALERT_FAR] });
  live = createLive();
  const atEarly = [];
  live.on('update', d => { log.push(d.metadata ? 'update early' : 'update'); if (d.metadata) atEarly.push({ floods: !!live.floods, loading: live.status.metadata, mode: live.status.mode }); });
  await live.refresh();
  assert.ok(log.indexOf('update early') < log.indexOf('done readings 2085'), 'drawn before any reading history');
  assert.deepEqual(atEarly[0], { floods: true, loading: true, mode: 'loading' }, 'warnings there, flagged "loading readings"');
  assert.equal(live.status.mode, 'live');
  assert.ok(!live.status.metadata, 'the flag is gone once the history has arrived');
});

test('failed reading history keeps the live gauge values instead of the snapshot, and keeps the notice on a failed retry', async () => {
  installEA({ fail: u => READINGS.test(u) && 503, floods: [ALERT_FAR] });
  live = createLive();
  await live.refresh();
  assert.equal(live.status.mode, 'live', 'not the offline snapshot');
  assert.equal(live.status.partial, true);
  assert.match(live.status.error, /having problems \(error 503\)/);
  assert.ok(live.floods, 'warnings are kept');
  assert.equal(gaugesWithReadings(), 0);
  const last = live.latestOf('2085');
  assert.ok(last && Number.isFinite(last[1]), "Diglis's latest value comes from the EA station metadata");
  // The retry fails the same way: still partial-live, not "could not refresh".
  api.resetForTests();
  await live.refresh();
  assert.equal(live.status.partial, true);
  assert.equal(live.status.mode, 'live');
});

test('partial-live then the gauge service failing too: stale, and the last known values are kept', async () => {
  installEA({ fail: u => READINGS.test(u) && 503 });
  live = createLive();
  await live.refresh();
  const before = live.latestOf('2085');
  assert.ok(before);
  api.resetForTests();
  installEA({ fail: () => 'network' });
  await live.refresh();
  assert.equal(live.status.mode, 'stale');
  assert.deepEqual(live.latestOf('2085'), before, 'the last known gauge values are not thrown away');
});

test('a later successful refresh clears the partial state', async () => {
  let history = false;
  installEA({ fail: u => READINGS.test(u) && !history && 503 });
  live = createLive();
  await live.refresh();
  assert.equal(live.status.partial, true);
  history = true;
  api.resetForTests();
  await live.refresh();
  assert.equal(live.status.mode, 'live');
  assert.ok(!live.status.partial);
  assert.equal(gaugesWithReadings(), 7);
});

test('failed warnings feed leaves the gauges live and says so, never claiming "no warnings"', async () => {
  installEA({ fail: u => /\/id\/floods\?/.test(u) && 500 });
  live = createLive();
  await live.refresh();
  assert.equal(live.status.mode, 'live');
  assert.equal(live.floods, null);
  assert.match(live.floodsError, /having problems \(error 500\)/);
  assert.equal(gaugesWithReadings(), 7);
});

test('a slow flood-area list never holds up the page, and an update follows when it lands', async () => {
  const { log } = installEA({ delay: u => (/floodAreas/.test(u) ? 150 : 0), floods: [ALERT_FAR] });
  live = createLive();
  live.on('update', d => log.push(d.areas ? 'update areas' : 'update'));
  await live.refresh();
  assert.equal(live.status.mode, 'live');
  assert.equal(live.localAreas, null, 'the list has not arrived yet, so every warning counts as local');
  await until(() => live.localAreas);
  assert.ok(log.includes('update areas'), 'an update tells the views to re-classify the warnings');
});

test('EA unreachable: the shipped all-gauge snapshot is used, labelled with its capture time', async () => {
  installEA({ fail: () => 'network' });
  live = createLive();
  await live.refresh();
  assert.equal(live.status.mode, 'snapshot');
  assert.ok(Number.isFinite(live.status.snapshotAt));
  assert.match(live.status.error, /could not be reached/);
  assert.ok(gaugesWithReadings() >= 5);
  assert.equal(live.primary().scale.high, 2.8);
});

test('an ongoing outage keeps the snapshot provenance: a second failed refresh does not promote snapshot values to "live"', async () => {
  installEA({ fail: () => 'network' });
  live = createLive();
  await live.refresh();
  assert.equal(live.status.mode, 'snapshot');
  const capturedAt = live.status.snapshotAt;
  api.resetForTests();
  await live.refresh();
  assert.equal(live.status.mode, 'snapshot', 'still the labelled snapshot, not partial-live');
  assert.ok(!live.status.partial);
  assert.equal(live.status.snapshotAt, capturedAt, 'with its capture time');
  assert.equal(live.status.updatedAt, null, 'no live success is claimed');
  assert.ok(gaugesWithReadings() >= 5);
});

test('EA unreachable and no snapshot shipped: an honest error, not an empty "live" page', async () => {
  installEA({ fail: () => 'network', staticFiles: false });
  live = createLive();
  await live.refresh();
  assert.equal(live.status.mode, 'error');
  assert.equal(gaugesWithReadings(), 0);
});
