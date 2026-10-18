// Application bootstrap: state, routing, shared helpers and status UI.
import { $, $$, tokens, reducedMotion, toggleFullscreen, toast, resizeAll } from './ui.js';
import { createStore, decode, VIEWS } from './store.js';
import { createLive } from './live.js';
import { STATIONS, RANGES } from './config.js';
import { transform, lttb, fmt, freshness, ukDayStart, ukDateInput, time } from './data.js';
import { createOverview } from './views/overview.js';
import { createMapView } from './views/map.js';
import { createAnalysis } from './views/analysis.js';
import { createExplore } from './views/explore.js';
import { createHistory } from './views/history.js';
import { createIntel } from './views/intel.js';

const store = createStore(decode(location.search));
const live = createLive();
const rangeGroups = [];
const COLOR_ORDER = ['2085', ...STATIONS.map(s => s.id).filter(id => id !== '2085')];

const ctx = {
  store, live,
  T: null,
  animate: !reducedMotion(),
  theme: () => document.documentElement.dataset.theme || 'dark',
  // Primary gauge gets the signature colour; others follow river order.
  colorOf: id => ctx.T.palette[Math.max(0, COLOR_ORDER.indexOf(id)) % ctx.T.palette.length],

  // Long series are downsampled (LTTB keeps peaks and troughs) before charting.
  transformFor(raw, metric, station) {
    const d = transform(raw, metric, station?.scale);
    return d.length > 5000 ? lttb(d, 4000) : d;
  },

  resolveRange(s) {
    if (s.range === 'custom' && s.from && s.to) {
      const from = ukDayStart(s.from), to = Math.min(ukDayStart(s.to) + time.DAY, Date.now());
      return { from, to, label: `${fmt.dateYear(from)} – ${fmt.dateYear(to - 1)}` };
    }
    const r = RANGES.find(x => x.id === s.range) || RANGES[0];
    const to = Date.now();
    return { from: to - r.hours * time.HOUR, to, label: `Last ${r.label}` };
  },

  // Segmented range control; several views share the store's range.
  rangeButtons(el, get, onPick, withCustom) {
    const opts = [...RANGES, ...(withCustom ? [{ id: 'custom', label: 'Custom' }] : [])];
    el.innerHTML = opts.map(o => `<button type="button" data-range="${o.id}">${o.id === 'custom' ? 'Custom…' : o.label.replace(' hours', ' h').replace(' days', ' days')}</button>`).join('');
    $$('button', el).forEach(b => (b.onclick = () => onPick(b.dataset.range)));
    rangeGroups.push({ el, get });
    ctx.syncRangeButtons();
  },
  syncRangeButtons() {
    for (const g of rangeGroups) $$('button', g.el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.range === g.get())));
    const form = $('#tl-custom');
    if (form) form.hidden = store.get().range !== 'custom';
  },
  bindCustomForm(form) {
    const s = store.get();
    const { from, to } = ctx.resolveRange(s);
    form.from.value = s.from || ukDateInput(from);
    form.to.value = s.to || ukDateInput(to);
    form.from.max = form.to.max = ukDateInput(Date.now());
    form.from.min = form.to.min = '2000-01-01';
    form.onsubmit = e => {
      e.preventDefault();
      let a = form.from.value, b = form.to.value;
      if (!a || !b) return;
      if (a > b) [a, b] = [b, a];
      const days = (Date.parse(b) - Date.parse(a)) / time.DAY;
      if (days > 62) { b = ukDateInput(Date.parse(a) + 62 * time.DAY); toast('Custom ranges are limited to 62 days — the end date was adjusted', 'error'); }
      store.set({ range: 'custom', from: a, to: b });
    };
  },

  go(view, patch = {}, anchor) {
    store.set({ ...patch, view }, { push: true });
    if (anchor) setTimeout(() => $(anchor)?.scrollIntoView({ behavior: ctx.animate ? 'smooth' : 'auto', block: 'start' }), 350);
    else scrollTo({ top: 0, behavior: 'auto' });
  },
  openIntel(section) {
    if (store.get().intel) intel.open(section);
    else { pendingSection = section; store.set({ intel: true }); }
  },
};
ctx.T = tokens();

const views = {
  overview: createOverview(ctx),
  map: createMapView(ctx),
  analysis: createAnalysis(ctx),
  explore: createExplore(ctx),
  history: createHistory(ctx),
};
const intel = createIntel(ctx);
const mounted = new Set();
const rendered = new Set();
let dataReady = false;
let pendingSection = null;

