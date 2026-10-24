// Network layer for Environment Agency APIs. Handles timeouts, retries,
// in-flight de-duplication, short-lived caching and incremental refreshes.
// No UI code here: callers receive normalised data or a thrown Error.
import { EA, HYDRO, HOME, RULES, STATIONS } from './config.js';
import { cleanReadings, parseTime, time } from './data.js';

const responseCache = new Map(); // url -> { at, data }
const inflight = new Map();      // url -> Promise
export const netLog = { requests: 0, failures: 0, lastError: null, lastSuccess: null };

export async function getJSON(url, { ttl = 60_000, timeout = 20_000, retries = 1 } = {}) {
  const hit = responseCache.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    let err;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        netLog.requests++;
        const r = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).hostname}`);
        const data = await r.json();
        responseCache.set(url, { at: Date.now(), data });
        netLog.lastSuccess = Date.now();
        return data;
      } catch (e) {
        err = e;
        if (attempt < retries) await new Promise(res => setTimeout(res, 600 * (attempt + 1)));
      }
    }
    netLog.failures++;
    netLog.lastError = { at: Date.now(), message: describeError(err) };
    throw new Error(describeError(err));
  })();
  inflight.set(url, p);
  try { return await p; } finally { inflight.delete(url); }
}

// Plain-English reasons; raw browser errors ("Failed to fetch") mean nothing
// to residents. A blocked or failed network request surfaces as a TypeError.
export function describeError(e, online = typeof navigator === 'undefined' || navigator.onLine) {
  if (!online) return 'You appear to be offline';
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'The Environment Agency service took too long to respond';
  if (e?.name === 'TypeError') return 'The Environment Agency service could not be reached';
  const http = /^HTTP (\d{3})/.exec(e?.message || '');
  if (http) return http[1] >= 500 ? `The Environment Agency service is having problems (error ${http[1]})` : `The Environment Agency service refused the request (error ${http[1]})`;
  return e?.message || 'Request failed';
}

const https = u => String(u).replace(/^http:\/\//, 'https://');
const asArray = v => (Array.isArray(v) ? v : v ? [v] : []);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/* ---------- Stations ---------- */

export function normaliseStation(item, fallback = {}) {
  const ss = item?.stageScale && typeof item.stageScale === 'object' ? item.stageScale : null;
  const measures = asArray(item?.measures);
  // Prefer the stage level in metres above station datum, 15-minute.
  const level = measures.find(m => /level-stage-i-15_min-mASD$/.test(m.notation || m['@id'] || ''))
    || measures.find(m => m.parameter === 'level');
  const latest = level && typeof level.latestReading === 'object' ? level.latestReading : null;
  return {
    id: item?.stationReference || item?.notation || fallback.id,
    label: item?.label || fallback.label,
    river: item?.riverName || fallback.river,
    town: item?.town || null,
    catchment: item?.catchmentName || null,
    lat: num(item?.lat) ?? fallback.lat,
    lng: num(item?.long) ?? fallback.lng,
    dateOpened: item?.dateOpened || null,
    rloi: item?.RLOIid || null,
    role: fallback.role,
    hydrology: fallback.hydrology,
    levelMeasure: level ? String(level.notation || level['@id']).split('/').pop() : null,
    unit: level?.unitName || 'mASD',
    latest: latest && num(latest.value) != null ? [parseTime(latest.dateTime), latest.value] : null,
    scale: ss ? {
      low: num(ss.typicalRangeLow), high: num(ss.typicalRangeHigh), scaleMax: num(ss.scaleMax), datum: num(ss.datum),
      highestRecent: ss.highestRecent ? { value: num(ss.highestRecent.value), t: parseTime(ss.highestRecent.dateTime) } : null,
      maxOnRecord: ss.maxOnRecord ? { value: num(ss.maxOnRecord.value), t: parseTime(ss.maxOnRecord.dateTime) } : null,
      minOnRecord: ss.minOnRecord ? { value: num(ss.minOnRecord.value), t: parseTime(ss.minOnRecord.dateTime) } : null,
    } : null,
    source: `${EA}/id/stations/${fallback.id || item?.stationReference}`,
    publicPage: item?.RLOIid ? `https://check-for-flooding.service.gov.uk/station/${item.RLOIid}` : null,
  };
}

