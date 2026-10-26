// Overview: the "five-second" command centre for the primary gauge.
import { $, $$, h, esc, countTo, mountChart, download, setBusy, errorBox } from '../ui.js';
import { timeSeriesOption, gaugeSVG, sparkline } from '../charts.js';
import {
  change, currentRate, trend, rangePosition, rangeWords, freshness, verdict, splitWarnings, warningCount, rateSeries, breakGaps, notable, fmt, toCSV, windowed, time, gaps,
} from '../data.js';
import { PRIMARY, STATIONS, SEVERITY, RULES } from '../config.js';

export function createOverview(ctx) {
  const { store, live } = ctx;
  let chart, sortKey = 'river', reqId = 0, lastWindow = null;

  function mount() {
    chart = mountChart($('#tl-chart'));
    ctx.rangeButtons($('#tl-range'), () => store.get().range, range => {
      if (range === 'custom') { $('#tl-custom').hidden = false; $('#tl-custom input[name=from]').focus(); return; }
      store.set({ range });
    }, true);
    ctx.bindCustomForm($('#tl-custom'));
    ['#tl-band', '#tl-notes', '#tl-upstream'].forEach(s => $(s).addEventListener('change', drawTimeline));
    $('#tl-csv').onclick = () => {
      if (!lastWindow) return;
      download(`diglis-${store.get().range}.csv`, toCSV(['timestamp_utc', 'uk_local_time', 'station', 'level_m_asd'],
        lastWindow.flatMap(s => s.raw.map(([t, v]) => [new Date(t).toISOString(), fmt.full(t), s.name, v]))));
    };
    $('#tl-explore').onclick = () => ctx.go('explore', { compare: $('#tl-upstream').checked ? ['2001', PRIMARY] : [PRIMARY] });
    $('#ov-warn-open').onclick = () => ctx.openIntel();
    $$('#view-overview [data-go]').forEach(a => (a.onclick = e => { e.preventDefault(); ctx.go(a.dataset.go); }));
    $$('#st-sort button').forEach(b => (b.onclick = () => {
      sortKey = b.dataset.sort;
      $$('#st-sort button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      drawStations();
    }));
  }

  /* ---------- Hero ---------- */

  function drawHero() {
    const st = live.primary();
    const series = live.series[PRIMARY] || [];
    const last = live.latestOf(PRIMARY);
    const rate = currentRate(series);
    const tr = trend(rate);
    const pos = rangePosition(last?.[1], st?.scale);
    const fr = freshness(last?.[0]);
    const h1 = change(series, 1);

    // Answer first: verdict, then official warnings, then the number.
    const v = verdict(last ? pos : { key: 'unknown' }, tr, live.floods ? live.floods.items : live.floodsError ? [] : null, live.localAreas);
    // Never present a snapshot or delayed reading as the river's current state.
    const old = live.status.mode === 'snapshot' || fr.key === 'stale';
    const head = !last ? 'No recent reading' : old ? `Not current · last reading was ${v.headline.toLowerCase()}` : v.headline;
    Object.assign($('#ov-verdict'), { textContent: head }).dataset.k = last && old ? 'unknown' : v.key;
    const wl = $('#ov-warnline');
    wl.dataset.k = live.floodsError ? 'unknown' : v.warning.key;
    wl.querySelector('span').textContent = live.floodsError ? 'Flood warning status could not be checked: use GOV.UK' : v.warning.text;
    countTo($('#ov-level'), last?.[1], { digits: 2 });
    Object.assign($('#ov-trend'), { textContent: `${tr.arrow} ${tr.label}${rate != null ? ` · ${fmt.signed(rate, 1, ' cm/h')}` : ''}` }).dataset.k = tr.key;
    Object.assign($('#ov-band'), {
      textContent: rangeWords(pos),
      title: pos.pct == null ? 'No EA typical range for this gauge' : `${Math.round(pos.pct)}% of the way from the EA typical low (0%) to typical high (100%)`,
    }).dataset.k = pos.key;
    $('#ov-fresh').dataset.k = fr.key;
    $('#ov-fresh span').textContent = last ? `Observed ${fmt.time(last[0])} ${fmt.zone(last[0])}, ${fmt.date(last[0])} · ${fmt.age(fr.ageMin)} · ${fr.label}` : 'No reading available';

    // Plain-English summary: everything stated is directly observed or official.
    let s = '';
    if (last) {
      s = `The Severn at Diglis is <b>${last[1].toFixed(2)} m</b> and <b>${tr.key === 'unknown' ? 'its trend is unclear' : tr.label.toLowerCase()}</b>${h1 ? ` (${fmt.signed(h1.delta * 100, 1, ' cm')} in the last hour)` : ''}. `;
      const sc = st?.scale;
      if (pos.key === 'normal') s += `That is within its typical range of ${sc.low.toFixed(2)}–${sc.high.toFixed(2)} m. `;
      else if (pos.key === 'low') s += `That is below its typical range (${sc.low.toFixed(2)}–${sc.high.toFixed(2)} m): low water. `;
      else if (pos.key === 'high') s += `That is <b>above</b> its typical range (top ${sc.high.toFixed(2)} m): the river is high. `;
    } else s = 'No recent reading is available from the Environment Agency. ';
    s += warningSentence();
    $('#ov-summary').innerHTML = s;
    $('#ov-gauge').innerHTML = gaugeSVG({ value: last?.[1], scale: st?.scale, T: ctx.T, label: 'Diglis latest level' });
    drawWarnCard();
    drawBanner();
  }

  function warningSentence() {
    if (!live.floods) return live.floodsError ? 'Flood warning status could not be checked — see official sources.' : '';
    const { local, remote } = splitWarnings(live.floods.items, live.localAreas);
    if (!local.length && !remote.length) return 'No flood warnings or alerts are in force within 40 km.';
    const near = local.length ? `<b>${warningCount(local)}</b> in force near Worcester.` : 'No flood warnings or alerts near Worcester.';
    const far = remote.length ? ` ${warningCount(remote)} elsewhere within 40 km (${esc(remote.map(w => w.area).slice(0, 2).join('; '))}).` : '';
    return near + far;
  }

  function drawWarnCard() {
    const el = $('#ov-warn');
    if (!live.floods) {
      el.dataset.k = live.floodsError ? 'error' : 'loading';
      $('#ov-warn-title').textContent = live.floodsError ? 'Warning status unavailable' : 'Checking…';
      $('#ov-warn-sub').textContent = live.floodsError ? 'Use Check for flooding (GOV.UK) for official status.' : 'Environment Agency · within 40 km';
      return;
    }
    const { local, remote } = splitWarnings(live.floods.items, live.localAreas);
    const top = local[0];
    el.dataset.k = top ? SEVERITY[top.severityLevel].key : 'clear';
    $('#ov-warn-title').textContent = top ? `${local.length} ${local.length > 1 ? 'warnings/alerts' : SEVERITY[top.severityLevel].label.toLowerCase()} near Worcester` : 'No warnings near Worcester';
    $('#ov-warn-sub').textContent = top ? `Most severe: ${SEVERITY[top.severityLevel].label} — ${top.area}${remote.length ? ` · ${remote.length} more elsewhere within 40 km` : ''}`
      : remote.length ? `${warningCount(remote)} elsewhere within 40 km: ${remote.map(w => w.area).join('; ')}`
      : `Checked ${fmt.time(live.floods.fetchedAt)} · EA flood warnings within 40 km of Worcester`;
  }

  function drawBanner() {
    const st = live.status;
    $('#ov-banner')?.remove();
    let msg = null;
    if (st.mode === 'snapshot') msg = `<b>Live data unavailable</b> (${esc(st.error)}). Showing the saved snapshot captured ${st.snapshotAt ? esc(fmt.full(st.snapshotAt)) : 'earlier'} — these are not current readings.`;
    else if (st.mode === 'stale') msg = `<b>Could not refresh</b> (${esc(st.error)}). Showing data from the last successful update at ${esc(fmt.time(st.updatedAt))}.`;
    else if (st.partial) msg = `<b>Reading history unavailable</b> (${esc(st.error)}). Showing each gauge's latest value from the Environment Agency; charts and trends will appear when the history loads. Retrying.`;
    else if (st.mode === 'error') msg = `<b>No data could be loaded.</b> ${esc(st.error)}. Please use the official links below.`;
    if (msg) $('#view-overview').prepend(h(`<div class="state-warn" id="ov-banner" role="alert">${msg}</div>`));
  }

  /* ---------- KPI cards ---------- */

  function drawKPIs() {
    const st = live.primary();
    const series = live.series[PRIMARY] || [];
    const last = live.latestOf(PRIMARY);
    const rates = rateSeries(series);
    const rate = currentRate(series);
    const pos = rangePosition(last?.[1], st?.scale);
    const active = live.floods?.items.filter(f => f.severityLevel <= 3) || [];
    const ch = hrs => change(series, hrs);
    const since = hrs => windowed(series, (last?.[0] ?? Date.now()) - hrs * time.HOUR);
    const cards = [
      ...[1, 6, 24].map(hrs => {
        const c = ch(hrs);
        return {
          id: `chg${hrs}`, label: `Change · ${hrs} hour${hrs > 1 ? 's' : ''}`, value: c ? c.delta * 100 : null, unit: 'cm', signed: true, digits: 1,
          k: c ? trend(c.delta * 100 / hrs).key : 'unknown', spark: since(Math.max(hrs, 3)),
          foot: c ? `${fmt.time(c.from[0])} → ${fmt.time(c.to[0])}` : 'No matching earlier reading',
          pop: c ? `From ${c.from[1].toFixed(3)} m at ${fmt.dateTime(c.from[0])} to ${c.to[1].toFixed(3)} m at ${fmt.dateTime(c.to[0])}. Measured change, not a forecast.` : `Needs a reading within ${RULES.matchToleranceMin} minutes of ${hrs} h before the latest.`,
          go: () => ctx.go('explore', { compare: [PRIMARY], range: hrs > 6 ? '7d' : '24h' }),
        };
      }),
      {
        id: 'rate', label: 'Rate now', value: rate, unit: 'cm/h', signed: true, digits: 1, k: trend(rate).key, spark: rates.slice(-96), foot: trend(rate).label,
        pop: 'Change between the latest reading and the one an hour earlier, expressed per hour. Opens the rate-of-change chart.',
        go: () => ctx.go('analysis', { station: PRIMARY }, '#an-rate'),
      },
      {
        // Distance to the top of the typical range, worded for which side we're on.
        id: 'room', label: pos.key === 'high' ? 'Above typical high' : 'Below typical high',
        value: st?.scale?.high != null && last ? Math.abs(st.scale.high - last[1]) : null, unit: 'm', digits: 2, k: pos.key,
        bar: pos.pct, foot: pos.pct != null ? rangeWords(pos) : 'Typical range unavailable',
        pop: `How far the latest reading is ${pos.key === 'high' ? 'above' : 'below'} the top of the EA typical range (${st?.scale?.high?.toFixed(2) ?? '—'} m). Typical range is context, not a flood threshold.`,
        go: () => ctx.openIntel('context'),
      },
      {
        id: 'warn', label: 'Warnings & alerts', value: live.floods ? active.length : null, unit: '', digits: 0, k: active.length ? 'high' : 'normal',
        foot: live.floods ? `EA · checked ${fmt.time(live.floods.fetchedAt)}` : live.floodsError ? 'Unavailable' : 'Checking…',
        pop: 'Official Environment Agency flood warnings and alerts in force within 40 km of Worcester. Opens Flood info.',
        go: () => ctx.openIntel('warnings'),
      },
    ];
    const root = $('#ov-kpis');
    if (root.children.length !== cards.length) {
      root.innerHTML = cards.map(c => `<button type="button" class="kpi" data-id="${c.id}" aria-describedby="pop-${c.id}"><span class="kpi-label">${esc(c.label)}</span><span class="kpi-value"><span class="v">—</span><small>${esc(c.unit)}</small></span><span class="kpi-viz"></span><span class="kpi-foot"></span><span class="kpi-pop" role="tooltip" id="pop-${c.id}"></span></button>`).join('');
    }
    for (const c of cards) {
      const el = root.querySelector(`[data-id="${c.id}"]`);
      el.dataset.k = c.k;
      el.onclick = c.go;
      countTo(el.querySelector('.v'), c.value, { digits: c.digits, signed: c.signed });
      el.querySelector('.kpi-label').textContent = c.label;
      el.querySelector('.kpi-foot').textContent = c.foot;
      el.querySelector('.kpi-pop').innerHTML = `<b>${esc(c.label)}</b><span>${esc(c.pop)}</span>`;
      el.querySelector('.kpi-viz').innerHTML = c.bar !== undefined
        ? `<span class="kpi-bar" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, c.bar ?? 0))}%"></span><i style="left:100%"></i></span>`
        : c.spark ? sparkline(c.spark, { width: 140, height: 30, color: 'currentColor' }) : '';
    }
  }

  /* ---------- Timeline ---------- */

  async function drawTimeline() {
    const id = ++reqId;
    const s = store.get();
    const { from, to, label } = ctx.resolveRange(s);
    const compare = $('#tl-upstream').checked;
    const ids = compare ? ['2001', PRIMARY] : [PRIMARY];
    setBusy($('#tl-chart'), true);
    $('#ov-timeline .state-error')?.remove();
    try {
      const results = await Promise.all(ids.map(i => live.window(i, from, to)));
      if (id !== reqId) return;
      const metric = compare ? 'change' : 'stage';
      const series = ids.map((sid, k) => {
        const raw = results[k].data;
        const st = live.station(sid);
        return { id: sid, name: st.label, raw, color: ctx.colorOf(sid), data: breakGaps(ctx.transformFor(raw, metric, st)), highlight: sid === PRIMARY };
      });
      lastWindow = series;
      const main = series.find(x => x.id === PRIMARY);
      const sc = live.primary()?.scale;
      if (!main.raw.length) { chart.set({}); $('#tl-note').textContent = `No readings for ${label}.`; return; }
      const showBand = $('#tl-band').checked && !compare && sc?.low != null;
      chart.set(timeSeriesOption({
        series, metric, T: ctx.T, animate: ctx.animate,
        bands: showBand ? [{ from: sc.low, to: sc.high, label: 'EA typical range', color: ctx.T.accentSoft }] : [],
        thresholds: !compare && sc?.highestRecent?.value && main.raw.some(p => p[1] > sc.high * 0.8) ? [{ value: sc.highestRecent.value, label: 'Highest recent', color: ctx.T.alert, dashed: true }] : [],
        annotations: $('#tl-notes').checked && !compare ? notable(main.raw) : [],
        span: to - from,
      }));
      const g = gaps(main.raw);
      $('#tl-sub').textContent = compare ? 'Change since the start of the window (cm) · Bewdley is upstream; rises there often reach Worcester later' : 'Diglis · metres above station datum (mASD) · UK time';
      $('#tl-note').textContent = `${label}: ${main.raw.length} readings, ${fmt.dateTime(main.raw[0][0])} → ${fmt.dateTime(main.raw.at(-1)[0])} (${fmt.zone(main.raw.at(-1)[0])}). ${g.length ? `${g.length} gap${g.length > 1 ? 's' : ''} over ${RULES.gapMinutes} min left blank.` : 'No gaps over 30 min.'} Source: ${results[results.length - 1].sources.join(' + ')}. Scroll with Shift or drag the handles to zoom.`;
    } catch (e) {
      if (id !== reqId) return;
      $('#tl-chart').after(errorBox(e.message, drawTimeline));
    } finally { if (id === reqId) setBusy($('#tl-chart'), false); }
  }

  /* ---------- Stations ---------- */

  function drawStations() {
    const rows = STATIONS.map((cfg, i) => {
      const st = live.station(cfg.id);
      const series = live.series[cfg.id] || [];
      const last = live.latestOf(cfg.id);
      const rate = currentRate(series);
      return { cfg, st, series, last, rate, pos: rangePosition(last?.[1], st?.scale), c24: change(series, 24), fr: freshness(last?.[0]), order: i };
    });
    const sorters = { river: (a, b) => a.order - b.order, range: (a, b) => (b.pos.pct ?? -1e9) - (a.pos.pct ?? -1e9), rate: (a, b) => Math.abs(b.rate ?? 0) - Math.abs(a.rate ?? 0) };
    rows.sort(sorters[sortKey]);
    $('#st-grid').innerHTML = rows.map(r => {
      const pct = r.pos.pct == null ? null : Math.max(0, Math.min(100, r.pos.pct));
      const tr = trend(r.rate);
      return `<article class="station${r.cfg.primary ? ' is-primary' : ''}" data-id="${r.cfg.id}">
        <div class="station-top"><div><h3>${esc(r.st?.label || r.cfg.label)}</h3><div class="river">${esc(r.cfg.river)} · ${esc(r.cfg.role)}</div></div><span class="chip" data-k="${tr.key}" title="${esc(tr.label)}">${tr.arrow}</span></div>
        <div class="station-val">${r.last ? r.last[1].toFixed(2) : '—'}<small> m</small> <small>${r.c24 ? fmt.signed(r.c24.delta * 100, 1, ' cm / 24 h') : ''}</small></div>
        ${sparkline(r.series, { width: 200, height: 36, color: ctx.colorOf(r.cfg.id), band: r.st?.scale })}
        <div class="range-meter" data-k="${r.pos.key}" title="${esc(r.pos.label)}${pct != null ? ` (${Math.round(r.pos.pct)}%)` : ''}"><span style="left:${pct ?? 0}%;${pct == null ? 'display:none' : ''}"></span></div>
        <div class="station-meta"><span>${esc(r.pos.label)}</span><span title="${r.last ? esc(fmt.full(r.last[0])) : ''}">${r.last ? (r.fr.key === 'stale' || r.fr.key === 'recent' ? `${esc(r.fr.label)}: last reading ${fmt.time(r.last[0])} (${esc(fmt.age(r.fr.ageMin))}); the EA has not yet published a newer one` : `${fmt.time(r.last[0])} · ${esc(r.fr.label)}`) : esc(r.st?.error || 'No data')}</span></div>
        <div class="station-actions"><button type="button" class="btn btn-ghost btn-small" data-act="map">On map</button><button type="button" class="btn btn-ghost btn-small" data-act="explore">Explore</button></div>
      </article>`;
    }).join('');
    $$('#st-grid [data-act]').forEach(b => (b.onclick = () => {
      const id = b.closest('[data-id]').dataset.id;
      if (b.dataset.act === 'map') ctx.go('map', { station: id });
      else ctx.go('explore', { compare: [id], station: id });
    }));
  }

  return {
    mount,
    render() { drawHero(); drawKPIs(); drawStations(); drawTimeline(); },
    onState(s, prev) { if (s.range !== prev.range || s.from !== prev.from || s.to !== prev.to) { ctx.syncRangeButtons(); drawTimeline(); } },
    onData() { drawHero(); drawKPIs(); drawStations(); drawTimeline(); },
  };
}
