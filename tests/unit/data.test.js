import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cleanReadings, parseTime, nearest, change, rateSeries, currentRate, trend, rangePosition, toAOD, freshness, breakGaps, gaps,
  lttb, transform, notable, topEvents, eventWindow, percentileRank, hourlyRain, totalRain, simulateLinear, hoursToReach,
  fmt, ukDayStart, ukDateInput, toCSV, quantile, explainRate, time,
} from '../../dist/js/data.js';

const T0 = Date.parse('2026-10-18T00:00:00Z');
const at = (min, v) => [T0 + min * 60000, v];
const ramp = (n, step = 15, f = i => 1 + i * 0.01) => Array.from({ length: n }, (_, i) => at(i * step, f(i)));

test('cleanReadings drops invalid values, dedupes timestamps and sorts', () => {
  const s = cleanReadings([
    { dateTime: '2026-10-18T00:15:00Z', value: 2 },
    { dateTime: '2026-10-18T00:00:00Z', value: 1 },
    { dateTime: '2026-10-18T00:15:00Z', value: 3 },
    { dateTime: 'nonsense', value: 4 },
    { dateTime: '2026-10-18T00:30:00Z' },
    { dateTime: '2026-10-18T00:45:00Z', value: 'x' },
  ]);
  assert.deepEqual(s, [at(0, 1), at(15, 3)]);
});

test('parseTime treats zone-less Hydrology timestamps as UTC', () => {
  assert.equal(parseTime('2024-01-01T00:00:00'), Date.parse('2024-01-01T00:00:00Z'));
  assert.equal(parseTime('2024-01-01T00:00:00Z'), Date.parse('2024-01-01T00:00:00Z'));
  assert.ok(Number.isNaN(parseTime(undefined)));
});

test('nearest never interpolates and respects tolerance', () => {
  const s = [at(0, 1), at(60, 2)];
  assert.deepEqual(nearest(s, T0 + 20 * 60000), at(0, 1));
  assert.equal(nearest(s, T0 + 30 * 60000, 10 * 60000), null);
});

test('change requires a real reading near the comparison time', () => {
  const s = ramp(25 * 4); // 25 h of 15-minute readings rising 1 cm each
  const c = change(s, 1);
  assert.equal(c.from[0], s.at(-5)[0]);
  assert.ok(Math.abs(c.delta - 0.04) < 1e-9);
  assert.equal(change([at(0, 1), at(600, 2)], 1), null, 'no reading within 30 min of 1 h earlier');
});

test('rate of change is in cm/hour and skips gaps', () => {
  const s = ramp(12);
  const r = rateSeries(s);
  assert.equal(r.length, 8);
  assert.ok(r.every(p => Math.abs(p[1] - 4) < 1e-9));
  assert.ok(Math.abs(currentRate(s) - 4) < 1e-9);
  assert.equal(rateSeries([at(0, 1), at(200, 2)]).length, 0);
});

test('trend labels use the documented steady threshold', () => {
  assert.equal(trend(0.2).key, 'steady');
  assert.equal(trend(2).key, 'rising');
  assert.equal(trend(-2).key, 'falling');
  assert.equal(trend(null).key, 'unknown');
});

test('rangePosition and derived AOD', () => {
  const sc = { low: 1, high: 3, datum: 10 };
  assert.equal(rangePosition(2, sc).pct, 50);
  assert.equal(rangePosition(4, sc).key, 'high');
  assert.equal(rangePosition(0.5, sc).key, 'low');
  assert.equal(rangePosition(2, null).key, 'unknown');
  assert.equal(toAOD(0.5, sc), 10.5);
  assert.equal(toAOD(0.5, { datum: null }), null);
});

test('freshness thresholds', () => {
  const now = T0 + 10 * time.HOUR;
  assert.equal(freshness(now - 30 * 60000, now).key, 'fresh');
  assert.equal(freshness(now - 90 * 60000, now).key, 'recent');
  assert.equal(freshness(now - 5 * time.HOUR, now).key, 'stale');
  assert.equal(freshness(now + time.HOUR, now).key, 'future');
  assert.equal(freshness(NaN, now).key, 'none');
});

test('gaps break chart lines instead of bridging them', () => {
  const s = [at(0, 1), at(15, 1), at(120, 1)];
  assert.equal(gaps(s).length, 1);
  const b = breakGaps(s);
  assert.equal(b.length, 4);
  assert.equal(b[2][1], null);
});

test('lttb keeps endpoints and extremes', () => {
  const s = Array.from({ length: 2000 }, (_, i) => at(i, i === 777 ? 50 : Math.sin(i / 50)));
  const d = lttb(s, 200);
  assert.equal(d.length, 200);
  assert.deepEqual(d[0], s[0]);
  assert.deepEqual(d.at(-1), s.at(-1));
  assert.ok(d.some(p => p[1] === 50), 'spike survives downsampling');
});