export async function getStation(cfg) {
  const d = await getJSON(`${EA}/id/stations/${cfg.id}.json`, { ttl: 10 * time.MIN });
  return normaliseStation(d.items, cfg);
}

export async function getStations() {
  const settled = await Promise.allSettled(STATIONS.map(getStation));
  return STATIONS.map((cfg, i) => (settled[i].status === 'fulfilled' ? settled[i].value : { ...normaliseStation(null, cfg), error: settled[i].reason?.message }));
}

/* ---------- Readings (real-time API, ~4 weeks retained) ---------- */

const seriesCache = new Map(); // measure -> { since, fetchedAt, data }
const LIVE_WINDOW_DAYS = 28;
export const liveWindowStart = (now = Date.now()) => now - LIVE_WINDOW_DAYS * time.DAY;

const iso = t => new Date(Math.floor(t / (15 * time.MIN)) * 15 * time.MIN).toISOString().replace('.000Z', 'Z');

async function fetchMeasure(measure, since) {
  const d = await getJSON(`${EA}/id/measures/${measure}/readings?_sorted&_limit=10000&since=${iso(since)}`, { ttl: 60_000 });
  return cleanReadings(d.items);
}

function merge(a, b) {
  const m = new Map(a);
  for (const [t, v] of b) m.set(t, v);
  return [...m].sort((x, y) => x[0] - y[0]);
}

// Readings since `since` for a measure. Re-uses a wider cached window and,
// when the cache is older than `maxAge`, only fetches the most recent hours.
export async function getReadings(measure, since, { maxAge = RULES.refreshMs - 10_000 } = {}) {
  if (!measure) throw new Error('No level measure published for this station');
  const c = seriesCache.get(measure);
  if (c && c.since <= since) {
    if (Date.now() - c.fetchedAt > maxAge) {
      const lastT = c.data.length ? c.data[c.data.length - 1][0] : since;
      const fresh = await fetchMeasure(measure, Math.max(since, lastT - 3 * time.HOUR));
      c.data = merge(c.data, fresh);
      c.fetchedAt = Date.now();
    }
    return c.data.filter(p => p[0] >= since);
  }
  const data = await fetchMeasure(measure, since);
  const merged = c ? merge(data, c.data) : data;
  seriesCache.set(measure, { since: Math.min(since, c?.since ?? since), fetchedAt: Date.now(), data: merged });
  return merged.filter(p => p[0] >= since);
}

/* ---------- Archive (EA Hydrology, quality-flagged) ---------- */

const ymd = t => new Date(t).toISOString().slice(0, 10);

export async function getArchive15(hydrologyId, from, to) {
  if (!hydrologyId) throw new Error('No archive series for this station');
  const url = `${HYDRO}/id/measures/${hydrologyId}-level-i-900-m-qualified/readings?mineq-date=${ymd(from)}&maxeq-date=${ymd(to)}&_limit=20000`;
  const d = await getJSON(url, { ttl: 60 * time.MIN, timeout: 40_000 });
  return cleanReadings(d.items).filter(p => p[0] >= from && p[0] <= to);
}

// Any date range: live API for the last four weeks, Hydrology archive before.
export async function getRange(station, from, to) {
  const liveStart = liveWindowStart();
  const parts = [];
  const sources = [];
  if (from < liveStart) {
    parts.push(getArchive15(station.hydrology, from, Math.min(to, liveStart)).then(d => (sources.push('EA Hydrology archive'), d)));
  }
  if (to > liveStart) {
    parts.push(getReadings(station.levelMeasure, Math.max(from, liveStart)).then(d => (sources.push('EA real-time API'), d.filter(p => p[0] <= to))));
  }
  const data = (await Promise.all(parts)).reduce(merge, []);
  return { data, sources };
}

/* ---------- Rainfall ---------- */

