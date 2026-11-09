// "The river at a glance": a schematic of the gauges in the order the water passes them, with the Teme joining the Severn below
// Diglis. It is a diagram, not a map (nothing is to scale), and it draws only what the station cards already state: each gauge's
// latest EA reading, its trend, and where that reading sits between the EA's typical low and typical high for that gauge.
// Pure: returns SVG markup. Colours come from the page's CSS variables (classes below), so it follows the theme without redrawing.

const escXml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Where each gauge sits in the two drawings. `wide` flows left to right, `tall` (phones) top to bottom.
const SEVERN = ['2001', '2642', '2085', '2616', '2032'];
const TEME = ['2029', '2086'];
const LAYOUTS = {
  wide: {
    width: 1040, height: 290,
    severn: { path: 'M14,128 L1008,128', label: [14, 152], at: { 2001: [56, 128], 2642: [246, 128], 2085: [428, 128], 2616: [690, 128], 2032: [868, 128] } },
    teme: { path: 'M150,256 L520,256 C580,256 572,128 628,128', label: [150, 280], at: { 2029: [200, 256], 2086: [382, 256] } },
    arrow: 'M1008,128 l-12,-7 v14 z', flow: [1008, 152, 'end'],
    // The meter stands above its node, with the words to its right.
    meter: ([x, y]) => ({ x: x - 6, top: y - 84, stem: `M${x},${y - 32} V${y}`, text: [x + 16, y - 72] }),
  },
  tall: {
    width: 360, height: 640,
    severn: { path: 'M34,22 L34,618', label: [48, 16], at: { 2001: [34, 68], 2642: [34, 148], 2085: [34, 228], 2616: [34, 498], 2032: [34, 578] } },
    teme: { path: 'M96,286 L96,410 C96,446 34,426 34,458', label: [108, 284], at: { 2029: [96, 328], 2086: [96, 400] } },
    arrow: 'M34,630 l-7,-12 h14 z', flow: [48, 628, 'start'],
    // The meter stands to the right of its node, with the words beyond it.
    meter: ([x, y]) => ({ x: x + 18, top: y - 26, stem: `M${x},${y} H${x + 18}`, text: [x + 40, y - 12] }),
  },
};
const METER_W = 12, METER_H = 52;

// How much of the meter is filled: 0 at the typical low, 1 at the typical high, and never outside the meter.
export function meterFill(pct) {
  return pct == null || !Number.isFinite(pct) ? null : Math.max(0, Math.min(1, pct / 100));
}

function node(row, layout) {
  const p = (layout.severn.at[row.id] || layout.teme.at[row.id]);
  if (!p) return '';
  const m = layout.meter(p), fill = meterFill(row.pos?.pct), key = row.pos?.key || 'unknown';
  const [tx, ty] = m.text;
  const has = row.value != null && Number.isFinite(row.value);
  const fillH = fill == null ? 0 : Math.max(fill * METER_H, 3); // at the typical low there is still a sliver to see
  const words = !has ? (row.note || 'No data') : row.pos?.label || 'No typical range published';
  return `<g class="rs-node${row.primary ? ' is-primary' : ''}${row.delayed ? ' is-delayed' : ''}" data-id="${escXml(row.id)}" data-k="${escXml(key)}">
    <title>${escXml(row.label)}: ${has ? `${row.value.toFixed(2)} m, ${escXml((row.trend?.label || 'trend unavailable').toLowerCase())}, ${escXml(words.toLowerCase())}` : escXml(words)}${row.delayed ? ' (delayed reading)' : ''}</title>
    <path class="rs-stem" d="${m.stem}"/>
    <rect class="rs-meter" x="${m.x}" y="${m.top}" width="${METER_W}" height="${METER_H}" rx="6"/>
    ${fill == null || !has ? '' : `<rect class="rs-fill" x="${m.x}" y="${(m.top + METER_H - fillH).toFixed(1)}" width="${METER_W}" height="${fillH.toFixed(1)}" rx="6"/>`}
    ${key === 'high' && has ? `<path class="rs-over" d="M${m.x - 4},${m.top - 3} h${METER_W + 8}"/>` : ''}
    <circle class="rs-dot" cx="${p[0]}" cy="${p[1]}" r="${row.primary ? 8 : 6}"/>
    <text class="rs-name" x="${tx}" y="${ty}">${escXml(row.label)}</text>
    <text class="rs-val" x="${tx}" y="${ty + 18}">${has ? `<tspan class="rs-num">${row.value.toFixed(2)} m</tspan><tspan dx="6">${escXml(row.trend?.arrow || '')} ${escXml(row.trend?.label || '')}</tspan>` : '—'}</text>
    <text class="rs-words" x="${tx}" y="${ty + 35}">${escXml(words)}${row.delayed && has ? ' · delayed' : ''}</text>
  </g>`;
}

// One sentence per gauge, for people who cannot see the drawing (the cards below carry the same facts in full).
export function stripSummary(rows) {
  const say = r => (r.value != null && Number.isFinite(r.value)
    ? `${r.label} ${r.value.toFixed(2)} metres, ${(r.trend?.label || 'trend unavailable').toLowerCase()}, ${(r.pos?.label || 'no typical range published').toLowerCase()}`
    : `${r.label} no reading`);
  const by = ids => ids.map(id => rows.find(r => r.id === id)).filter(Boolean).map(say).join('; ');
  return `Diagram of the gauges in river order, not to scale. River Severn, upstream to downstream: ${by(SEVERN)}. River Teme, which joins the Severn below Diglis: ${by(TEME)}.`;
}

// rows: [{ id, label, value (m) or null, pos: rangePosition(), trend: trend(), primary, delayed, note }]
export function riverStrip(rows, which = 'wide') {
  const L = LAYOUTS[which];
  const [fx, fy, anchor] = L.flow;
  return `<svg class="rs rs-${which}" viewBox="0 0 ${L.width} ${L.height}" role="img" aria-label="${escXml(stripSummary(rows))}" focusable="false">
    <path class="rs-river rs-teme" d="${L.teme.path}"/>
    <path class="rs-river" d="${L.severn.path}"/>
    <path class="rs-arrow" d="${L.arrow}"/>
    <text class="rs-label" x="${L.severn.label[0]}" y="${L.severn.label[1]}">RIVER SEVERN</text>
    <text class="rs-label" x="${L.teme.label[0]}" y="${L.teme.label[1]}">RIVER TEME</text>
    <text class="rs-label" x="${fx}" y="${fy}" text-anchor="${anchor}">DOWNSTREAM</text>
    ${rows.map(r => node(r, L)).join('\n')}
  </svg>`;
}

export const STRIP_ORDER = [...SEVERN, ...TEME];
