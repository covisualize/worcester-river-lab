// End-to-end smoke test in headless Chromium. The site is served from dist/
// via request interception and every Environment Agency call is answered from
// tests/fixtures/ea.json (real responses captured earlier), with the clock
// fixed at capture time, so the test is deterministic and needs no network.
// Run: npm run test:e2e
import { chromium, devices } from 'playwright';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../dist/', import.meta.url));
const AXE = await readFile(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');

// WCAG 2.2 AA plus best practice; charts are canvases, so their text
// alternatives are checked separately by the unit tests.
// The Explore mini-map's markers overlap at regional zoom; WCAG 2.5.8's
// "equivalent" exception applies because the station checkboxes beside it
// offer the same function, so target-size is skipped for that map only.
async function axeViolations(page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] });
    const inMiniMap = n => !!document.querySelector('#ex-map')?.contains(document.querySelector(n.target[0]));
    return r.violations
      .map(v => (v.id === 'target-size' ? { ...v, nodes: v.nodes.filter(n => !inMiniMap(n)) } : v))
      .filter(v => v.nodes.length)
      .map(v => `${v.impact} ${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(' ')}`);
  });
}
const fx = JSON.parse(await readFile(new URL('../fixtures/ea.json', import.meta.url)));
const NOW = Date.parse(fx.capturedAt);
const ORIGIN = 'https://wr.test';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.png': 'image/png' };

// TEST-ONLY flood alert so the warning path is exercised. Never shipped.
const TEST_ALERT = {
  floodAreaID: '031WAF108', description: 'River Severn in Worcestershire (TEST FIXTURE)', severity: 'Flood alert', severityLevel: 3,
  message: 'Test fixture message.', timeRaised: fx.capturedAt, floodArea: { county: 'Worcestershire', riverOrSea: 'River Severn', polygon: 'http://environment.data.gov.uk/flood-monitoring/id/floodAreas/031WAF108/polygon' },
};
const POLY = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-2.24, 52.18], [-2.22, 52.18], [-2.22, 52.2], [-2.24, 52.18]]] } }] };

// TEST-ONLY high-water scenario: the real Feb 2020 peak at Diglis (daily max
// 5.27 m, EA archive) replayed by shifting the captured Diglis readings up so
// the latest equals that peak, with a TEST Flood Warning. Never shipped.
const FEB_2020_PEAK = 5.27;
// TEST-ONLY: an alert for a flood area outside the 12 km "near Worcester" set
// (the real case on 25 Oct 2026: River Wye in Herefordshire, ~40 km away).
const TEST_REMOTE = { ...TEST_ALERT, floodAreaID: '031WAF119', description: 'River Wye in Herefordshire (TEST FIXTURE)', floodArea: { county: 'Herefordshire', riverOrSea: 'River Wye' } };
const TEST_REMOTE_SEVERN = { ...TEST_ALERT, floodAreaID: '031WAF103', description: 'River Severn in Shropshire (TEST FIXTURE)', floodArea: { county: 'Shropshire', riverOrSea: 'River Severn' } };
const TEST_WARNING = { ...TEST_ALERT, floodAreaID: '031FWFSE440', description: 'River Severn at Hylton Road, Worcester (TEST FIXTURE)', severity: 'Flood warning', severityLevel: 2 };

