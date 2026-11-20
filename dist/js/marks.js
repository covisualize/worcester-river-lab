// Personal watermarks ("My reference levels"): strictly browser-local, per-station
// user notes in metres above station datum (mASD). Never shared in URLs, never
// pre-populated with guessed thresholds, and never presented as official.
import { STATIONS } from './config.js';

export const STORAGE_KEY = 'wr-marks';
export const MAX_MARKS_PER_STATION = 5;
export const MAX_LABEL_LEN = 40;
export const MIN_LEVEL = -5;
export const MAX_LEVEL = 25;

const VALID_STATIONS = new Set(STATIONS.map(s => s.id));

export const cleanLabel = raw => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LEN);

export function validateMark({ stationId, label, value, existingCount = 0 }) {
  if (!VALID_STATIONS.has(stationId)) return { ok: false, error: 'Unknown monitoring station.' };
  if (existingCount >= MAX_MARKS_PER_STATION) {
    return { ok: false, error: `Up to ${MAX_MARKS_PER_STATION} personal marks per gauge.` };
  }
  const name = cleanLabel(label);
  if (!name) return { ok: false, error: 'Enter a short label for your mark.' };
  const num = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(num)) return { ok: false, error: 'Enter a height in metres.' };
  if (num < MIN_LEVEL || num > MAX_LEVEL) {
    return { ok: false, error: `Height must be between ${MIN_LEVEL} m and ${MAX_LEVEL} m.` };
  }
  const rounded = Math.round(num * 1000) / 1000;
  return { ok: true, mark: { label: name, value: rounded } };
}

export function describeDistance(level, markValue) {
  if (!Number.isFinite(level) || !Number.isFinite(markValue)) return null;
  const diff = level - markValue;
  if (Math.abs(diff) < 0.005) return { status: 'at', diff, text: 'At mark' };
  if (diff > 0) return { status: 'above', diff, text: `${diff.toFixed(2)} m above` };
  return { status: 'below', diff, text: `${Math.abs(diff).toFixed(2)} m below` };
}

// Keep quiet-day charts readable: include marks that sit within or near the
// plotted series values, unless the user opts to zoom out and show all marks.
export function partitionForChart(marks, values, { showAll = false } = {}) {
  const list = Array.isArray(marks) ? marks : [];
  if (!list.length) return { visible: [], hidden: [] };
  if (showAll) return { visible: [...list], hidden: [] };
  const nums = (values || []).filter(Number.isFinite);
  if (!nums.length) return { visible: [], hidden: [...list] };
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const pad = Math.max((hi - lo) * 0.25, 0.2);
  const visible = [];
  const hidden = [];
  for (const m of list) {
    if (m.value >= lo - pad && m.value <= hi + pad) visible.push(m);
    else hidden.push(m);
  }
  return { visible, hidden };
}

export function toThresholds(marks, T) {
  const color = T?.mark || T?.sim || '#f48fb1';
  return (marks || []).map(m => ({
    value: m.value,
    label: `Your mark · ${m.label}`,
    color,
    lineType: 'dotted',
    width: 1.8,
    personal: true,
  }));
}

// Count archived days (from EA Hydrology daily maxima) on which the river
// reached or exceeded a personal mark.
export function countDaysExceeded(rows, markValue) {
  const total = Array.isArray(rows) ? rows.length : 0;
  if (!total || !Number.isFinite(markValue)) return { count: 0, total, pct: 0, lastDate: null };
  let count = 0;
  let lastDate = null;
  for (const r of rows) {
    if (Number.isFinite(r[1]) && r[1] >= markValue) {
      count++;
      if (!lastDate || r[0] > lastDate) lastDate = r[0];
    }
  }
  return { count, total, pct: (count / total) * 100, lastDate };
}

function defaultStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function sanitiseMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const src = raw.stations && typeof raw.stations === 'object' ? raw.stations : raw;
  for (const [sid, arr] of Object.entries(src)) {
    if (!VALID_STATIONS.has(sid) || !Array.isArray(arr)) continue;
    const clean = [];
    for (const item of arr) {
      if (clean.length >= MAX_MARKS_PER_STATION) break;
      const v = validateMark({ stationId: sid, label: item?.label, value: item?.value, existingCount: clean.length });
      if (!v.ok) continue;
      const id = typeof item?.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 40) : `m-${clean.length + 1}-${Math.round(v.mark.value * 1000)}`;
      clean.push({ id, ...v.mark });
    }
    if (clean.length) out[sid] = sortMarks(clean);
  }
  return out;
}

const sortMarks = list => [...list].sort((a, b) => a.value - b.value || a.label.localeCompare(b.label));

export function createMarksStore(storage = defaultStorage()) {
  let byStation = {};
  let canPersist = false;
  const subs = new Set();

  if (storage) {
    try {
      const saved = storage.getItem(STORAGE_KEY);
      if (saved) byStation = sanitiseMap(JSON.parse(saved));
      canPersist = true;
    } catch {
      byStation = {};
      canPersist = false;
    }
  }

  function persist() {
    if (!storage) return;
    try {
      if (Object.keys(byStation).length) storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, stations: byStation }));
      else storage.removeItem(STORAGE_KEY);
      canPersist = true;
    } catch {
      canPersist = false;
    }
  }

  function notify(stationId) {
    subs.forEach(fn => fn(stationId));
  }

  let seq = 0;
  function makeId() {
    seq++;
    return `mk-${Date.now().toString(36)}-${seq.toString(36)}`;
  }

  return {
    storageAvailable: () => canPersist,
    list(stationId) {
      return (byStation[stationId] || []).map(m => ({ ...m }));
    },
    all() {
      return Object.fromEntries(Object.entries(byStation).map(([k, v]) => [k, v.map(m => ({ ...m }))]));
    },
    add(stationId, { label, value }) {
      const cur = byStation[stationId] || [];
      const check = validateMark({ stationId, label, value, existingCount: cur.length });
      if (!check.ok) return check;
      const mark = { id: makeId(), ...check.mark };
      byStation[stationId] = sortMarks([...cur, mark]);
      persist();
      notify(stationId);
      return { ok: true, mark };
    },
    remove(stationId, id) {
      const cur = byStation[stationId];
      if (!cur) return false;
      const next = cur.filter(m => m.id !== id);
      if (next.length === cur.length) return false;
      if (next.length) byStation[stationId] = next;
      else delete byStation[stationId];
      persist();
      notify(stationId);
      return true;
    },
    clear(stationId) {
      if (stationId) {
        if (!byStation[stationId]) return;
        delete byStation[stationId];
      } else {
        byStation = {};
      }
      persist();
      notify(stationId || null);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
