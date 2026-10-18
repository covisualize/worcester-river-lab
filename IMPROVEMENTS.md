# Improvement backlog

A daily scheduled run picks **one** item (or a problem it finds itself), ships it as a
small pull request, and records the outcome in the log below. Keep this file current:
it is how successive runs avoid repeating or contradicting each other.

## Ground rules for every change
- Never invent readings, thresholds, forecasts or warning statuses. Label any sample,
  derived or simulated data as such. UK local time everywhere.
- Small and reviewable: one theme per PR, all of `npm test` and `npm run test:e2e` green,
  plus a real-browser check against the live EA API.
- Do not remove or weaken a test to make it pass. Do not merge your own PR.
- Do not add third-party scripts from CDNs; vendor libraries via `scripts/vendor.mjs`.

## Daily health checks (every run, before choosing an item)
1. Live site https://covisualize.github.io/worcester-river-lab/ loads, reaches "live"
   status, no console errors (desktop and mobile).
2. All 7 gauges report; note any station that is offline or delayed > 2 h.
3. EA API shape unchanged (stations, readings, floods, floodAreas, Hydrology).
4. Last runs of the Pages and Weekly data refresh workflows are green.
Anything broken here takes priority over the backlog.

## Backlog (highest value first)
- [ ] Accessibility audit (WCAG 2.1 AA): colour contrast in both themes, focus order,
      screen-reader names for charts and map markers, 44 px touch targets on mobile.
- [ ] Performance: Lighthouse on mobile; consider lazy-loading ECharts/Leaflet per view,
      and pre-compressing `dist/data/archive-daily.json`.
- [ ] Chart time-axis ticks follow the viewer's local timezone; make tick placement
      follow UK midnights for non-UK viewers (labels are already UK time).
- [ ] Flood-warning history: show warnings issued in the last 24 h with their timeline
      (EA `/id/floods` includes severity 4 "no longer in force").
- [ ] Upstream travel-time explorer: cross-correlate Bewdley → Diglis level changes over
      recent events to show the *observed* lag range (descriptive, not a forecast).
- [ ] Flow data: Bewdley and Saxons Lode publish flow (m³/s); add as an Explore measure
      with clear units.
- [ ] Teme confluence view: Severn vs Teme contribution around Worcester during events.
- [ ] Offline/PWA: cache the shell and last readings so the page opens without signal,
      clearly marked as cached.
- [ ] Shareable PNG/CSV of any chart view; print stylesheet for a one-page report.
- [ ] Data-quality panel: per-station completeness for the selected window.
- [ ] Extend unit tests to `api.js` normalisation of floods/flood areas and `live.js`
      fallback paths.
- [ ] Optional custom domain once the owner buys one (see README).

## Log
<!-- newest first: date — PR — what changed / what was checked -->
- 2026-10-18 — #1–#3 — Dashboard v4 shipped, GitHub Pages deploy, weekly data refresh
  that commits only on real data changes.