function eaResponse(url, { withAlert, scenario }) {
  const u = new URL(url);
  const p = u.pathname;
  let m;
  if ((m = p.match(/\/id\/stations\/(\w+)\.json$/))) return fx.stations[m[1]] ? { items: fx.stations[m[1]] } : null;
  if ((m = p.match(/\/id\/measures\/([^/]+)\/readings$/))) {
    const since = Date.parse(u.searchParams.get('since') || 0);
    let rows = (fx.readings[m[1]] || []).filter(r => Date.parse(r.dateTime) >= since);
    if (scenario === 'high' && m[1].startsWith('2085-')) {
      const shift = FEB_2020_PEAK - fx.readings[m[1]][0].value;
      rows = rows.map(r => ({ ...r, value: +(r.value + shift).toFixed(3) }));
    }
    return { items: rows.map(r => ({ ...r, measure: `http://environment.data.gov.uk/flood-monitoring/id/measures/${m[1]}` })) };
  }
  if (p.endsWith('/id/floods')) return { items: scenario === 'high' ? [TEST_WARNING, TEST_ALERT] : scenario === 'remote' || scenario === 'remoteslow' ? [TEST_REMOTE, TEST_REMOTE_SEVERN] : withAlert ? [TEST_ALERT] : [] };
  if (p.endsWith('/id/floodAreas')) return { items: [
    { notation: '031FWFSE440', label: 'River Severn at Hylton Road, Worcester', riverOrSea: 'River Severn', lat: 52.19, long: -2.23, polygon: 'http://environment.data.gov.uk/flood-monitoring/id/floodAreas/031FWFSE440/polygon' },
    { notation: '031WAF108', label: 'River Severn in Worcestershire', riverOrSea: 'River Severn', lat: 52.18, long: -2.22, polygon: 'http://environment.data.gov.uk/flood-monitoring/id/floodAreas/031WAF108/polygon' },
  ] };
  if (p.endsWith('/polygon')) return POLY;
  if (u.hostname === 'environment.data.gov.uk') return { items: [] };
  return null;
}

async function open(browser, { path = '/', viewport, device, offline = false, withAlert = true, scenario = null } = {}) {
  const context = await browser.newContext(device ? { ...devices[device] } : { viewport: viewport || { width: 1400, height: 950 } });
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  const errors = [];
  const requested = [];
  let leafletHits = 0, leafletCssHits = 0;
  page.on('request', r => requested.push(new URL(r.url()).pathname));
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(ORIGIN)) {
      let p = new URL(url).pathname;
      if (p.endsWith('/')) p += 'index.html';
      // 'noleaflet': the map library fails on its first two requests only, so "Try again" can succeed.
      if (scenario === 'noleaflet' && p.endsWith('/vendor/leaflet/leaflet.js') && leafletHits++ < 2) return route.abort('failed');
      // 'nocss': the script loads but the stylesheet fails once; a retry must fetch the stylesheet again.
      if (scenario === 'nocss' && p.endsWith('/vendor/leaflet/leaflet.css') && leafletCssHits++ < 1) return route.abort('failed');
      try { return route.fulfill({ body: await readFile(join(root, p)), contentType: types[extname(p)] || 'application/octet-stream' }); } catch { return route.fulfill({ status: 404 }); }
    }
    if (offline) return route.abort('internetdisconnected');
    // EA reading history: 'slow' answers after 8 s, 'noreadings' fails fast. Gauge metadata and warnings are untouched.
    if (/\/readings$/.test(new URL(url).pathname)) {
      if (scenario === 'noreadings') return route.abort('failed');
      if (scenario === 'slow' || scenario === 'slowstations' || scenario === 'remoteslow') await new Promise(r => setTimeout(r, 8000));
    }
    // 'slowstations': every gauge except Diglis (2085) answers its metadata 8 s late.
    if (scenario === 'slowstations' && /\/id\/stations\/\w+\.json$/.test(new URL(url).pathname) && !url.includes('/2085.json')) await new Promise(r => setTimeout(r, 8000));
    // The remote scenario also makes the flood-area list slow, to prove it never holds up readings.
    if ((scenario === 'remote' || scenario === 'remoteslow') && new URL(url).pathname.endsWith('/id/floodAreas')) await new Promise(r => setTimeout(r, 4000));
    const body = eaResponse(url, { withAlert, scenario });
    return body ? route.fulfill({ json: body }) : route.abort();
  });
  await page.goto(ORIGIN + path);
  return { page, context, errors, requested };
}

const waitLive = page => page.waitForFunction(() => window.__wr?.live.status.mode === 'live', null, { timeout: 20000 });
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(`  ✓ ${name}`); } catch (e) { results.push(`  ✗ ${name}\n    ${e.message.split('\n').slice(0, 12).join('\n    ')}`); process.exitCode = 1; }
};

