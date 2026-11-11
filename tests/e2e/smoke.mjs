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
  if ((m = p.match(/\/id\/stations\/(\w+)\.json$/))) {
    if (scenario === 'delayed' && m[1] === '2086' && fx.stations[m[1]]) {
      // Bransford's EA feed stops 4 h before "now" (as it did on 1-2 Nov 2026).
      const st = JSON.parse(JSON.stringify(fx.stations[m[1]]));
      for (const ms of Array.isArray(st.measures) ? st.measures : [st.measures]) if (ms.latestReading && typeof ms.latestReading === 'object') ms.latestReading.dateTime = new Date(NOW - 4 * 3600e3).toISOString();
      return { items: st };
    }
    return fx.stations[m[1]] ? { items: fx.stations[m[1]] } : null;
  }
  if ((m = p.match(/\/id\/measures\/([^/]+)\/readings$/))) {
    const since = Date.parse(u.searchParams.get('since') || 0);
    let rows = (fx.readings[m[1]] || []).filter(r => Date.parse(r.dateTime) >= since);
    if (scenario === 'delayed' && m[1].startsWith('2086-')) rows = rows.filter(r => Date.parse(r.dateTime) <= NOW - 4 * 3600e3);
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

async function open(browser, { path = '/', viewport, device, offline = false, withAlert = true, scenario = null, watchShifts = false } = {}) {
  const context = await browser.newContext(device ? { ...devices[device] } : { viewport: viewport || { width: 1400, height: 950 } });
  const page = await context.newPage();
  // Sum of the page's layout shifts (CLS) since it started loading, in window.__shift.
  if (watchShifts) await page.addInitScript(() => { window.__shift = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shift += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  await page.clock.setFixedTime(NOW);
  const errors = [];
  const requested = [];
  let leafletHits = 0, leafletCssHits = 0, echartsHits = 0;
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
      // 'noecharts': the charting library fails on its first two requests only (the early preload counts as one), so a retry can succeed.
      if (scenario === 'noecharts' && p.endsWith('/vendor/echarts.slim.min.js') && echartsHits++ < 2) return route.abort('failed');
      // 'slowpicture': the code that makes "Save image" pictures takes 1.5 s to arrive, so the chart can change while it loads.
      if (scenario === 'slowpicture' && p.endsWith('/js/chart-image.js')) await new Promise(r => setTimeout(r, 1500));
      // 'nopicture': that code cannot be fetched at all (the connection dropped after the page loaded).
      if (scenario === 'nopicture' && p.endsWith('/js/chart-image.js')) return route.abort('failed');
      // 'nocss': the script loads but the stylesheet fails once; a retry must fetch the stylesheet again.
      if (scenario === 'nocss' && p.endsWith('/vendor/leaflet/leaflet.css') && leafletCssHits++ < 1) return route.abort('failed');
      try { return route.fulfill({ body: await readFile(join(root, p)), contentType: types[extname(p)] || 'application/octet-stream' }); } catch { return route.fulfill({ status: 404 }); }
    }
    if (offline) return route.abort('internetdisconnected');
    // 'late': every EA answer takes 1.5 s, so the page paints its placeholders first and the data arrives afterwards.
    if (scenario === 'late') await new Promise(r => setTimeout(r, 1500));
    // 'veryslow': every EA answer takes 9 s (the EA has done this), so for a while there is nothing at all to show.
    if (scenario === 'veryslow') await new Promise(r => setTimeout(r, 9000));
    // EA reading history: 'slow' answers after 8 s, 'noreadings' fails fast. Gauge metadata and warnings are untouched.
    if (/\/readings$/.test(new URL(url).pathname)) {
      if (scenario === 'noreadings') return route.abort('failed');
      // 'badgauge': only Bransford's history request fails; the other six answer normally.
      if (scenario === 'badgauge' && /\/measures\/2086-/.test(url)) return route.abort('failed');
      if (scenario === 'slow' || scenario === 'slowstations' || scenario === 'remoteslow') await new Promise(r => setTimeout(r, 8000));
      // 'primaryfirst': Diglis's history arrives at once, every other gauge's 6 s later.
      if (scenario === 'primaryfirst' && !/\/measures\/2085-/.test(url)) await new Promise(r => setTimeout(r, 6000));
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

// Click "Save image" on the Overview timeline and return what came out: the file name, every string drawn on a canvas while the
// picture was made (the text cannot be read back out of a PNG), and a description of the PNG itself, decoded in the page.
// `during`, if given, runs right after the click, while the picture is still being made.
async function saveImage(page, { during, button = '#tl-png', canvas = '#tl-chart canvas', note = '#tl-note', noteRe = 'readings' } = {}) {
  const where = { canvas, note, noteRe };
  await page.waitForFunction(w => document.querySelector(w.canvas) && new RegExp(w.noteRe).test(document.querySelector(w.note).textContent), where, { timeout: 10000 }).catch(async e => {
    const seen = await page.evaluate(w => ({ canvases: document.querySelectorAll(w.canvas).length, note: document.querySelector(w.note).textContent, mode: window.__wr?.live.status.mode, view: location.search }), where);
    throw new Error(`the chart never showed itself and its readings: ${JSON.stringify(seen)}`);
  });
  await page.evaluate(() => {
    window.__drawn = [];
    window.__fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { window.__drawn.push(String(t)); return window.__fillText.call(this, t, ...a); };
  });
  try {
    const downloading = page.waitForEvent('download', { timeout: 10000 });
    downloading.catch(() => {}); // if `during` fails first, this must not become an unhandled rejection; the await below still reports it
    await page.click(button);
    await during?.();
    const download = await downloading;
    const bytes = await readFile(await download.path());
    const drawn = await page.evaluate(() => window.__drawn.join(' '));
    // How many different colours there are in a strip: text on a plain background has many (anti-aliasing), an empty strip has one.
    const picture = await page.evaluate(async b64 => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const colours = (y, h) => { const d = x.getImageData(0, y, img.width, h).data, s = new Set(); for (let i = 0; i < d.length; i += 4) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); return s.size; };
      return { width: img.width, height: img.height, header: colours(0, 70), middle: colours(Math.round(img.height / 2) - 20, 40), footer: colours(img.height - 90, 90) };
    }, bytes.toString('base64'));
    return { name: download.suggestedFilename(), bytes, drawn, picture };
  } finally {
    await page.evaluate(() => { CanvasRenderingContext2D.prototype.fillText = window.__fillText; });
  }
}
// The UK date and time as in the picture's file name, worked out here independently of the site's own code.
const ukStamp = ms => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`;
};
const PNG_SIGNATURE = '89504e470d0a1a0a';

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

  await step('river diagram: all 7 gauges in river order with the same readings as the cards, and a text alternative', async () => {
    assert.ok(await page.isVisible('#st-river .rs-wide') && await page.isHidden('#st-river .rs-tall'), 'the left-to-right drawing on a wide screen');
    assert.equal(await page.locator('#st-river .rs-wide .rs-node').count(), 7);
    const shown = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#st-river .rs-wide .rs-node')].map(n => [n.dataset.id, n.querySelector('.rs-num')?.textContent])));
    const cards = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#st-grid .station')].map(c => [c.dataset.id, c.querySelector('.station-val').firstChild.textContent.trim() + ' m'])));
    assert.deepEqual(shown, cards, 'the diagram and the cards state the same levels');
    assert.equal(shown['2085'], `${latest.value.toFixed(2)} m`);
    assert.match(await page.getAttribute('#st-river .rs-wide', 'aria-label'), /River Severn, upstream to downstream: Bewdley .* River Teme, which joins the Severn below Diglis: Knightsford Bridge /);
    assert.match(await page.textContent('.river-strip figcaption'), /A diagram, not a map: nothing is to scale/);
    await page.click('#st-sort [data-sort="rate"]');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#st-river .rs-wide .rs-node')].map(n => n.dataset.id)), ['2001', '2642', '2085', '2616', '2032', '2029', '2086'], 'sorting the cards does not reorder the river');
    await page.click('#st-sort [data-sort="river"]');
  });

  await step('printing: a dated stamp, no dead buttons, and the chart drawn at the page width', async () => {
    await page.waitForSelector('#tl-chart canvas');
    const wide = await page.evaluate(() => document.querySelector('#tl-chart').getBoundingClientRect().width);
    assert.ok(wide > 700, 'the chart is wide on screen');
    try {
      await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
      await page.emulateMedia({ media: 'print' });
      const stamp = await page.textContent('#print-stamp');
      assert.match(stamp, /unofficial summary of Environment Agency data\) · printed \w{3}, \d+ \w{3} \d{4}, \d\d:\d\d (GMT|BST)\. Latest Diglis reading: \w{3}, \d+ \w{3} \d{4}, \d\d:\d\d (GMT|BST)\./);
      assert.match(stamp, /official flood warnings use GOV\.UK Check for flooding or call Floodline 0345 988 1188/);
      assert.ok(await page.isVisible('#print-stamp'));
      for (const hidden of ['#ov-warn-open', '#tl-csv', '#tl-png', '#tl-explore', '#tl-range', '.toggle-row', '.explain', '#st-grid .station .btn']) {
        assert.ok(await page.locator(hidden).first().isHidden(), `${hidden} is not printed`);
      }
      assert.equal(await page.locator('.kpi:visible').count(), 6, 'the figures are printed');
      assert.equal(await page.locator('#st-grid .station:visible').count(), 7);
      // 17.5 cm is 661 px: the canvas is redrawn to that, not left at its screen width and cut off by the page.
      const fit = await page.evaluate(() => { const c = document.querySelector('#tl-chart canvas').getBoundingClientRect(), box = document.querySelector('#tl-chart').getBoundingClientRect(); return { box: Math.round(box.width), canvasRight: Math.round(c.right), boxRight: Math.round(box.right) }; });
      assert.ok(fit.box <= 662 && fit.canvasRight <= fit.boxRight + 1, `chart fits the page (${JSON.stringify(fit)})`);
    } finally {
      // Whatever happened above, leave the page as a screen again so the later steps are not affected.
      await page.emulateMedia({ media: null });
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    }
    await page.waitForFunction(w => document.querySelector('#tl-chart').getBoundingClientRect().width > w, 700, { timeout: 5000 });
    assert.ok(await page.isHidden('#print-stamp'), 'the stamp is for paper only');
    assert.ok(await page.isVisible('#tl-csv'), 'controls are back on screen');
  });

  await step('save image: a PNG of the chart with its title, period, source, save time and where the official warnings are', async () => {
    assert.ok(!requested.some(p => p.endsWith('/js/chart-image.js')), 'the picture code is not part of the page start-up');
    const shot = await saveImage(page);
    assert.ok(requested.some(p => p.endsWith('/js/chart-image.js')), 'it is fetched when someone asks for a picture');
    assert.equal(shot.name, `diglis-24h-chart-${ukStamp(NOW)}.png`);
    assert.equal(shot.bytes.subarray(0, 8).toString('hex'), PNG_SIGNATURE, 'a real PNG');
    const { width, height, header, middle, footer } = shot.picture;
    assert.ok(width >= 1400 && height >= 700, `a picture you can share (${width} x ${height})`);
    assert.ok(header > 3 && footer > 3, `text above and below the chart, not blank strips (colours: header ${header}, footer ${footer})`);
    assert.ok(middle > 3, `the chart itself is in the middle (${middle} colours)`);
    assert.match(shot.drawn, /River Severn at Diglis, Worcester/);
    assert.match(shot.drawn, /Last 24 hours, .+ \((GMT|BST)\) · metres above station datum · UK time/);
    assert.match(shot.drawn, new RegExp(`Latest Diglis reading: \\w{3}, \\d+ \\w{3} \\d{4}, \\d\\d:\\d\\d (GMT|BST)\\. Saved \\w{3}, \\d+ \\w{3} \\d{4}, \\d\\d:\\d\\d (GMT|BST)\\.`));
    assert.match(shot.drawn, /unofficial summary of Environment Agency real-time data \(Open Government Licence v3\)/);
    assert.match(shot.drawn, /official flood warnings use GOV\.UK Check for flooding or call Floodline 0345 988 1188/);
    assert.doesNotMatch(shot.drawn, /DEMO|snapshot/i, 'live data is not labelled as either');
    assert.match(await page.textContent('#toasts'), /Downloaded diglis-24h-chart-/);
  });

  await step('save image: the compare view says what it shows, and the picture follows the range', async () => {
    await page.click('#tl-range [data-range="7d"]');
    await page.check('#tl-upstream');
    await page.waitForFunction(() => /Bewdley/.test(document.querySelector('#tl-sub').textContent) && /Last 7 days/.test(document.querySelector('#tl-note').textContent));
    const shot = await saveImage(page);
    assert.equal(shot.name, `diglis-7d-chart-${ukStamp(NOW)}.png`);
    assert.match(shot.drawn, /River level change since the start of the period: Bewdley \(upstream\) and Diglis/);
    assert.match(shot.drawn, /Last 7 days, .+ · change in cm · UK time/);
    await page.uncheck('#tl-upstream');
    await page.click('#tl-range [data-range="24h"]');
    await page.waitForFunction(() => /Last 24 hours/.test(document.querySelector('#tl-note').textContent));
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

  await step('map panel shows the EA\'s flow only for gauges that publish one', async () => {
    assert.doesNotMatch(await page.textContent('#map-panel'), /Flow \(EA\)/, 'Bransford publishes level only');
    await page.click('#map-list button[data-id="2001"]');
    await page.waitForFunction(() => document.querySelector('#map-panel .panel-title')?.textContent === 'Bewdley');
    // 21:00 UTC on 18 Oct is 22:00 British Summer Time: times are shown in UK local time.
    assert.match(await page.textContent('#map-panel .kv'), /Flow \(EA\)\s*18\.5 m³\/s at 22:00/);
    // A flow reading that is not from the same time as the level beside it is not shown.
    await page.evaluate(() => { const s = window.__wr.live.byId['2001']; s.flow = { ...s.flow, t: s.flow.t - 24 * 3600e3 }; });
    await page.click('#map-list button[data-id="2086"]');
    await page.waitForFunction(() => document.querySelector('#map-panel .panel-title')?.textContent === 'Bransford');
    await page.click('#map-list button[data-id="2001"]');
    await page.waitForFunction(() => document.querySelector('#map-panel .panel-title')?.textContent === 'Bewdley');
    assert.doesNotMatch(await page.textContent('#map-panel'), /Flow \(EA\)/, 'a day-old flow beside a current level is hidden');
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
    // Past the point where a silent EA is called slow (6 s): this EA has answered, so the page must not claim otherwise.
    await slow.page.waitForTimeout(6500);
    assert.doesNotMatch(await slow.page.textContent('#ov-summary'), /taking longer than usual/);
    assert.doesNotMatch(await slow.page.textContent('#live-status'), /slow to answer/);
    await slow.page.waitForFunction(() => window.__wr.live.status.mode === 'live' && Object.keys(window.__wr.live.series).length >= 5, null, { timeout: 30000 });
    assert.match(await slow.page.textContent('#ov-trend'), /Steady|Rising|Falling/, 'the trend arrives with the history');
  });
  await slow.context.close();
  const vs = await open(browser, { scenario: 'veryslow' });
  await step('a silent EA: after a few seconds the page says the wait is the EA\'s, and the notice goes when data arrives', async () => {
    await vs.page.waitForFunction(() => /taking longer than usual/.test(document.querySelector('#ov-summary').textContent), null, { timeout: 8500 });
    assert.match(await vs.page.textContent('#live-status'), /EA is slow to answer/);
    assert.match(await vs.page.textContent('#ov-summary'), /nothing to show yet.*will fill in by itself.*Floodline 0345 988 1188/);
    assert.equal(await vs.page.textContent('#ov-level'), '—', 'no number is made up while waiting');
    await waitLive(vs.page);
    assert.match(await vs.page.textContent('#ov-summary'), /^The Severn at Diglis is/);
    assert.match(await vs.page.textContent('#live-status'), /^Live/);
    assert.deepEqual(vs.errors, []);
  });
  await vs.context.close();
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

  /* ---------- The charting library is not run at startup ---------- */
  const ph = await open(browser, { device: 'iPhone 13' });
  await step('phone: ECharts is fetched early but not run at startup, and runs once when the timeline nears the screen', async () => {
    await waitLive(ph.page);
    await ph.page.waitForTimeout(1500);
    assert.equal(await ph.page.evaluate(() => typeof window.echarts), 'undefined', 'not evaluated while the timeline is far below the fold');
    assert.equal(await ph.page.locator('#tl-chart canvas').count(), 0);
    assert.ok(ph.requested.some(p => p.endsWith('/vendor/echarts.slim.min.js')), 'but the file is fetched early (preload), so scrolling does not wait on the network');
    assert.notEqual(await ph.page.textContent('#ov-level'), '—', 'the hero does not wait for charts');
    await ph.page.locator('#ov-timeline').scrollIntoViewIfNeeded();
    await ph.page.waitForSelector('#tl-chart canvas', { timeout: 10000 });
    assert.equal(await ph.page.evaluate(() => typeof window.echarts), 'object');
    assert.equal(ph.requested.filter(p => p.endsWith('/vendor/echarts.slim.min.js')).length, 1, 'fetched once, not again when it runs');
    assert.deepEqual(ph.errors, []);
  });
  await ph.context.close();
  const pp = await open(browser, { device: 'iPhone 13' });
  await step('printing on a phone before the timeline has loaded says so, loads it, and a second print has the chart', async () => {
    await waitLive(pp.page);
    await pp.page.waitForTimeout(1500);
    assert.equal(await pp.page.evaluate(() => typeof window.echarts), 'undefined', 'the chart is not loaded yet');
    await pp.page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.match(await pp.page.textContent('#print-stamp'), /The timeline chart had not loaded when this was printed\./, 'the printout does not silently lack its chart');
    await pp.page.waitForSelector('#tl-chart canvas', { timeout: 10000 }); // loaded without any scrolling
    await pp.page.waitForTimeout(500);
    const canvases = await pp.page.locator('#tl-chart canvas').count();
    await pp.page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.doesNotMatch(await pp.page.textContent('#print-stamp'), /had not loaded/, 'a second print has the chart');
    await pp.page.waitForTimeout(500);
    assert.equal(await pp.page.locator('#tl-chart canvas').count(), canvases, 'asking again does not draw a second chart');
    assert.equal(pp.requested.filter(p => p.endsWith('/vendor/echarts.slim.min.js')).length, 1, 'the library is fetched once');
    await pp.page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.deepEqual(pp.errors, []);
  });
  await pp.context.close();
  const ne = await open(browser, { scenario: 'noecharts' });
  await step('a failed charting library leaves the hero and KPIs working, and the timeline offers a retry', async () => {
    await waitLive(ne.page);
    await ne.page.waitForSelector('#ov-timeline .state-error', { timeout: 10000 });
    assert.match(await ne.page.textContent('#ov-timeline .state-error'), /charting library could not be loaded/);
    assert.notEqual(await ne.page.textContent('#ov-level'), '—');
    assert.equal(await ne.page.locator('.kpi').count(), 6);
    for (let i = 0; i < 3 && !(await ne.page.locator('#tl-chart canvas').count()); i++) {
      await ne.page.click('#ov-timeline .state-error button');
      await ne.page.waitForTimeout(800);
    }
    await ne.page.waitForSelector('#tl-chart canvas', { timeout: 10000 });
    assert.equal(await ne.page.locator('#ov-timeline .state-error').count(), 0, 'the error is cleared once it loads');
  });
  await ne.context.close();
  const xi = await open(browser, { path: '/?view=explore' });
  await step('explore save image: the measure, the stations and the period are in the picture; a replay says where it stopped', async () => {
    const opts = { button: '#ex-png', canvas: '#ex-chart canvas', note: '#ex-sub', noteRe: 'station' };
    await xi.page.waitForSelector('#ex-chart canvas', { timeout: 15000 });
    await xi.page.check('#ex-stations input[value="2001"]');
    await xi.page.waitForFunction(() => /2 stations/.test(document.querySelector('#ex-sub').textContent));
    const shot = await saveImage(xi.page, opts);
    assert.match(shot.name, /^explore-stage-24h-chart-\d{4}-\d\d-\d\d-\d{4}\.png$/);
    assert.equal(shot.bytes.subarray(0, 8).toString('hex'), PNG_SIGNATURE);
    assert.match(shot.drawn, /Stage \(m above station datum\): (Bewdley, Diglis|Diglis, Bewdley)/);
    assert.match(shot.drawn, /Last 24 hours, .+ to .+ \((GMT|BST)\) · UK time/);
    assert.match(shot.drawn, /Different datums: compare shapes and timing, not heights/, 'two gauges on one stage axis carry the page\'s own warning about it');
    assert.doesNotMatch(shot.drawn, /replay at/, 'a whole window is not a replay');
    assert.match(shot.drawn, /unofficial summary of Environment Agency real-time data/);
    assert.match(shot.drawn, /official flood warnings use GOV\.UK/);
    assert.ok(shot.picture.header > 3 && shot.picture.footer > 3 && shot.picture.middle > 3);
    // Part-way through a playback the chart shows only the readings up to the playhead, and the picture says so.
    await xi.page.evaluate(() => { const e = document.querySelector('#ex-scrub'); e.value = 500; e.dispatchEvent(new Event('input')); });
    const part = await saveImage(xi.page, opts);
    assert.match(part.drawn, /· replay at \w{3}, \d+ \w{3} \d{4}, \d\d:\d\d (GMT|BST): later readings are not shown/);
    // A full redraw part-way through a replay (annotations switched off and on, the theme, a note) keeps the replay: the chart, the
    // scrubber and the picture's caption must all describe the same thing.
    const plotted = () => xi.page.evaluate(() => echarts.getInstanceByDom(document.querySelector('#ex-chart')).getOption().series[0].data.length);
    const partial = await plotted();
    await xi.page.evaluate(() => { const e = document.querySelector('#ex-scrub'); e.value = 1000; e.dispatchEvent(new Event('input')); });
    const whole = await plotted();
    assert.ok(partial < whole, `a replay plots fewer points than the whole window (${partial} < ${whole})`);
    await xi.page.evaluate(() => { const e = document.querySelector('#ex-scrub'); e.value = 500; e.dispatchEvent(new Event('input')); });
    await xi.page.click('#ex-auto'); // a full redraw
    await xi.page.waitForTimeout(300);
    assert.equal(await plotted(), partial, 'still the replay after a full redraw');
    assert.match((await saveImage(xi.page, opts)).drawn, /replay at /, 'and the picture says so');
    await xi.page.click('#ex-auto');
    await xi.page.evaluate(() => { const e = document.querySelector('#ex-scrub'); e.value = 1000; e.dispatchEvent(new Event('input')); });
    assert.equal(await plotted(), whole, 'back at the end it is the whole window again');
    assert.doesNotMatch((await saveImage(xi.page, opts)).drawn, /replay at /);
    // Another measure names itself in the picture and in the file name.
    await xi.page.evaluate(() => { const e = document.querySelector('#ex-scrub'); e.value = 1000; e.dispatchEvent(new Event('input')); });
    await xi.page.click('#ex-metric [data-metric="rate"]');
    await xi.page.waitForFunction(() => /Rate of change/.test(document.querySelector('#ex-chart-title').textContent));
    const rate = await saveImage(xi.page, opts);
    assert.match(rate.name, /^explore-rate-24h-chart-/);
    assert.match(rate.drawn, /Rate of change \(cm per hour\): /);
    assert.doesNotMatch(rate.drawn, /Different datums/, 'a rate has no datum, so there is nothing to warn about');
  });
  assert.deepEqual(xi.errors, []);
  await xi.context.close();
  const dh = await open(browser, { path: '/?view=history' });
  await step('a direct link to a chart view waits for the library and then draws', async () => {
    await dh.page.waitForSelector('#hi-chart canvas', { timeout: 15000 });
    assert.equal(await dh.page.locator('#view-history .lib-error').count(), 0);
    assert.deepEqual(dh.errors, []);
  });
  await dh.context.close();
  const na = await open(browser, { path: '/?view=analysis', scenario: 'noecharts' });
  await step('a chart view shows "Charts unavailable" with a working retry when the library fails', async () => {
    await na.page.waitForSelector('#view-analysis .lib-error', { timeout: 10000 });
    assert.match(await na.page.textContent('#view-analysis .lib-error'), /Charts unavailable\..*could not be loaded/);
    for (let i = 0; i < 3 && !(await na.page.locator('#an-multi-chart canvas').count()); i++) {
      if (await na.page.locator('#view-analysis .lib-error button').count()) await na.page.click('#view-analysis .lib-error button');
      await na.page.waitForTimeout(800);
    }
    await na.page.waitForSelector('#an-multi-chart canvas', { timeout: 10000 });
    assert.equal(await na.page.locator('#view-analysis .lib-error').count(), 0);
  });
  await na.context.close();
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

  /* ---------- The Overview does not jump around while the first data arrives ---------- */
  // The placeholders are painted first and every EA answer arrives 1.5 s later, as on a real connection.
  for (const [name, opts, limit] of [['phone', { device: 'iPhone 13' }, 0.1], ['desktop', {}, 0.05]]) {
    const sh = await open(browser, { ...opts, scenario: 'late', watchShifts: true });
    await step(`overview on a ${name}: layout shift while the data arrives stays under ${limit}${limit === 0.1 ? ' (Google\'s "good" limit)' : ''}`, async () => {
      await waitLive(sh.page);
      await sh.page.waitForTimeout(2500);
      const cls = await sh.page.evaluate(() => window.__shift);
      console.log(`    (${name} CLS ${cls.toFixed(3)})`);
      assert.ok(cls < limit, `layout shift ${cls.toFixed(3)}`);
    });
    await sh.context.close();
  }

  /* ---------- A gauge the EA has not updated for hours is named in the status pill ---------- */
  const lag = await open(browser, { scenario: 'delayed' });
  await step('status pill: "Live" also says when another gauge is hours behind', async () => {
    await waitLive(lag.page);
    await lag.page.waitForFunction(() => /1 gauge delayed/.test(document.querySelector('#live-status').textContent), null, { timeout: 15000 });
    assert.match(await lag.page.textContent('#live-status'), /^Live · \d\d:\d\d · 1 gauge delayed$/);
    assert.match(await lag.page.getAttribute('#live-status', 'title'), /Delayed: Bransford, last reading .*; the EA has not published a newer one/);
    assert.equal(await lag.page.getAttribute('#live-status', 'data-mode'), 'live', 'Diglis itself is current, so the pill is not in its warning state');
  });
  await step('data confidence: the drawer lists readings received per gauge, and flags a feed that has gone quiet', async () => {
    await lag.page.click('#live-status');
    await lag.page.waitForSelector('#intel.open [data-sec="confidence"] tbody tr');
    const rows = await lag.page.$$eval('#intel [data-sec="confidence"] tbody tr', trs => Object.fromEntries(trs.map(tr => [tr.dataset.id, [...tr.cells].map(c => c.textContent.trim())])));
    assert.deepEqual(rows['2085'], ['Diglis', '96 of 96', 'none'], 'a healthy gauge: everything in the period arrived, and a normal publishing delay is not a gap');
    assert.equal(rows['2001'][1], '96 of 96');
    assert.equal(rows['2086'][0], 'Bransford');
    assert.equal(rows['2086'][1], '84 of 96', 'the feed stopped 4 h before now, so 12 readings of the period are missing');
    assert.match(rows['2086'][2], /^4 h( \d+ min)? \(ongoing\)$/, 'about 4 h of silence since the newest reading, measured to now');
    assert.match(await lag.page.textContent('#intel [data-sec="confidence"]'), /A gap is a break of more than 30 minutes/);
    await lag.page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 6000 }).catch(() => {});
    await lag.page.waitForTimeout(600);
    assert.deepEqual(await axeViolations(lag.page), [], 'the open confidence table is accessible (light)');
    await lag.page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await lag.page.waitForTimeout(400);
    assert.deepEqual(await axeViolations(lag.page), [], 'the open confidence table is accessible (dark)');
  });
  await lag.context.close();
  const pf = await open(browser, { scenario: 'primaryfirst' });
  await step('data confidence: no half-loaded table while the other gauges\' histories are still arriving', async () => {
    await pf.page.waitForFunction(() => window.__wr?.live.status.mode === 'live' && window.__wr.live.status.refreshing && window.__wr.live.series['2085']?.length, null, { timeout: 15000 });
    assert.equal(await pf.page.evaluate(() => Object.keys(window.__wr.live.series).length), 1, 'only Diglis has its history so far');
    await pf.page.click('#live-status');
    await pf.page.waitForSelector('#intel.open [data-sec="confidence"] summary');
    assert.equal(await pf.page.locator('#intel [data-sec="confidence"] tbody tr').count(), 0, 'no "0 of 96" rows for gauges that simply have not loaded');
    await pf.page.waitForFunction(() => window.__wr.live.status.refreshing === false, null, { timeout: 30000 });
    await pf.page.waitForSelector('#intel [data-sec="confidence"] tbody tr');
    assert.equal(await pf.page.locator('#intel [data-sec="confidence"] tbody tr').count(), 7, 'the table appears once everything has loaded');
    assert.equal(await pf.page.textContent('#intel [data-sec="confidence"] tr[data-id="2001"] td:nth-child(2)'), '96 of 96');
  });
  await pf.context.close();
  const bad = await open(browser, { scenario: 'badgauge' });
  await step('data confidence: a gauge whose history failed to load is not counted as missing readings', async () => {
    await waitLive(bad.page);
    await bad.page.waitForFunction(() => window.__wr.live.status.refreshing === false && window.__wr.live.historyLoaded, null, { timeout: 15000 });
    await bad.page.click('#live-status');
    await bad.page.waitForSelector('#intel [data-sec="confidence"] tbody tr');
    const rows = await bad.page.$$eval('#intel [data-sec="confidence"] tbody tr', trs => Object.fromEntries(trs.map(tr => [tr.dataset.id, [...tr.cells].map(c => c.textContent.trim())])));
    assert.deepEqual(rows['2086'], ['Bransford', '—', 'not fetched this time'], 'no "0 of 96 / 25 h (ongoing)" for a request this site failed to make');
    assert.equal(rows['2085'][1], '96 of 96');
    assert.match(await bad.page.textContent('#intel [data-sec="confidence"]'), /"Not fetched this time" is different: this site's own request/);
  });
  await bad.context.close();
  await step('status pill: all gauges current means no extra words', async () => {
    assert.match(await page.textContent('#live-status'), /^Live · \d\d:\d\d$/);
  });

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
    await off.page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.match(await off.page.textContent('#print-stamp'), /Saved offline snapshot taken .*: not current conditions\./, 'a printed snapshot says it is one');
  });
  await step('save image: an offline snapshot picture says SNAPSHOT in its text and its name; an empty chart says so instead of saving a blank', async () => {
    const at = await off.page.evaluate(() => window.__wr.live.status.snapshotAt);
    assert.ok(Number.isFinite(at), 'the snapshot has a date');
    // 40 days on, no range (24 h to 30 d) reaches the snapshot's readings: nothing to take a picture of.
    await off.page.clock.setFixedTime(at + 40 * 24 * 3600e3);
    await off.page.click('#tl-range [data-range="7d"]');
    await off.page.waitForFunction(() => /^No readings for/.test(document.querySelector('#tl-note').textContent));
    await off.page.click('#tl-png');
    await off.page.waitForSelector('#toasts .toast');
    assert.match(await off.page.textContent('#toasts'), /There are no readings in this chart to save a picture of\./);
    // An hour after the snapshot was taken, its last day of readings is in the 24-hour window.
    await off.page.clock.setFixedTime(at + 3600e3);
    await off.page.click('#tl-range [data-range="24h"]');
    const shot = await saveImage(off.page);
    assert.match(shot.name, /^SNAPSHOT-diglis-24h-chart-\d{4}-\d\d-\d\d-\d{4}\.png$/);
    assert.match(shot.drawn, /Saved offline snapshot taken .*: not current conditions\. Saved /);
    assert.doesNotMatch(shot.drawn, /Latest Diglis reading/);
  });
  await off.context.close();

  /* ---------- Save image while its code is still loading ---------- */
  const sp = await open(browser, { scenario: 'slowpicture' });
  await waitLive(sp.page);
  await step('save image: changing the chart while the picture code loads cannot give one chart another one\'s caption', async () => {
    const shot = await saveImage(sp.page, {
      during: async () => {
        await sp.page.check('#tl-upstream'); // the comparison view, while the 1.5 s load is still running
        await sp.page.waitForFunction(() => /Bewdley/.test(document.querySelector('#tl-sub').textContent));
      },
    });
    assert.match(shot.drawn, /River level change since the start of the period: Bewdley \(upstream\) and Diglis/);
    assert.match(shot.drawn, /· change in cm · UK time/);
    assert.doesNotMatch(shot.drawn, /metres above station datum/, 'a change-in-cm chart is not labelled as metres');
  });
  await sp.context.close();
  const np = await open(browser, { scenario: 'nopicture' });
  await waitLive(np.page);
  await step('save image: if the picture code cannot be fetched, the visitor is told plainly and nothing is saved', async () => {
    await np.page.waitForFunction(() => document.querySelector('#tl-chart canvas'));
    let saved = false;
    np.page.on('download', () => { saved = true; });
    await np.page.click('#tl-png');
    await np.page.waitForSelector('#toasts .toast-error');
    assert.match(await np.page.textContent('#toasts'), /The picture code could not be loaded\. Check your connection and try again\./);
    assert.doesNotMatch(await np.page.textContent('#toasts'), /dynamically imported|Failed to fetch/, 'not the browser\'s own wording');
    assert.equal(saved, false);
  });
  await np.context.close();

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
    await demo.page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.match(await demo.page.textContent('#print-stamp'), /DEMO REPLAY of February 2020: illustrative, not current conditions\./, 'a printed demo cannot pass for a real flood');
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
  await step('save image: a demo replay picture says DEMO in its text and its name, and never offers a latest reading', async () => {
    const shot = await saveImage(demo.page);
    assert.match(shot.name, /^DEMO-replay-diglis-24h-chart-\d{4}-\d\d-\d\d-\d{4}\.png$/);
    assert.match(shot.drawn, /DEMO REPLAY of February 2020: illustrative, not current conditions\. Saved /);
    assert.doesNotMatch(shot.drawn, /Latest Diglis reading/);
    assert.match(shot.drawn, /official flood warnings use GOV\.UK/);
    assert.ok(shot.picture.header > 3 && shot.picture.footer > 3 && shot.picture.middle > 3);
  });
  await step('demo replay: a real flow reading is never shown beside the replayed flood level', async () => {
    await demo.page.click('.primary-nav [data-nav="map"]');
    await demo.page.waitForFunction(() => document.querySelectorAll('.gauge-marker').length === 7, null, { timeout: 15000 });
    await demo.page.click('#map-list button[data-id="2001"]');
    await demo.page.waitForFunction(() => document.querySelector('#map-panel .panel-title')?.textContent === 'Bewdley');
    assert.doesNotMatch(await demo.page.textContent('#map-panel'), /Flow \(EA\)/);
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
  await step('river diagram on a phone: the top-to-bottom drawing, inside the screen', async () => {
    await mob.page.click('.bottom-nav [data-nav="overview"]');
    await mob.page.waitForSelector('#st-river .rs-tall .rs-node');
    assert.ok(await mob.page.isVisible('#st-river .rs-tall') && await mob.page.isHidden('#st-river .rs-wide'));
    assert.equal(await mob.page.locator('#st-river .rs-tall .rs-node').count(), 7);
    const fit = await mob.page.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('#st-river .rs-tall text')].map(t => Math.round(t.getBoundingClientRect().right)).filter(r => r > w); });
    assert.deepEqual(fit, [], 'no label runs off the screen');
  });
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
