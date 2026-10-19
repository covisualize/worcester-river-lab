// ECharts option builders. Pure functions of (data, tokens): no DOM access, so
// they are unit tested in Node. All times are formatted in UK local time.
import { fmt, METRICS, rateSeries, explainRate, nearest, time } from './data.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const UK_MIDNIGHT = t => fmt.time(t) === '00:00';

// Axis label: dates at UK midnight, otherwise times (with dates on long spans).
export function timeLabel(span) {
  return v => (UK_MIDNIGHT(v) ? `{d|${fmt.date(v)}}` : span > 3 * time.DAY ? `${fmt.date(v)} ${fmt.time(v)}` : fmt.time(v));
}

/* ---------- Screen-reader summaries ----------
   ECharts' automatic aria text reads raw epoch milliseconds and float noise, so
   every chart gets a plain-English description of what it shows instead. */

const num = (v, d) => (v == null || !Number.isFinite(v) ? 'unavailable' : (+v.toFixed(d)).toString());

function extremes(data) {
  let lo = null, hi = null;
  for (const p of data) if (p[1] != null) { if (!lo || p[1] < lo[1]) lo = p; if (!hi || p[1] > hi[1]) hi = p; }
  return { lo, hi };
}

export function describeSeries(series, { metric = 'stage', kind = 'Line chart' } = {}) {
  const M = METRICS[metric];
  const parts = series.map(s => {
    const pts = s.data.filter(p => p[1] != null);
    if (!pts.length) return `${s.name}: no readings.`;
    const { lo, hi } = extremes(pts), a = pts[0], b = pts[pts.length - 1];
    return `${s.name}: ${num(a[1], M.digits)} ${M.unit} at ${fmt.dateTime(a[0])} to ${num(b[1], M.digits)} ${M.unit} at ${fmt.dateTime(b[0])}; highest ${num(hi[1], M.digits)} at ${fmt.dateTime(hi[0])}, lowest ${num(lo[1], M.digits)} at ${fmt.dateTime(lo[0])}.`;
  });
  return `${kind} of ${M.label.toLowerCase()}, UK time. ${parts.join(' ')}`;
}

function base(T, animate, description) {
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: T.font, color: T.muted },
    animation: animate,
    animationDuration: 700,
    animationDurationUpdate: 550,
    animationEasingUpdate: 'cubicOut',
    aria: { enabled: true, decal: { show: false }, ...(description ? { label: { description } } : {}) },
  };
}

const tooltipBase = T => ({
  backgroundColor: T.surface,
  borderColor: T.line,
  borderWidth: 1,
  padding: [10, 12],
  textStyle: { color: T.text, fontFamily: T.font, fontSize: 12 },
  extraCssText: 'border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.28);max-width:320px;white-space:normal;',
});

const axisCommon = T => ({
  axisLine: { lineStyle: { color: T.line } },
  axisTick: { show: false },
  axisLabel: { color: T.muted, fontSize: 11, hideOverlap: true },
  splitLine: { lineStyle: { color: T.grid } },
});

const dot = c => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:6px"></span>`;

/* ---------- 1. Time series (single or multi-station) ---------- */

