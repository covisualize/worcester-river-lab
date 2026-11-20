import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, MAX_MARKS_PER_STATION, MAX_LABEL_LEN,
  cleanLabel, validateMark, describeDistance, partitionForChart, toThresholds, countDaysExceeded, createMarksStore,
} from '../../dist/js/marks.js';
import { gaugeSVG, timeSeriesOption, archiveOption, eventsOverlayOption, refLines } from '../../dist/js/charts.js';

const T = {
  bg: '#0b1517', surface: '#101e21', surface2: '#15272a', line: '#22383b', grid: '#1a2c2f',
  text: '#e8efe9', muted: '#8ea39f', accent: '#d8ef97', accentSoft: '#d8ef9726',
  water: '#4fc3c9', rise: '#f2a65a', fall: '#6aaee6', alert: '#f0b44c', severe: '#ef5f5f',
  ok: '#7fd1a8', rain: '#6aaee6', sim: '#c792ea', mark: '#f48fb1',
  palette: ['#4fc3c9', '#d8ef97'], sequential: ['#5b8fc4', '#2f8f86', '#6fd0bf', '#f0b44c', '#ef5f5f'], font: 'sans-serif',
};

function memStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    dump: () => Object.fromEntries(map),
  };
}

test('validateMark enforces station, label, numeric bounds and per-station cap', () => {
  assert.equal(validateMark({ stationId: '9999', label: 'Towpath', value: 2.1 }).ok, false);
  assert.equal(validateMark({ stationId: '2085', label: '   ', value: 2.1 }).ok, false);
  assert.equal(validateMark({ stationId: '2085', label: 'Towpath', value: '' }).ok, false);
  assert.equal(validateMark({ stationId: '2085', label: 'Towpath', value: NaN }).ok, false);
  assert.equal(validateMark({ stationId: '2085', label: 'Towpath', value: 50 }).ok, false);
  assert.equal(validateMark({ stationId: '2085', label: 'Towpath', value: -10 }).ok, false);
  assert.equal(validateMark({ stationId: '2085', label: 'Towpath', value: 2.1, existingCount: MAX_MARKS_PER_STATION }).ok, false);

  const ok = validateMark({ stationId: '2085', label: '  Lower   towpath steps  ', value: '2.3456' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.mark, { label: 'Lower towpath steps', value: 2.346 });
  assert.equal(cleanLabel('x'.repeat(100)).length, MAX_LABEL_LEN);
});

test('describeDistance classifies below, at and above cleanly', () => {
  assert.equal(describeDistance(null, 2), null);
  assert.equal(describeDistance(1.0, NaN), null);
  assert.deepEqual(describeDistance(0.78, 2.1), { status: 'below', diff: 0.78 - 2.1, text: '1.32 m below' });
  assert.deepEqual(describeDistance(2.103, 2.1), { status: 'at', diff: 2.103 - 2.1, text: 'At mark' });
  assert.deepEqual(describeDistance(2.45, 2.1), { status: 'above', diff: 2.45 - 2.1, text: '0.35 m above' });
});

test('partitionForChart keeps quiet-day timelines readable unless showAll is on', () => {
  const marks = [
    { id: 'a', label: 'Low bank', value: 1.05 },
    { id: 'b', label: 'Slipway', value: 2.1 },
    { id: 'c', label: 'Flood wall', value: 4.5 },
  ];
  const quiet = [0.75, 0.80, 0.85, 0.90];
  const p1 = partitionForChart(marks, quiet, { showAll: false });
  assert.deepEqual(p1.visible.map(m => m.id), ['a']);
  assert.deepEqual(p1.hidden.map(m => m.id), ['b', 'c']);

  const p2 = partitionForChart(marks, quiet, { showAll: true });
  assert.deepEqual(p2.visible.map(m => m.id), ['a', 'b', 'c']);
  assert.deepEqual(p2.hidden, []);

  assert.deepEqual(partitionForChart(marks, []).hidden.length, 3);
});

test('countDaysExceeded counts archive exceedances and finds the latest date', () => {
  const rows = [
    ['2007-07-21', 5.30, 3.0, 'G'],
    ['2014-02-12', 3.40, 2.5, 'G'],
    ['2020-02-17', 5.27, 4.1, 'G'],
    ['2024-01-04', 2.15, 1.8, 'G'],
  ];
  assert.deepEqual(countDaysExceeded(rows, 3.0), { count: 3, total: 4, pct: 75, lastDate: '2020-02-17' });
  assert.deepEqual(countDaysExceeded(rows, 6.0), { count: 0, total: 4, pct: 0, lastDate: null });
});

test('createMarksStore persists per-station, sorts ascending, notifies and handles corrupt/blocked storage', () => {
  const st = memStorage();
  const s1 = createMarksStore(st);
  const events = [];
  s1.subscribe(sid => events.push(sid));

  assert.equal(s1.storageAvailable(), true);
  assert.equal(s1.add('2085', { label: 'Bridge', value: 3.2 }).ok, true);
  assert.equal(s1.add('2085', { label: 'Towpath', value: 1.8 }).ok, true);
  assert.equal(s1.add('2001', { label: 'Bewdley quay', value: 2.5 }).ok, true);

  // Sorted ascending per station and isolated between stations.
  assert.deepEqual(s1.list('2085').map(m => m.label), ['Towpath', 'Bridge']);
  assert.deepEqual(s1.list('2001').map(m => m.label), ['Bewdley quay']);
  assert.deepEqual(events, ['2085', '2085', '2001']);

  // Reloading from the same storage preserves marks.
  const s2 = createMarksStore(st);
  assert.deepEqual(s2.list('2085').map(m => [m.label, m.value]), [['Towpath', 1.8], ['Bridge', 3.2]]);

  // Removal cleans up storage cleanly.
  const id = s2.list('2085')[0].id;
  assert.equal(s2.remove('2085', id), true);
  assert.equal(s2.list('2085').length, 1);
  s2.clear();
  assert.equal(st.dump()[STORAGE_KEY], undefined);

  // Corrupt / adversarial JSON is sanitised rather than throwing.
  const bad = memStorage({
    [STORAGE_KEY]: JSON.stringify({
      v: 1,
      stations: {
        '9999': [{ label: 'Bad station', value: 1 }],
        '2085': [
          { label: '', value: 2 },
          { label: 'NaN', value: 'abc' },
          { label: 'Valid', value: 2.2 },
        ],
      },
    }),
  });
  const s3 = createMarksStore(bad);
  assert.deepEqual(s3.list('2085').map(m => m.label), ['Valid']);
  assert.deepEqual(s3.list('9999'), []);

  // Storage that throws (e.g. private browsing) falls back to in-memory without throwing.
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  const s4 = createMarksStore(broken);
  assert.equal(s4.storageAvailable(), false);
  assert.equal(s4.add('2085', { label: 'Session note', value: 1.5 }).ok, true);
  assert.equal(s4.list('2085').length, 1);
});

test('chart builders render personal watermarks distinctly and without NaN', () => {
  const marks = [{ id: 'm1', label: 'Towpath', value: 2.1 }];
  const g = gaugeSVG({ value: 0.9, scale: { low: 0.5, high: 2.8, highestRecent: { value: 4.9 }, maxOnRecord: { value: 5.3 } }, T, marks });
  assert.match(g, /Your mark: Towpath 2\.10 m/);
  assert.match(g, /Personal marks: Towpath at 2\.10 m/);
  assert.ok(!g.includes('NaN'));

  const lines = refLines(toThresholds(marks, T), T, [0.8, 2.5]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].lineStyle.type, 'dotted');
  assert.equal(lines[0].lineStyle.color, T.mark);

  const t0 = Date.parse('2026-10-18T00:00:00Z');
  const raw = [[t0, 1.2], [t0 + 3600e3, 1.5]];
  const ts = timeSeriesOption({ series: [{ id: '2085', name: 'Diglis', color: T.water, raw, data: raw }], T, thresholds: toThresholds(marks, T), fitThresholds: true });
  assert.equal(ts.series[0].markLine.data[0].lineStyle.type, 'dotted');
  assert.ok(ts.yAxis.max({ min: 1.2, max: 1.5 }) >= 2.1, 'yAxis expands to show personal marks when fitThresholds is true');

  const arch = archiveOption({
    series: [{ name: 'Diglis', color: T.water, data: [[t0, 2.5, 'G']] }],
    thresholds: toThresholds(marks, T).map(x => ({ ...x, text: `${x.label} ${x.value.toFixed(2)} m` })),
    T,
  });
  assert.match(arch.series[0].markLine.data[0].label.formatter, /Your mark · Towpath 2\.10 m/);

  const ov = eventsOverlayOption({
    events: [{ name: 'Feb 2020', data: [[0, 5.27]] }],
    reference: toThresholds(marks, T).map(x => ({ ...x, text: `${x.label} ${x.value.toFixed(2)} m` })),
    T,
  });
  assert.match(ov.series[1].markLine.data[0].label.formatter, /Your mark · Towpath 2\.10 m/);
});
