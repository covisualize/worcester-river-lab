// Analysis: five linked visualisations plus a clearly separated simulator.
import { $, $$, esc, mountChart, download, setBusy, errorBox } from '../ui.js';
import { timeSeriesOption, rateOption, rangeBarsOption, rainLevelOption, simulationOption, gaugeSVG } from '../charts.js';
import {
  METRICS, breakGaps, rateSeries, currentRate, trend, rangePosition, fmt, toCSV, hourlyRain, quantile, simulateLinear, hoursToReach, time, stats,
} from '../data.js';
import { STATIONS, RAIN_GAUGES, RANGES } from '../config.js';

export function createAnalysis(ctx) {
  const { store, live } = ctx;
  const charts = {};
  const local = { rateStation: null, rateRange: '7d', rainGauge: '1773', rainStation: '2085', rainRange: '7d', simStation: null };
  const req = { multi: 0, rate: 0, rain: 0 };
  let multiData = [], rateData = [], rainData = null;

  const stationOptions = sel => STATIONS.map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.label)} · ${esc(s.river.replace('River ', ''))}</option>`).join('');
  const hoursOf = id => RANGES.find(r => r.id === id).hours;

  function mount() {
    charts.multi = mountChart($('#an-multi-chart'));
    charts.bars = mountChart($('#an-bars'));
    charts.rate = mountChart($('#an-rate-chart'));
    charts.rain = mountChart($('#an-rain-chart'));
    charts.sim = mountChart($('#sim-chart'));

    // 01 multi-station
    ctx.rangeButtons($('#an-range'), () => store.get().range, range => store.set({ range: range === 'custom' ? '7d' : range }), false);
    $('#an-metric').innerHTML = ['stage', 'change', 'range', 'aod'].map(m => `<button type="button" data-metric="${m}">${esc(METRICS[m].short)}</button>`).join('');
    $$('#an-metric button').forEach(b => (b.onclick = () => store.set({ metric: b.dataset.metric })));
    $('#an-multi-csv').onclick = () => download('station-comparison.csv', toCSV(['timestamp_utc', 'uk_local_time', 'station_id', 'station', 'level_m_asd'], multiData.flatMap(s => s.raw.map(([t, v]) => [new Date(t).toISOString(), fmt.full(t), s.id, s.name, v]))));

    // 02 gauge
    $('#an-gauge-station').onchange = e => store.set({ station: e.target.value });

    // 03 bars → focus station
    charts.bars.chart?.on('click', p => { const id = STATIONS[p.dataIndex]?.id; if (id) store.set({ station: id }); });

    // 04 rate
    $('#an-rate-station').onchange = e => { local.rateStation = e.target.value; drawRate(); };
    ctx.rangeButtons($('#an-rate-range'), () => local.rateRange, r => { local.rateRange = r; drawRate(); }, false);
    $('#an-rate-csv').onclick = () => download(`rate-of-change-${local.rateStation}.csv`, toCSV(['timestamp_utc', 'uk_local_time', 'rate_cm_per_hour'], rateData.map(([t, v]) => [new Date(t).toISOString(), fmt.full(t), v.toFixed(2)])));

    // 05 rain vs level
    $('#an-rain-gauge').innerHTML = RAIN_GAUGES.map(g => `<option value="${g.id}">${esc(g.label)}</option>`).join('');
    $('#an-rain-gauge').onchange = e => { local.rainGauge = e.target.value; drawRain(); };
    $('#an-rain-station').innerHTML = stationOptions(local.rainStation);
    $('#an-rain-station').onchange = e => { local.rainStation = e.target.value; drawRain(); };
    ctx.rangeButtons($('#an-rain-range'), () => local.rainRange, r => { local.rainRange = r; drawRain(); }, false);
    $('#an-rain-csv').onclick = () => rainData && download('rain-and-level.csv', toCSV(['hour_ending_utc', 'uk_local_time', 'rain_mm_complete_hours', 'station', 'level_m_asd_at_hour'],
      rainData.rain.map(([t, mm]) => { const l = rainData.levelAt(t); return [new Date(t).toISOString(), fmt.full(t), mm, rainData.stationName, l ?? '']; })));

    // 06 simulator
    $('#sim-station').onchange = e => { local.simStation = e.target.value; drawSim(); };
    $('#sim-rate').oninput = drawSim;
    $('#sim-hours').oninput = drawSim;
    $('#sim-observed').onclick = () => {
      const r = currentRate(live.series[local.simStation] || []);
      if (r == null) return;
      $('#sim-rate').value = Math.max(-10, Math.min(20, Math.round(r * 2) / 2));
      drawSim();
    };
  }

  /* ---------- 01 Multi-station ---------- */

  function drawChips() {
    const sel = new Set(store.get().compare);
    $('#an-stations').innerHTML = STATIONS.map(s => `<button type="button" data-id="${s.id}" aria-pressed="${sel.has(s.id)}" style="--c:${ctx.colorOf(s.id)}"><i></i>${esc(s.label)}</button>`).join('');
    $$('#an-stations button').forEach(b => (b.onclick = () => {
      const cur = new Set(store.get().compare);
      cur.has(b.dataset.id) ? cur.delete(b.dataset.id) : cur.add(b.dataset.id);
      if (!cur.size) return;
      store.set({ compare: STATIONS.map(s => s.id).filter(id => cur.has(id)) });
    }));
    $$('#an-metric button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.metric === store.get().metric)));
  }

  async function drawMulti() {
    const id = ++req.multi;
    drawChips();
    const s = store.get();
    const metric = s.metric === 'rate' ? 'stage' : s.metric;
    const { from, to, label } = ctx.resolveRange(s);
    setBusy($('#an-multi-chart'), true);
    $('#an-multi .state-error')?.remove();
    try {
      const results = await Promise.allSettled(s.compare.map(sid => live.window(sid, from, to)));
      if (id !== req.multi) return;
      multiData = s.compare.map((sid, k) => {
        const st = live.station(sid);
        const raw = results[k].status === 'fulfilled' ? results[k].value.data : [];
        return { id: sid, name: st.label, raw, color: ctx.colorOf(sid), data: breakGaps(ctx.transformFor(raw, metric, st)), highlight: sid === s.station };
      });
      charts.multi.set(timeSeriesOption({ series: multiData, metric, T: ctx.T, animate: ctx.animate, span: to - from }));
      const missing = multiData.filter(x => !x.raw.length).map(x => x.name);
      $('#an-multi-sub').textContent = `${METRICS[metric].label} · ${label} · ${multiData.length} station${multiData.length > 1 ? 's' : ''}`;
      $('#an-multi-note').textContent = `${missing.length ? `No data for ${missing.join(', ')}. ` : ''}Hover to compare stations at the same moment; Shift+scroll or drag the handles to zoom.`;
      $('#an-datums').innerHTML = `<table class="ref-table"><thead><tr><th>Station</th><th>Typical range (mASD)</th><th>EA stage datum</th><th>Latest (derived mAOD)</th></tr></thead><tbody>${multiData.map(x => {
        const st = live.station(x.id), sc = st.scale || {}, l = live.latestOf(x.id);
        return `<tr><td><span class="sw" style="background:${x.color}"></span>${esc(x.name)}</td><td>${sc.low != null ? `${sc.low.toFixed(2)}–${sc.high.toFixed(2)}` : '—'}</td><td>${sc.datum != null ? sc.datum + ' m' : '—'}</td><td>${l && sc.datum != null ? (l[1] + sc.datum).toFixed(2) : '—'}</td></tr>`;
      }).join('')}</tbody></table>`;
    } catch (e) {
      $('#an-multi-chart').after(errorBox(e.message, drawMulti));
    } finally { if (id === req.multi) setBusy($('#an-multi-chart'), false); }
  }

  /* ---------- 02 Gauge & 03 Bars ---------- */

  function drawGauge() {
    const id = store.get().station;
    $('#an-gauge-station').innerHTML = stationOptions(id);
    const st = live.station(id), last = live.latestOf(id), sc = st.scale || {};
    $('#an-gauge').innerHTML = gaugeSVG({ value: last?.[1], scale: sc, T: ctx.T, label: `${st.label} latest level` });
    const row = (c, k, v, d) => `<tr><td><span class="sw" style="background:${c}"></span>${k}</td><td>${v != null ? v.toFixed(3) + ' m' : '—'}</td><td>${d || ''}</td><td>${v != null && last ? fmt.signed((last[1] - v) * 100, 0, ' cm') : '—'}</td></tr>`;
    $('#an-ref').innerHTML = `<thead><tr><th>EA reference level</th><th>Level</th><th>Date</th><th>Latest vs level</th></tr></thead><tbody>
      ${row(ctx.T.text, 'Latest reading', last?.[1], last ? fmt.dateTime(last[0]) : '')}
      ${row(ctx.T.fall, 'Typical range low', sc.low)}
      ${row(ctx.T.water, 'Typical range high', sc.high)}
      ${row(ctx.T.alert, 'Highest recent', sc.highestRecent?.value, sc.highestRecent ? fmt.dateYear(sc.highestRecent.t) : '')}
      ${row(ctx.T.severe, 'Maximum on record', sc.maxOnRecord?.value, sc.maxOnRecord ? fmt.dateYear(sc.maxOnRecord.t) : '')}
      ${row(ctx.T.muted, 'Minimum on record', sc.minOnRecord?.value, sc.minOnRecord ? fmt.dateYear(sc.minOnRecord.t) : '')}
    </tbody><caption class="note" style="caption-side:bottom;text-align:left;padding-top:8px">All values are EA station metadata (stageScale) in metres above station datum. None of them is an official flood-warning trigger.</caption>`;
  }

  function drawBars() {
    const rows = STATIONS.map(cfg => {
      const st = live.station(cfg.id), last = live.latestOf(cfg.id), pos = rangePosition(last?.[1], st.scale);
      return { name: st.label, river: cfg.river, value: last?.[1], when: last ? fmt.dateTime(last[0]) : 'no data', low: st.scale?.low, high: st.scale?.high, pct: pos.pct };
    });
    charts.bars.set(rangeBarsOption({ rows, T: ctx.T, animate: ctx.animate }));
  }

  /* ---------- 04 Rate ---------- */

  async function drawRate() {
    const id = ++req.rate;
    local.rateStation ??= store.get().station;
    $('#an-rate-station').innerHTML = stationOptions(local.rateStation);
    const hours = hoursOf(local.rateRange);
    setBusy($('#an-rate-chart'), true);
    try {
      const { data } = await live.window(local.rateStation, Date.now() - hours * time.HOUR);
      if (id !== req.rate) return;
      rateData = rateSeries(data);
      const vals = rateData.map(p => p[1]);
      // Rises are positive rates only and falls negative only (an all-falling window has no rise).
      const up = rateData.filter(p => p[1] > 0).reduce((m, p) => (p[1] > (m?.[1] ?? -Infinity) ? p : m), null);
      const dn = rateData.filter(p => p[1] < 0).reduce((m, p) => (p[1] < (m?.[1] ?? Infinity) ? p : m), null);
      const rising = vals.filter(v => v >= 0.5).length, falling = vals.filter(v => v <= -0.5).length;
      const now = currentRate(data), tr = trend(now);
      const stat = (label, v, small) => `<div class="stat"><span>${label}</span><strong>${v}</strong>${small ? `<small>${small}</small>` : ''}</div>`;
      $('#an-rate-summary').innerHTML = rateData.length ? [
        stat('Now', fmt.signed(now, 1, ' cm/h'), tr.label),
        stat('Fastest rise', up ? fmt.signed(up[1], 1, ' cm/h') : 'None', up ? fmt.dateTime(up[0]) : 'no rise in this window'),
        stat('Fastest fall', dn ? fmt.signed(dn[1], 1, ' cm/h') : 'None', dn ? fmt.dateTime(dn[0]) : 'no fall in this window'),
        stat('Time rising / falling', `${Math.round((rising / vals.length) * 100)}% / ${Math.round((falling / vals.length) * 100)}%`, `typical |rate| ${quantile(vals.map(Math.abs), 0.5)?.toFixed(1)} cm/h`),
      ].join('') : '<p class="empty">Not enough consecutive readings to compute a rate.</p>';
      charts.rate.set(rateOption({ data: rateData, T: ctx.T, animate: ctx.animate, name: live.station(local.rateStation).label }));
    } catch (e) { $('#an-rate-summary').replaceChildren(errorBox(e.message, drawRate)); }
    finally { if (id === req.rate) setBusy($('#an-rate-chart'), false); }
  }

  /* ---------- 05 Rain vs level ---------- */

  async function drawRain() {
    const id = ++req.rain;
    const hours = hoursOf(local.rainRange);
    const from = Date.now() - hours * time.HOUR;
    setBusy($('#an-rain-chart'), true);
    $('#an-rain .state-error')?.remove();
    try {
      const [rainRaw, lvl] = await Promise.all([live.rain(local.rainGauge, from), live.window(local.rainStation, from)]);
      if (id !== req.rain) return;
      const rain = hourlyRain(rainRaw);
      const st = live.station(local.rainStation);
      const level = lvl.data;
      const byT = new Map(level);
      rainData = { rain, stationName: st.label, levelAt: t => byT.get(t) };
      const total = rain.reduce((a, p) => a + p[1], 0);
      const peak = rain.reduce((m, p) => (p[1] > (m?.[1] ?? -1) ? p : m), null);
      const ls = stats(level);
      const stat = (label, v, small) => `<div class="stat"><span>${label}</span><strong>${v}</strong>${small ? `<small>${small}</small>` : ''}</div>`;
      $('#an-rain-summary').innerHTML = [
        stat('Rain in complete hours', `${total.toFixed(1)} mm`, `${rain.length} of ${hours} hours complete`),
        stat('Wettest hour', peak && peak[1] > 0 ? `${peak[1].toFixed(1)} mm` : 'None recorded', peak && peak[1] > 0 ? `hour ending ${fmt.dateTime(peak[0])}` : ''),
        stat(`${esc(st.label)} range`, ls ? `${(ls.max[1] - ls.min[1]).toFixed(2)} m` : '—', ls ? `${ls.min[1].toFixed(2)} → ${ls.max[1].toFixed(2)} m` : ''),
      ].join('');
      if (!rain.length && !level.length) { charts.rain.set({}); return; }
      const g = RAIN_GAUGES.find(x => x.id === local.rainGauge);
      charts.rain.set(rainLevelOption({ rain, level: breakGaps(level), T: ctx.T, animate: ctx.animate, rainName: `${g.label} (mm/h)`, levelName: `${st.label} level (m)`, levelColor: ctx.colorOf(local.rainStation) }));
    } catch (e) { $('#an-rain-chart').after(errorBox(e.message, drawRain)); }
    finally { if (id === req.rain) setBusy($('#an-rain-chart'), false); }
  }

  /* ---------- 06 Simulator ---------- */

  function drawSim() {
    local.simStation ??= store.get().station;
    $('#sim-station').innerHTML = stationOptions(local.simStation);
    const rate = Number($('#sim-rate').value), hours = Number($('#sim-hours').value);
    $('#sim-rate-out').textContent = fmt.signed(rate, 1, ' cm/h');
    $('#sim-hours-out').textContent = `${hours} h`;
    const st = live.station(local.simStation), last = live.latestOf(local.simStation), sc = st.scale || {};
    if (!last) { $('#sim-out').innerHTML = '<p class="empty">No observed starting level available.</p>'; charts.sim.set({}); return; }
    const sim = simulateLinear(last[1], rate, hours).map(([hh, v]) => [last[0] + hh * time.HOUR, v]);
    const observed = (live.series[local.simStation] || []).slice(-96);
    const refs = [
      { value: sc.high, label: 'Typical high', color: ctx.T.water },
      { value: sc.highestRecent?.value, label: 'Highest recent', color: ctx.T.alert },
      { value: sc.maxOnRecord?.value, label: 'Record', color: ctx.T.severe },
    ].filter(r => Number.isFinite(r.value));
    $('#sim-out').innerHTML = refs.map(r => {
      const hrs = hoursToReach(last[1], r.value, rate);
      const already = last[1] >= r.value;
      return `<div class="stat"><span>${esc(r.label)} (${r.value.toFixed(2)} m)</span><strong>${already ? 'Already above' : hrs == null ? 'Not reached' : hrs <= hours ? `~${hrs < 1 ? Math.round(hrs * 60) + ' min' : hrs.toFixed(1) + ' h'}` : `> ${hours} h`}</strong><small>under this hypothetical rate</small></div>`;
    }).join('');
    charts.sim.set(simulationOption({ observed, simulated: sim, thresholds: refs, T: ctx.T, animate: ctx.animate }));
  }

  return {
    mount,
    render() { drawMulti(); drawGauge(); drawBars(); drawRate(); drawRain(); drawSim(); ctx.syncRangeButtons(); },
    onState(s, prev) {
      if (s.compare !== prev.compare || s.metric !== prev.metric || s.range !== prev.range || s.from !== prev.from || s.to !== prev.to) { ctx.syncRangeButtons(); drawMulti(); }
      if (s.station !== prev.station) { drawGauge(); if (s.compare.includes(s.station)) drawMulti(); }
    },
    onData() { drawMulti(); drawGauge(); drawBars(); drawRate(); drawRain(); drawSim(); },
  };
}
