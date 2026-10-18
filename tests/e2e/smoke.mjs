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

function eaResponse(url, { withAlert }) {
  const u = new URL(url);
  const p = u.pathname;
  let m;
  if ((m = p.match(/\/id\/stations\/(\w+)\.json$/))) return fx.stations[m[1]] ? { items: fx.stations[m[1]] } : null;
  if ((m = p.match(/\/id\/measures\/([^/]+)\/readings$/))) {
    const since = Date.parse(u.searchParams.get('since') || 0);
    const rows = (fx.readings[m[1]] || []).filter(r => Date.parse(r.dateTime) >= since);
    return { items: rows.map(r => ({ ...r, measure: `http://environment.data.gov.uk/flood-monitoring/id/measures/${m[1]}` })) };
  }
  if (p.endsWith('/id/floods')) return { items: withAlert ? [TEST_ALERT] : [] };
  if (p.endsWith('/id/floodAreas')) return { items: [{ notation: '031FWFSE440', label: 'River Severn at Hylton Road, Worcester', riverOrSea: 'River Severn', lat: 52.19, long: -2.23, polygon: 'http://environment.data.gov.uk/flood-monitoring/id/floodAreas/031FWFSE440/polygon' }] };
  if (p.endsWith('/polygon')) return POLY;
  if (u.hostname === 'environment.data.gov.uk') return { items: [] };
  return null;
}

async function open(browser, { path = '/', viewport, device, offline = false, withAlert = true } = {}) {
  const context = await browser.newContext(device ? { ...devices[device] } : { viewport: viewport || { width: 1400, height: 950 } });
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(ORIGIN)) {
      let p = new URL(url).pathname;
      if (p.endsWith('/')) p += 'index.html';
      try { return route.fulfill({ body: await readFile(join(root, p)), contentType: types[extname(p)] || 'application/octet-stream' }); } catch { return route.fulfill({ status: 404 }); }
    }
    if (offline) return route.abort('internetdisconnected');
    const body = eaResponse(url, { withAlert });
    return body ? route.fulfill({ json: body }) : route.abort();
  });
  await page.goto(ORIGIN + path);
  return { page, context, errors };
}

const waitLive = page => page.waitForFunction(() => window.__wr?.live.status.mode === 'live', null, { timeout: 20000 });
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(`  ✓ ${name}`); } catch (e) { results.push(`  ✗ ${name}\n    ${e.message.split('\n')[0]}`); process.exitCode = 1; }
};

const browser = await chromium.launch();
try {
  /* ---------- Desktop, live (mocked) ---------- */
  const { page, errors } = await open(browser);
  await waitLive(page);
  const latest = fx.readings['2085-level-stage-i-15_min-mASD'][0];

  await step('overview shows the latest EA reading and a plain-English summary', async () => {
    await page.waitForFunction(v => document.querySelector('#ov-level').textContent === v, latest.value.toFixed(2), { timeout: 5000 });
    const summary = await page.textContent('#ov-summary');
    assert.match(summary, /The Severn at Diglis is/);
    assert.match(summary, /1 flood alert/);
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
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#intel').classList.contains('open'));
  });

  await step('keyboard shortcut opens the map; markers and station panel work', async () => {
    await page.keyboard.press('2');
    await page.waitForFunction(() => location.search.includes('view=map'));
    await page.waitForFunction(() => document.querySelectorAll('.gauge-marker').length === 7);
    await page.click('#map-list button[data-id="2086"]');
    await page.waitForSelector('#map-panel:not([hidden]) h3');
    assert.equal(await page.textContent('#map-panel h3'), 'Bransford');
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

  await step('no runtime errors on desktop', () => assert.deepEqual(errors, []));

  /* ---------- Offline: falls back to the labelled snapshot ---------- */
  const off = await open(browser, { offline: true });
  await step('offline mode shows the saved snapshot with a clear warning', async () => {
    await off.page.waitForFunction(() => window.__wr?.live.status.mode === 'snapshot', null, { timeout: 30000 });
    await off.page.waitForSelector('#ov-banner');
    assert.match(await off.page.textContent('#ov-banner'), /not current readings/);
    assert.match(await off.page.textContent('#live-status'), /Offline snapshot/);
    assert.notEqual(await off.page.textContent('#ov-level'), '—');
  });
  await off.context.close();

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
  await step('no runtime errors on mobile', () => assert.deepEqual(mob.errors, []));
} finally {
  await browser.close();
}
console.log(results.join('\n'));
console.log(process.exitCode ? 'E2E FAILED' : `E2E PASS (${results.length} checks)`);
