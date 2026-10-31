// Geographic river explorer (Leaflet).
/* global L */
import { $, $$, esc, toast, toggleFullscreen } from '../ui.js';
import { sparkline } from '../charts.js';
import { HOME, STATIONS, RAIN_GAUGES, SEVERITY } from '../config.js';
import { change, currentRate, trend, rangePosition, freshness, fmt, totalRain, time } from '../data.js';
import * as api from '../api.js';

const RAINVIEWER = 'https://api.rainviewer.com/public/weather-maps.json';

export function basemap() {
  // OpenStreetMap standard tiles; the dark theme recolours them with a CSS filter.
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, className: 'osm-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
}

export function bandColor(T, key) {
  return key === 'high' ? T.rise : key === 'low' ? T.fall : key === 'normal' ? T.water : T.muted;
}

// Label colour with the higher WCAG contrast against the marker fill.
export function inkFor(hex) {
  const lum = h => {
    const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return '#ffffff';
  const l = lum(hex);
  return (1.05 / (l + 0.05)) >= ((l + 0.05) / (lum('#0b1517') + 0.05)) ? '#ffffff' : '#0b1517';
}

export function gaugeIcon(T, { label, key, primary, hi, dim }) {
  const bg = bandColor(T, key);
  return L.divIcon({
    className: '', iconSize: primary ? [36, 36] : [30, 30],
    html: `<div class="gauge-marker${primary ? ' is-primary' : ''}${hi ? ' is-hi' : ''}${dim ? ' is-dim' : ''}" style="background:${bg};color:${inkFor(bg)}">${esc(label)}</div>`,
  });
}

export function createMapView(ctx) {
  const { live, store } = ctx;
  let map, base, layers = {}, markers = {}, placeMarker, floodAreas = null, warnLoaded = false, rainLoaded = false, radarLoaded = false;

  function mount() {
    map = L.map('map', { zoomControl: false, preferCanvas: false, worldCopyJump: false }).setView([HOME.lat, HOME.lng], HOME.zoom);
    // Bottom-right keeps the zoom buttons clear of the station panel and search box.
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    base = basemap(ctx.theme()).addTo(map);
    map.attributionControl.addAttribution('EA data &copy; Crown copyright, <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/">OGL v3</a>');
    layers.stations = L.layerGroup().addTo(map);
    layers.rivers = L.layerGroup().addTo(map);
    layers.warnings = L.layerGroup().addTo(map);
    layers.rain = L.layerGroup();
    layers.radar = L.layerGroup();
    loadRivers();
    loadWarnings();
    // On phones start with the layer list collapsed so it doesn't cover the map.
    if (matchMedia('(max-width: 640px)').matches) $('#map-layers').open = false;

    $$('#map-layers input[data-layer]').forEach(cb => cb.addEventListener('change', () => {
      const layer = layers[cb.dataset.layer];
      if (cb.checked) {
        layer.addTo(map);
        if (cb.dataset.layer === 'rain') loadRain();
        if (cb.dataset.layer === 'radar') loadRadar();
      } else map.removeLayer(layer);
    }));
    $('#map-reset').onclick = () => { closePanel(); placeMarker?.remove(); map.flyTo([HOME.lat, HOME.lng], HOME.zoom, { duration: ctx.animate ? 0.8 : 0 }); };
    $('#map-full').onclick = () => toggleFullscreen($('#map-shell'), () => map.invalidateSize());
    document.addEventListener('fullscreenchange', () => setTimeout(() => map.invalidateSize(), 150));
    $('#map-search').onsubmit = e => { e.preventDefault(); search($('#map-q').value.trim()); };
    $('#map-q-stations').innerHTML = STATIONS.map(s => `<option value="${esc(s.label)}">`).join('');
    $('#map-list').innerHTML = STATIONS.map(s => `<button type="button" data-id="${s.id}"><span><b>${esc(s.label)}</b><small>${esc(s.river)} · ${esc(s.role)}</small></span><span class="mono" data-val></span></button>`).join('');
    $$('#map-list button').forEach(b => (b.onclick = () => { store.set({ station: b.dataset.id }); focusStation(b.dataset.id, true); $('#map-shell').scrollIntoView({ behavior: ctx.animate ? 'smooth' : 'auto' }); }));
  }

  /* ---------- Stations ---------- */

  function drawStations() {
    layers.stations.clearLayers();
    for (const cfg of STATIONS) {
      const st = live.station(cfg.id);
      const last = live.latestOf(cfg.id);
      const pos = rangePosition(last?.[1], st?.scale);
      const tr = trend(currentRate(live.series[cfg.id] || []));
      const m = L.marker([st.lat, st.lng], {
        icon: gaugeIcon(ctx.T, { label: last ? last[1].toFixed(1) : '?', key: pos.key, primary: cfg.primary }),
        keyboard: true, title: `${st.label}: ${last ? last[1].toFixed(2) + ' m' : 'no data'}`, riseOnHover: true, alt: st.label,
      });
      m.bindTooltip(`<b>${esc(st.label)}</b> · ${esc(cfg.river)}<br>${last ? `${last[1].toFixed(3)} m · ${tr.arrow} ${esc(tr.label)}<br><span style="opacity:.7">${esc(fmt.dateTime(last[0]))} · ${esc(pos.label)}</span>` : 'No reading'}`, { direction: 'top', offset: [0, -14] });
      m.on('click', () => { store.set({ station: cfg.id }); focusStation(cfg.id, false); });
      m.addTo(layers.stations);
      markers[cfg.id] = m;
      const v = $(`#map-list [data-id="${cfg.id}"] [data-val]`);
      if (v) v.textContent = last ? `${last[1].toFixed(2)} m ${tr.arrow}` : '—';
    }
  }

  function focusStation(id, fly) {
    const st = live.station(id);
    if (!st) return;
    if (fly) map.flyTo([st.lat, st.lng], Math.max(map.getZoom(), 12), { duration: ctx.animate ? 0.8 : 0 });
    openPanel(id);
  }

  function openPanel(id) {
    const cfg = STATIONS.find(s => s.id === id);
    const st = live.station(id);
    const series = live.series[id] || [];
    const last = live.latestOf(id);
    const rate = currentRate(series);
    const tr = trend(rate);
    const pos = rangePosition(last?.[1], st.scale);
    const fr = freshness(last?.[0]);
    const c24 = change(series, 24);
    const sc = st.scale || {};
    const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
    const panel = $('#map-panel');
    panel.hidden = false;
    panel.innerHTML = `
      <button type="button" class="icon-btn close" aria-label="Close station details">×</button>
      <p class="eyebrow">${esc(cfg.river)} · ${esc(cfg.role)}</p>
      <h2 class="panel-title">${esc(st.label)}</h2>
      <div class="hero-level" style="margin:8px 0 0"><span class="station-val">${last ? last[1].toFixed(3) : '—'}<small> m</small></span><span class="chip" data-k="${tr.key}">${tr.arrow} ${esc(tr.label)}${rate != null ? ' ' + fmt.signed(rate, 1, ' cm/h') : ''}</span><span class="chip" data-k="${pos.key}">${esc(pos.label)}</span></div>
      <p class="sub">${last ? `${esc(fmt.full(last[0]))} · ${esc(fmt.age(fr.ageMin))}` : esc(st.error || 'No reading available')}</p>
      ${sparkline(series, { width: 320, height: 70, color: ctx.colorOf(id), band: st.scale })}
      <p class="note">Last 24 hours. Shaded band = EA typical range.</p>
      <dl class="kv">
        ${row('Change, 24 h', c24 ? fmt.signed(c24.delta * 100, 1, ' cm') : '—')}
        ${row('Typical range', sc.low != null ? `${sc.low.toFixed(2)}–${sc.high.toFixed(2)} m` : '—')}
        ${row('Highest recent', sc.highestRecent?.value != null ? `${sc.highestRecent.value.toFixed(2)} m (${fmt.dateYear(sc.highestRecent.t)})` : '—')}
        ${row('Maximum on record', sc.maxOnRecord?.value != null ? `${sc.maxOnRecord.value.toFixed(2)} m (${fmt.dateYear(sc.maxOnRecord.t)})` : '—')}
        ${row('Stage datum (EA)', sc.datum != null ? `${sc.datum} m above Ordnance Datum` : '—')}
        ${row('EA station / measure', `<span class="mono" style="font-size:11px">${esc(id)} · ${esc(st.levelMeasure || '—')}</span>`)}
      </dl>
      <div class="station-actions">
        <button type="button" class="btn btn-small" data-go="explore">Explore</button>
        <button type="button" class="btn btn-small btn-ghost" data-go="analysis">Gauge</button>
        ${st.publicPage ? `<a class="btn btn-small btn-ghost" href="${esc(st.publicPage)}" target="_blank" rel="noopener">GOV.UK ↗</a>` : ''}
      </div>
      <p class="note" style="margin-top:10px">Readings: Environment Agency real-time API. Reference levels: EA station metadata (stageScale). Typical range is not a flood-warning threshold.</p>`;
    panel.querySelector('.close').onclick = closePanel;
    panel.querySelector('[data-go="explore"]').onclick = () => ctx.go('explore', { compare: [id], station: id });
    panel.querySelector('[data-go="analysis"]').onclick = () => ctx.go('analysis', { station: id });
    Object.entries(markers).forEach(([k, m]) => m.getElement()?.firstElementChild?.classList.toggle('is-hi', k === id));
  }

  function closePanel() {
    $('#map-panel').hidden = true;
    Object.values(markers).forEach(m => m.getElement()?.firstElementChild?.classList.remove('is-hi'));
  }

  /* ---------- Layers ---------- */

  async function loadRivers() {
    try {
      const gj = await api.getStatic('data/main-rivers.geojson');
      layers.rivers.clearLayers();
      L.geoJSON(gj, { interactive: false, style: { color: ctx.T.water, weight: 2.2, opacity: 0.75 } }).addTo(layers.rivers);
    } catch { toast('River network layer unavailable', 'error'); }
  }

  async function loadWarnings() {
    try {
      floodAreas ??= await api.getFloodAreas();
      const active = new Map((live.floods?.items || []).map(f => [f.id, f]));
      // Warning areas near Worcester, plus any area (incl. large alert areas) with an active message.
      const targets = floodAreas.filter(a => a.type === 'warning' || active.has(a.id));
      for (const f of active.values()) if (!targets.some(a => a.id === f.id)) targets.push({ id: f.id, label: f.area, polygon: f.polygon, type: 'active' });
      const polys = await Promise.allSettled(targets.map(a => api.getPolygon(a.polygon)));
      layers.warnings.clearLayers();
      polys.forEach((p, i) => {
        if (p.status !== 'fulfilled') return;
        const a = targets[i], w = active.get(a.id), sev = w ? SEVERITY[w.severityLevel] : null;
        const color = !w || w.severityLevel === 4 ? ctx.T.muted : w.severityLevel <= 2 ? ctx.T.severe : ctx.T.alert;
        L.geoJSON(p.value, { style: { color, weight: w ? 2 : 1, fillColor: color, fillOpacity: w && w.severityLevel < 4 ? 0.28 : 0.07, dashArray: w ? null : '3 4' } })
          // A function, so the near/elsewhere tag reads the area list as it is when the tooltip opens
          // (it may arrive after the polygons are drawn). Same rule as the Overview and the drawer.
          .bindTooltip(() => `<b>${esc(a.label)}</b><br>${sev ? `<b style="color:${color}">${esc(sev.label)}</b>` : 'No warning in force'}${sev && sev.key !== 'removed' && live.localAreas ? `<br>${live.localAreas.has(a.id) ? 'Near Worcester' : 'Elsewhere within the 40 km search, not near Worcester'}` : ''}<br><span style="opacity:.7">EA flood warning area ${esc(a.id)}</span>`, { sticky: true })
          .on('click', () => window.open(`https://check-for-flooding.service.gov.uk/target-area/${encodeURIComponent(a.id)}`, '_blank', 'noopener'))
          .addTo(layers.warnings);
      });
      warnLoaded = true;
    } catch (e) { toast('Flood warning areas unavailable: ' + e.message, 'error'); }
  }

  async function loadRain() {
    if (rainLoaded) return;
    rainLoaded = true;
    const since = Date.now() - 24 * time.HOUR;
    const res = await Promise.allSettled(RAIN_GAUGES.map(g => live.rain(g.id, since)));
    res.forEach((r, i) => {
      const g = RAIN_GAUGES[i];
      const tot = r.status === 'fulfilled' ? totalRain(r.value, 24, Date.now()) : null;
      const text = tot && tot.count ? `${tot.mm.toFixed(1)} mm` : 'n/a';
      L.marker([g.lat, g.lng], { icon: L.divIcon({ className: '', html: `<div class="rain-marker">☂ ${text}</div>`, iconSize: [64, 20], iconAnchor: [32, 10] }) })
        .bindTooltip(`<b>${esc(g.label)}</b><br>${tot ? `${tot.mm.toFixed(1)} mm in the last 24 h<br>${tot.count}/${tot.expected} 15-min readings${tot.complete ? '' : ' (incomplete — total may be low)'}` : 'Readings unavailable'}<br><span style="opacity:.7">EA tipping-bucket gauge</span>`)
        .addTo(layers.rain);
    });
  }

  async function loadRadar() {
    if (radarLoaded) return;
    const note = $('#map-radar-note');
    try {
      const d = await api.getJSON(RAINVIEWER, { ttl: 5 * time.MIN });
      const frame = d.radar?.past?.at(-1);
      if (!frame) throw new Error('no radar frame');
      L.tileLayer(`${d.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0.6, maxNativeZoom: 7, maxZoom: 19, attribution: 'Radar &copy; <a href="https://www.rainviewer.com/">RainViewer</a>' }).addTo(layers.radar);
      note.hidden = false;
      note.textContent = `Radar frame ${fmt.time(frame.time * 1000)} ${fmt.zone(frame.time * 1000)} (third-party, indicative only; coarse at street zoom).`;
      radarLoaded = true;
    } catch (e) { note.hidden = false; note.textContent = 'Radar unavailable right now.'; }
  }

  /* ---------- Search ---------- */

  async function search(q) {
    if (!q) return;
    const st = STATIONS.find(s => s.label.toLowerCase().includes(q.toLowerCase()));
    if (st) { store.set({ station: st.id }); focusStation(st.id, true); return; }
    try {
      let hit;
      if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(q)) {
        const d = await api.getJSON(`https://api.postcodes.io/postcodes/${encodeURIComponent(q)}`, { retries: 0 });
        hit = { lat: d.result.latitude, lng: d.result.longitude, label: d.result.postcode };
      } else {
        const d = await api.getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gb&viewbox=-2.7,52.45,-1.8,51.9&q=${encodeURIComponent(q)}`, { retries: 0, ttl: 3600e3 });
        if (!d.length) throw new Error('No match');
        hit = { lat: +d[0].lat, lng: +d[0].lon, label: d[0].display_name.split(',').slice(0, 2).join(',') };
      }
      const near = STATIONS.map(s => ({ s, d: map.distance([hit.lat, hit.lng], [live.station(s.id).lat, live.station(s.id).lng]) })).sort((a, b) => a.d - b.d)[0];
      placeMarker?.remove();
      placeMarker = L.marker([hit.lat, hit.lng], { icon: L.divIcon({ className: '', html: '<div class="place-marker"></div>', iconSize: [16, 16] }) })
        .bindPopup(`<b>${esc(hit.label)}</b><br>Nearest river gauge: <b>${esc(near.s.label)}</b> (${(near.d / 1000).toFixed(1)} km)<br><a href="https://check-for-flooding.service.gov.uk/" target="_blank" rel="noopener">Check flooding here (GOV.UK) ↗</a>`)
        .addTo(map).openPopup();
      map.flyTo([hit.lat, hit.lng], 13, { duration: ctx.animate ? 0.8 : 0 });
    } catch (e) {
      toast(`No place found for “${q}”`, 'error');
    }
  }

  return {
    mount,
    render() {
      map.invalidateSize();
      drawStations();
      const id = store.get().station;
      if (id && store.get().view === 'map' && !$('#map-panel').hidden) openPanel(id);
    },
    show() {
      setTimeout(() => map.invalidateSize(), 50);
      const id = store.get().station;
      if (id && id !== '2085') focusStation(id, true);
    },
    onData() {
      drawStations();
      if (!$('#map-panel').hidden) openPanel(store.get().station);
      if (warnLoaded) loadWarnings();
    },
    onTheme() {
      map.removeLayer(base);
      base = basemap(ctx.theme()).addTo(map);
      base.bringToBack();
      loadRivers();
      drawStations();
      if (warnLoaded) loadWarnings();
    },
  };
}
