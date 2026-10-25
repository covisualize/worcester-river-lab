// Pure data functions: no DOM, no network. Every series is an ascending array
// of [epochMs, value] pairs. Unit tested in tests/unit/data.test.js.
import { RULES, TZ } from './config.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const time = { MIN, HOUR, DAY };

/* ---------- Cleaning ---------- */

// EA real-time readings: drop non-numeric values and invalid timestamps,
// deduplicate timestamps (last wins) and sort ascending.
export function cleanReadings(items, measureSuffix) {
  const byTime = new Map();
  for (const r of items || []) {
    if (measureSuffix && !String(r.measure || '').endsWith('/' + measureSuffix)) continue;
    const t = parseTime(r.dateTime);
    if (!Number.isFinite(t) || typeof r.value !== 'number' || !Number.isFinite(r.value)) continue;
    byTime.set(t, r.value);
  }
  return [...byTime].sort((a, b) => a[0] - b[0]);
}

// EA Hydrology timestamps omit the zone; the archive is in GMT/UTC.
export function parseTime(s) {
  if (typeof s !== 'string') return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
}

/* ---------- Lookup ---------- */

// Index of the last point with t <= target (binary search), or -1.
export function indexAtOrBefore(series, t) {
  let lo = 0, hi = series.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// Nearest point to t within tolerance, otherwise null. No interpolation.
export function nearest(series, t, toleranceMs = RULES.matchToleranceMin * MIN) {
  if (!series.length) return null;
  const i = indexAtOrBefore(series, t);
  const candidates = [series[i], series[i + 1]].filter(Boolean);
  let best = null;
  for (const p of candidates) if (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
  return best && Math.abs(best[0] - t) <= toleranceMs ? best : null;
}

export const latest = series => (series.length ? series[series.length - 1] : null);

export function windowed(series, startMs, endMs = Infinity) {
  return series.filter(p => p[0] >= startMs && p[0] <= endMs);
}

/* ---------- Change & rate ---------- */

// Observed change over `hours` ending at the latest reading. Requires a real
// reading within tolerance of the comparison time.
export function change(series, hours) {
  const end = latest(series);
  if (!end) return null;
  const start = nearest(series, end[0] - hours * HOUR);
  if (!start || start[0] >= end[0]) return null;
  return { delta: end[1] - start[1], from: start, to: end, hours };
}

// Rate of change in cm/hour: each reading compared with the reading closest to
// `windowMin` earlier (within 10 minutes). Gaps produce no value.
export function rateSeries(series, windowMin = 60) {
  const out = [];
  const tol = 10 * MIN;
  for (let i = 0; i < series.length; i++) {
    const [t, v] = series[i];
    const prev = nearest(series, t - windowMin * MIN, tol);
    if (!prev || prev[0] >= t) continue;
    out.push([t, ((v - prev[1]) * 100) / ((t - prev[0]) / HOUR)]);
  }
  return out;
}

export function currentRate(series) {
  const end = latest(series);
  if (!end) return null;
  const r = rateSeries(series.slice(-12));
  const last = latest(r);
  return last && last[0] === end[0] ? last[1] : null;
}

export function trend(rateCmPerHour) {
  if (rateCmPerHour == null || !Number.isFinite(rateCmPerHour)) return { key: 'unknown', label: 'Trend unavailable', arrow: '·' };
  if (Math.abs(rateCmPerHour) < RULES.steadyCmPerHour) return { key: 'steady', label: 'Steady', arrow: '→' };
  return rateCmPerHour > 0 ? { key: 'rising', label: 'Rising', arrow: '↗' } : { key: 'falling', label: 'Falling', arrow: '↘' };
}

/* ---------- Context ---------- */

// Where a level sits relative to the EA "typical range" for the station.
// The typical range is station metadata, never a flood-warning threshold.
export function rangePosition(value, scale) {
  if (value == null || !scale || !Number.isFinite(scale.low) || !Number.isFinite(scale.high) || scale.high <= scale.low) {
    return { key: 'unknown', label: 'No typical range published', pct: null };
  }
  const pct = ((value - scale.low) / (scale.high - scale.low)) * 100;
  if (value > scale.high) return { key: 'high', label: 'Above typical range', pct };
  if (value < scale.low) return { key: 'low', label: 'Below typical range', pct };
  return { key: 'normal', label: 'Within typical range', pct };
}

// The same position in words, for residents: "1% of typical range" reads as
// alarming when it simply means the river is near its usual low.
export function rangeWords(pos) {
  if (pos?.pct == null) return pos?.label || 'No typical range published';
  if (pos.key === 'low') return 'Below typical range';
  if (pos.key === 'high') return 'Above typical range';
  return pos.pct < 20 ? 'Near typical low' : pos.pct > 80 ? 'Near typical high' : 'Middle of typical range';
}

// Split active warnings into those for flood areas near Worcester (EA flood
// areas within RULES.floodAreaRadiusKm) and the rest of the 40 km search.
// Without the local list every warning counts as local: never under-warn.
export function splitWarnings(warnings, localIds = null) {
  const active = (warnings || []).filter(w => w.severityLevel <= 3);
  if (!localIds) return { local: active, remote: [] };
  return { local: active.filter(w => localIds.has(w.id)), remote: active.filter(w => !localIds.has(w.id)) };
}

const countOf = ws => {
  const w = ws.filter(f => f.severityLevel <= 2).length, a = ws.length - w;
  return [w && `${w} flood warning${w > 1 ? 's' : ''}`, a && `${a} flood alert${a > 1 ? 's' : ''}`].filter(Boolean).join(' and ');
};
export { countOf as warningCount };

// Plain-English headline for the Overview, built only from the observed
// position in the EA typical range, the observed trend and official warnings.
// Only warnings near Worcester colour the headline; an alert on another river
// 40 km away is reported, but not as if it were here.
export function verdict(pos, tr, warnings = null, localIds = null) {
  const level = { normal: 'Normal', low: 'Low', high: 'High', unknown: 'Level unknown' }[pos?.key] || 'Level unknown';
  const motion = { steady: 'steady', rising: 'rising', falling: 'falling' }[tr?.key];
  const headline = pos?.key === 'unknown' || !pos ? level : motion ? `${level} and ${motion}` : level;
  const { local, remote } = splitWarnings(warnings, localIds);
  const worst = local.length ? Math.min(...local.map(w => w.severityLevel)) : null;
  let warning;
  if (warnings == null) warning = { key: 'unknown', text: 'Flood warning status not yet checked' };
  else if (worst === 1) warning = { key: 'severe', text: 'Severe flood warning in force near Worcester' };
  else if (worst === 2) warning = { key: 'warning', text: 'Flood warning in force near Worcester' };
  else if (worst === 3) warning = { key: 'alert', text: 'Flood alert in force near Worcester' };
  else if (remote.length) warning = { key: 'remote', text: `No flood warnings near Worcester · ${countOf(remote)} elsewhere within 40 km` };
  else warning = { key: 'clear', text: 'No flood warnings in force near Worcester' };
  return { headline, key: worst && worst <= 2 ? 'severe' : worst === 3 ? 'alert' : pos?.key || 'unknown', warning, local, remote };
}

// Derived height above Ordnance Datum: stage + EA stage-scale datum (which the
// EA API documents as "the datum level for the measurement point on OS datum").
export const toAOD = (value, scale) => (scale && Number.isFinite(scale.datum) ? value + scale.datum : null);

export function freshness(tMs, nowMs = Date.now()) {
  if (!Number.isFinite(tMs)) return { key: 'none', label: 'No data', ageMin: null };
  const ageMin = (nowMs - tMs) / MIN;
  if (ageMin < -5) return { key: 'future', label: 'Timestamp ahead of clock', ageMin };
  if (ageMin <= RULES.freshMinutes) return { key: 'fresh', label: 'Up to date', ageMin };
  if (ageMin <= RULES.staleMinutes) return { key: 'recent', label: 'Slightly delayed', ageMin };
  return { key: 'stale', label: 'Delayed data', ageMin };
}

/* ---------- Series utilities ---------- */

// Insert null points so chart lines break across gaps instead of bridging them.
export function breakGaps(series, gapMs = RULES.gapMinutes * MIN) {
  const out = [];
  for (let i = 0; i < series.length; i++) {
    if (i && series[i][0] - series[i - 1][0] > gapMs) out.push([series[i - 1][0] + 1, null]);
    out.push(series[i]);
  }
  return out;
}

export function gaps(series, gapMs = RULES.gapMinutes * MIN) {
  const out = [];
  for (let i = 1; i < series.length; i++) if (series[i][0] - series[i - 1][0] > gapMs) out.push([series[i - 1][0], series[i][0]]);
  return out;
}

export function stats(series) {
  if (!series.length) return null;
  let min = series[0], max = series[0], sum = 0;
  for (const p of series) {
    if (p[1] < min[1]) min = p;
    if (p[1] > max[1]) max = p;
    sum += p[1];
  }
  return { min, max, mean: sum / series.length, count: series.length, start: series[0][0], end: series[series.length - 1][0] };
}

export function quantile(values, q) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

// Largest-Triangle-Three-Buckets downsampling for long series. Keeps shape and
// extremes far better than striding; never invents values.
export function lttb(series, threshold) {
  if (threshold >= series.length || threshold < 3) return series;
  const out = [series[0]];
  const every = (series.length - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const rs = Math.floor((i + 1) * every) + 1, re = Math.min(Math.floor((i + 2) * every) + 1, series.length);
    let ax = 0, ay = 0;
    for (let j = rs; j < re; j++) { ax += series[j][0]; ay += series[j][1]; }
    ax /= re - rs || 1; ay /= re - rs || 1;
    const s = Math.floor(i * every) + 1, e = Math.floor((i + 1) * every) + 1;
    let maxArea = -1, pick = s;
    for (let j = s; j < e; j++) {
      const area = Math.abs((series[a][0] - ax) * (series[j][1] - series[a][1]) - (series[a][0] - series[j][0]) * (ay - series[a][1]));
      if (area > maxArea) { maxArea = area; pick = j; }
    }
    out.push(series[pick]);
    a = pick;
  }
  out.push(series[series.length - 1]);
  return out;
}

// Re-express a series for comparison modes.
export function transform(series, metric, scale) {
  if (metric === 'change') {
    const base = series[0]?.[1];
    return series.map(([t, v]) => [t, (v - base) * 100]);
  }
  if (metric === 'aod') return Number.isFinite(scale?.datum) ? series.map(([t, v]) => [t, v + scale.datum]) : [];
  if (metric === 'range') {
    if (!(scale?.high > scale?.low)) return [];
    return series.map(([t, v]) => [t, ((v - scale.low) / (scale.high - scale.low)) * 100]);
  }
  if (metric === 'rate') return rateSeries(series);
  return series;
}

export const METRICS = {
  stage: { label: 'Stage (m above station datum)', unit: 'm', digits: 3, short: 'Stage' },
  change: { label: 'Change since start of window (cm)', unit: 'cm', digits: 1, short: 'Change' },
  range: { label: 'Position in typical range (%)', unit: '%', digits: 0, short: '% of typical range' },
  aod: { label: 'Derived height above Ordnance Datum (m)', unit: 'mAOD', digits: 2, short: 'Derived mAOD' },
  rate: { label: 'Rate of change (cm per hour)', unit: 'cm/h', digits: 1, short: 'Rate' },
};

/* ---------- Insight & annotation ---------- */

// Automatic, descriptive annotations for a window: peak, low, fastest rise and
// fastest fall. These describe recorded data only.
export function notable(series) {
  const s = stats(series);
  if (!s || series.length < 3) return [];
  const notes = [
    { kind: 'peak', t: s.max[0], v: s.max[1], label: 'Highest reading in window' },
    { kind: 'low', t: s.min[0], v: s.min[1], label: 'Lowest reading in window' },
  ];
  const rates = rateSeries(series);
  if (rates.length) {
    const up = rates.reduce((m, p) => (p[1] > m[1] ? p : m), rates[0]);
    const down = rates.reduce((m, p) => (p[1] < m[1] ? p : m), rates[0]);
    const atUp = nearest(series, up[0], 0), atDown = nearest(series, down[0], 0);
    if (up[1] >= RULES.steadyCmPerHour && atUp) notes.push({ kind: 'rise', t: up[0], v: atUp[1], rate: up[1], label: `Fastest rise: +${up[1].toFixed(1)} cm/h` });
    if (down[1] <= -RULES.steadyCmPerHour && atDown) notes.push({ kind: 'fall', t: down[0], v: atDown[1], rate: down[1], label: `Fastest fall: ${down[1].toFixed(1)} cm/h` });
  }
  return notes.sort((a, b) => a.t - b.t);
}

// Explain a reading relative to the rest of its window (for tooltips).
export function explainRate(rate, allRates) {
  if (rate == null || !allRates.length) return '';
  const p95 = quantile(allRates.map(Math.abs), 0.95);
  if (Math.abs(rate) < RULES.steadyCmPerHour) return 'Little change over the previous hour.';
  if (p95 != null && Math.abs(rate) >= p95 && Math.abs(rate) >= 1) {
    return rate > 0 ? 'Unusually rapid rise for this window (top 5% of hourly changes).' : 'Unusually rapid fall for this window (top 5% of hourly changes).';
  }
  return rate > 0 ? 'Rising over the previous hour.' : 'Falling over the previous hour.';
}

/* ---------- Archive (daily max) ---------- */

// Independent peaks from daily maxima: highest days first, each at least
// `separationDays` from any higher peak already chosen.
export function topEvents(rows, { count = 10, separationDays = 14, minValue = -Infinity } = {}) {
  const sorted = rows.filter(r => Number.isFinite(r[1]) && r[1] >= minValue).sort((a, b) => b[1] - a[1]);
  const chosen = [];
  for (const r of sorted) {
    const t = Date.parse(r[0] + 'T00:00:00Z');
    if (chosen.every(c => Math.abs(c.t - t) >= separationDays * DAY)) chosen.push({ date: r[0], t, value: r[1], quality: r[3] });
    if (chosen.length >= count) break;
  }
  return chosen;
}

// Daily maxima around an event, aligned on days from the peak.
export function eventWindow(rows, peakDate, days = 15) {
  const t0 = Date.parse(peakDate + 'T00:00:00Z');
  const out = [];
  for (const r of rows) {
    const d = Math.round((Date.parse(r[0] + 'T00:00:00Z') - t0) / DAY);
    if (d >= -days && d <= days && Number.isFinite(r[1])) out.push([d, r[1]]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// Percentage of archived days with a daily max at or below `value`.
export function percentileRank(value, values) {
  const v = values.filter(Number.isFinite);
  if (!v.length || value == null) return null;
  return (v.filter(x => x <= value).length / v.length) * 100;
}

/* ---------- Rain ---------- */

// Sum 15-minute tipping-bucket totals into hourly bins. A bin is reported only
// when all four readings are present: missing data is never treated as zero.
export function hourlyRain(series) {
  const bins = new Map();
  for (const [t, v] of series) {
    if (!(v >= 0)) continue;
    const k = Math.floor((t - 1) / HOUR) * HOUR; // reading at :00 closes the previous hour
    const b = bins.get(k) || { n: 0, sum: 0 };
    b.n++; b.sum += v;
    bins.set(k, b);
  }
  return [...bins].filter(([, b]) => b.n === 4).map(([k, b]) => [k + HOUR, +b.sum.toFixed(2)]).sort((a, b) => a[0] - b[0]);
}

export function totalRain(series, hours, nowMs) {
  const end = nowMs ?? latest(series)?.[0];
  if (!end) return null;
  const rows = series.filter(p => p[0] > end - hours * HOUR && p[0] <= end && p[1] >= 0);
  const expected = hours * 4;
  return { mm: rows.reduce((a, p) => a + p[1], 0), count: rows.length, expected, complete: rows.length >= expected };
}

/* ---------- Simulation (explicitly hypothetical) ---------- */

// Straight-line what-if: level after `hours` at a constant, user-chosen rate.
// Used only by the clearly labelled scenario simulator; never a forecast.
export function simulateLinear(startLevel, rateCmPerHour, hours, stepMin = 15) {
  const out = [];
  for (let m = 0; m <= hours * 60; m += stepMin) out.push([m / 60, startLevel + (rateCmPerHour * m) / 6000]);
  return out;
}

export function hoursToReach(startLevel, target, rateCmPerHour) {
  if (!Number.isFinite(target) || !rateCmPerHour) return null;
  const h = ((target - startLevel) * 100) / rateCmPerHour;
  return h >= 0 ? h : null;
}

/* ---------- Formatting (UK local time) ---------- */

const fmtCache = new Map();
function formatter(opts) {
  const key = JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }));
  return fmtCache.get(key);
}
export const fmt = {
  time: t => formatter({ hour: '2-digit', minute: '2-digit' }).format(t),
  date: t => formatter({ day: 'numeric', month: 'short' }).format(t),
  dateYear: t => formatter({ day: 'numeric', month: 'short', year: 'numeric' }).format(t),
  dateTime: t => formatter({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(t),
  full: t => formatter({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(t),
  zone: t => formatter({ timeZoneName: 'short' }).formatToParts(t).find(p => p.type === 'timeZoneName')?.value || 'UK',
  age(min) {
    if (min == null || !Number.isFinite(min)) return '—';
    if (min < 1) return 'just now';
    if (min < 60) return `${Math.round(min)} min ago`;
    if (min < 48 * 60) return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min ago`;
    return `${Math.round(min / 1440)} days ago`;
  },
  signed(v, digits = 1, unit = '') {
    if (v == null || !Number.isFinite(v)) return '—';
    const s = Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v;
    return (s > 0 ? '+' : s < 0 ? '−' : '±') + Math.abs(s).toFixed(digits) + unit;
  },
  m: (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d) + ' m'),
};

// UK-local calendar date (YYYY-MM-DD) for an instant; used by date inputs.
export function ukDateInput(t) {
  const p = formatter({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t);
  const g = k => p.find(x => x.type === k).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// Start of a UK-local calendar day (handles GMT/BST) as epoch ms.
export function ukDayStart(dateStr) {
  const guess = Date.parse(dateStr + 'T00:00:00Z');
  for (const off of [0, -HOUR, HOUR]) {
    const t = guess + off;
    if (ukDateInput(t) === dateStr && ukDateInput(t - HOUR) !== dateStr) return t;
  }
  return guess;
}

// Mark a CSV of replayed (time-shifted) readings, so a detached file can never
// pass for current data: a source column and each reading's real time. Returns
// null for exports that are not time-shifted (e.g. the dated daily archive).
export function markDemoCSV(text, shiftMs) {
  const lines = text.split('\n');
  if (!/_utc$/.test(lines[0].split(',')[0])) return null;
  return lines.map((l, i) => {
    if (!l) return l;
    if (i === 0) return `${l},data_source,original_timestamp_utc`;
    const t = Date.parse(l.split(',')[0]);
    return `${l},DEMO replay - not current,${Number.isFinite(t) ? new Date(t - shiftMs).toISOString() : ''}`;
  }).join('\n');
}

export function toCSV(header, rows) {
  const esc = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [header.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}