export function timeSeriesOption({
  series, metric = 'stage', T, animate = true, bands = [], thresholds = [], annotations = [], userNotes = [],
  zoom = null, slider = true, compact = false, span: spanIn,
}) {
  const M = METRICS[metric];
  const all = series.flatMap(s => s.data.filter(p => p[1] != null));
  const span = spanIn ?? (all.length ? all[all.length - 1][0] - all[0][0] : time.DAY);
  const rateById = Object.fromEntries(series.map(s => [s.id, s.raw ? rateSeries(s.raw) : []]));
  const single = series.length === 1;
  const out = {
    ...base(T, animate, describeSeries(series, { metric })),
    color: series.map(s => s.color),
    grid: { left: compact ? 44 : 56, right: compact ? 14 : 24, top: compact ? 16 : 36, bottom: slider ? 78 : 34, containLabel: false },
    legend: single || compact ? { show: false } : { top: 0, left: 'center', icon: 'roundRect', itemWidth: 14, itemHeight: 4, textStyle: { color: T.text, fontSize: 12 } },
    tooltip: {
      ...tooltipBase(T),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: T.muted, type: 'dashed' }, label: { show: false } },
      formatter(params) {
        const list = Array.isArray(params) ? params : [params];
        const t = list[0]?.value?.[0];
        let h = `<div style="font-weight:600;margin-bottom:6px">${esc(fmt.full(t))}</div>`;
        for (const p of list) {
          if (p.value?.[1] == null || p.seriesType !== 'line') continue;
          const s = series[p.seriesIndex];
          h += `<div style="display:flex;justify-content:space-between;gap:14px">${dot(p.color)}<span style="flex:1">${esc(p.seriesName)}</span><b style="font-variant-numeric:tabular-nums">${p.value[1].toFixed(M.digits)} ${esc(M.unit)}</b></div>`;
          if (s?.raw && metric !== 'rate') {
            const r = nearest(rateById[s.id], t, 5 * time.MIN);
            if (r) h += `<div style="color:${T.muted};font-size:11px;margin:0 0 4px 14px">${fmt.signed(r[1], 1, ' cm/h')} · ${esc(explainRate(r[1], rateById[s.id].map(x => x[1])))}</div>`;
          }
        }
        return h;
      },
    },
    xAxis: { type: 'time', ...axisCommon(T), splitLine: { show: false }, axisLabel: { ...axisCommon(T).axisLabel, formatter: timeLabel(span), rich: { d: { fontWeight: 'bold', color: T.text, fontSize: 11 } } } },
    yAxis: {
      type: 'value', scale: metric !== 'range', ...axisCommon(T),
      name: compact ? '' : M.unit, nameTextStyle: { color: T.muted, fontSize: 11, align: 'right' },
      axisLabel: { ...axisCommon(T).axisLabel, formatter: v => (metric === 'stage' ? v.toFixed(2) : metric === 'aod' ? v.toFixed(1) : String(Math.round(v * 10) / 10)) },
    },
    dataZoom: [
      { type: 'inside', filterMode: 'none', zoomOnMouseWheel: 'shift', moveOnMouseMove: true, ...(zoom || {}) },
      ...(slider ? [{
        type: 'slider', filterMode: 'none', height: 30, bottom: 12, brushSelect: true, ...(zoom || {}),
        borderColor: T.line, backgroundColor: T.surface2, fillerColor: T.accentSoft,
        handleStyle: { color: T.accent, borderColor: T.accent }, moveHandleStyle: { color: T.accent },
        dataBackground: { lineStyle: { color: T.muted, opacity: 0.6 }, areaStyle: { color: T.muted, opacity: 0.12 } },
        selectedDataBackground: { lineStyle: { color: T.accent }, areaStyle: { color: T.accent, opacity: 0.2 } },
        textStyle: { color: T.muted, fontSize: 10 }, labelFormatter: v => fmt.dateTime(v),
      }] : []),
    ],
    series: series.map((s, i) => ({
      id: s.id, name: s.name, type: 'line', data: s.data, showSymbol: false, symbolSize: 6, connectNulls: false,
      sampling: s.data.length > 4000 ? 'lttb' : undefined,
      lineStyle: { width: s.highlight ? 3 : 2, color: s.color, opacity: s.dim ? 0.25 : 1 },
      emphasis: { focus: 'series', lineStyle: { width: 3.5 } },
      areaStyle: single && metric !== 'rate' ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: s.color + '55' }, { offset: 1, color: s.color + '00' }] } } : undefined,
      z: s.highlight ? 5 : 2,
      markArea: i === 0 && bands.length ? { silent: true, data: bands.map(b => [{ yAxis: b.from, name: b.label, itemStyle: { color: b.color }, label: { show: !compact, position: 'insideTopLeft', color: T.muted, fontSize: 10, formatter: b.label } }, { yAxis: b.to }]) } : undefined,
      markLine: i === 0 && (thresholds.length || userNotes.length) ? {
        silent: false, symbol: 'none', animation: false,
        data: [
          ...thresholds.map(th => ({ yAxis: th.value, name: th.label, lineStyle: { color: th.color, type: th.dashed ? 'dashed' : 'solid', width: 1.2 }, label: { show: !compact, formatter: `${th.label} ${th.value.toFixed(2)} m`, position: 'insideEndTop', color: th.color, fontSize: 10 } })),
          ...userNotes.map(t => ({ xAxis: t, name: 'Your note', lineStyle: { color: T.accent, type: 'dotted', width: 1.5 }, label: { formatter: `📌 ${fmt.dateTime(t)}`, position: 'insideEndTop', color: T.accent, fontSize: 10 } })),
        ],
      } : undefined,
      markPoint: i === 0 && annotations.length ? {
        symbol: 'pin', symbolSize: 34, animation: animate,
        data: annotations.map(a => ({ coord: [a.t, a.v], name: a.label, value: a.kind === 'peak' ? '▲' : a.kind === 'low' ? '▼' : a.kind === 'rise' ? '↑' : '↓', itemStyle: { color: a.kind === 'rise' || a.kind === 'peak' ? T.rise : T.fall } })),
        label: { color: '#fff', fontSize: 11 },
        tooltip: { trigger: 'item', formatter: p => `<b>${esc(p.name)}</b><br>${esc(fmt.full(p.data.coord[0]))}<br>${p.data.coord[1].toFixed(3)} m` },
      } : undefined,
    })),
  };
  return out;
}

