// Compare how fast two copies of the site show the river level on a slow phone connection.
//
//   node scripts/serve.mjs --gzip --dir /path/to/old-dist &      (PORT=8081 node ... to pick ports)
//   node scripts/serve.mjs --gzip &
//   node scripts/measure-load.mjs http://localhost:8081/ http://localhost:8080/ 8
//
// Each run loads the page in a fresh phone-sized Chromium with "slow 4G" throttling on every request (150 ms round trip, 1.6 Mbps down,
// 0.75 Mbps up, the profile Lighthouse uses), against the real EA API. It reports three times in ms from the start of navigation:
//   first paint     the first thing on screen (the empty page shell)
//   first EA call   when the page first asks the Environment Agency for data
//   data shown      when the Diglis level replaces the "—" placeholder (what a visitor actually came for)
// The two URLs are measured alternately so a slow patch at the EA affects both alike; the medians are what to compare.
// Serve both copies with --gzip: GitHub Pages compresses, and without it extra files look much more expensive than they are.
// Playwright's route.fulfill() would skip the throttling for the page's own files, so use real servers, not routes.
import { chromium, devices } from 'playwright';

const [urlA, urlB, runs = 6] = process.argv.slice(2);
if (!urlA || !urlB) { console.error('usage: node scripts/measure-load.mjs <urlA> <urlB> [runs]'); process.exit(2); }

const proxy = process.env.HTTPS_PROXY; // only needed where outside traffic goes through a proxy; localhost is never proxied
const browser = await chromium.launch(proxy ? { args: [`--proxy-server=${proxy}`, '--proxy-bypass-list=localhost;127.0.0.1'] } : {});

async function once(url) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
  await page.addInitScript(() => {
    window.__t = {};
    new PerformanceObserver(list => { for (const e of list.getEntries()) if (/environment\.data\.gov\.uk/.test(e.name) && window.__t.firstEA == null) window.__t.firstEA = Math.round(e.startTime); }).observe({ type: 'resource', buffered: true });
    new PerformanceObserver(list => { for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') window.__t.paint = Math.round(e.startTime); }).observe({ type: 'paint', buffered: true });
    const poll = setInterval(() => {
      const el = document.querySelector('#ov-level');
      if (el && el.textContent !== '—' && window.__t.data == null) { window.__t.data = Math.round(performance.now()); clearInterval(poll); }
    }, 20);
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__t.data != null, null, { timeout: 120000 });
  const t = await page.evaluate(() => window.__t);
  await context.close();
  return t;
}

const results = { A: [], B: [] };
for (let i = 0; i < Number(runs); i++) {
  results.A.push(await once(urlA));
  results.B.push(await once(urlB));
}
await browser.close();

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
for (const [name, url] of [['A', urlA], ['B', urlB]]) {
  const r = results[name];
  console.log(`${name} ${url}  median first paint ${median(r.map(x => x.paint))} ms | first EA call ${median(r.map(x => x.firstEA))} ms | data shown ${median(r.map(x => x.data))} ms   (${r.length} runs)`);
}
const d = key => median(results.B.map(x => x[key])) - median(results.A.map(x => x[key]));
console.log(`B minus A: first paint ${d('paint') >= 0 ? '+' : ''}${d('paint')} ms | first EA call ${d('firstEA') >= 0 ? '+' : ''}${d('firstEA')} ms | data shown ${d('data') >= 0 ? '+' : ''}${d('data')} ms`);
