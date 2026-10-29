// A stand-in for the Environment Agency API and the site's static files, for unit tests of the
// data layer (api.js, live.js). It serves the real responses captured in tests/fixtures/ea.json
// and the real files shipped in dist/, so what is tested is the code, not invented shapes.
//
// `log` records, in order, every request start/finish and anything the test adds with `log.push`,
// so tests assert on sequence ("Diglis's readings were requested before the slowest gauge
// answered") rather than on wall-clock timing.
import { readFileSync, existsSync } from 'node:fs';
import { mock } from 'node:test';

export const fx = JSON.parse(readFileSync(new URL('../../fixtures/ea.json', import.meta.url)));
export const FIXTURE_NOW = Date.parse('2026-10-18T21:30:00Z'); // just after the newest captured reading
const DIST = new URL('../../../dist/', import.meta.url);

const sleep = ms => new Promise(r => setTimeout(r, ms));

export const AREAS = [
  { notation: '031FWFSE440', label: 'River Severn at Hylton Road, Worcester', riverOrSea: 'River Severn', lat: 52.19, long: -2.23, polygon: 'http://environment.data.gov.uk/flood-monitoring/id/floodAreas/031FWFSE440/polygon' },
  { notation: '031WAF108', label: 'River Severn in Worcestershire', riverOrSea: 'River Severn', lat: 52.18, long: -2.22, polygon: 'http://environment.data.gov.uk/flood-monitoring/id/floodAreas/031WAF108/polygon' },
];
export const ALERT_NEAR = { floodAreaID: '031WAF108', description: 'River Severn in Worcestershire', severity: 'Flood alert', severityLevel: 3, message: 'm', timeRaised: '2026-10-18T10:00:00', floodArea: { county: 'Worcestershire', riverOrSea: 'River Severn' } };
export const ALERT_FAR = { floodAreaID: '031WAT217', description: 'Severn estuary from Gloucester to Sharpness', severity: 'Flood alert', severityLevel: 3, message: 'm', timeRaised: '2026-10-18T09:00:00', isTidal: true, floodArea: { county: 'Gloucestershire', riverOrSea: 'Severn Estuary' } };

// Freeze Date.now() just after the fixture's newest reading, so "the last 25 hours" contains data.
export const freezeClock = () => mock.timers.enable({ apis: ['Date'], now: FIXTURE_NOW });
export const unfreezeClock = () => mock.timers.reset();

/**
 * Install a fake fetch.
 *   delay(url) -> ms to wait before answering      fail(url) -> 'network' | HTTP status | falsy
 *   floods, areas -> response bodies for /id/floods and /id/floodAreas
 *   staticFiles -> false to make every shipped static file 404 (a total outage with no snapshot)
 *   missing -> shipped files (substrings of the path) that 404, e.g. ['fallback-snapshot'] to force the older fallback
 */
export function installEA({ delay = () => 0, fail = () => false, floods = [], areas = AREAS, staticFiles = true, missing = [] } = {}) {
  const log = [], urls = [];
  const short = url => {
    const u = String(url);
    let m;
    if ((m = u.match(/\/stations\/(\w+)\.json/))) return `station ${m[1]}`;
    if ((m = u.match(/\/measures\/(\w+)-[^/]*\/readings/))) return `readings ${m[1]}`;
    if (u.includes('/floodAreas')) return 'floodAreas';
    if (u.includes('/floods')) return 'floods';
    return u.replace(/^.*\//, '');
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input), name = short(url);
    urls.push(url);
    log.push(`start ${name}`);
    const d = delay(url); if (d) await sleep(d);
    const f = /^https?:/.test(url) ? fail(url) : false; // `fail` is the EA; shipped files use `missing`
    log.push(`${f ? 'fail' : 'done'} ${name}`);
    if (f === 'network') throw new TypeError('Failed to fetch');
    if (f) return { ok: false, status: f, json: async () => ({}) };
    const ok = body => ({ ok: true, status: 200, json: async () => body });
    if (!/^https?:/.test(url)) { // a static file shipped in dist/
      const file = new URL(url, DIST);
      return staticFiles && !missing.some(m => url.includes(m)) && existsSync(file) ? ok(JSON.parse(readFileSync(file))) : { ok: false, status: 404, json: async () => ({}) };
    }
    const u = new URL(url), p = u.pathname;
    let m;
    if (p.includes('/hydrology/')) return ok({ items: [{ dateTime: '2026-09-14T00:00:00', value: 1.5 }, { dateTime: '2026-09-15T00:00:00', value: 1.6 }] });
    if ((m = p.match(/\/id\/stations\/(\w+)\.json$/))) return fx.stations[m[1]] ? ok({ items: fx.stations[m[1]] }) : { ok: false, status: 404, json: async () => ({}) };
    if ((m = p.match(/\/id\/measures\/([^/]+)\/readings$/))) {
      const since = Date.parse(u.searchParams.get('since') || 0);
      return ok({ items: (fx.readings[m[1]] || []).filter(r => Date.parse(r.dateTime) >= since).map(r => ({ ...r, measure: `http://environment.data.gov.uk/flood-monitoring/id/measures/${m[1]}` })) });
    }
    if (p.endsWith('/id/floods')) return ok({ items: floods });
    if (p.endsWith('/id/floodAreas')) return ok({ items: areas });
    return ok({ items: [] });
  };
  return { log, urls };
}

/** Wait until `fn()` is truthy (polling), for things that settle after refresh() resolves. */
export async function until(fn, ms = 2000) {
  const end = Date.now() + ms; // Date is frozen in these tests, so count real polls instead
  for (let i = 0; i < ms / 10; i++) { if (fn()) return true; await sleep(10); }
  throw new Error(`condition not met in ${ms} ms (${String(fn)})`);
}