export async function getRain(gaugeId, since) {
  const measure = `${gaugeId}-rainfall-tipping_bucket_raingauge-t-15_min-mm`;
  return getReadings(measure, since);
}

/* ---------- Flood warnings & areas ---------- */

export async function getFloods() {
  const d = await getJSON(`${EA}/id/floods?lat=${HOME.lat}&long=${HOME.lng}&dist=${RULES.warningRadiusKm}`, { ttl: 60_000 });
  return {
    fetchedAt: Date.now(),
    items: asArray(d.items).map(f => ({
      id: f.floodAreaID,
      area: f.description || f.floodArea?.label || f.floodAreaID,
      county: f.floodArea?.county || null,
      river: f.floodArea?.riverOrSea || null,
      severityLevel: Number(f.severityLevel),
      severity: f.severity,
      message: f.message || '',
      raised: parseTime(f.timeRaised),
      changed: parseTime(f.timeMessageChanged || f.timeSeverityChanged),
      polygon: f.floodArea?.polygon ? https(f.floodArea.polygon) : `${EA}/id/floodAreas/${f.floodAreaID}/polygon`,
      tidal: !!f.isTidal,
    })).sort((a, b) => a.severityLevel - b.severityLevel),
  };
}

export async function getFloodAreas() {
  const d = await getJSON(`${EA}/id/floodAreas?lat=${HOME.lat}&long=${HOME.lng}&dist=${RULES.floodAreaRadiusKm}&_limit=200`, { ttl: 60 * time.MIN });
  return asArray(d.items).map(a => ({
    id: a.notation, label: a.label || a.description, river: a.riverOrSea || null,
    lat: a.lat, lng: a.long, polygon: https(a.polygon),
    // EA codes: "FWF" = Flood Warning area; "WAF"/"WAB"/etc = Flood Alert area.
    type: /FWF/.test(a.notation) ? 'warning' : 'alert',
  }));
}

export const getPolygon = url => getJSON(https(url), { ttl: 24 * 60 * time.MIN, timeout: 40_000 });

/* ---------- Static research files (shipped with the site) ---------- */

const staticCache = new Map();
export function getStatic(path) {
  if (!staticCache.has(path)) {
    staticCache.set(path, fetch(path).then(r => { if (!r.ok) throw new Error(`${path} unavailable`); return r.json(); })
      .catch(e => { staticCache.delete(path); throw e; }));
  }
  return staticCache.get(path);
}

// Offline fallback: the weekly all-gauge snapshot (research/build_snapshot.py),
// else the original milestone snapshots, which cover Diglis and Bewdley only.
export async function getSnapshotFallback() {
  try {
    const f = await getStatic('data/fallback-snapshot.json');
    const out = { capturedAt: parseTime(f.retrievedAt), series: {}, stations: {}, rain1773: f.rain1773 || [] };
    for (const cfg of STATIONS) {
      if (f.stations?.[cfg.id]) out.stations[cfg.id] = normaliseStation(f.stations[cfg.id], cfg);
      if (f.series?.[cfg.id]?.length) out.series[cfg.id] = f.series[cfg.id];
    }
    if (Object.keys(out.series).length) return out;
  } catch { /* fall through to the milestone files */ }
  const [snap, hist] = await Promise.allSettled([getStatic('snapshot.json'), getStatic('history.json')]);
  const out = { capturedAt: null, series: {}, stations: {} };
  if (snap.status === 'fulfilled') {
    const s = snap.value;
    out.capturedAt = parseTime(s.retrievedAt);
    out.stations['2085'] = normaliseStation(s.station, STATIONS.find(x => x.id === '2085'));
    out.series['2085'] = cleanReadings(s.readings);
  }
  if (hist.status === 'fulfilled') {
    const h = hist.value;
    out.capturedAt = out.capturedAt || parseTime(h.retrievedAt);
    const d = cleanReadings(h.series?.diglis?.readings);
    if (d.length > (out.series['2085']?.length || 0)) out.series['2085'] = d;
    out.series['2001'] = cleanReadings(h.series?.bewdley?.readings);
    out.rain1773 = cleanReadings(h.series?.rain?.readings);
  }
  return out;
}