/* ---------- 2. Rate of change ---------- */

export function rateOption({ data, T, animate = true, name = 'Rate of change' }) {
  const all = data.map(p => p[1]);
  const span = data.length ? data[data.length - 1][0] - data[0][0] : time.DAY;
  // Only positive rates count as rises and only negative ones as falls, so an
  // all-falling window never reports a "fastest rise".
  const up = extremes(data.filter(p => p[1] > 0)).hi, down = extremes(data.filter(p => p[1] < 0)).lo;
  const desc = data.length
    ? `Bar chart of rate of change for ${name}, centimetres per hour, UK time, ${fmt.dateTime(data[0][0])} to ${fmt.dateTime(data[data.length - 1][0])}. ` +
      (up ? `Fastest rise ${fmt.signed(up[1], 1)} cm/h at ${fmt.dateTime(up[0])}` : 'No rise in this window') + '; ' +
      (down ? `fastest fall ${fmt.signed(down[1], 1)} cm/h at ${fmt.dateTime(down[0])}.` : 'no fall in this window.')
    : `Rate of change for ${name}: not enough readings.`;
  return {
    ...base(T, animate, desc),
    grid: { left: 52, right: 18, top: 24, bottom: 70 },
    tooltip: {
      ...tooltipBase(T), trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter(ps) {
        const p = ps[0];
        return `<b>${esc(fmt.full(p.value[0]))}</b><br>${dot(p.color)}${fmt.signed(p.value[1], 1, ' cm per hour')}<br><span style="color:${T.muted}">${esc(explainRate(p.value[1], all))}</span>`;
      },
    },
    xAxis: { type: 'time', ...axisCommon(T), splitLine: { show: false }, axisLabel: { ...axisCommon(T).axisLabel, formatter: timeLabel(span), rich: { d: { fontWeight: 'bold', color: T.text } } } },
    yAxis: { type: 'value', name: 'cm/h', ...axisCommon(T), nameTextStyle: { color: T.muted, fontSize: 11 } },
    visualMap: { show: false, pieces: [{ lt: 0, color: T.fall }, { gte: 0, color: T.rise }], dimension: 1 },
    dataZoom: [{ type: 'inside', filterMode: 'none', zoomOnMouseWheel: 'shift' }, { type: 'slider', height: 24, bottom: 10, borderColor: T.line, fillerColor: T.accentSoft, handleStyle: { color: T.accent }, textStyle: { color: T.muted, fontSize: 10 }, labelFormatter: v => fmt.dateTime(v), showDataShadow: false }],
    series: [{ type: 'bar', name, data, barMaxWidth: 6, large: data.length > 1500, markLine: { silent: true, symbol: 'none', data: [{ yAxis: 0 }], lineStyle: { color: T.muted }, label: { show: false } } }],
  };
}

/* ---------- 3. Position within typical range (comparison bars) ---------- */

