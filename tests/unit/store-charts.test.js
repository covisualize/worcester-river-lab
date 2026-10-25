import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode, encode, defaults, createStore } from '../../dist/js/store.js';
import {
  timeSeriesOption, rateOption, rangeBarsOption, rainLevelOption, archiveOption, eventsOverlayOption, calendarOption, simulationOption,
  sparkline, gaugeSVG, esc,
} from '../../dist/js/charts.js';
import { cleanReadings, rateSeries, notable, topEvents, eventWindow, hourlyRain, simulateLinear, breakGaps } from '../../dist/js/data.js';
import { normaliseStation } from '../../dist/js/api.js';
import { STATIONS } from '../../dist/js/config.js';

const T = {
  bg: '#000000', surface: '#111111', surface2: '#222222', line: '#333333', grid: '#444444', text: '#ffffff', muted: '#999999',
  accent: '#d8ef97', accentSoft: '#d8ef9726', water: '#4fc3c9', rise: '#f2a65a', fall: '#6aaee6', alert: '#f0b44c', severe: '#ef5f5f',
  ok: '#7fd1a8', rain: '#6aaee6', sim: '#c792ea', palette: ['#111111', '#222222'], sequential: ['#000001', '#000002', '#000003', '#000004', '#000005'], font: 'sans-serif',
};
const snap = JSON.parse(readFileSync(new URL('../../dist/snapshot.json', import.meta.url)));
const series = cleanReadings(snap.readings);
const station = normaliseStation(snap.station, STATIONS.find(s => s.id === '2085'));
const noNaN = o => assert.ok(!/NaN|undefined m/.test(JSON.stringify(o, (k, v) => (typeof v === 'function' ? undefined : v))));

test('URL state round-trips and rejects invalid input', () => {
  const s = { ...defaults(), view: 'explore', compare: ['2001', '2085'], range: 'custom', from: '2026-01-01', to: '2026-01-20', metric: 'range', notes: [1792300000000] };
  assert.deepEqual(decode(encode(s)), { ...s, intel: false });
  const bad = decode('?view=evil&compare=999,2085&range=custom&metric=x&notes=a,-1');
  assert.equal(bad.view, 'overview');
  assert.deepEqual(bad.compare, ['2085']);
  assert.equal(bad.range, '7d', 'custom without dates falls back');
  assert.equal(bad.metric, 'stage');
  assert.deepEqual(bad.notes, []);
  assert.equal(encode(defaults()), '');
});

test('store notifies subscribers with previous state', () => {
  const st = createStore(defaults());
  let seen;
  st.subscribe((s, p) => (seen = [s.range, p.range]));
  st.set({ range: '30d' });
  assert.deepEqual(seen, ['30d', '24h']);
});

test('station normalisation picks the stage measure and EA stageScale', () => {
  assert.equal(station.levelMeasure, '2085-level-stage-i-15_min-mASD');
  assert.equal(station.scale.high, 2.8);
  assert.equal(station.scale.datum, 10);
  assert.ok(station.scale.maxOnRecord.value > 5);
  const empty = normaliseStation(null, STATIONS[0]);
  assert.equal(empty.label, 'Bewdley');
  assert.equal(empty.scale, null);
});

test('chart option builders produce finite, complete options from real data', () => {
  const ts = timeSeriesOption({
    series: [{ id: '2085', name: 'Diglis', color: '#111111', raw: series, data: breakGaps(series) }], T, animate: false,
    bands: [{ from: 0.5, to: 2.8, label: 'Typical', color: '#000000' }], thresholds: [{ value: 5, label: 'Highest recent', color: '#ff0000' }],
    annotations: notable(series), userNotes: [series[10][0]],
  });
  noNaN(ts);
  assert.equal(ts.series[0].markPoint.data.length, notable(series).length);
  assert.equal(ts.dataZoom.length, 2);
  const tip = ts.tooltip.formatter([{ value: series[50], seriesIndex: 0, seriesType: 'line', seriesName: 'Diglis', color: '#111111' }]);
  assert.match(tip, /Diglis/);
  assert.match(tip, /cm\/h/);

  noNaN(rateOption({ data: rateSeries(series), T }));
  noNaN(rangeBarsOption({ rows: [{ name: 'A', river: 'R', value: 1, when: 'x', low: 0, high: 2, pct: 50 }, { name: 'B', river: 'R', pct: null }], T }));
  noNaN(rainLevelOption({ rain: [[series[4][0], 0.4]], level: series, T, rainName: 'r', levelName: 'l' }));
  const rows = [['2007-07-21', 5.3, 1, 'G'], ['2007-07-22', 5.2, 1, 'G'], ['2020-02-17', 5.27, 1, 'U']];
  noNaN(archiveOption({ series: [{ name: 'Diglis', color: '#111111', data: rows.map(r => [Date.parse(r[0]), r[1], r[3]]) }], events: topEvents(rows), T }));
  noNaN(eventsOverlayOption({ events: [{ name: 'e', data: eventWindow(rows, '2007-07-21') }], reference: [{ value: 1, label: 'x', color: '#fff' }], T }));
  noNaN(calendarOption({ year: 2007, rows, T, low: 0.5, high: 2.8 }));
  noNaN(simulationOption({ observed: series.slice(-10), simulated: simulateLinear(0.5, 2, 6).map(([h, v]) => [series.at(-1)[0] + h * 3600000, v]), thresholds: [{ value: 2.8, label: 'Typical high', color: '#fff' }], T }));
  assert.equal(hourlyRain([]).length, 0);
});

