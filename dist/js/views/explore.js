// Explore mode: choose stations, dates and measures; annotate, play back and share.
/* global L */
import { $, $$, esc, mountChart, download, copyLink, setBusy, errorBox, toast } from '../ui.js';
import { timeSeriesOption } from '../charts.js';
import { METRICS, breakGaps, notable, fmt, toCSV, stats, rangePosition, nearest, indexAtOrBefore, ukDateInput, time } from '../data.js';
import { STATIONS, HOME } from '../config.js';
import { basemap, gaugeIcon } from './map.js';

export function createExplore(ctx) {
  const { store, live } = ctx;
  let chart, map, base, markers = {}, current = null, reqId = 0, autoNotes = true, playing = null, playFrac = 1;

  function mount() {
    chart = mountChart($('#ex-chart'));
    // Stations
    $('#ex-stations').innerHTML = STATIONS.map(s => `<label data-id="${s.id}" style="--c:${ctx.colorOf(s.id)}"><input type="checkbox" value="${s.id}"><i></i><span>${esc(s.label)}<br><small style="margin:0">${esc(s.river)}</small></span><small data-val></small></label>`).join('');
    $$('#ex-stations input').forEach(cb => (cb.onchange = () => {
      const sel = $$('#ex-stations input:checked').map(x => x.value);
      if (!sel.length) { cb.checked = true; toast('Select at least one station'); return; }
      store.set({ compare: sel, station: sel.includes(store.get().station) ? store.get().station : sel[0] });
    }));
    $$('#ex-stations label').forEach(l => {
      l.addEventListener('mouseenter', () => highlight(l.dataset.id, true));
      l.addEventListener('mouseleave', () => highlight(l.dataset.id, false));
    });
    // Range & measure
    ctx.rangeButtons($('#ex-range'), () => store.get().range, range => {
      if (range === 'custom') { $('#ex-custom input[name=from]').focus(); return; }
      store.set({ range });
    }, true);
    ctx.bindCustomForm($('#ex-custom'));
    $('#ex-metric').innerHTML = Object.entries(METRICS).map(([k, m]) => `<button type="button" data-metric="${k}" title="${esc(m.label)}">${esc(m.short)} <small>(${esc(m.unit)})</small></button>`).join('');
    $$('#ex-metric button').forEach(b => (b.onclick = () => store.set({ metric: b.dataset.metric })));
    // Annotations
    $('#ex-auto').onchange = e => { autoNotes = e.target.checked; draw(false); };
    $('#ex-clear-notes').onclick = () => store.set({ notes: [] });
    chart.chart?.getZr().on('click', e => {
      if (!current || !chart.chart.containPixel('grid', [e.offsetX, e.offsetY])) return;
      const [t] = chart.chart.convertFromPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY]);
      const span = current.to - current.from;
      const notes = store.get().notes;
      const hit = notes.find(n => Math.abs(n - t) < span * 0.01);
      if (hit) { store.set({ notes: notes.filter(n => n !== hit) }); toast('Note removed'); }
      else if (notes.length >= 20) toast('Up to 20 notes per view', 'error');
      else { store.set({ notes: [...notes, Math.round(t / (15 * time.MIN)) * 15 * time.MIN].sort((a, b) => a - b) }); toast(`Note pinned at ${fmt.dateTime(t)}`, 'ok'); }
    });
    chart.chart?.on('mouseover', p => p.seriesId && highlight(p.seriesId, true, 'chart'));
    chart.chart?.on('mouseout', p => p.seriesId && highlight(p.seriesId, false, 'chart'));
    // Player
    $('#ex-play').onclick = () => (playing ? stop() : play());
    $('#ex-scrub').oninput = e => { stop(); applyPlayhead(Number(e.target.value) / 1000); };
    document.addEventListener('visibilitychange', () => document.hidden && stop());
    // Share & download
    $('#ex-share').onclick = () => copyLink();
    $('#ex-csv').onclick = () => current && download('explore-view.csv', toCSV(['timestamp_utc', 'uk_local_time', 'station_id', 'station', 'level_m_asd', METRICS[current.metric].label],
      current.series.flatMap(s => s.raw.map(([t, v]) => [new Date(t).toISOString(), fmt.full(t), s.id, s.name, v, s.metricAt(t) ?? '']))));
    // Linked map
    map = L.map('ex-map', { zoomControl: true, scrollWheelZoom: false, attributionControl: true }).setView([HOME.lat, HOME.lng], 10);
    base = basemap(ctx.theme()).addTo(map);
  }

  function syncControls() {
    const s = store.get();
    $$('#ex-stations input').forEach(cb => (cb.checked = s.compare.includes(cb.value)));
    $$('#ex-metric button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.metric === s.metric)));
    const { from, to } = ctx.resolveRange(s);
    $('#ex-custom input[name=from]').value = s.from || ukDateInput(from);
    $('#ex-custom input[name=to]').value = s.to || ukDateInput(to);
    ctx.syncRangeButtons();
  }

  async function load() {
    const id = ++reqId;
    stop();
    syncControls();
    const s = store.get();
    const { from, to, label } = ctx.resolveRange(s);
    setBusy($('#ex-chart'), true);
    $('#ex-panel .state-error')?.remove();
    try {
      const res = await Promise.allSettled(s.compare.map(sid => live.window(sid, from, to)));
      if (id !== reqId) return;
      const sources = new Set();
      const series = s.compare.map((sid, k) => {
        const st = live.station(sid);
        const raw = res[k].status === 'fulfilled' ? res[k].value.data : [];
        if (res[k].status === 'fulfilled') res[k].value.sources.forEach(x => sources.add(x));
        const metricData = ctx.transformFor(raw, s.metric, st);
        return { id: sid, name: st.label, raw, metricData, color: ctx.colorOf(sid), metricAt: t => nearest(metricData, t, 0)?.[1] };
      });
      current = { series, from, to, label, metric: s.metric, sources: [...sources], failed: s.compare.filter((sid, k) => res[k].status === 'rejected') };
      playFrac = 1;
      $('#ex-scrub').value = 1000;
      draw(true);
      drawMap();
      drawInsights();
    } catch (e) {
      $('#ex-chart').after(errorBox(e.message, load));
    } finally { if (id === reqId) setBusy($('#ex-chart'), false); }
  }

  function focusId() {
    const s = store.get();
    return s.compare.includes(s.station) ? s.station : s.compare[0];
  }

  function draw(animate) {
    if (!current) return;
    const s = store.get();
    const focus = current.series.find(x => x.id === focusId());
    const metric = current.metric;
    const notes = autoNotes && focus && metric === 'stage' ? notable(focus.raw) : [];
    const sc = live.station(focusId())?.scale;
    chart.set(timeSeriesOption({
      series: current.series.map(x => ({ id: x.id, name: x.name, color: x.color, raw: x.raw, data: breakGaps(x.metricData), highlight: x.id === focus?.id })),
      metric, T: ctx.T, animate: animate && ctx.animate, annotations: notes, userNotes: s.notes.filter(t => t >= current.from && t <= current.to),
      bands: metric === 'range' ? [{ from: 0, to: 100, label: 'Typical range', color: ctx.T.accentSoft }] : metric === 'stage' && current.series.length === 1 && sc?.low != null ? [{ from: sc.low, to: sc.high, label: 'EA typical range', color: ctx.T.accentSoft }] : [],
      span: current.to - current.from,
    }));
    const empty = current.series.filter(x => !x.raw.length).map(x => x.name);
    $('#ex-chart-title').textContent = `${METRICS[metric].label}`;
    $('#ex-sub').innerHTML = `${esc(current.label)} · ${current.series.length} station${current.series.length > 1 ? 's' : ''} · ${esc(current.sources.join(' + ') || 'no data')}${empty.length ? ` · <b>no readings for ${esc(empty.join(', '))}</b>` : ''}${metric === 'stage' && current.series.length > 1 ? ' · <b>Different datums:</b> compare shapes and timing, or switch to % of typical range.' : ''}`;
    $('#ex-playtime').textContent = fmt.dateTime(current.to);
  }

  /* ---------- Playback ---------- */

  function applyPlayhead(frac) {
    if (!current || !chart.chart) return;
    playFrac = frac;
    const t = current.from + frac * (current.to - current.from);
    if (frac >= 0.999) { draw(false); drawMap(); return; }
    const all = current.series.flatMap(x => x.metricData.map(p => p[1]));
    const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.08 || 0.05;
    chart.chart.setOption({
      xAxis: { min: current.from, max: current.to },
      yAxis: { min: lo - pad, max: hi + pad },
      series: current.series.map((x, i) => ({ id: x.id, data: breakGaps(x.metricData.slice(0, indexAtOrBefore(x.metricData, t) + 1)), markPoint: { data: [] }, markLine: i ? { data: [] } : { data: [{ xAxis: t, lineStyle: { color: ctx.T.accent, width: 1.5 }, label: { formatter: fmt.dateTime(t), color: ctx.T.accent, fontSize: 10 } }], symbol: 'none', silent: true } })),
    }, { lazyUpdate: true });
    $('#ex-playtime').textContent = fmt.full(t);
    drawMap(t);
  }

  function play() {
    if (!current) return;
    if (playFrac >= 0.999) playFrac = 0;
    const speed = Number($('#ex-speed').value);
    const duration = 14000 / speed;
    let last = performance.now();
    $('#ex-play').textContent = 'Ⅱ Pause';
    $('#ex-play').setAttribute('aria-label', 'Pause animation');
    const step = now => {
      if (!playing) return;
      playFrac = Math.min(1, playFrac + (now - last) / duration);
      last = now;
      $('#ex-scrub').value = Math.round(playFrac * 1000);
      applyPlayhead(playFrac);
      if (playFrac >= 1) { stop(); return; }
      playing = requestAnimationFrame(step);
    };
    playing = requestAnimationFrame(step);
  }

  function stop() {
    if (playing) cancelAnimationFrame(playing);
    playing = null;
    $('#ex-play').textContent = '▶ Play';
    $('#ex-play').setAttribute('aria-label', 'Play time-series animation');
  }

  /* ---------- Linked map ---------- */

  function drawMap(atT) {
    Object.values(markers).forEach(m => m.remove());
    markers = {};
    const sel = new Set(store.get().compare);
    const pts = [];
    for (const cfg of STATIONS) {
      const st = live.station(cfg.id);
      const ser = current?.series.find(x => x.id === cfg.id);
      const p = ser ? (atT ? nearest(ser.raw, atT, 45 * time.MIN) : ser.raw.at(-1)) : live.latestOf(cfg.id);
      const pos = rangePosition(p?.[1], st.scale);
      const m = L.marker([st.lat, st.lng], {
        icon: gaugeIcon(ctx.T, { label: p ? p[1].toFixed(1) : '–', key: sel.has(cfg.id) ? pos.key : 'none', primary: cfg.id === focusId() }),
        opacity: sel.has(cfg.id) ? 1 : 0.45, title: st.label, keyboard: true,
      }).bindTooltip(`<b>${esc(st.label)}</b><br>${p ? `${p[1].toFixed(3)} m at ${esc(fmt.dateTime(p[0]))}<br>${esc(pos.label)}` : 'No reading'}${sel.has(cfg.id) ? '' : '<br><i>Click to add to the chart</i>'}`, { direction: 'top', offset: [0, -14] });
      m.on('mouseover', () => highlight(cfg.id, true, 'map'));
      m.on('mouseout', () => highlight(cfg.id, false, 'map'));
      m.on('click', () => {
        const s = store.get();
        if (!sel.has(cfg.id)) store.set({ compare: STATIONS.map(x => x.id).filter(id => id === cfg.id || s.compare.includes(id)), station: cfg.id });
        else store.set({ station: cfg.id });
      });
      m.addTo(map);
      markers[cfg.id] = m;
      if (sel.has(cfg.id)) pts.push([st.lat, st.lng]);
      const v = $(`#ex-stations [data-id="${cfg.id}"] [data-val]`);
      const l = live.latestOf(cfg.id);
      if (v) v.textContent = l ? `${l[1].toFixed(2)} m` : '';
    }
    if (!atT && pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.5), { maxZoom: 12, animate: ctx.animate });
  }

  function highlight(id, on, from) {
    if (from !== 'chart' && chart.chart && current?.series.some(x => x.id === id)) chart.chart.dispatchAction({ type: on ? 'highlight' : 'downplay', seriesId: id });
    markers[id]?.getElement()?.firstElementChild?.classList.toggle('is-hi', on);
    $(`#ex-stations [data-id="${id}"]`)?.classList.toggle('is-hi', on);
  }

  /* ---------- Insights ---------- */

  function drawInsights() {
    if (!current) return;
    const items = [];
    for (const x of current.series) {
      const st = stats(x.raw);
      if (!st) { items.push({ ico: '∅', title: `${x.name}: no readings`, sub: 'The station returned no data for this window.', t: null }); continue; }
      const delta = x.raw.at(-1)[1] - x.raw[0][1];
      items.push({ ico: delta > 0.005 ? '↗' : delta < -0.005 ? '↘' : '→', color: x.color, title: `${x.name}: ${fmt.signed(delta * 100, 1, ' cm')} over the window`, sub: `${x.raw[0][1].toFixed(2)} → ${x.raw.at(-1)[1].toFixed(2)} m · peak ${st.max[1].toFixed(2)} m on ${fmt.dateTime(st.max[0])}`, t: st.max[0] });
      for (const n of notable(x.raw).filter(n => n.kind === 'rise' || n.kind === 'fall')) {
        items.push({ ico: n.kind === 'rise' ? '⇡' : '⇣', color: x.color, title: `${x.name}: ${n.label}`, sub: 'Steepest hourly change in this window — select to zoom in.', t: n.t });
      }
    }
    // Lag hint: timing of peaks along the river, purely descriptive.
    const peaks = current.series.map(x => ({ x, st: stats(x.raw) })).filter(p => p.st && p.st.max[0] > current.from + time.HOUR && p.st.max[0] < current.to - time.HOUR);
    if (peaks.length > 1) {
      const sorted = peaks.sort((a, b) => a.st.max[0] - b.st.max[0]);
      items.push({ ico: '⏱', title: 'Order of peaks in this window', sub: sorted.map(p => `${p.x.name} ${fmt.dateTime(p.st.max[0])}`).join(' → ') + '. Descriptive only: peaks can have different causes.', t: null });
    }
    for (const n of store.get().notes.filter(t => t >= current.from && t <= current.to)) {
      const f = current.series[0];
      const p = nearest(f.raw, n, time.HOUR);
      items.push({ ico: '📌', title: `Your note · ${fmt.dateTime(n)}`, sub: p ? `${f.name} ${p[1].toFixed(3)} m` : 'No reading near this time', t: n });
    }
    $('#ex-insights').innerHTML = items.map((it, i) => `<button type="button" class="insight" data-i="${i}" ${it.t ? '' : 'disabled'}><span class="ico" style="color:${it.color || 'inherit'}">${it.ico}</span><span><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span><span class="when">${it.t ? 'Zoom →' : ''}</span></button>`).join('') || '<p class="empty">Nothing to summarise yet.</p>';
    $$('#ex-insights .insight').forEach(b => (b.onclick = () => {
      const it = items[Number(b.dataset.i)];
      if (!it.t || !chart.chart) return;
      const w = Math.max(3 * time.HOUR, (current.to - current.from) * 0.08);
      chart.chart.dispatchAction({ type: 'dataZoom', startValue: it.t - w, endValue: it.t + w });
      $('#ex-panel').scrollIntoView({ behavior: ctx.animate ? 'smooth' : 'auto', block: 'start' });
    }));
  }

  return {
    mount,
    render() { load(); },
    show() { setTimeout(() => map.invalidateSize(), 60); },
    hide() { stop(); },
    onState(s, prev) {
      if (s.compare !== prev.compare || s.range !== prev.range || s.from !== prev.from || s.to !== prev.to || s.metric !== prev.metric) load();
      else if (s.notes !== prev.notes) { draw(false); drawInsights(); }
      else if (s.station !== prev.station) { draw(false); drawMap(); }
    },
    onData() { if (!playing) load(); },
    onTheme() { map.removeLayer(base); base = basemap(ctx.theme()).addTo(map); draw(false); drawMap(); },
  };
}