export function rangeBarsOption({ rows, T, animate = true }) {
  const data = rows.map(r => ({ value: r.pct == null ? null : +r.pct.toFixed(1), name: r.name, row: r }));
  const color = v => (v == null ? T.muted : v > 100 ? T.alert : v < 0 ? T.fall : T.water);
  const desc = 'Bar chart of where each gauge sits in its typical range, where 0% is the typical low and 100% the typical high. ' +
    rows.map(r => `${r.name}: ${r.pct == null ? 'not available' : Math.round(r.pct) + '%'}.`).join(' ');
  return {
    ...base(T, animate, desc),
    grid: { left: 8, right: 40, top: 26, bottom: 26, containLabel: true },
    tooltip: {
      ...tooltipBase(T), trigger: 'item',
      formatter: p => {
        const r = p.data.row;
        return `<b>${esc(r.name)}</b> · ${esc(r.river)}<br>Latest ${r.value?.toFixed(3) ?? '—'} m (${esc(r.when)})<br>Typical range ${r.low?.toFixed(2)}–${r.high?.toFixed(2)} m<br><b>${p.value == null ? 'Not available' : p.value.toFixed(0) + '% of the way through its typical range'}</b><br><span style="color:${T.muted}">0% = bottom of typical range, 100% = top. Datum-independent, so gauges can be compared.</span>`;
      },
    },
    xAxis: { type: 'value', min: v => Math.min(-10, Math.floor(v.min / 10) * 10), max: v => Math.max(110, Math.ceil(v.max / 10) * 10), ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: '{value}%' } },
    yAxis: { type: 'category', inverse: true, data: rows.map(r => r.name), ...axisCommon(T), splitLine: { show: false }, axisLabel: { color: T.text, fontSize: 12 } },
    series: [{
      type: 'bar', data: data.map(d => ({ ...d, itemStyle: { color: color(d.value), borderRadius: 4 } })), barMaxWidth: 18,
      label: { show: true, position: 'right', color: T.text, fontSize: 11, formatter: p => (p.value == null ? 'n/a' : `${Math.round(p.value)}%`) },
      markArea: { silent: true, itemStyle: { color: T.accentSoft }, data: [[{ xAxis: 0, name: 'Typical range' }, { xAxis: 100 }]], label: { color: T.muted, fontSize: 10, position: 'insideTop' } },
      markLine: { silent: true, symbol: 'none', lineStyle: { color: T.muted, type: 'dashed' }, data: [{ xAxis: 0 }, { xAxis: 100 }], label: { formatter: p => (p.value === 0 ? 'Typical low' : 'Typical high'), color: T.muted, fontSize: 10 } },
    }],
  };
}

/* ---------- 4. Rainfall vs river level ---------- */

export function rainLevelOption({ rain, level, T, animate = true, rainName, levelName, levelColor }) {
  const all = [...rain, ...level];
  const t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0]));
  const span = t1 - t0;
  const total = rain.reduce((a, p) => a + (p[1] || 0), 0);
  const wet = extremes(rain).hi, lv = extremes(level);
  const desc = `Two linked charts, UK time, ${fmt.dateTime(t0)} to ${fmt.dateTime(t1)}. Top: hourly rainfall at ${rainName}, ${num(total, 1)} millimetres in ${rain.length} complete hours` +
    (wet && wet[1] > 0 ? `, wettest hour ending ${fmt.dateTime(wet[0])} with ${num(wet[1], 1)} millimetres` : '') +
    `. Bottom: ${levelName}` + (lv.hi ? `, between ${num(lv.lo[1], 2)} and ${num(lv.hi[1], 2)} metres, highest at ${fmt.dateTime(lv.hi[0])}.` : ', no readings.');
  return {
    ...base(T, animate, desc),
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [{ left: 56, right: 20, top: 24, height: '26%' }, { left: 56, right: 20, top: '42%', bottom: 70 }],
    tooltip: {
      ...tooltipBase(T), trigger: 'axis',
      formatter(ps) {
        const t = ps[0].value[0];
        return `<b>${esc(fmt.full(t))}</b><br>` + ps.map(p => `${dot(p.color)}${esc(p.seriesName)}: <b>${p.value[1] == null ? '—' : p.seriesIndex === 0 ? p.value[1].toFixed(1) + ' mm in hour' : p.value[1].toFixed(3) + ' m'}</b>`).join('<br>');
      },
    },
    xAxis: [
      { type: 'time', gridIndex: 0, min: t0, max: t1, ...axisCommon(T), axisLabel: { show: false }, splitLine: { show: false } },
      { type: 'time', gridIndex: 1, min: t0, max: t1, ...axisCommon(T), splitLine: { show: false }, axisLabel: { ...axisCommon(T).axisLabel, formatter: timeLabel(span), rich: { d: { fontWeight: 'bold', color: T.text } } } },
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, inverse: true, name: 'mm/h', nameLocation: 'start', ...axisCommon(T), nameTextStyle: { color: T.muted, fontSize: 11 } },
      { type: 'value', gridIndex: 1, scale: true, name: 'm', ...axisCommon(T), nameTextStyle: { color: T.muted, fontSize: 11 }, axisLabel: { ...axisCommon(T).axisLabel, formatter: v => v.toFixed(2) } },
    ],
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], filterMode: 'none', zoomOnMouseWheel: 'shift' }, { type: 'slider', xAxisIndex: [0, 1], height: 24, bottom: 12, borderColor: T.line, fillerColor: T.accentSoft, handleStyle: { color: T.accent }, textStyle: { color: T.muted, fontSize: 10 }, labelFormatter: v => fmt.dateTime(v), showDataShadow: false }],
    series: [
      { name: rainName, type: 'bar', xAxisIndex: 0, yAxisIndex: 0, data: rain, itemStyle: { color: T.rain, borderRadius: [0, 0, 2, 2] }, barMaxWidth: 8 },
      { name: levelName, type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: level, showSymbol: false, connectNulls: false, lineStyle: { color: levelColor || T.water, width: 2 }, itemStyle: { color: levelColor || T.water } },
    ],
  };
}