const browser = await chromium.launch();
try {
  /* ---------- Desktop, live (mocked) ---------- */
  const { page, errors, requested } = await open(browser);
  await waitLive(page);
  const latest = fx.readings['2085-level-stage-i-15_min-mASD'][0];

  await step('overview shows the latest EA reading and a plain-English summary', async () => {
    await page.waitForFunction(v => document.querySelector('#ov-level').textContent === v, latest.value.toFixed(2), { timeout: 5000 });
    const summary = await page.textContent('#ov-summary');
    assert.match(summary, /The Severn at Diglis is/);
    assert.match(summary, /1 flood alert/);
    assert.match(await page.textContent('#ov-verdict'), /^(Normal|Low|High) and (steady|rising|falling)$|^(Normal|Low|High)$/);
    assert.match(await page.textContent('#ov-warnline'), /Flood alert in force near Worcester/);
    assert.match(await page.textContent('#ov-band'), /^(Near typical (low|high)|Middle of typical range|(Below|Above) typical range)$/);
    assert.match(await page.textContent('#ov-warn .unofficial'), /Unofficial site/);
    assert.equal(await page.locator('.kpi').count(), 6);
    assert.equal(await page.locator('#st-grid .station').count(), 7);
    assert.ok(!(await page.textContent('main')).includes('NaN'));
  });

  await step('range switch animates the timeline and updates the URL', async () => {
    await page.click('#tl-range [data-range="7d"]');
    await page.waitForFunction(() => location.search.includes('range=7d'));
    await page.waitForFunction(() => /readings/.test(document.querySelector('#tl-note').textContent));
    assert.ok(await page.locator('#tl-chart canvas').count());
  });

  await step('flood intelligence drawer opens with the warning and closes on Escape', async () => {
    await page.click('#intel-open');
    await page.waitForSelector('#intel.open .warn-card');
    assert.match(await page.textContent('#intel .warn-card'), /Flood Alert/);
    assert.equal(await page.textContent('#intel-badge'), '1');
    assert.equal(await page.getAttribute('#intel .warn-card', 'data-where'), 'near');
    assert.match(await page.textContent('#intel .warn-card'), /Near Worcester/);
    assert.match(await page.textContent('#intel [data-sec="warnings"] summary'), /1 near Worcester/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#intel').classList.contains('open'));
  });

  await step('keyboard shortcut opens the map; markers and station panel work', async () => {
    assert.equal(await page.evaluate(() => typeof window.L), 'undefined', 'the map library is not loaded until the map is opened');
    assert.ok(!requested.some(p => p.includes('leaflet')), 'and was never requested for the Overview');
    await page.keyboard.press('2');
    await page.waitForFunction(() => location.search.includes('view=map'));
    await page.waitForFunction(() => document.querySelectorAll('.gauge-marker').length === 7);
    await page.click('#map-list button[data-id="2086"]');
    await page.waitForSelector('#map-panel:not([hidden]) .panel-title');
    assert.equal(await page.textContent('#map-panel .panel-title'), 'Bransford');
    assert.ok(requested.some(p => p.endsWith('/vendor/leaflet/leaflet.js')) && requested.some(p => p.endsWith('/vendor/leaflet/leaflet.css')), 'loaded on first use');
  });

  await step('analysis: station chips and measures update the shared state', async () => {
    await page.click('[data-nav="analysis"]');
    await page.click('#an-stations button[data-id="2001"]');
    await page.click('#an-metric button[data-metric="range"]');
    await page.waitForFunction(() => location.search.includes('compare=2001') && location.search.includes('metric=range'));
    await page.waitForFunction(() => document.querySelector('#an-rate-summary .stat'));
    assert.match(await page.textContent('#an-ref'), /Maximum on record/);
    assert.match(await page.textContent('.sim-banner'), /SIMULATION/);
  });

  await step('explore: deep link, click-to-annotate and playback', async () => {
    await page.goto(`${ORIGIN}/?view=explore&compare=2001,2085&range=7d`);
    await waitLive(page);
    await page.waitForSelector('#ex-insights .insight');
    const box = await page.locator('#ex-chart').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);
    await page.waitForFunction(() => /notes=\d+/.test(location.search));
    await page.click('#ex-play');
    await page.waitForTimeout(600);
    assert.notEqual(await page.inputValue('#ex-scrub'), '1000');
    await page.click('#ex-play');
    assert.equal(await page.locator('#ex-stations input:checked').count(), 2);
  });

  await step('history loads the archive, events and comparison', async () => {
    await page.click('[data-nav="history"]');
    await page.waitForSelector('#hi-events tbody tr', { timeout: 15000 });
    assert.ok((await page.locator('#hi-events tbody tr').count()) >= 10);
    assert.match(await page.textContent('#hi-context'), /2007/);
  });

  await step('accessibility: no axe violations on any view, in both themes', async () => {
    const found = [];
    for (const theme of ['dark', 'light']) {
      // Use the real theme control so every view re-renders with that theme's colours.
      if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
        await page.click('#theme');
        await page.waitForFunction(t => document.documentElement.dataset.theme === t, theme);
      }
      for (const v of ['overview', 'map', 'analysis', 'explore', 'history']) {
        await page.click(`.primary-nav [data-nav="${v}"]`);
        await page.waitForTimeout(v === 'history' ? 2500 : 1200);
        if (v === 'map') await page.click('#map-list button[data-id="2085"]');
        // Toasts fade in/out; auditing mid-animation measures a half-transparent colour.
        await page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 6000 });
        for (const x of await axeViolations(page)) found.push(`${theme}/${v}: ${x}`);
      }
    }
    assert.ok(!found.length, found.join('\n    '));
  });

  await step('no runtime errors on desktop', () => assert.deepEqual(errors, []));

  await step('shared links only carry the current view\'s state', async () => {
    await page.goto(`${ORIGIN}/?view=explore&compare=2001,2085&range=7d`);
    await waitLive(page);
    await page.click('.primary-nav [data-nav="map"]');
    await page.waitForFunction(() => location.search.includes('view=map'));
    assert.ok(!/compare=|range=/.test(await page.evaluate(() => location.search)), await page.evaluate(() => location.search));
  });

  /* ---------- High water + official warning (replayed Feb 2020 peak) ---------- */
  const hi = await open(browser, { scenario: 'high' });
  await step('high-water replay: Overview leads with the verdict and the official warning', async () => {
    await waitLive(hi.page);
    await hi.page.waitForFunction(() => window.__wr?.live.status.mode === 'live' && !window.__wr.live.status.refreshing && /^High/.test(document.querySelector('#ov-verdict').textContent), null, { timeout: 15000 });
    assert.equal(await hi.page.getAttribute('#ov-verdict', 'data-k'), 'severe');
    assert.match(await hi.page.textContent('#ov-warnline'), /Flood warning in force near Worcester/);
    assert.match(await hi.page.textContent('#ov-summary'), /above.*typical range/);
    assert.match(await hi.page.textContent('#ov-summary'), /1 flood warning and 1 flood alert/);
    assert.match(await hi.page.textContent('#ov-warn-title'), /2 warnings\/alerts near Worcester/);
    assert.equal(await hi.page.textContent('#intel-badge'), '2', 'header count: both are near Worcester');
    assert.equal(await hi.page.getAttribute('#intel-open', 'data-k'), 'warning');
    assert.equal(await hi.page.textContent('#ov-band'), 'Above typical range');
    // KPI numbers count up for ~0.9 s after each redraw (and every update restarts it): wait for the settled value.
    await hi.page.waitForFunction(() => /Above typical high\s*2\.47/.test(document.querySelector('.kpi[data-id="room"]').textContent), null, { timeout: 6000 });
    assert.match(await hi.page.textContent('.kpi[data-id="room"]'), /Above typical high\s*2\.47/);
    await hi.page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 6000 }).catch(() => {});
    assert.deepEqual(await axeViolations(hi.page), []);
    if (process.env.E2E_SHOTS) await hi.page.screenshot({ path: `${process.env.E2E_SHOTS}/high-water.png` });
  });
  await step('no runtime errors in the high-water replay', () => assert.deepEqual(hi.errors, []));
  await hi.context.close();

  /* ---------- Slow or failing EA reading history never blanks the page ---------- */
  const slow = await open(browser, { scenario: 'slow' });
  await step('slow reading history: latest values and warnings show within seconds, trends follow', async () => {
    await slow.page.waitForFunction(() => /^(Normal|Low|High)/.test(document.querySelector('#ov-verdict').textContent), null, { timeout: 5000 });
    assert.notEqual(await slow.page.textContent('#ov-level'), '—', 'a level is shown before any history arrives');
    assert.match(await slow.page.textContent('#live-status'), /Loading readings/);
    assert.ok(await slow.page.evaluate(() => window.__wr.live.floods), 'warnings are shown');
    await slow.page.waitForFunction(() => window.__wr.live.status.mode === 'live' && Object.keys(window.__wr.live.series).length >= 5, null, { timeout: 30000 });
    assert.match(await slow.page.textContent('#ov-trend'), /Steady|Rising|Falling/, 'the trend arrives with the history');
  });
  await slow.context.close();
  const lazy = await open(browser);
  await step('hovering the Map link starts loading the map library before the click', async () => {
    await waitLive(lazy.page);
    assert.equal(await lazy.page.evaluate(() => typeof window.L), 'undefined');
    await lazy.page.hover('.primary-nav [data-nav="map"]');
    await lazy.page.waitForFunction(() => typeof window.L !== 'undefined', null, { timeout: 5000 });
    assert.ok(await lazy.page.isVisible('#view-overview'), 'still on the Overview');
  });
  await lazy.context.close();
  const nl = await open(browser, { path: '/?view=map', scenario: 'noleaflet' });
  await step('a failed map library shows "Map unavailable" with a working retry; other views are unaffected', async () => {
    await nl.page.waitForSelector('#view-map .lib-error', { timeout: 10000 });
    assert.match(await nl.page.textContent('#view-map .lib-error'), /Map unavailable\..*could not be loaded/);
    await nl.page.keyboard.press('1');
    await nl.page.waitForFunction(() => !document.querySelector('#view-overview').hidden && document.querySelector('#ov-level').textContent !== '—', null, { timeout: 15000 });
    await nl.page.keyboard.press('2');
    await nl.page.waitForSelector('#view-map .lib-error', { timeout: 10000 }); // second failure
    await nl.page.click('#view-map .lib-error button');
    await nl.page.waitForFunction(() => document.querySelectorAll('.gauge-marker').length === 7, null, { timeout: 15000 });
    assert.equal(await nl.page.locator('#view-map .lib-error').count(), 0, 'the error is cleared once it loads');
    assert.deepEqual(nl.errors, []);
  });
  await nl.context.close();
  const nc = await open(browser, { path: '/?view=map', scenario: 'nocss' });
  await step('if only the map stylesheet fails, Try again fetches it again (not a half-loaded map)', async () => {
    await nc.page.waitForSelector('#view-map .lib-error', { timeout: 10000 });
    await nc.page.click('#view-map .lib-error button');
    await nc.page.waitForFunction(() => document.querySelectorAll('.gauge-marker').length === 7, null, { timeout: 15000 });
    assert.equal(await nc.page.evaluate(() => getComputedStyle(document.querySelector('.leaflet-pane')).position), 'absolute', "Leaflet's stylesheet is applied");
    assert.equal(nc.requested.filter(p => p.endsWith('/leaflet.css')).length, 2, 'stylesheet requested again');
    assert.equal(nc.requested.filter(p => p.endsWith('/leaflet.js')).length, 1, 'script not requested again');
    assert.deepEqual(nc.errors, []);
  });
  await nc.context.close();
  const dm = await open(browser, { path: '/?view=map' });
  await step('a direct link to the map loads straight into it', async () => {
    await dm.page.waitForFunction(() => document.querySelectorAll('.gauge-marker').length === 7, null, { timeout: 15000 });
    assert.ok(await dm.page.isVisible('#view-map'));
    assert.deepEqual(dm.errors, []);
  });
  await dm.context.close();
  const rs = await open(browser, { scenario: 'remoteslow' });
  await step('a faraway alert counted as local while the area list is unknown is corrected when it arrives, before readings', async () => {
    await rs.page.waitForFunction(() => window.__wr?.live.status.metadata && window.__wr.live.floods && !window.__wr.live.localAreas, null, { timeout: 8000 });
    assert.equal(await rs.page.getAttribute('#ov-warnline', 'data-k'), 'alert', 'unknown area list: cautiously counted as local');
    await rs.page.waitForFunction(() => window.__wr.live.localAreas, null, { timeout: 10000 });
    await rs.page.waitForTimeout(800);
    assert.equal(await rs.page.evaluate(() => window.__wr.live.status.mode), 'loading', 'history still loading');
    assert.equal(await rs.page.getAttribute('#ov-warnline', 'data-k'), 'remote', 'corrected without waiting for the history');
    assert.match(await rs.page.textContent('#ov-warnline'), /No flood warnings near Worcester/);
  });
  await rs.context.close();
  const early = await open(browser, { scenario: 'slowstations' });
  await step('Diglis shows as soon as its own data arrives, while the other gauges are still loading', async () => {
    await early.page.waitForFunction(() => /^(Normal|Low|High)/.test(document.querySelector('#ov-verdict').textContent), null, { timeout: 5000 });
    assert.notEqual(await early.page.textContent('#ov-level'), '—');
    assert.ok(await early.page.evaluate(() => window.__wr.live.floods), 'warnings joined as soon as they arrived');
    const others = await early.page.evaluate(() => window.__wr.live.stations.filter(s => s.id !== '2085' && s.latest).length);
    assert.equal(others, 0, 'the other gauges have not arrived yet');
    await early.page.waitForFunction(() => window.__wr.live.status.mode === 'live' && Object.keys(window.__wr.live.series).length >= 5, null, { timeout: 40000 });
    assert.ok(await early.page.evaluate(() => window.__wr.live.stations.filter(s => s.latest).length >= 5), 'the rest filled in afterwards');
  });
  await early.context.close();
  const nor = await open(browser, { scenario: 'noreadings' });
  await step('failed reading history keeps the live latest values instead of the old snapshot', async () => {
    await nor.page.waitForFunction(() => window.__wr?.live.status.partial, null, { timeout: 30000 });
    assert.equal(await nor.page.evaluate(() => window.__wr.live.status.mode), 'live', 'not the offline snapshot');
    assert.notEqual(await nor.page.textContent('#ov-level'), '—');
    assert.match(await nor.page.textContent('#ov-banner'), /Reading history unavailable/);
    assert.match(await nor.page.textContent('#live-status'), /^Live/);
    // A retry that fails the same way keeps the notice and stays live (it used to become "Could not refresh").
    await nor.page.evaluate(() => window.__wr.live.refresh({ manual: true }));
    await nor.page.waitForTimeout(500);
    assert.equal(await nor.page.evaluate(() => window.__wr.live.status.partial), true);
    assert.equal(await nor.page.evaluate(() => window.__wr.live.status.mode), 'live');
    assert.match(await nor.page.textContent('#ov-banner'), /Reading history unavailable/);
    assert.match(await nor.page.textContent('#live-status'), /^Live/);
  });
  await nor.context.close();

  /* ---------- A warning 40 km away is reported, not shown as local ---------- */
  const far = await open(browser, { scenario: 'remote' });
  await step('a flood alert on another river is reported but does not colour the verdict', async () => {
    // Readings and warnings arrive before the (slow) local area list; meanwhile the alert counts as local.
    await far.page.waitForFunction(() => window.__wr?.live.status.mode === 'live' && window.__wr.live.floods, null, { timeout: 30000 });
    assert.equal(await far.page.evaluate(() => window.__wr.live.localAreas), null, 'area list still loading');
    await far.page.waitForFunction(() => window.__wr?.live.localAreas && window.__wr.live.floods && /^(Normal|Low|High)/.test(document.querySelector('#ov-verdict').textContent), null, { timeout: 30000 });
    await far.page.waitForTimeout(500);
    assert.notEqual(await far.page.getAttribute('#ov-verdict', 'data-k'), 'alert');
    assert.equal(await far.page.getAttribute('#ov-warnline', 'data-k'), 'remote');
    assert.match(await far.page.textContent('#ov-warnline'), /No flood warnings near Worcester · 2 flood alerts elsewhere within 40 km/);
    assert.match(await far.page.textContent('#ov-warn-title'), /No warnings near Worcester/);
    assert.match(await far.page.textContent('#ov-warn-sub'), /River Severn in Shropshire.*River Wye in Herefordshire/);
    const summary = await far.page.textContent('#ov-summary');
    assert.match(summary, /No flood warnings or alerts near Worcester\. 2 flood alerts elsewhere within 40 km/);
    assert.match(summary, /River Severn in Shropshire[^;]*; River Wye in Herefordshire/, 'every name is listed, own river first');
    // The Flood info drawer and its header badge follow the same rule as the Overview.
    assert.ok(await far.page.isHidden('#intel-badge'), 'no red count for warnings that are not near Worcester');
    assert.match(await far.page.getAttribute('#intel-open', 'title'), /0 flood warning\(s\)\/alert\(s\) near Worcester; 2 elsewhere within 40 km/);
    await far.page.click('#intel-open');
    await far.page.waitForSelector('#intel.open .warn-card');
    assert.match(await far.page.textContent('#intel [data-sec="warnings"] summary'), /None near Worcester · 2 elsewhere/);
    assert.match(await far.page.textContent('#intel .all-clear'), /No flood warnings or alerts near Worcester/);
    assert.match(await far.page.textContent('#intel [data-sec="warnings"]'), /Elsewhere within 40 km, not near Worcester/);
    assert.equal(await far.page.locator('#intel .warn-card[data-where="elsewhere"]').count(), 2);
    assert.equal(await far.page.locator('#intel .warn-card[data-where="near"]').count(), 0);
    assert.match(await far.page.textContent('#intel .warn-card'), /River Severn in Shropshire/, 'own river first');
    await far.page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 6000 }).catch(() => {});
    await far.page.waitForTimeout(600);
    assert.deepEqual(await axeViolations(far.page), [], 'the open drawer is accessible (light)');
    await far.page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await far.page.waitForTimeout(400);
    assert.deepEqual(await axeViolations(far.page), [], 'the open drawer is accessible (dark)');
  });
  await far.context.close();

  /* ---------- Map: warning areas say whether they are near Worcester ---------- */
  // The test polygons share one shape, so the last one drawn is on top: the remote alerts, appended after the local areas.
  async function mapTooltip(scenario, drawn) {
    const m = await open(browser, { scenario });
    await waitLive(m.page);
    await m.page.waitForFunction(() => window.__wr.live.localAreas, null, { timeout: 30000 });
    await m.page.click('.primary-nav [data-nav="map"]');
    await m.page.waitForFunction(() => n => document.querySelectorAll('#map .leaflet-overlay-pane path.leaflet-interactive').length >= n, drawn, { timeout: 30000 });
    const box = await m.page.locator('#map .leaflet-overlay-pane path.leaflet-interactive').last().boundingBox();
    const tip = m.page.locator('.leaflet-tooltip', { hasText: 'EA flood warning area' });
    // Station markers sit on top of the polygon: probe points inside its triangle until one reaches it.
    for (const [fx_, fy_] of [[0.9, 0.95], [0.7, 0.95], [0.5, 0.95], [0.95, 0.5], [0.95, 0.2], [0.3, 0.97]]) {
      await m.page.mouse.move(box.x + box.width * fx_, box.y + box.height * fy_);
      if (await tip.waitFor({ timeout: 1500 }).then(() => true, () => false)) break;
    }
    await tip.waitFor({ timeout: 1000 });
    const text = await tip.textContent();
    await m.context.close();
    return text;
  }
  await step('map: a faraway alert is drawn and tagged "elsewhere"', async () => {
    const t = await mapTooltip('remote', 4);
    assert.match(t, /River Severn in Shropshire|River Wye in Herefordshire/);
    assert.match(t, /Elsewhere within the 40 km search, not near Worcester/);
  });
  await step('map: an alert near Worcester is tagged "near Worcester"', async () => {
    const t = await mapTooltip(null, 2);
    assert.match(t, /River Severn in Worcestershire/);
    assert.match(t, /Near Worcester/);
    assert.doesNotMatch(t, /Elsewhere/);
  });

  /* ---------- Offline: falls back to the labelled snapshot ---------- */
  const off = await open(browser, { offline: true });
  await step('offline mode shows the saved snapshot with a clear warning', async () => {
    await off.page.waitForFunction(() => window.__wr?.live.status.mode === 'snapshot', null, { timeout: 30000 });
    await off.page.waitForSelector('#ov-banner');
    assert.match(await off.page.textContent('#ov-banner'), /not current readings/);
    assert.doesNotMatch(await off.page.textContent('#ov-banner'), /Failed to fetch/);
    assert.match(await off.page.textContent('#ov-banner'), /could not be reached/);
    const gauges = await off.page.evaluate(() => Object.values(window.__wr.live.series).filter(s => s.length).length);
    assert.ok(gauges >= 5, `snapshot covers ${gauges} gauges`);
    assert.match(await off.page.textContent('#live-status'), /Offline snapshot/);
    assert.notEqual(await off.page.textContent('#ov-level'), '—');
    assert.match(await off.page.textContent('#ov-verdict'), /^Not current · last reading was /);
  });
  await off.context.close();

  /* ---------- Demo replay: real Feb 2020 readings, labelled everywhere ---------- */
  const demo = await open(browser, { path: '/?demo=feb2020' });
  await step('demo replay shows a flood state and is labelled as a demo', async () => {
    await demo.page.waitForFunction(() => window.__wr?.live.status.mode === 'demo', null, { timeout: 30000 });
    await demo.page.waitForFunction(() => /^High and rising$/.test(document.querySelector('#ov-verdict').textContent), null, { timeout: 8000 });
    assert.equal(await demo.page.textContent('#ov-level'), '4.98');
    assert.match(await demo.page.textContent('#ov-warnline'), /Flood warning in force near Worcester/);
    assert.match(await demo.page.textContent('#demo-banner'), /DEMO REPLAY · NOT CURRENT CONDITIONS/);
    assert.match(await demo.page.textContent('#demo-banner'), /illustrative, not real/);
    assert.match(await demo.page.textContent('#live-status'), /Demo replay/);
    assert.ok(await demo.page.isHidden('#ov-demo-link'));
    await demo.page.click('.primary-nav [data-nav="analysis"]');
    assert.match(demo.page.url(), /demo=feb2020/, 'demo survives navigation');
    assert.ok(await demo.page.isVisible('#demo-banner'));
    await demo.page.click('.primary-nav [data-nav="overview"]');
    await demo.page.waitForTimeout(1200);
    await demo.page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 6000 }).catch(() => {});
    if (process.env.E2E_SHOTS) await demo.page.screenshot({ path: `${process.env.E2E_SHOTS}/demo.png`, fullPage: false });
    assert.deepEqual(await axeViolations(demo.page), []);
  });
  await demo.context.close();
  const demoOff = await open(browser, { path: '/?demo=feb2020', offline: true });
  await step('demo replay still classifies the flood with the EA service down', async () => {
    await demoOff.page.waitForFunction(() => window.__wr?.live.status.mode === 'demo', null, { timeout: 30000 });
    await demoOff.page.waitForFunction(() => /^High and rising$/.test(document.querySelector('#ov-verdict').textContent), null, { timeout: 8000 });
    assert.equal(await demoOff.page.textContent('#ov-band'), 'Above typical range');
    const [dl] = await Promise.all([demoOff.page.waitForEvent('download'), demoOff.page.click('#tl-csv')]);
    assert.match(dl.suggestedFilename(), /^DEMO-feb2020-diglis-/);
  });
  await demoOff.context.close();

  /* ---------- Mobile: no horizontal scrolling on any view ---------- */
  const mob = await open(browser, { device: 'iPhone 13' });
  await waitLive(mob.page);
  for (const v of ['overview', 'map', 'analysis', 'explore', 'history']) {
    await step(`mobile ${v}: fits the screen`, async () => {
      await mob.page.click(`.bottom-nav [data-nav="${v}"]`);
      await mob.page.waitForTimeout(1200);
      const over = await mob.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 1, `overflows by ${over}px`);
    });
  }
  await step('mobile overview: a card\'s "cm / 24 h" change never splits across lines', async () => {
    await mob.page.setViewportSize({ width: 320, height: 700 });
    await mob.page.click('.bottom-nav [data-nav="overview"]');
    await mob.page.waitForSelector('#st-grid .station-val small:last-child');
    // Squeeze the line so any breakable space inside the label would wrap, whatever the live numbers are.
    const split = await mob.page.evaluate(() => [...document.querySelectorAll('#st-grid .station-val small:last-child')]
      .map(el => (el.parentElement.style.width = '5.5em', el))
      .filter(el => el.textContent.trim() && el.getClientRects().length > 1).map(el => el.textContent));
    assert.deepEqual(split, [], 'wrapped onto more than one line');
  });
  await step('no runtime errors on mobile', () => assert.deepEqual(mob.errors, []));
} finally {
  await browser.close();
}
console.log(results.join('\n'));
console.log(process.exitCode ? 'E2E FAILED' : `E2E PASS (${results.length} checks)`);
