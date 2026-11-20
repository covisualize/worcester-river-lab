// Reusable accessible UI for managing and displaying personal watermarks.
import { $$, esc, toast } from './ui.js';
import { MAX_MARKS_PER_STATION, MAX_LABEL_LEN, MIN_LEVEL, MAX_LEVEL, describeDistance } from './marks.js';

export function renderMarksManager(el, {
  prefix, stationId, stationLabel, latest, isDemo = false, marksStore, compact = false,
}) {
  if (!el || !marksStore) return;
  const list = marksStore.list(stationId);
  const full = list.length >= MAX_MARKS_PER_STATION;
  const liveVal = !isDemo && latest && Number.isFinite(latest[1]) ? latest[1] : null;
  const lblId = `${prefix}-lbl`;
  const valId = `${prefix}-val`;
  const errId = `${prefix}-err`;

  const itemsHtml = list.length ? `<ul class="marks-list">${list.map(m => {
    const dist = describeDistance(latest?.[1], m.value);
    const pill = dist ? `<span class="mark-dist" data-k="${dist.status}">${esc(dist.text)}</span>` : '';
    return `<li class="mark-item">
      <span class="mark-main"><i class="mark-dot" aria-hidden="true"></i><span class="mark-name">${esc(m.label)}</span><span class="mark-val mono">${m.value.toFixed(2)} m</span>${pill}</span>
      <button type="button" class="mark-del" data-del="${esc(m.id)}" aria-label="Remove personal mark ${esc(m.label)}">×</button>
    </li>`;
  }).join('')}</ul>` : `<p class="marks-empty">No personal marks saved for ${esc(stationLabel)} yet.</p>`;

  const formHtml = full
    ? `<p class="note">Maximum ${MAX_MARKS_PER_STATION} marks saved for ${esc(stationLabel)}. Remove one to add another.</p>`
    : `<form class="marks-form${compact ? ' is-compact' : ''}" novalidate>
        <div class="marks-fields">
          <label for="${lblId}"><span>Label</span><input id="${lblId}" name="label" type="text" maxlength="${MAX_LABEL_LEN}" placeholder="e.g. Towpath, slipway, steps" autocomplete="off" required></label>
          <label for="${valId}"><span>Height (m)</span><input id="${valId}" name="value" type="number" step="0.01" min="${MIN_LEVEL}" max="${MAX_LEVEL}" placeholder="e.g. 2.10" inputmode="decimal" required></label>
        </div>
        <div class="marks-form-actions">
          ${liveVal != null ? `<button type="button" class="btn btn-ghost btn-small" data-use-current="${liveVal.toFixed(2)}">Use current (${liveVal.toFixed(2)} m)</button>` : ''}
          <button type="submit" class="btn btn-small">Add mark</button>
        </div>
        <p class="marks-err" id="${errId}" role="alert" hidden></p>
      </form>`;

  el.innerHTML = `
    <div class="marks-mgr${compact ? ' is-compact' : ''}">
      <div class="marks-head">
        <strong>Your marks · ${esc(stationLabel)}</strong>
        <span class="marks-count mono">${list.length}/${MAX_MARKS_PER_STATION}</span>
      </div>
      <p class="note marks-caveat">Saved only in this browser (never shared in links) for ${esc(stationLabel)}’s own gauge datum — <b>not</b> official flood thresholds.${!marksStore.storageAvailable() ? ' Browser storage is blocked, so marks will last for this session only.' : ''}</p>
      ${itemsHtml}
      ${formHtml}
    </div>`;

  $$('[data-del]', el).forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.del;
      const target = list.find(m => m.id === id);
      if (marksStore.remove(stationId, id)) toast(`Removed mark “${target?.label || ''}”`);
    };
  });

  const form = el.querySelector('.marks-form');
  if (!form) return;
  const labelInput = form.querySelector('input[name="label"]');
  const valueInput = form.querySelector('input[name="value"]');
  const errEl = form.querySelector('.marks-err');
  const useBtn = form.querySelector('[data-use-current]');
  if (useBtn) {
    useBtn.onclick = () => {
      valueInput.value = useBtn.dataset.useCurrent;
      errEl.hidden = true;
      (labelInput.value.trim() ? form.querySelector('button[type="submit"]') : labelInput).focus();
    };
  }
  form.onsubmit = e => {
    e.preventDefault();
    const res = marksStore.add(stationId, { label: labelInput.value, value: valueInput.value });
    if (!res.ok) {
      errEl.textContent = res.error;
      errEl.hidden = false;
      return;
    }
    errEl.hidden = true;
    toast(`Saved personal mark “${res.mark.label}” (${res.mark.value.toFixed(2)} m)`, 'ok');
  };
}