function refreshView(v) {
  if (!rendered.has(v)) { views[v].render(); rendered.add(v); }
  else views[v].onData?.();
}

function show(view) {
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  $$('[data-nav]').forEach(b => (b.dataset.nav === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  document.title = `${{ overview: 'Live overview', map: 'River map', analysis: 'Analysis', explore: 'Explore', history: 'History' }[view]} · Worcester River`;
  const v = views[view];
  if (!mounted.has(view)) { v.mount(); mounted.add(view); }
  if (dataReady) refreshView(view);
  for (const k of VIEWS) if (k !== view) views[k].hide?.();
  v.show?.();
  requestAnimationFrame(resizeAll);
}

store.subscribe((s, prev) => {
  if (s.view !== prev.view) show(s.view);
  else if (mounted.has(s.view)) views[s.view].onState?.(s, prev);
  if (s.intel !== prev.intel) { s.intel ? intel.open(pendingSection) : intel.close(); pendingSection = null; }
});

addEventListener('popstate', () => {
  const next = decode(location.search);
  const prev = store.get();
  store.set(next);
  if (next.view === prev.view && mounted.has(next.view)) views[next.view].onState?.(next, prev);
});

/* ---------- Status pill ---------- */

function drawStatus(st) {
  const pill = $('#live-status');
  const last = live.latestOf('2085');
  const fr = freshness(last?.[0]);
  let text, mode = st.mode;
  if (st.refreshing && !st.updatedAt) text = 'Connecting to EA…';
  else if (st.offline) { text = 'Offline'; mode = 'error'; }
  else if (st.mode === 'live') { text = `Live · ${fmt.time(st.updatedAt)}`; if (fr.key === 'stale') { mode = 'stale'; text = `Live · reading ${fmt.age(fr.ageMin)}`; } }
  else if (st.mode === 'stale') text = 'Update failed · cached';
  else if (st.mode === 'snapshot') text = 'Offline snapshot';
  else if (st.mode === 'error') text = 'Data unavailable';
  else text = 'Connecting…';
  pill.dataset.mode = mode;
  pill.querySelector('span').textContent = text;
  pill.title = [`Status: ${st.mode}`, st.updatedAt && `Last update ${fmt.full(st.updatedAt)}`, last && `Latest Diglis reading ${fmt.full(last[0])}`, st.error && `Note: ${st.error}`, 'Click for data confidence details'].filter(Boolean).join('\n');
  $('#refresh').classList.toggle('spinning', !!st.refreshing);
}

/* ---------- Wiring ---------- */

$$('[data-nav]').forEach(b => (b.onclick = () => ctx.go(b.dataset.nav)));
$('#refresh').onclick = async () => { await live.refresh({ manual: true }); toast(live.status.mode === 'live' ? 'Data refreshed from the Environment Agency' : 'Refresh failed — showing the last available data', live.status.mode === 'live' ? 'ok' : 'error'); };
$('#live-status').onclick = () => ctx.openIntel('confidence');
$('#theme').onclick = () => {
  const next = ctx.theme() === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('wr-theme', next); } catch { /* private mode */ }
  ctx.T = tokens();
  for (const v of mounted) views[v].onTheme?.();
  rendered.clear();
  if (dataReady) refreshView(store.get().view);
  intel.render();
  toast(`${next === 'light' ? 'Light' : 'Dark'} theme`);
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-full]');
  if (b) toggleFullscreen($(b.dataset.full));
});
// Keyboard shortcuts: 1–5 switch views, R refreshes, F opens flood intelligence.
document.addEventListener('keydown', e => {
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const i = Number(e.key);
  if (i >= 1 && i <= VIEWS.length) ctx.go(VIEWS[i - 1]);
  else if (e.key === 'r') $('#refresh').click();
  else if (e.key === 'f') ctx.openIntel();
});
matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', e => { ctx.animate = !e.matches; });

intel.mount();
live.on('status', st => { drawStatus(st); });
live.on('update', () => {
  dataReady = true;
  refreshView(store.get().view);
  intel.render();
});

const first = store.get();
show(first.view);
if (first.intel) intel.open();
live.start();

// Expose a tiny debug handle for the end-to-end smoke test.
window.__wr = { store, live, ctx };