/* ---------- 5. Long-term archive (daily maxima) ---------- */

export function archiveOption({ series, T, animate = true, thresholds = [], events = [], zoom }) {
  const s0 = series[0]?.data || [];
  const desc = s0.length
    ? `Line chart of daily maximum river level for ${series[0].name}, ${fmt.dateYear(s0[0][0])} to ${fmt.dateYear(s0[s0.length - 1][0])}. Largest events: ` +
      events.slice(0, 5).map((e, i) => `${i + 1}, ${fmt.dateYear(e.t + 12 * time.HOUR)} at ${num(e.value, 2)} metres`).join('; ') + '.'
    : 'Daily maximum river level: no archive data.';
  return {
    ...base(T, animate, desc),
    color: series.map(s => s.color),
    grid: { left: 52, right: 20, top: 36, bottom: 80 },
    legend: series.length > 1 ? { top: 0, textStyle: { color: T.text } } : { show: false },
    tooltip: {
      ...tooltipBase(T), trigger: 'axis',
      formatter: ps => `<b>${esc(fmt.dateYear(ps[0].value[0]))}</b><br>` + ps.filter(p => p.value[1] != null).map(p => `${dot(p.color)}${esc(p.seriesName)} daily max <b>${p.value[1].toFixed(3)} m</b>${p.value[2] && p.value[2] !== 'G' ? ` <span style="color:${T.muted}">(${{ U: 'unchecked', S: 'suspect', E: 'estimated' }[p.value[2]] || 'quality n/a'})</span>` : ''}`).join('<br>'),
    },
    xAxis: { type: 'time', ...axisCommon(T), splitLine: { show: false }, axisLabel: { ...axisCommon(T).axisLabel, formatter: v => fmt.dateYear(v) } },
    yAxis: { type: 'value', name: 'm', scale: true, ...axisCommon(T), nameTextStyle: { color: T.muted } },
    dataZoom: [{ type: 'inside', filterMode: 'none', zoomOnMouseWheel: 'shift', ...(zoom || {}) }, { type: 'slider', height: 30, bottom: 14, brushSelect: true, borderColor: T.line, fillerColor: T.accentSoft, handleStyle: { color: T.accent }, textStyle: { color: T.muted, fontSize: 10 }, labelFormatter: v => fmt.dateYear(v), ...(zoom || {}) }],
    series: series.map((s, i) => ({
      name: s.name, type: 'line', data: s.data, showSymbol: false, sampling: 'lttb', lineStyle: { width: 1.4, color: s.color },
      markLine: i === 0 && thresholds.length ? { silent: true, symbol: 'none', data: thresholds.map(th => ({ yAxis: th.value, lineStyle: { color: th.color, type: 'dashed' }, label: { formatter: th.label, color: th.color, fontSize: 10, position: 'insideEndTop' } })) } : undefined,
      markPoint: i === 0 && events.length ? {
        symbol: 'circle', symbolSize: 9, itemStyle: { color: T.rise, borderColor: T.surface, borderWidth: 2 },
        data: events.map((e, k) => ({ coord: [e.t, e.value], name: `#${k + 1}`, label: { show: k < 5, formatter: `#${k + 1}`, position: 'top', color: T.text, fontSize: 10 } })),
      } : undefined,
    })),
  };
}

