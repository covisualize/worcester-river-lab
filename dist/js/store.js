// Minimal observable state with URL synchronisation, so any view can be
// bookmarked or shared. Only user choices live in the URL — never data.
import { PRIMARY, STATIONS } from './config.js';

export const VIEWS = ['overview', 'map', 'analysis', 'explore', 'history'];
const VALID_IDS = new Set(STATIONS.map(s => s.id));
const RANGE_IDS = new Set(['24h', '7d', '30d', 'custom']);
const METRIC_IDS = new Set(['stage', 'change', 'range', 'aod', 'rate']);

export const defaults = () => ({
  view: 'overview',
  station: PRIMARY,          // focused station
  compare: [PRIMARY],        // stations plotted together (Explore / Analysis)
  range: '24h',
  from: null,                // custom range (YYYY-MM-DD, UK dates)
  to: null,
  metric: 'stage',
  notes: [],                 // user annotation timestamps (epoch ms)
  intel: false,              // flood information panel open
});

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

export function decode(search) {
  const p = new URLSearchParams(search);
  const s = defaults();
  if (VIEWS.includes(p.get('view'))) s.view = p.get('view');
  if (VALID_IDS.has(p.get('station'))) s.station = p.get('station');
  const cmp = (p.get('compare') || '').split(',').filter(id => VALID_IDS.has(id));
  if (cmp.length) s.compare = [...new Set(cmp)].slice(0, 7);
  if (RANGE_IDS.has(p.get('range'))) s.range = p.get('range');
  if (isDate(p.get('from')) && isDate(p.get('to')) && p.get('from') <= p.get('to')) { s.from = p.get('from'); s.to = p.get('to'); }
  else if (s.range === 'custom') s.range = '7d';
  if (METRIC_IDS.has(p.get('metric'))) s.metric = p.get('metric');
  s.notes = (p.get('notes') || '').split(',').map(Number).filter(n => Number.isFinite(n) && n > 0).slice(0, 20);
  s.intel = p.get('intel') === '1';
  return s;
}

// Only the choices that the current view actually uses go into the URL, so a
// shared link never carries stale state from another tab.
const VIEW_PARAMS = {
  overview: ['range'],
  map: ['station'],
  analysis: ['station', 'compare', 'range', 'metric'],
  explore: ['station', 'compare', 'range', 'metric', 'notes'],
  history: ['station'],
};

export function encode(s) {
  const d = defaults();
  const keep = new Set(VIEW_PARAMS[s.view] || []);
  const p = new URLSearchParams();
  if (s.view !== d.view) p.set('view', s.view);
  if (keep.has('station') && s.station !== d.station) p.set('station', s.station);
  if (keep.has('compare') && s.compare.join(',') !== d.compare.join(',')) p.set('compare', s.compare.join(','));
  if (keep.has('range') && s.range !== d.range) p.set('range', s.range);
  if (keep.has('range') && s.range === 'custom' && s.from && s.to) { p.set('from', s.from); p.set('to', s.to); }
  if (keep.has('metric') && s.metric !== d.metric) p.set('metric', s.metric);
  if (keep.has('notes') && s.notes.length) p.set('notes', s.notes.join(','));
  if (s.intel) p.set('intel', '1');
  const q = p.toString();
  return q ? '?' + q : '';
}

export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch, { push = false } = {}) {
      const prev = state;
      state = { ...state, ...patch };
      if (typeof history !== 'undefined' && typeof location !== 'undefined') {
        const url = location.pathname + encode(state) + location.hash;
        if (url !== location.pathname + location.search + location.hash) history[push ? 'pushState' : 'replaceState'](null, '', url);
      }
      subs.forEach(fn => fn(state, prev));
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
