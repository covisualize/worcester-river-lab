// Flood intelligence drawer. Official warnings first, then observed context.
// Nothing here is a forecast: every figure is an EA observation or EA metadata.
import { $, $$, esc } from '../ui.js';
import { STATIONS, PRIMARY, SEVERITY, GUIDANCE, FLOODLINE, RULES } from '../config.js';
import { change, currentRate, trend, rangePosition, freshness, fmt, topEvents, parseTime } from '../data.js';
import { getStatic, netLog } from '../api.js';

export function createIntel(ctx) {
  const { live } = ctx;
  let archive = null, archiveTried = false, lastFocus = null;
  const open = new Set(['warnings', 'change']);

  function sec(id, title, badge, body) {
    return `<details class="intel-sec" data-sec="${id}" ${open.has(id) ? 'open' : ''}><summary>${title}${badge || ''}</summary><div>${body}</div></details>`;
  }

  function warningsHTML() {
    if (!live.floods) {
      return live.floodsError
        ? `<div class="state-error" role="alert"><strong>Warning status unavailable.</strong> ${esc(live.floodsError)}. Check <a href="https://check-for-flooding.service.gov.uk/" target="_blank" rel="noopener">Check for flooding ↗</a> directly.</div>`
        : '<p class="empty">Checking Environment Agency warnings…</p>';
    }
    const items = live.floods.items;
    const active = items.filter(f => f.severityLevel <= 3), removed = items.filter(f => f.severityLevel === 4);
    const card = f => `<article class="warn-card" data-sev="${f.severityLevel}">
      <span class="sev">${esc(SEVERITY[f.severityLevel]?.label || f.severity)}</span>
      <h4>${esc(f.area)}</h4>
      <p>${esc([f.river, f.county].filter(Boolean).join(' · '))}${f.raised ? ` · raised ${esc(fmt.dateTime(f.raised))}` : ''}${f.changed ? ` · updated ${esc(fmt.dateTime(f.changed))}` : ''}</p>
      <p>${esc(SEVERITY[f.severityLevel]?.advice || '')}</p>
      ${f.message ? `<details><summary>Official message</summary><p>${esc(f.message)}</p></details>` : ''}
      <p style="margin-top:6px"><a href="https://check-for-flooding.service.gov.uk/target-area/${encodeURIComponent(f.id)}" target="_blank" rel="noopener">View on GOV.UK ↗</a></p>
    </article>`;
    return `${active.length ? active.map(card).join('') : `<div class="all-clear"><span aria-hidden="true">✓</span><div><b>No flood warnings or alerts in force</b>within ${RULES.warningRadiusKm} km of Worcester, according to the Environment Agency at ${esc(fmt.time(live.floods.fetchedAt))} ${esc(fmt.zone(live.floods.fetchedAt))}.</div></div>`}
      ${removed.length ? `<p class="sub" style="margin:12px 0 6px">Removed in the last 24 hours:</p>${removed.map(card).join('')}` : ''}
      <p class="note" style="margin-top:10px">Source: EA flood-monitoring API <span class="mono">/id/floods</span>, refreshed every ${RULES.refreshMs / 60000} minutes while this page is open. The EA updates warnings every 15 minutes. Severe Flood Warning = danger to life; Flood Warning = flooding expected; Flood Alert = flooding possible.</p>`;
  }

  function changeHTML() {
    const rows = STATIONS.map(cfg => {
      const s = live.series[cfg.id] || [], st = live.station(cfg.id), last = live.latestOf(cfg.id);
      const c6 = change(s, 6), c24 = change(s, 24), tr = trend(currentRate(s));
      return `<tr><td>${esc(st.label)}<br><small class="sub">${esc(cfg.river)}</small></td><td class="n">${last ? last[1].toFixed(2) : '—'}</td><td class="n">${c6 ? fmt.signed(c6.delta * 100, 1) : '—'}</td><td class="n">${c24 ? fmt.signed(c24.delta * 100, 1) : '—'}</td><td><span class="chip" data-k="${tr.key}">${tr.arrow} ${esc(tr.label)}</span></td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Gauge</th><th class="n">Latest m</th><th class="n">6 h cm</th><th class="n">24 h cm</th><th>Now</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note" style="margin-top:8px">Observed changes only. Upstream rises (Bewdley, Knightsford Bridge on the Teme) often reach Worcester later, but timing varies with every event — this is not a prediction.</p>`;
  }

  function contextHTML() {
    const st = live.primary(), sc = st?.scale || {}, last = live.latestOf(PRIMARY);
    const pos = rangePosition(last?.[1], sc);
    const line = (label, v, when) => v == null ? '' : `<tr><td>${label}</td><td class="n">${v.toFixed(2)} m</td><td class="n">${last ? fmt.signed(last[1] - v, 2, ' m') : '—'}</td><td>${when ? esc(fmt.dateYear(when)) : ''}</td></tr>`;
    return `<p class="sub">Diglis latest: <b>${last ? last[1].toFixed(3) + ' m' : '—'}</b> · ${esc(pos.label)}${pos.pct != null ? ` (${Math.round(pos.pct)}% through typical range)` : ''}</p>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>EA reference level (Diglis)</th><th class="n">Level</th><th class="n">Latest vs</th><th>Date</th></tr></thead><tbody>
      ${line('Typical range — high', sc.high)}${line('Typical range — low', sc.low)}${line('Highest recent', sc.highestRecent?.value, sc.highestRecent?.t)}${line('Maximum on record', sc.maxOnRecord?.value, sc.maxOnRecord?.t)}
      </tbody></table></div>
      <p class="note" style="margin-top:8px">Verified EA station metadata (stageScale). The EA does not publish the river level at which each warning is issued through this API, so no “flood threshold” is shown — warnings above are the authoritative signal.</p>`;
  }

  function historyHTML() {
    if (!archive) return archiveTried ? '<p class="empty">Archive unavailable.</p>' : '<p class="empty">Loading archive…</p>';
    const rows = archive.stations[PRIMARY]?.rows || [];
    const last = live.latestOf(PRIMARY);
    const ev = topEvents(rows, { count: 6, separationDays: 14 });
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Largest Diglis events since 2000</th><th class="n">Daily max</th><th class="n">Latest vs peak</th></tr></thead><tbody>${ev.map(e => `<tr><td>${esc(fmt.dateYear(e.t + 43200000))}</td><td class="n">${e.value.toFixed(2)} m</td><td class="n">${last ? fmt.signed(last[1] - e.value, 2, ' m') : '—'}</td></tr>`).join('')}</tbody></table></div>
      <p class="note" style="margin-top:8px">EA Hydrology archive daily maxima (quality-flagged; retrieved ${esc(fmt.dateYear(parseTime(archive.retrievedAt)))}). Events are the highest days at least 14 days apart. <button type="button" class="link btn-link" data-go-history>Open the historical explorer →</button></p>`;
  }

  function confidenceHTML() {
    const s = live.status;
    const last = live.latestOf(PRIMARY);
    const fr = freshness(last?.[0]);
    const okStations = STATIONS.filter(c => live.series[c.id]?.length).length;
    const row = (k, label, detail) => `<i data-k="${k}"></i><span>${label}</span><span>${detail}</span>`;
    return `<div class="conf">
      ${row(s.mode === 'live' ? 'good' : s.mode === 'stale' ? 'fair' : 'poor', 'Connection', esc(s.mode === 'live' ? `Live · updated ${fmt.time(s.updatedAt)}` : s.mode === 'stale' ? 'Refresh failed — showing last good data' : s.mode === 'snapshot' ? 'Offline snapshot' : s.mode))}
      ${row(fr.key, 'Diglis reading', esc(last ? `${fmt.dateTime(last[0])} · ${fmt.age(fr.ageMin)}` : 'none'))}
      ${row(okStations === STATIONS.length ? 'good' : okStations ? 'fair' : 'poor', 'Gauges reporting', `${okStations} of ${STATIONS.length}`)}
      ${row(live.floods ? 'good' : 'poor', 'Flood warnings', esc(live.floods ? `Checked ${fmt.time(live.floods.fetchedAt)}` : live.floodsError || 'pending'))}
      ${row(archive ? 'good' : 'fair', 'Historical archive', esc(archive ? `Snapshot ${fmt.dateYear(parseTime(archive.retrievedAt))}; recent days may be unchecked` : 'not loaded'))}
      ${row(netLog.failures ? 'fair' : 'good', 'Requests', `${netLog.requests} made · ${netLog.failures} failed`)}
    </div>
    <p class="note" style="margin-top:8px">Real-time readings are provisional and may be revised; the EA labels this service Beta. “Up to date” means newer than ${RULES.freshMinutes} min; “Delayed” means older than ${RULES.staleMinutes} min (app conventions).</p>`;
  }

  function guidanceHTML() {
    return `<ul class="links">${GUIDANCE.map(g => `<li><a href="${g.url}" target="_blank" rel="noopener"><span>${esc(g.label)}</span><span aria-hidden="true">↗</span></a></li>`).join('')}</ul>
      <p class="floodline">Floodline (24 hours): <b>${FLOODLINE}</b>. In an emergency, if there is a risk to life, call <b>999</b>.</p>`;
  }

  function render() {
    const active = live.floods?.items.filter(f => f.severityLevel <= 3) || [];
    const top = active[0];
    const badge = live.floods ? `<span class="chip" data-k="${active.length ? 'high' : 'normal'}">${active.length ? `${active.length} in force` : 'None in force'}</span>` : '';
    $('#intel-body').innerHTML = [
      sec('warnings', 'Official flood warnings', badge, warningsHTML()),
      sec('change', 'Observed river changes', '', changeHTML()),
      sec('context', 'Station reference levels', '', contextHTML()),
      sec('history', 'Historical comparison', '', historyHTML()),
      sec('confidence', 'Data confidence & freshness', `<span class="chip" data-k="${live.status.mode === 'live' ? 'normal' : 'high'}">${esc(live.status.mode)}</span>`, confidenceHTML()),
      sec('guidance', 'Official guidance', '', guidanceHTML()),
      '<p class="note" style="margin-top:14px">This panel summarises Environment Agency observations and warnings. It does not forecast flooding or assess individual properties.</p>',
    ].join('');
    $$('#intel-body details').forEach(d => d.addEventListener('toggle', () => {
      d.open ? open.add(d.dataset.sec) : open.delete(d.dataset.sec);
      if (d.open && d.dataset.sec === 'history') loadArchive();
    }));
    $('#intel-body [data-go-history]')?.addEventListener('click', () => { close(); ctx.go('history', { station: PRIMARY }); });
    // Header badge
    const btn = $('#intel-open'), b = $('#intel-badge');
    btn.dataset.k = top ? SEVERITY[top.severityLevel].key : 'clear';
    b.hidden = !active.length;
    b.textContent = active.length;
    btn.title = live.floods ? `${active.length} flood warning(s)/alert(s) in force within ${RULES.warningRadiusKm} km` : 'Flood intelligence';
  }

  async function loadArchive() {
    if (archive || archiveTried) return;
    archiveTried = true;
    try { archive = await getStatic('data/archive-daily.json'); } catch { /* shown as unavailable */ }
    render();
  }

  function openDrawer(section) {
    if (section) open.add(section);
    render();
    if (open.has('history')) loadArchive();
    const d = $('#intel');
    if (!d.classList.contains('open')) lastFocus = document.activeElement;
    d.classList.add('open');
    d.setAttribute('aria-hidden', 'false');
    $('#intel-scrim').hidden = false;
    $('#intel-open').setAttribute('aria-expanded', 'true');
    d.focus();
    if (section) setTimeout(() => $(`#intel-body [data-sec="${section}"]`)?.scrollIntoView({ block: 'start', behavior: ctx.animate ? 'smooth' : 'auto' }), 200);
  }

  function close() {
    const d = $('#intel');
    if (!d.classList.contains('open')) return;
    d.classList.remove('open');
    d.setAttribute('aria-hidden', 'true');
    $('#intel-scrim').hidden = true;
    $('#intel-open').setAttribute('aria-expanded', 'false');
    ctx.store.set({ intel: false });
    lastFocus?.focus?.();
  }

  function mount() {
    $('#intel-open').onclick = () => ctx.store.set({ intel: true });
    $('#intel-close').onclick = close;
    $('#intel-scrim').onclick = close;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    // Keep keyboard focus inside the open drawer.
    $('#intel').addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const f = $$('#intel a, #intel button, #intel summary, #intel input').filter(x => x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    });
  }

  return { mount, render, open: openDrawer, close, isOpen: () => $('#intel').classList.contains('open') };
}