/* ---------- 6. Event overlay (aligned on peak day) ---------- */

export function eventsOverlayOption({ events, T, animate = true, reference = [] }) {
  const desc = events.length
    ? 'Line chart comparing past events, aligned on each peak day, from 15 days before to 15 days after. ' +
      events.map(e => { const pk = extremes(e.data).hi; return `${e.name}: peak ${pk ? num(pk[1], 2) : 'unavailable'} metres.`; }).join(' ')
    : 'Event comparison: no events selected.';
  return {
    ...base(T, animate, desc),
    color: T.palette,
    grid: { left: 52, right: 24, top: 64, bottom: 44 },
    legend: { top: 0, type: 'scroll', data: events.map(e => e.name), textStyle: { color: T.text, fontSize: 11 }, pageTextStyle: { color: T.muted } },
    tooltip: {
      ...tooltipBase(T), trigger: 'axis',
      formatter: ps => `<b>${ps[0].value[0] === 0 ? 'Peak day' : (ps[0].value[0] > 0 ? '+' : '') + ps[0].value[0] + ' days from peak'}</b><br>` + ps.map(p => `${dot(p.color)}${esc(p.seriesName)}: <b>${p.value[1].toFixed(2)} m</b>`).join('<br>'),
    },
    xAxis: { type: 'value', min: -15, max: 15, interval: 5, name: 'Days from peak', nameLocation: 'middle', nameGap: 28, ...axisCommon(T), nameTextStyle: { color: T.muted } },
    yAxis: { type: 'value', name: 'Daily max (m)', scale: true, ...axisCommon(T), nameTextStyle: { color: T.muted } },
    series: [
      ...events.map(e => ({ name: e.name, type: 'line', data: e.data, smooth: false, showSymbol: false, lineStyle: { width: 2 }, emphasis: { focus: 'series' } })),
      ...(reference.length ? [{
        name: 'Reference levels', type: 'line', data: [], markLine: { silent: true, symbol: 'none', data: reference.map(r => ({ yAxis: r.value, lineStyle: { color: r.color, type: 'dashed' }, label: { formatter: r.label, color: r.color, fontSize: 10, position: 'insideEndTop' } })) },
      }] : []),
    ],
  };
}

/* ---------- 7. Calendar heatmap of daily maxima ---------- */

export function calendarOption({ year, rows, T, animate = true, low, high, narrow = false }) {
  const data = rows.filter(r => r[0].startsWith(String(year))).map(r => [r[0], r[1]]);
  const vals = data.map(d => d[1]);
  const top = data.reduce((m, d) => (d[1] > (m?.[1] ?? -Infinity) ? d : m), null);
  const desc = data.length
    ? `Calendar of daily maximum river level in ${year}, ${data.length} days with data. Highest ${num(top[1], 2)} metres on ${fmt.dateYear(Date.parse(top[0] + 'T12:00:00Z'))}.`
    : `Calendar for ${year}: no data.`;
  return {
    ...base(T, animate, desc),
    tooltip: { ...tooltipBase(T), formatter: p => `<b>${esc(fmt.dateYear(Date.parse(p.value[0] + 'T12:00:00Z')))}</b><br>Daily max ${p.value[1].toFixed(3)} m` },
    visualMap: {
      min: Math.min(...vals, low ?? Infinity), max: Math.max(...vals, high ?? -Infinity), calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
      inRange: { color: T.sequential }, textStyle: { color: T.muted, fontSize: 10 }, formatter: v => v.toFixed(1) + ' m', itemHeight: 140,
    },
    calendar: {
      range: String(year), top: 30, left: narrow ? 26 : 40, right: 10, bottom: 60, cellSize: ['auto', narrow ? 9 : 14],
      orient: 'horizontal', splitLine: { lineStyle: { color: T.line } }, itemStyle: { borderColor: T.bg, borderWidth: 1.5, color: T.surface2 },
      yearLabel: { show: false }, monthLabel: { color: T.muted, fontSize: 10, nameMap: 'EN' }, dayLabel: { color: T.muted, fontSize: 9, firstDay: 1, nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] },
    },
    series: [{ type: 'heatmap', coordinateSystem: 'calendar', data }],
  };
}

