// Shared DOM helpers: theme tokens, chart mounting, counters, toasts, downloads.
/* global echarts */
import { esc } from './charts.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export { esc };

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ---------- Theme ---------- */

const TOKEN_NAMES = ['bg', 'surface', 'surface2', 'line', 'grid', 'text', 'muted', 'accent', 'accentSoft', 'water', 'rise', 'fall', 'alert', 'severe', 'ok', 'rain', 'sim'];

export function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue('--' + n.replace(/[A-Z]/g, m => '-' + m.toLowerCase())).trim();
  const T = Object.fromEntries(TOKEN_NAMES.map(n => [n, v(n)]));
  T.palette = v('palette').split(',').map(s => s.trim());
  T.sequential = v('sequential').split(',').map(s => s.trim());
  T.font = getComputedStyle(document.body).fontFamily;
  return T;
}

export function stationColor(T, index) {
  return T.palette[index % T.palette.length];
}

/* ---------- Charts ---------- */

const charts = new Set();
let resizeObserver;

// Mount an ECharts instance; returns a handle with `set(option)`.
export function mountChart(el, { onReady } = {}) {
  if (!window.echarts) {
    el.innerHTML = '<p class="empty">The charting library failed to load. Please refresh the page.</p>';
    return { set() {}, chart: null, dispose() {} };
  }
  const chart = echarts.init(el, null, { renderer: 'canvas' });
  el.classList.add('is-empty');
  charts.add(chart);
  resizeObserver ??= new ResizeObserver(entries => entries.forEach(e => echarts.getInstanceByDom(e.target)?.resize()));
  resizeObserver.observe(el);
  onReady?.(chart);
  return {
    chart,
    set(option, opts = { notMerge: true }) { el.classList.remove('is-empty'); chart.setOption(option, opts); },
    dispose() { resizeObserver.unobserve(el); charts.delete(chart); chart.dispose(); },
  };
}

export const resizeAll = () => charts.forEach(c => c.resize());

/* ---------- Animated numbers ---------- */

export function countTo(el, value, { digits = 2, prefix = '', suffix = '', signed = false, duration = 900 } = {}) {
  if (!el) return;
  const fmt = v => {
    const s = signed ? (v > 0.5 * 10 ** -digits ? '+' : v < -0.5 * 10 ** -digits ? '−' : '±') : v < 0 ? '−' : '';
    return prefix + s + Math.abs(v).toFixed(digits) + suffix;
  };
  if (value == null || !Number.isFinite(value)) { el.textContent = '—'; el.dataset.v = ''; return; }
  const from = Number(el.dataset.v);
  el.dataset.v = value;
  if (reducedMotion() || !Number.isFinite(from) || from === value) { el.textContent = fmt(value); return; }
  const start = performance.now();
  const step = now => {
    const k = Math.min(1, (now - start) / duration), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (value - from) * e);
    if (k < 1 && Number(el.dataset.v) === value) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- Feedback ---------- */

export function toast(message, kind = 'info') {
  let host = $('#toasts');
  const el = h(`<div class="toast toast-${kind}" role="status">${esc(message)}</div>`);
  host.append(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3700);
}

export function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast(`Downloaded ${name}`, 'ok');
}

export async function copyLink(url = location.href) {
  try {
    await navigator.clipboard.writeText(url);
    toast('Link to this view copied', 'ok');
  } catch {
    prompt('Copy this link:', url);
  }
}

// Full-screen a panel; falls back to a CSS overlay where the API is missing.
export function toggleFullscreen(el, after) {
  const done = () => setTimeout(() => { resizeAll(); after?.(); }, 120);
  if (document.fullscreenElement) { document.exitFullscreen().then(done); return; }
  if (el.classList.contains('is-max')) { el.classList.remove('is-max'); document.body.classList.remove('no-scroll'); done(); return; }
  if (el.requestFullscreen) el.requestFullscreen().then(done).catch(() => { el.classList.add('is-max'); document.body.classList.add('no-scroll'); done(); });
  else { el.classList.add('is-max'); document.body.classList.add('no-scroll'); done(); }
}

export function setBusy(el, busy) {
  if (!el) return;
  el.classList.toggle('is-loading', busy);
  el.setAttribute('aria-busy', String(busy));
}

export function errorBox(message, retry) {
  const el = h(`<div class="state state-error" role="alert"><strong>Data unavailable.</strong> <span>${esc(message)}</span> ${retry ? '<button class="btn btn-small" type="button">Try again</button>' : ''}</div>`);
  if (retry) el.querySelector('button').onclick = retry;
  return el;
}
