// Live data service: owns station metadata, recent readings and warnings,
// schedules polite refreshes and degrades to the saved snapshot when offline.
import { EA, RULES, STATIONS, PRIMARY, RAIN_GAUGES } from './config.js';
import * as api from './api.js';
import { time, latest } from './data.js';

// Demo replays: real archived readings shifted to "now", with illustrative
// warnings. Every view labels them; they are never presented as current.
const EA_POLYGON = `${EA}/id/floodAreas`;
const DEMO_WARNINGS = [
  { id: '031FWFSE440', area: 'DEMO · River Severn at Hylton Road, Worcester (illustrative, not a real warning)', severityLevel: 2, severity: 'Flood warning' },
  { id: '031WAF108', area: 'DEMO · River Severn in Worcestershire (illustrative, not a real alert)', severityLevel: 3, severity: 'Flood alert' },
];

export function createLive({ demo = null } = {}) {
  const target = new EventTarget();
  let timer = null;
  let retryTimer = null; // the 60 s retry after a failed reading history
  let refreshing = null;

  const live = {
    stations: STATIONS.map(s => api.normaliseStation(null, s)),
    byId: {},
    series: {},        // id -> last ~25 h of readings
    floods: null,      // { fetchedAt, items }
    floodsError: null,
    localAreas: null,  // Set of EA flood-area ids near Worcester, once fetched
    status: { mode: 'loading', updatedAt: null, error: null, snapshotAt: null },

    on(type, fn) { target.addEventListener(type, e => fn(e.detail)); },
    emit(type, detail) { target.dispatchEvent(new CustomEvent(type, { detail })); },

    station(id) { return live.byId[id] || live.stations.find(s => s.id === id); },
    primary() { return live.station(PRIMARY); },
    latestOf(id) { return latest(live.series[id] || []) || live.station(id)?.latest || null; },

    async refresh({ manual = false } = {}) {
      if (refreshing) return refreshing;
      if (demo) {
        if (!live.status.demo) await live.useDemo(demo);
        live.emit('status', live.status);
        live.emit('update', { manual });
        return;
      }
      live.status = { ...live.status, mode: live.status.updatedAt ? live.status.mode : 'loading', refreshing: true };
      live.emit('status', live.status);
      refreshing = (async () => {
        const since = Date.now() - 25 * time.HOUR;
        // The local flood-area list only refines warnings, so it never holds up
        // readings: until it arrives every warning counts as local.
        api.getFloodAreas().then(areas => {
          if (!areas.length) return;
          const had = live.localAreas;
          live.localAreas = new Set(areas.map(a => a.id));
          // Redraw once the list lands, also during the early draw (before 'live'), so a warning
          // that was counted as local while it was unknown is corrected straight away.
          if (!had && (live.status.mode === 'live' || live.status.metadata)) live.emit('update', { areas: true });
        }, () => {});
        // Show Diglis the moment its own data arrives, not once all seven gauges and the
        // warnings have answered; the warnings join as soon as they arrive. Its reading
        // history starts loading now too (the later request shares this in-flight fetch).
        const drawEarly = () => {
          if (live.status.updatedAt || !live.stations.some(s => s.latest)) return;
          live.status = { ...live.status, metadata: true };
          live.emit('status', live.status);
          live.emit('update', { partial: true, metadata: true });
        };
        const onEach = s => {
          if (s.id !== PRIMARY || live.status.updatedAt) return;
          live.byId[s.id] = s;
          live.stations = live.stations.map(x => (x.id === s.id ? s : x));
          if (s.levelMeasure) api.getReadings(s.levelMeasure, since).catch(() => {});
          drawEarly();
        };
        const floodsP = api.getFloods().then(f => { live.floods = f; live.floodsError = null; drawEarly(); return f; });
        const [stations, floods] = await Promise.allSettled([api.getStations({ onEach }), floodsP]);
        // A gauge whose details failed to refresh keeps its last known details (latest reading,
        // typical range): they carry their own timestamps, so the freshness labels stay honest.
        const gotMeta = stations.status === 'fulfilled' && stations.value.some(s => !s.error);
        if (stations.status === 'fulfilled') {
          live.stations = stations.value.map(s => (s.error && live.byId[s.id]?.latest ? live.byId[s.id] : s));
          live.byId = Object.fromEntries(live.stations.map(s => [s.id, s]));
        }
        if (floods.status === 'fulfilled') { live.floods = floods.value; live.floodsError = null; }
        else live.floodsError = floods.reason?.message || 'Warnings unavailable';

        // The gauges' own latest readings and the warnings are enough for an honest picture;
        // draw (again) now instead of waiting for the slow reading history.
        drawEarly();

        const pending = live.stations.map(s => api.getReadings(s.levelMeasure, since));
        // First load: show the primary gauge as soon as it arrives rather than
        // waiting for the slowest station.
        const pi = live.stations.findIndex(s => s.id === PRIMARY);
        if (!live.status.updatedAt && pi >= 0) {
          pending[pi].then(d => {
            if (live.status.updatedAt || !d.length) return;
            live.series[PRIMARY] = d;
            live.status = { mode: 'live', updatedAt: Date.now(), error: null, refreshing: true };
            live.emit('status', live.status);
            live.emit('update', { partial: true });
          }, () => {});
        }
        const results = await Promise.allSettled(pending);
        let ok = 0;
        results.forEach((r, i) => {
          const id = live.stations[i].id;
          if (r.status === 'fulfilled' && r.value.length) { live.series[id] = r.value; ok++; }
          else if (r.status === 'rejected') live.stations[i].error = r.reason?.message;
        });

        if (ok) {
          live.status = { mode: 'live', updatedAt: Date.now(), error: ok < live.stations.length ? `${live.stations.length - ok} station(s) did not respond` : null, refreshing: false };
        } else if (live.stations.some(s => s.latest) && (!live.status.updatedAt || (live.status.partial && gotMeta))) {
          // The history failed but the gauges' latest values are live: keep them rather than
          // swap to an older snapshot, say so, and retry soon. A retry that fails the same way
          // stays here (only while this refresh's gauge details did arrive: `gotMeta`), so the
          // notice and the retries continue instead of turning into "could not refresh".
          live.status = { mode: 'live', updatedAt: Date.now(), error: api.netLog.lastError?.message || 'Reading history unavailable', refreshing: false, partial: true };
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => { if (live.status.partial) live.refresh(); }, 60_000);
        } else if (live.status.updatedAt) {
          live.status = { ...live.status, mode: 'stale', error: api.netLog.lastError?.message || 'Update failed', refreshing: false };
        } else {
          await live.useSnapshot();
        }
        live.emit('status', live.status);
        live.emit('update', { manual });
      })().finally(() => { refreshing = null; });
      return refreshing;
    },

    async useSnapshot() {
      try {
        const snap = await api.getSnapshotFallback();
        // Neither shipped snapshot could be read: that is an error, not an empty "saved snapshot".
        if (!Object.values(snap.series).some(s => s.length)) throw new Error('No saved snapshot available');
        for (const [id, s] of Object.entries(snap.stations)) { live.byId[id] = s; live.stations = live.stations.map(x => (x.id === id ? s : x)); }
        for (const [id, d] of Object.entries(snap.series)) if (d.length) live.series[id] = d;
        live.status = { mode: 'snapshot', updatedAt: null, snapshotAt: snap.capturedAt, error: api.netLog.lastError?.message || 'Live service unavailable', refreshing: false };
      } catch {
        live.status = { mode: 'error', updatedAt: null, error: api.netLog.lastError?.message || 'Live service and saved snapshot unavailable', refreshing: false };
      }
    },

    async useDemo(id) {
      try {
        const d = await api.getStatic(`data/demo-${id}.json`);
        // Bundled EA station metadata, so the replay works without the live service.
        live.stations = STATIONS.map(cfg => api.normaliseStation(d.stations?.[cfg.id] || null, cfg));
        // Whole quarter-hours, so replayed readings keep the EA's 15-minute grid.
        const shift = Math.floor((Date.now() - d.now) / (15 * time.MIN)) * 15 * time.MIN;
        live.series = Object.fromEntries(Object.entries(d.series).map(([sid, rows]) => [sid, rows.map(([t, v]) => [t + shift, v])]));
        live.stations = live.stations.map(s => ({ ...s, latest: latest(live.series[s.id] || []) }));
        live.byId = Object.fromEntries(live.stations.map(s => [s.id, s]));
        const raised = d.now + shift - 6 * time.HOUR;
        live.floods = { fetchedAt: Date.now(), items: DEMO_WARNINGS.map(w => ({ ...w, county: 'Worcestershire', river: 'River Severn', message: 'Demo replay: illustrative warning text. Check GOV.UK for real warnings.', raised, changed: raised, polygon: `${EA_POLYGON}/${w.id}/polygon`, tidal: false, demo: true })) };
        live.floodsError = null;
        live.status = { mode: 'demo', updatedAt: Date.now(), error: null, refreshing: false, demo: { id, label: d.label, source: d.source, start: d.start, now: d.now, shift } };
      } catch (e) {
        live.status = { mode: 'error', updatedAt: null, error: `Demo data unavailable (${e.message})`, refreshing: false };
      }
    },

    // Readings for a station over an arbitrary window (cached by the API layer).
    async window(id, from, to = Date.now()) {
      const s = live.station(id);
      if (live.status.mode === 'snapshot') return { data: (live.series[id] || []).filter(p => p[0] >= from && p[0] <= to), sources: ['Saved snapshot'] };
      if (live.status.mode === 'demo') return { data: (live.series[id] || []).filter(p => p[0] >= from && p[0] <= to), sources: ['Demo replay (EA archive, Feb 2020)'] };
      if (from >= api.liveWindowStart()) return { data: (await api.getReadings(s.levelMeasure, from)).filter(p => p[0] <= to), sources: ['EA real-time API'] };
      return api.getRange(s, from, to);
    },

    async rain(gaugeId, from) {
      if (live.status.mode === 'demo') return [];
      if (live.status.mode === 'snapshot') {
        const snap = await api.getSnapshotFallback();
        return gaugeId === '1773' ? (snap.rain1773 || []).filter(p => p[0] >= from) : [];
      }
      return api.getRain(gaugeId, from);
    },

    rainGauges: RAIN_GAUGES,

    start() {
      const tick = () => { if (!document.hidden) live.refresh(); };
      timer = setInterval(tick, RULES.refreshMs);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && live.status.updatedAt && Date.now() - live.status.updatedAt > RULES.refreshMs) live.refresh();
      });
      addEventListener('online', () => live.refresh());
      addEventListener('offline', () => { live.status = { ...live.status, offline: true }; live.emit('status', live.status); });
      return live.refresh();
    },
    stop() { clearInterval(timer); clearTimeout(retryTimer); },
  };
  return live;
}