/* ---------- 8. Scenario simulator (hypothetical) ---------- */

export function simulationOption({ observed, simulated, thresholds, T, animate = true }) {
  const span = (simulated.at(-1)?.[0] ?? 0) - (observed[0]?.[0] ?? 0);
  const end = simulated.at(-1);
  const desc = `Simulation chart, hypothetical and not a forecast. Observed level up to ${observed.length ? fmt.dateTime(observed[observed.length - 1][0]) : 'now'}, then a straight-line what-if reaching ${end ? num(end[1], 2) : 'unavailable'} metres at ${end ? fmt.dateTime(end[0]) : 'the end'}.`;
  return {
    ...base(T, animate, desc),
    grid: { left: 52, right: 20, top: 30, bottom: 40 },
    legend: { top: 0, textStyle: { color: T.text, fontSize: 11 } },
    tooltip: { ...tooltipBase(T), trigger: 'axis', formatter: ps => `<b>${esc(fmt.full(ps[0].value[0]))}</b><br>` + ps.filter(p => p.value[1] != null).map(p => `${dot(p.color)}${esc(p.seriesName)}: <b>${p.value[1].toFixed(3)} m</b>`).join('<br>') },
    xAxis: { type: 'time', ...axisCommon(T), splitLine: { show: false }, axisLabel: { ...axisCommon(T).axisLabel, formatter: timeLabel(span), rich: { d: { fontWeight: 'bold', color: T.text } } } },
    yAxis: { type: 'value', scale: true, name: 'm', ...axisCommon(T), nameTextStyle: { color: T.muted } },
    series: [
      { name: 'Observed (EA)', type: 'line', data: observed, showSymbol: false, lineStyle: { color: T.water, width: 2 }, itemStyle: { color: T.water } },
      {
        name: 'SIMULATION (hypothetical)', type: 'line', data: simulated, showSymbol: false, lineStyle: { color: T.sim, width: 2, type: [6, 4] }, itemStyle: { color: T.sim },
        areaStyle: { color: T.sim, opacity: 0.06 },
        markLine: { silent: true, symbol: 'none', data: thresholds.map(th => ({ yAxis: th.value, lineStyle: { color: th.color, type: 'dashed' }, label: { formatter: `${th.label} ${th.value.toFixed(2)} m`, color: th.color, fontSize: 10, position: 'insideEndTop' } })) },
      },
    ],
  };
}

/* ---------- Inline SVG primitives (no chart instance needed) ---------- */

export function sparkline(series, { width = 120, height = 34, color = 'currentColor', fill = true, band = null } = {}) {
  const pts = series.filter(p => p[1] != null);
  if (pts.length < 2) return `<svg viewBox="0 0 ${width} ${height}" class="spark" aria-hidden="true"></svg>`;
  let lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
  if (hi - lo < 1e-6) { lo -= 0.01; hi += 0.01; }
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  const x = t => ((t - t0) / (t1 - t0 || 1)) * (width - 4) + 2;
  const y = v => height - 3 - ((v - lo) / (hi - lo)) * (height - 6);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  const bandEl = band && band.high > lo && band.low < hi ? `<rect x="0" width="${width}" y="${y(Math.min(band.high, hi)).toFixed(1)}" height="${Math.max(0, y(Math.max(band.low, lo)) - y(Math.min(band.high, hi))).toFixed(1)}" fill="${color}" opacity=".07"/>` : '';
  return `<svg viewBox="0 0 ${width} ${height}" class="spark" aria-hidden="true" preserveAspectRatio="none">${bandEl}${fill ? `<path d="${d}L${x(last[0]).toFixed(1)},${height}L2,${height}Z" fill="${color}" opacity=".12"/>` : ''}<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><circle cx="${x(last[0]).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="2.4" fill="${color}"/></svg>`;
}

