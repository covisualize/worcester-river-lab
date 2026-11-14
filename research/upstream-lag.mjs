// How long after the upstream gauge (Bewdley) peaks does Diglis peak, in the EA's own 15-minute archive? A DESCRIPTIVE look at past events, not a
// forecast. Written to settle the backlog item "Upstream travel-time explorer": see IMPROVEMENTS.md (2026-11-14) for what it found.
//
//   node research/upstream-lag.mjs [--from 2016] [--to 2025] [--good-only] [--cache DIR]
//
// The rule is fixed in advance (so it cannot be tuned to the answer):
//   an EVENT is a Diglis peak: the highest reading within +-24 h, at least `riseMin` above its lowest reading in the previous 72 h
//     (peaks less than 48 h apart count as one event, the higher one);
//   it is UPSTREAM-DRIVEN if Bewdley's highest reading in the 72 h before it itself rose at least `upstreamRiseMin` above its own low in the 72 h before that;
//   the LAG is the time from that Bewdley peak to the Diglis peak.
// Series are arrays of [epochMs, metres] on the 15-minute grid.
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const HOUR = 3600e3, STEP = 900e3;
export const DEFAULTS = { riseMin: 1.0, upstreamRiseMin: 0.5, peakWindowH: 24, riseWindowH: 72, minSeparationH: 48 };

const grid = series => new Map(series.map(([t, v]) => [t, v]));
function span(map, from, to) { const out = []; for (let t = from; t <= to; t += STEP) if (map.has(t)) out.push(map.get(t)); return out; }
const maxOf = a => a.reduce((m, v) => (v > m ? v : m), -Infinity), minOf = a => a.reduce((m, v) => (v < m ? v : m), Infinity);

export function findEvents(downstream, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, map = grid(downstream), events = [];
  for (const [t, v] of downstream) {
    if (v < maxOf(span(map, t - o.peakWindowH * HOUR, t + o.peakWindowH * HOUR))) continue;
    const before = span(map, t - o.riseWindowH * HOUR, t);
    if (before.length < 200 || v - minOf(before) < o.riseMin) continue; // 200 of the 288 readings a 72 h window should hold: no judging a gap
    const last = events.at(-1);
    if (last && t - last.t < o.minSeparationH * HOUR) { if (v > last.v) events[events.length - 1] = { t, v }; continue; }
    events.push({ t, v });
  }
  return events;
}

// One row per event that has an upstream rise; `unmatched` counts the events that do not (a local or tributary-driven rise) or whose upstream record has a gap.
export function matchLags(events, upstream, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, map = grid(upstream), rows = []; let unmatched = 0;
  for (const e of events) {
    let best = null;
    for (let t = e.t - o.riseWindowH * HOUR; t <= e.t; t += STEP) if (map.has(t) && (!best || map.get(t) > best.v)) best = { t, v: map.get(t) };
    const low = best && span(map, best.t - o.riseWindowH * HOUR, best.t);
    if (!best || span(map, e.t - o.riseWindowH * HOUR, e.t).length < 200 || best.v - minOf(low) < o.upstreamRiseMin) { unmatched++; continue; }
    rows.push({ downstreamAt: e.t, downstream: e.v, upstreamAt: best.t, upstream: best.v, upstreamRise: best.v - minOf(low), lagHours: (e.t - best.t) / HOUR });
  }
  return { rows, unmatched };
}

export function quantile(values, p) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
export function summarise(rows) {
  const lags = rows.map(r => r.lagHours);
  return { n: lags.length, min: Math.min(...lags), q1: quantile(lags, .25), median: quantile(lags, .5), q3: quantile(lags, .75), max: Math.max(...lags), withinAnHour: lags.filter(l => l < 1).length };
}

/* ---------- command line: fetch the EA Hydrology archive, one request per year ---------- */

const HYDRO = 'https://environment.data.gov.uk/hydrology/id/measures';
const MEASURES = { bewdley: '8820d897-a09e-4857-8095-5834fee6962f-level-i-900-m-qualified', diglis: '92fe5ece-51b6-4935-b975-1a069a13af65-level-i-900-m-qualified' };

async function year(name, y, cache) {
  const file = cache && `${cache}/${name}-${y}.json`;
  if (file) try { return JSON.parse(await readFile(file)); } catch { /* not cached yet */ }
  const res = await fetch(`${HYDRO}/${MEASURES[name]}/readings?mineq-date=${y}-01-01&max-date=${y + 1}-01-01&_limit=40000`);
  if (!res.ok) throw new Error(`${name} ${y}: HTTP ${res.status}`);
  const rows = (await res.json()).items.map(x => [Date.parse(`${x.dateTime}Z`), x.value, x.quality === 'Good' ? 1 : 0]);
  if (file) { await mkdir(cache, { recursive: true }); await writeFile(file, JSON.stringify(rows)); }
  return rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i < 0 ? d : process.argv[i + 1]; };
  const from = Number(arg('--from', 2016)), to = Number(arg('--to', 2025)), goodOnly = process.argv.includes('--good-only'), cache = arg('--cache');
  const load = async name => { const all = []; for (let y = from; y <= to; y++) all.push(...await year(name, y, cache)); return all.filter(r => Number.isFinite(r[1]) && (!goodOnly || r[2])).sort((a, b) => a[0] - b[0]); };
  const [up, down] = [await load('bewdley'), await load('diglis')];
  console.log(`EA Hydrology, 15-minute levels ${from}-${to}${goodOnly ? ', quality "Good" only' : ''}: ${up.length} Bewdley and ${down.length} Diglis readings\n`);
  for (const riseMin of [0.5, 1.0, 2.0]) {
    const events = findEvents(down, { riseMin }), { rows, unmatched } = matchLags(events, up), s = summarise(rows);
    console.log(`Diglis rise >= ${riseMin} m: ${events.length} events; ${rows.length} with a Bewdley rise >= ${DEFAULTS.upstreamRiseMin} m before it, ${unmatched} without`);
    if (rows.length) console.log(`  Bewdley peak -> Diglis peak, hours: min ${s.min.toFixed(1)}, middle half ${s.q1.toFixed(1)} to ${s.q3.toFixed(1)}, median ${s.median.toFixed(1)}, max ${s.max.toFixed(1)}; ${s.withinAnHour} of ${s.n} within an hour`);
  }
}
