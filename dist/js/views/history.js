// Historical explorer: EA Hydrology daily maxima since 2000.
import { $, $$, esc, mountChart, download, errorBox } from '../ui.js';
import { archiveOption, eventsOverlayOption, calendarOption } from '../charts.js';
import { topEvents, eventWindow, percentileRank, fmt, toCSV, time, parseTime, ukDateInput } from '../data.js';
import { STATIONS, PRIMARY } from '../config.js';
import { getStatic } from '../api.js';

const QUALITY = { G: 'Good', U: 'Unchecked', S: 'Suspect', E: 'Estimated', '?': 'Not stated' };

export function createHistory(ctx) {
  const { live } = ctx;
  let archive = null, station = PRIMARY, events = [], picked = new Set(), year = new Date().getUTCFullYear(), charts = {};

  const ids = () => STATIONS.filter(s => archive?.stations[s.id]).map(s => s.id);
  const rowsOf = id => archive.stations[id].rows;

  function mount() {
    charts.long = mountChart($('#hi-chart'));
    charts.overlay = mountChart($('#hi-overlay'));
    charts.cal = mountChart($('#hi-cal'));
    $('#hi-station').onchange = e => { station = e.target.value; picked = new Set(); draw(); };
    $('#hi-prev').onclick = () => { year--; drawCalendar(); };
    $('#hi-next').onclick = () => { year++; drawCalendar(); };
    $('#hi-csv').onclick = () => archive && download(`archive-daily-${station}.csv`, toCSV(['date_gmt', 'daily_max_m_asd', 'daily_min_m_asd', 'quality_of_max'], rowsOf(station).map(r => [r[0], r[1], r[2], QUALITY[r[3]] || r[3]])));
    charts.cal.chart?.on('click', p => zoomTo(Date.parse(p.value[0] + 'T12:00:00Z'), 20));
  }

  async function load() {
    if (archive) return draw();
    $('#hi-source').textContent = 'Loading the EA archive (≈300 kB)…';
    try {
      archive = await getStatic('data/archive-daily.json');
      if (!archive.stations[station]) station = ids()[0];
      $('#hi-station').innerHTML = ids().map(id => `<option value="${id}" ${id === station ? 'selected' : ''}>${esc(live.station(id).label)} · ${esc(live.station(id).river)}</option>`).join('');
      draw();
    } catch (e) {
      $('#hi-source').replaceChildren(errorBox(e.message, load));
    }
  }

  function draw() {
    if (!archive) return;
    const rows = rowsOf(station), st = live.station(station), sc = st.scale || {};
    const retrieved = parseTime(archive.retrievedAt);
    // Whole calendar days between the UK retrieval date and the last archived day.
    const lagDays = Math.round((Date.parse(ukDateInput(retrieved)) - Date.parse(rows.at(-1)[0])) / time.DAY);
    $('#hi-source').innerHTML = `${rows.length.toLocaleString('en-GB')} days · ${esc(fmt.dateYear(Date.parse(rows[0][0])))} to ${esc(fmt.dateYear(Date.parse(rows.at(-1)[0])))} · EA Hydrology API, retrieved ${esc(fmt.dateYear(retrieved))}. <b>The quality-checked archive runs about a week behind</b> (latest archived day was ${lagDays} days before retrieval); for the most recent days use Overview or Explore, which read the live feed.`;
    const minYear = +rows[0][0].slice(0, 4), maxYear = +rows.at(-1)[0].slice(0, 4);
    year = Math.min(Math.max(year, minYear), maxYear);
    events = topEvents(rows, { count: 12, separationDays: 14 });
    if (!picked.size) events.slice(0, 4).forEach(e => picked.add(e.date));

    // Context tiles
    const maxes = rows.map(r => r[1]);
    const last = live.latestOf(station);
    const pr = percentileRank(last?.[1], maxes);
    const above = sc.high != null ? rows.filter(r => r[1] > sc.high).length : null;
    const years = (Date.parse(rows.at(-1)[0]) - Date.parse(rows[0][0])) / (365.25 * time.DAY);
    const q = rows.reduce((a, r) => ((a[r[3]] = (a[r[3]] || 0) + 1), a), {});
    const stat = (label, v, small) => `<div class="stat"><span>${label}</span><strong>${v}</strong><small>${small}</small></div>`;
    $('#hi-context').innerHTML = [
      stat('Highest daily max in archive', `${events[0].value.toFixed(2)} m`, fmt.dateYear(events[0].t)),
      stat('Latest reading vs history', pr == null ? '—' : `${Math.round(pr)}%`, last ? `of archived days had a lower daily max than ${last[1].toFixed(2)} m` : 'No live reading'),
      stat('Days above typical high', above == null ? '—' : above.toLocaleString('en-GB'), above == null ? '' : `≈ ${(above / years).toFixed(0)} days a year on average`),
      stat('Data quality (daily max)', `${Math.round(((q.G || 0) / rows.length) * 100)}% good`, Object.entries(q).filter(([k]) => k !== 'G').map(([k, n]) => `${n} ${QUALITY[k].toLowerCase()}`).join(', ') || 'all good'),
    ].join('');

    charts.long.set(archiveOption({
      series: [{ name: st.label, color: ctx.colorOf(station), data: rows.map(r => [Date.parse(r[0] + 'T12:00:00Z'), r[1], r[3]]) }],
      thresholds: [sc.high != null && { value: sc.high, label: 'Typical high', color: ctx.T.water }, sc.highestRecent?.value && { value: sc.highestRecent.value, label: 'Highest recent (EA)', color: ctx.T.alert }].filter(Boolean),
      events, T: ctx.T, animate: ctx.animate,
    }));
    drawEvents();
    drawCalendar();
  }

  function drawEvents() {
    const last = live.latestOf(station);
    $('#hi-events').innerHTML = `<thead><tr><th>#</th><th>Peak day (GMT)</th><th class="n">Daily max</th><th class="n">vs latest</th><th>Quality</th><th>Compare</th></tr></thead><tbody>${events.map((e, i) => `
      <tr aria-selected="${picked.has(e.date)}"><td>${i + 1}</td><td><button type="button" class="link" data-zoom="${e.t}">${esc(fmt.dateYear(e.t + 12 * time.HOUR))}</button></td><td class="n">${e.value.toFixed(2)} m</td><td class="n">${last ? fmt.signed(last[1] - e.value, 2, ' m') : '—'}</td><td><span class="q-tag">${esc(QUALITY[e.quality] || '—')}</span></td><td><input type="checkbox" data-date="${e.date}" ${picked.has(e.date) ? 'checked' : ''} aria-label="Overlay event of ${esc(e.date)}"></td></tr>`).join('')}</tbody>`;
    $$('#hi-events [data-zoom]').forEach(b => (b.onclick = () => zoomTo(Number(b.dataset.zoom), 60)));
    $$('#hi-events input[data-date]').forEach(cb => (cb.onchange = () => {
      cb.checked ? picked.add(cb.dataset.date) : picked.delete(cb.dataset.date);
      cb.closest('tr').setAttribute('aria-selected', String(cb.checked));
      drawOverlay();
    }));
    drawOverlay();
  }

  function drawOverlay() {
    const rows = rowsOf(station), sc = live.station(station).scale || {}, last = live.latestOf(station);
    const evs = events.filter(e => picked.has(e.date)).map(e => ({ name: fmt.dateYear(e.t + 12 * time.HOUR), data: eventWindow(rows, e.date, 15) }));
    charts.overlay.set(eventsOverlayOption({
      events: evs, T: ctx.T, animate: ctx.animate,
      reference: [last && { value: last[1], label: `Latest ${last[1].toFixed(2)} m`, color: ctx.T.accent, position: 'insideStartBottom' }, sc.high != null && { value: sc.high, label: 'Typical high', color: ctx.T.water }].filter(Boolean),
    }));
  }

  function drawCalendar() {
    if (!archive) return;
    const rows = rowsOf(station), sc = live.station(station).scale || {};
    const minYear = +rows[0][0].slice(0, 4), maxYear = +rows.at(-1)[0].slice(0, 4);
    year = Math.min(Math.max(year, minYear), maxYear);
    $('#hi-year').textContent = year;
    $('#hi-prev').disabled = year <= minYear;
    $('#hi-next').disabled = year >= maxYear;
    charts.cal.set(calendarOption({ year, rows, T: ctx.T, animate: ctx.animate, low: sc.low, high: sc.high, highestRecent: sc.highestRecent?.value, narrow: innerWidth < 640 }));
  }

  function zoomTo(t, days) {
    charts.long.chart?.dispatchAction({ type: 'dataZoom', startValue: t - days * time.DAY, endValue: t + days * time.DAY });
    $('#hi-long').scrollIntoView({ behavior: ctx.animate ? 'smooth' : 'auto', block: 'start' });
  }

  return {
    mount,
    render() { load(); },
    onState(s, prev) { if (s.station !== prev.station && archive?.stations[s.station]) { station = s.station; picked = new Set(); $('#hi-station').value = station; draw(); } },
    onData() { if (archive) draw(); },
    setStation(id) { if (archive?.stations[id] || !archive) station = id; },
  };
}
