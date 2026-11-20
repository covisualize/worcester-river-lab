// readingsTable (dist/js/data.js): the rows behind the Overview timeline's "Show the readings as a table". Real readings only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingsTable } from '../../dist/js/data.js';

const T = m => Date.UTC(2026, 10, 12, 8, m); // 12 Nov 2026, 08:mm UTC

test('one series: newest first, values untouched', () => {
  const { rows, total } = readingsTable([{ raw: [[T(0), 0.5], [T(15), 0.52], [T(30), 0.51]] }]);
  assert.equal(total, 3);
  assert.deepEqual(rows.map(r => r.t), [T(30), T(15), T(0)]);
  assert.deepEqual(rows.map(r => r.values), [[0.51], [0.52], [0.5]]);
});

test('two series are joined by time; a gauge with no reading then is null, never filled in', () => {
  const { rows } = readingsTable([{ raw: [[T(0), 1], [T(15), 2]] }, { raw: [[T(15), 20], [T(30), 30]] }]);
  assert.deepEqual(rows, [{ t: T(30), values: [null, 30] }, { t: T(15), values: [2, 20] }, { t: T(0), values: [1, null] }]);
});

test('the limit keeps the newest rows and total still says how many there are', () => {
  const raw = Array.from({ length: 200 }, (_, i) => [T(0) + i * 900000, i]);
  const { rows, total } = readingsTable([{ raw }], 96);
  assert.equal(total, 200);
  assert.equal(rows.length, 96);
  assert.equal(rows[0].values[0], 199);
  assert.equal(rows.at(-1).values[0], 104);
});

test('missing or non-numeric readings are skipped, and nothing at all is an empty table', () => {
  const { rows, total } = readingsTable([{ raw: [[T(0), null], [T(15), NaN], [T(30), 0.4], [NaN, 1]] }]);
  assert.equal(total, 1);
  assert.deepEqual(rows, [{ t: T(30), values: [0.4] }]);
  assert.deepEqual(readingsTable([{ raw: [] }]), { total: 0, rows: [] });
  assert.deepEqual(readingsTable([]), { total: 0, rows: [] });
});