// Semicircular gauge with EA reference levels. Rendered as SVG so the needle
// can animate with CSS (and stay still under prefers-reduced-motion).
export function gaugeSVG({ value, scale, T, label = 'Latest level' }) {
  const max = Math.max(scale?.scaleMax || 0, (scale?.maxOnRecord?.value || 0) * 1.05, (value || 0) * 1.1, 1);
  const min = Math.min(0, value ?? 0);
  const cx = 160, cy = 150, r = 118;
  const ang = v => Math.PI * (1 - (Math.max(min, Math.min(max, v)) - min) / (max - min));
  const pt = (v, rr = r) => [cx + rr * Math.cos(ang(v)), cy - rr * Math.sin(ang(v))];
  const arc = (a, b, rr, color, w) => {
    if (!(b > a)) return '';
    const [x1, y1] = pt(a, rr), [x2, y2] = pt(b, rr);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}A${rr} ${rr} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="butt"/>`;
  };
  const low = scale?.low, high = scale?.high, hr = scale?.highestRecent?.value, rec = scale?.maxOnRecord?.value;
  let bands = arc(min, max, r, T.surface2, 16);
  if (Number.isFinite(low) && Number.isFinite(high)) {
    bands += arc(min, low, r, T.fall + '88', 16) + arc(low, high, r, T.water, 16) + arc(high, Number.isFinite(hr) ? hr : max, r, T.alert, 16);
    if (Number.isFinite(hr)) bands += arc(hr, max, r, T.severe, 16);
  }
  const tick = (v, text, color, outside = true) => {
    if (!Number.isFinite(v)) return '';
    if (!text) { const [a1, b1] = pt(v, r - 10), [a2, b2] = pt(v, r + 10); return `<line x1="${a1.toFixed(1)}" y1="${b1.toFixed(1)}" x2="${a2.toFixed(1)}" y2="${b2.toFixed(1)}" stroke="${color}" stroke-width="2.5"/>`; }
    const [x1, y1] = pt(v, r - 10), [x2, y2] = pt(v, r + 12), [tx, ty] = pt(v, outside ? r + 26 : r - 30);
    const anchor = tx < cx - 10 ? 'end' : tx > cx + 10 ? 'start' : 'middle';
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="2"/><text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}" font-size="10.5" fill="${color}">${esc(text)}</text>`;
  };
  const deg = value == null ? -90 : -90 + (1 - ang(value) / Math.PI) * 180;
  return `<svg viewBox="-44 0 408 196" class="gauge" role="img" aria-label="${esc(label)}: ${value == null ? 'unavailable' : value.toFixed(2) + ' metres'}. Typical range ${low ?? '?'} to ${high ?? '?'} metres; highest recent ${hr ?? '?'} m; maximum on record ${rec ?? '?'} m.">
  ${bands}
  ${tick(low, `Typical low ${low?.toFixed(2)}`, T.muted)}${tick(high, `Typical high ${high?.toFixed(2)}`, T.text)}${tick(hr, '', T.alert)}${tick(rec, '', T.severe)}
  <text x="${cx - r}" y="${cy + 18}" text-anchor="middle" font-size="10" fill="${T.muted}">${min.toFixed(0)} m</text><text x="${cx + r}" y="${cy + 18}" text-anchor="middle" font-size="10" fill="${T.muted}">${max.toFixed(1)} m</text>
  <g class="gauge-needle" style="transform-origin:${cx}px ${cy}px;transform:rotate(${deg.toFixed(2)}deg)"><path d="M${cx - 4} ${cy}L${cx} ${cy - r + 22}L${cx + 4} ${cy}Z" fill="${T.text}"/></g>
  <circle cx="${cx}" cy="${cy}" r="9" fill="${T.text}"/><circle cx="${cx}" cy="${cy}" r="4" fill="${T.bg}"/>
  <text x="${cx}" y="${cy + 38}" text-anchor="middle" font-size="22" font-weight="600" fill="${T.text}" style="font-variant-numeric:tabular-nums">${value == null ? '—' : value.toFixed(2) + ' m'}</text>
</svg><div class="gauge-legend">${Number.isFinite(hr) ? `<span><i style="background:${T.alert}"></i>Highest recent ${hr.toFixed(2)} m</span>` : ''}${Number.isFinite(rec) ? `<span><i style="background:${T.severe}"></i>Record ${rec.toFixed(2)} m</span>` : ''}</div>`;
}