test('transform modes', () => {
  const s = [at(0, 1), at(15, 2)];
  const sc = { low: 0, high: 4, datum: 5 };
  assert.deepEqual(transform(s, 'change', sc).map(p => p[1]), [0, 100]);
  assert.deepEqual(transform(s, 'range', sc).map(p => p[1]), [25, 50]);
  assert.deepEqual(transform(s, 'aod', sc).map(p => p[1]), [6, 7]);
  assert.deepEqual(transform(s, 'aod', {}), []);
  assert.deepEqual(transform(s, 'stage', sc), s);
});

test('notable annotations describe the window', () => {
  const s = ramp(40, 15, i => (i < 20 ? 1 + i * 0.02 : 1.4 - (i - 20) * 0.01));
  const n = notable(s);
  assert.ok(n.find(x => x.kind === 'peak'));
  assert.ok(n.find(x => x.kind === 'rise').rate > 0);
  assert.ok(n.find(x => x.kind === 'fall').rate < 0);
  assert.ok(n.every((x, i) => !i || n[i - 1].t <= x.t), 'sorted by time');
});

test('explainRate flags unusually rapid change', () => {
  const all = [...Array(99).fill(0.2), 6];
  assert.match(explainRate(6, all), /Unusually rapid rise/);
  assert.match(explainRate(0.1, all), /Little change/);
});

test('topEvents separates independent peaks', () => {
  const rows = [['2020-02-17', 5.27, 0.5, 'G'], ['2020-02-18', 5.2, 0.5, 'G'], ['2007-07-21', 5.3, 0.5, 'G'], ['2020-03-20', 4, 0.5, 'G']];
  const e = topEvents(rows, { count: 5, separationDays: 14 });
  assert.deepEqual(e.map(x => x.date), ['2007-07-21', '2020-02-17', '2020-03-20']);
  const w = eventWindow(rows, '2020-02-17', 2);
  assert.deepEqual(w, [[0, 5.27], [1, 5.2]]);
  assert.equal(percentileRank(5.25, rows.map(r => r[1])), 50);
});

test('hourlyRain only reports complete hours; totals report completeness', () => {
  const s = [at(15, 0.2), at(30, 0.2), at(45, 0.2), at(60, 0.2), at(75, 1), at(90, 1)];
  assert.deepEqual(hourlyRain(s), [[T0 + time.HOUR, 0.8]]);
  const t = totalRain(s, 1, T0 + time.HOUR);
  assert.equal(t.count, 4);
  assert.equal(t.complete, true);
});

test('simulator is linear and reports time to reach', () => {
  const s = simulateLinear(1, 10, 2);
  assert.equal(s.length, 9);
  assert.ok(Math.abs(s.at(-1)[1] - 1.2) < 1e-9);
  assert.equal(hoursToReach(1, 1.5, 10), 5);
  assert.equal(hoursToReach(1, 0.5, 10), null);
});

test('UK time formatting handles BST and GMT', () => {
  assert.equal(fmt.time(Date.parse('2026-07-01T12:00:00Z')), '13:00');
  assert.equal(fmt.time(Date.parse('2026-12-01T12:00:00Z')), '12:00');
  assert.equal(fmt.zone(Date.parse('2026-07-01T12:00:00Z')), 'BST');
  assert.equal(ukDayStart('2026-07-01'), Date.parse('2026-06-30T23:00:00Z'));
  assert.equal(ukDayStart('2026-12-01'), Date.parse('2026-12-01T00:00:00Z'));
  assert.equal(ukDateInput(Date.parse('2026-06-30T23:30:00Z')), '2026-07-01');
  assert.equal(fmt.signed(1.234, 1, ' cm'), '+1.2 cm');
  assert.equal(fmt.signed(-0.01, 1), '±0.0');
});

test('CSV escaping and quantiles', () => {
  assert.equal(toCSV(['a', 'b'], [['x,y', 'q"']]), 'a,b\n"x,y","q"""');
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
});

test('real snapshot data produces sensible derived values', () => {
  const snap = JSON.parse(readFileSync(new URL('../../dist/snapshot.json', import.meta.url)));
  const s = cleanReadings(snap.readings);
  assert.ok(s.length > 500);
  assert.ok(s.every((p, i) => !i || p[0] > s[i - 1][0]));
  const r = rateSeries(s);
  assert.ok(r.length > 100 && r.every(p => Number.isFinite(p[1]) && Math.abs(p[1]) < 100));
});
