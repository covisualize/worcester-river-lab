// The "river at a glance" diagram (dist/js/river-strip.js): it may only draw what the readings say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riverStrip, stripSummary, meterFill, STRIP_ORDER } from '../../dist/js/river-strip.js';
import { STATIONS } from '../../dist/js/config.js';
import { rangePosition, trend } from '../../dist/js/data.js';

const scale = { low: 0.5, high: 2.5 };
const row = (cfg, value, rate = 0, extra = {}) => ({ id: cfg.id, label: cfg.label, value, pos: rangePosition(value, scale), trend: trend(rate), primary: !!cfg.primary, ...extra });
const rows = values => STATIONS.map((cfg, i) => row(cfg, values[i]));
const fillOf = (svg, id) => svg.match(new RegExp(`data-id="${id}"[\\s\\S]*?</g>`))[0].match(/class="rs-fill"[^>]*height="([\d.]+)"/)?.[1];

test('the diagram covers exactly the configured gauges, in both layouts', () => {
  assert.deepEqual([...STRIP_ORDER].sort(), STATIONS.map(s => s.id).sort());
  for (const which of ['wide', 'tall']) {
    const svg = riverStrip(rows([1, 1, 1, 1, 1, 1, 1]), which);
    assert.equal((svg.match(/class="rs-node/g) || []).length, 7, which);
    for (const s of STATIONS) assert.ok(svg.includes(`data-id="${s.id}"`), `${which} ${s.label}`);
    assert.doesNotMatch(svg, /NaN|undefined|null/);
  }
});

test('meterFill: empty at the typical low, full at the typical high, never outside the bar', () => {
  assert.equal(meterFill(0), 0);
  assert.equal(meterFill(50), 0.5);
  assert.equal(meterFill(100), 1);
  assert.equal(meterFill(-40), 0);
  assert.equal(meterFill(260), 1);
  assert.equal(meterFill(null), null);
  assert.equal(meterFill(NaN), null);
});

test('a reading in the middle of the typical range fills half the bar; above the range it is full and marked', () => {
  const svg = riverStrip(rows([1.5, 3.2, 0.5, 0.2, 1, 1, 1]));
  assert.equal(fillOf(svg, '2001'), '26.0', 'half of the 52-unit bar');
  assert.equal(fillOf(svg, '2642'), '52.0');
  const high = svg.match(/data-id="2642"[\s\S]*?<\/g>/)[0];
  assert.match(high, /data-k="high"/);
  assert.match(high, /class="rs-over"/);
  assert.match(high, /Above typical range/);
  const low = svg.match(/data-id="2616"[\s\S]*?<\/g>/)[0];
  assert.match(low, /data-k="low"/);
  assert.doesNotMatch(low, /rs-over/);
  assert.match(low, /Below typical range/);
});

test('no reading means no fill and no number: it says so', () => {
  const r = rows([1, 1, 1, 1, 1, 1, 1]);
  r[4] = { ...r[4], value: null, pos: rangePosition(null, scale), trend: trend(null) };
  const node = riverStrip(r).match(/data-id="2032"[\s\S]*?<\/g>/)[0];
  assert.doesNotMatch(node, /rs-fill/);
  assert.match(node, /No data/);
  assert.doesNotMatch(node, /\d\.\d\d m/);
});

test('a gauge with no published typical range shows its reading but no fill', () => {
  const r = rows([1, 1, 1, 1, 1, 1, 1]);
  r[0] = { ...r[0], pos: rangePosition(1, null) };
  const node = riverStrip(r).match(/data-id="2001"[\s\S]*?<\/g>/)[0];
  assert.doesNotMatch(node, /rs-fill/);
  assert.match(node, /1\.00 m/);
  assert.match(node, /No typical range published/);
});

test('a delayed reading is marked, and names are escaped', () => {
  const r = rows([1, 1, 1, 1, 1, 1, 1]);
  r[6] = { ...r[6], delayed: true, label: 'Brans<ford> & Co' };
  const svg = riverStrip(r);
  const node = svg.match(/<g class="[^"]*" data-id="2086"[\s\S]*?<\/g>/)[0];
  assert.match(node, /^<g class="rs-node is-delayed"/);
  assert.match(node, /· delayed/);
  assert.ok(svg.includes('Brans&lt;ford&gt; &amp; Co') && !svg.includes('Brans<ford>'));
});

test('the text alternative names every gauge with its reading, trend and range, Severn first', () => {
  const s = stripSummary(rows([1.5, 3.2, 0.55, 0.2, 1, 1, 1]));
  assert.match(s, /not to scale/);
  assert.match(s, /River Severn, upstream to downstream: Bewdley 1\.50 metres, steady, within typical range; Worcester \(Barbourne\) 3\.20 metres, steady, above typical range; Diglis/);
  assert.match(s, /River Teme, which joins the Severn below Diglis: Knightsford Bridge .*; Bransford /);
  assert.ok(riverStrip(rows([1, 1, 1, 1, 1, 1, 1])).includes('role="img" aria-label="Diagram of the gauges'));
});
