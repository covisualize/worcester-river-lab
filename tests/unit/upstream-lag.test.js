// research/upstream-lag.mjs: how long after an upstream gauge peaks does the downstream one? Tested on series built so the right answer is known.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findEvents, matchLags, quantile, summarise } from '../../research/upstream-lag.mjs';

const HOUR = 3600e3, STEP = 900e3, T0 = Date.UTC(2026, 0, 1);
// A flat series at `base` for `days`, with triangular pulses: [peakAtHours, height, halfWidthHours].
function series(base, pulses, days = 10, skip = () => false) {
  const out = [];
  for (let t = T0; t < T0 + days * 24 * HOUR; t += STEP) {
    if (skip(t)) continue;
    const h = (t - T0) / HOUR;
    out.push([t, base + Math.max(0, ...pulses.map(([at, height, half]) => height * (1 - Math.abs(h - at) / half)))]);
  }
  return out;
}

test('an upstream pulse 10 h before a downstream one gives a lag of 10 h', () => {
  const down = series(1.0, [[150, 1.2, 12]]), up = series(0.5, [[140, 1.0, 12]]);
  const events = findEvents(down);
  assert.equal(events.length, 1);
  assert.equal(events[0].t, T0 + 150 * HOUR);
  const { rows, unmatched } = matchLags(events, up);
  assert.equal(unmatched, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lagHours, 10);
  assert.ok(Math.abs(rows[0].upstreamRise - 1.0) < 1e-9);
});

test('a downstream rise with nothing upstream is counted as unmatched, not given a lag', () => {
  const { rows, unmatched } = matchLags(findEvents(series(1.0, [[150, 1.2, 12]])), series(0.5, []));
  assert.equal(rows.length, 0);
  assert.equal(unmatched, 1);
});

test('a small rise is not an event unless the threshold allows it', () => {
  const down = series(1.0, [[150, 0.6, 12]]);
  assert.equal(findEvents(down, { riseMin: 1.0 }).length, 0);
  assert.equal(findEvents(down, { riseMin: 0.5 }).length, 1);
});

test('two peaks less than 48 h apart are one event, the higher one', () => {
  const events = findEvents(series(1.0, [[120, 1.2, 8], [140, 1.6, 8]], 12), { riseMin: 1.0 });
  assert.equal(events.length, 1);
  assert.equal(events[0].t, T0 + 140 * HOUR);
});

test('two peaks 60 h apart are two events', () => {
  assert.equal(findEvents(series(1.0, [[120, 1.2, 8], [180, 1.6, 8]], 12), { riseMin: 1.0 }).length, 2);
});

test('a gap in the record is never judged: no event from a window with too few readings, and no lag from a missing upstream record', () => {
  const gapFrom = T0 + 100 * HOUR, gapTo = T0 + 148 * HOUR;
  assert.equal(findEvents(series(1.0, [[150, 1.2, 12]], 10, t => t >= T0 && t < T0 + 120 * HOUR)).length, 0, 'the 72 h before the peak is mostly missing');
  const down = series(1.0, [[150, 1.2, 12]]), upGap = series(0.5, [[140, 1.0, 12]], 10, t => t >= gapFrom && t < gapTo + 6 * HOUR);
  const { rows, unmatched } = matchLags(findEvents(down), upGap);
  assert.equal(rows.length + unmatched, 1);
  assert.ok(rows.every(r => Number.isFinite(r.lagHours)), 'never NaN');
});

test('quantile and summarise: the middle half, the median and how many are within an hour', () => {
  assert.equal(quantile([0.5, 1, 2, 3, 10], 0.5), 2);
  assert.equal(quantile([0.5, 1, 2, 3, 10], 0.25), 1);
  assert.equal(quantile([0.5, 1, 2, 3, 10], 0.75), 3);
  assert.ok(Number.isNaN(quantile([], 0.5)));
  const s = summarise([0.5, 1, 2, 3, 10].map(lagHours => ({ lagHours })));
  assert.deepEqual([s.n, s.min, s.q1, s.median, s.q3, s.max, s.withinAnHour], [5, 0.5, 1, 2, 3, 10, 1]);
});