test('inline SVG primitives', () => {
  const g = gaugeSVG({ value: 0.57, scale: station.scale, T });
  assert.match(g, /role="img"/);
  assert.match(g, /0\.57 m/);
  assert.match(g, /Record 5\.30 m/);
  assert.ok(!g.includes('NaN'));
  assert.ok(!gaugeSVG({ value: null, scale: null, T }).includes('NaN'));
  assert.ok(!sparkline(series.slice(-96)).includes('NaN'));
  assert.ok(sparkline([]).includes('<svg'));
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('chart descriptions are plain English for screen readers', () => {
  const raw = series.slice(-96);
  const opts = [
    timeSeriesOption({ series: [{ id: '2085', name: 'Diglis', color: '#111111', raw, data: raw }], T, animate: false }),
    rateOption({ data: rateSeries(raw), T, name: 'Diglis' }),
    rangeBarsOption({ rows: [{ name: 'Diglis', pct: 1.4 }, { name: 'Bewdley', pct: null }], T }),
    rainLevelOption({ rain: [[raw[4][0], 0.4]], level: raw, T, rainName: 'Rain gauge 1773', levelName: 'Diglis level' }),
    simulationOption({ observed: raw, simulated: simulateLinear(0.5, 2, 6).map(([h, v]) => [raw.at(-1)[0] + h * 3600000, v]), thresholds: [], T }),
  ];
  for (const o of opts) {
    const d = o.aria.label.description;
    assert.ok(d.length > 40, 'has a real description');
    assert.ok(!/\d{12,}/.test(d), `no raw epoch timestamps: ${d}`);
    assert.ok(!/\d\.\d{5,}/.test(d), `no float noise: ${d}`);
    assert.ok(!/NaN|undefined/.test(d), d);
  }
  assert.match(opts[0].aria.label.description, /Diglis: .* m at .*highest/);
  assert.match(opts[2].aria.label.description, /Diglis: 1%\. Bewdley: not available\./);
  assert.match(opts[4].aria.label.description, /hypothetical and not a forecast/);
});

test('rate summary never calls a fall a rise (single-direction windows)', () => {
  const t0 = Date.parse('2026-10-18T00:00:00Z');
  const falling = Array.from({ length: 8 }, (_, i) => [t0 + i * 900000, -1 - i * 0.2]);
  const rising = falling.map(([t, v]) => [t, -v]);
  const df = rateOption({ data: falling, T, name: 'Diglis' }).aria.label.description;
  const dr = rateOption({ data: rising, T, name: 'Diglis' }).aria.label.description;
  assert.match(df, /No rise in this window/);
  assert.match(df, /fastest fall −2\.4 cm\/h/);
  assert.ok(!/Fastest rise −/.test(df), df);
  assert.match(dr, /Fastest rise \+2\.4 cm\/h/);
  assert.match(dr, /no fall in this window/);
});

test('review fixes: verdict, axis digits, staggered labels, heatmap bands, URL hygiene', async () => {
  const { verdict } = await import('../../dist/js/data.js');
  const { levelDigits, refLines } = await import('../../dist/js/charts.js');
  // Verdict: answer first, warnings override the colour key, never invented.
  assert.equal(verdict({ key: 'normal' }, { key: 'steady' }, []).headline, 'Normal and steady');
  assert.equal(verdict({ key: 'high' }, { key: 'rising' }, []).headline, 'High and rising');
  assert.equal(verdict({ key: 'normal' }, { key: 'steady' }, []).warning.text, 'No flood warnings in force near Worcester');
  const w = verdict({ key: 'high' }, { key: 'rising' }, [{ severityLevel: 3 }, { severityLevel: 2 }]);
  assert.equal(w.key, 'severe');
  assert.equal(w.warning.text, 'Flood warning in force near Worcester');
  // Only warnings for flood areas near Worcester colour the headline.
  const local = new Set(['031FWFSE440']);
  const far = verdict({ key: 'normal' }, { key: 'rising' }, [{ id: '031WAF119', severityLevel: 3 }], local);
  assert.equal(far.key, 'normal');
  assert.equal(far.warning.key, 'remote');
  assert.equal(far.warning.text, 'No flood warnings near Worcester · 1 flood alert elsewhere within 40 km');
  const both = verdict({ key: 'normal' }, { key: 'rising' }, [{ id: '031WAF119', severityLevel: 2 }, { id: '031FWFSE440', severityLevel: 3 }], local);
  assert.equal(both.key, 'alert', 'the local alert counts; the remote warning does not');
  assert.equal(verdict({ key: 'normal' }, { key: 'rising' }, [{ id: 'X', severityLevel: 3 }], null).key, 'alert', 'unknown area list: treat as local');
  assert.equal(verdict({ key: 'normal' }, { key: 'steady' }, [{ severityLevel: 4 }]).warning.key, 'clear', 'removed warnings do not count');
  assert.equal(verdict({ key: 'normal' }, { key: 'steady' }, null).warning.key, 'unknown');
  // Narrow ranges get 3 dp so ticks never repeat.
  assert.equal(levelDigits([0.55, 0.552, 0.57]), 3);
  assert.equal(levelDigits([0.5, 1.4]), 2);
  // Close reference lines get different label positions.
  const lines = refLines([{ value: 5.04, label: 'Highest recent', color: '#f00' }, { value: 5.3, label: 'Record', color: '#f00' }, { value: 2.8, label: 'Typical high', color: '#0f0' }], T, [0.5, 6]);
  assert.equal(lines.length, 3);
  const pos = Object.fromEntries(lines.map(l => [l.name, l.label.position]));
  assert.notEqual(pos['Highest recent'], pos.Record);
  // Heatmap: piecewise bands from EA reference levels; blank cells for no data.
  const cal = calendarOption({ year: 2026, rows: [['2026-01-05', 4.6, 1, 'G'], ['2026-06-01', 0.55, 0.5, 'G']], T, low: 0.548, high: 2.8, highestRecent: 5.037 });
  assert.equal(cal.visualMap.type, 'piecewise');
  assert.equal(cal.visualMap.pieces.length, 5);
  assert.equal(cal.calendar.itemStyle.color, 'transparent');
  // Shared links only carry the current view's state.
  const st = { ...defaults(), view: 'map', compare: ['2001', '2085'], metric: 'range', notes: [1792300000000], range: '7d' };
  assert.equal(encode(st), '?view=map');
  assert.equal(encode({ ...st, view: 'overview' }), '?range=7d');
  assert.match(encode({ ...st, view: 'explore' }), /compare=2001%2C2085.*range=7d.*metric=range.*notes=/);
});

test('second review: range words, demo URL state, label backing', async () => {
  const { rangeWords, rangePosition } = await import('../../dist/js/data.js');
  const { refLines } = await import('../../dist/js/charts.js');
  const sc = { low: 0.548, high: 2.8 };
  assert.equal(rangeWords(rangePosition(0.572, sc)), 'Near typical low');
  assert.equal(rangeWords(rangePosition(1.7, sc)), 'Middle of typical range');
  assert.equal(rangeWords(rangePosition(2.6, sc)), 'Near typical high');
  assert.equal(rangeWords(rangePosition(4.98, sc)), 'Above typical range');
  assert.equal(rangeWords(rangePosition(0.4, sc)), 'Below typical range');
  assert.equal(rangeWords(rangePosition(1, null)), 'No typical range published');
  // The demo flag survives every view change and rejects unknown replays.
  assert.equal(decode('?demo=feb2020').demo, 'feb2020');
  assert.equal(decode('?demo=evil').demo, null);
  assert.equal(encode({ ...defaults(), view: 'history', demo: 'feb2020' }), '?view=history&demo=feb2020');
  assert.equal(refLines([{ value: 1, label: 'Latest', color: '#fff' }], T)[0].label.backgroundColor, T.surface);
});

test('demo replay data is real archive data, not invented', () => {
  const d = JSON.parse(readFileSync(new URL('../../dist/data/demo-feb2020.json', import.meta.url)));
  assert.match(d.source, /EA Hydrology/);
  const dig = d.series['2085'];
  assert.ok(dig.length > 900);
  assert.deepEqual(dig.at(-1), [Date.parse('2020-02-16T18:00:00Z'), 4.978]);
  for (const rows of Object.values(d.series)) for (const [t] of rows) assert.ok(t >= d.start && t <= d.now);
  // Bundled EA metadata lets the replay classify levels without the live service.
  const s = normaliseStation(d.stations['2085'], STATIONS.find(x => x.id === '2085'));
  assert.equal(s.scale.high, 2.8);
});

test('CSV exports during a demo are marked and keep the real reading times', async () => {
  const { markDemoCSV, toCSV } = await import('../../dist/js/data.js');
  const shift = Date.parse('2026-10-20T21:00:00Z') - Date.parse('2020-02-16T18:00:00Z');
  const csv = toCSV(['timestamp_utc', 'level_m_asd'], [[new Date(Date.parse('2020-02-16T18:00:00Z') + shift).toISOString(), 4.978]]);
  const out = markDemoCSV(csv, shift).split('\n');
  assert.equal(out[0], 'timestamp_utc,level_m_asd,data_source,original_timestamp_utc');
  assert.equal(out[1], '2026-10-20T21:00:00.000Z,4.978,DEMO replay - not current,2020-02-16T18:00:00.000Z');
  assert.equal(markDemoCSV(toCSV(['date_gmt', 'daily_max_m_asd'], [['2020-02-17', 5.27]]), shift), null, 'real dated archive is left alone');
});

test('outage messages are plain English, and the fallback snapshot covers the gauges', async () => {
  const { describeError } = await import('../../dist/js/api.js');
  assert.equal(describeError(new TypeError('Failed to fetch'), true), 'The Environment Agency service could not be reached');
  assert.equal(describeError(new Error('HTTP 503 from environment.data.gov.uk'), true), 'The Environment Agency service is having problems (error 503)');
  assert.equal(describeError(new Error('HTTP 404 from environment.data.gov.uk'), true), 'The Environment Agency service refused the request (error 404)');
  assert.equal(describeError(new TypeError('x'), false), 'You appear to be offline');
  const f = JSON.parse(readFileSync(new URL('../../dist/data/fallback-snapshot.json', import.meta.url)));
  assert.ok(Number.isFinite(Date.parse(f.retrievedAt)));
  assert.ok(Object.values(f.series).filter(s => s.length).length >= 5);
  for (const s of Object.values(f.series)) for (const [t, v] of s) assert.ok(Number.isFinite(t) && Number.isFinite(v));
  assert.equal(normaliseStation(f.stations['2085'], STATIONS.find(x => x.id === '2085')).scale.high, 2.8);
});

test('simulation caveat is drawn inside the chart image', () => {
  const o = simulationOption({ observed: series.slice(-10), simulated: simulateLinear(0.5, 2, 6).map(([h, v]) => [series.at(-1)[0] + h * 3600000, v]), thresholds: [], T });
  assert.ok(o.graphic.some(g => /SIMULATION, NOT A FORECAST/.test(g.style.text)));
});

test('slim ECharts bundle includes every feature the charts use', () => {
  const src = readFileSync(new URL('../../dist/js/charts.js', import.meta.url), 'utf8');
  const entry = readFileSync(new URL('../../scripts/echarts-entry.mjs', import.meta.url), 'utf8');
  const need = {
    "type: 'line'": 'LineChart', "type: 'bar'": 'BarChart', "type: 'heatmap'": 'HeatmapChart', 'markLine': 'MarkLineComponent',
    'markArea': 'MarkAreaComponent', 'markPoint': 'MarkPointComponent', 'dataZoom': 'DataZoomComponent', 'visualMap': 'VisualMapComponent',
    'calendar': 'CalendarComponent', 'graphic': 'GraphicComponent', 'legend': 'LegendComponent', 'tooltip': 'TooltipComponent', 'aria': 'AriaComponent',
  };
  for (const [used, comp] of Object.entries(need)) if (src.includes(used)) assert.match(entry, new RegExp(`\\b${comp}\\b`), `${used} needs ${comp}`);
  // Every `type:` in the chart options must be a bundled series or a built-in axis/zoom/legend type.
  const known = new Set(['line', 'bar', 'heatmap', 'time', 'value', 'category', 'inside', 'slider', 'piecewise', 'continuous', 'scroll', 'dashed', 'dotted', 'solid', 'text', 'group', 'rect', 'cross', 'shadow', 'linear']);
  for (const [, t] of src.matchAll(/type: '(\w+)'/g)) assert.ok(known.has(t), `type '${t}' is not bundled`);
  const html = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');
  assert.match(html, /vendor\/echarts\.slim\.min\.js/);
  assert.ok(readFileSync(new URL('../../dist/vendor/echarts.slim.min.js', import.meta.url)).length > 100_000);
});
