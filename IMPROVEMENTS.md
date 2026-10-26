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
- [x] Accessibility audit (WCAG 2.2 AA + best practice, axe-core): zero violations on all
      5 views in both themes; chart screen-reader summaries; regression test in e2e.
- [ ] Accessibility follow-up: manual screen-reader pass (VoiceOver/NVDA) over the map
      panel and Explore playback; a visible "skip to chart data" table option.
- [x] Fallback snapshot covers all 7 gauges (weekly `research/build_snapshot.py`, kept unless
      all 7 gauges respond) and outage messages are plain English instead of "Failed to fetch".
- [x] Performance, step 1: slim ECharts bundle (only the charts/components used; built by
      `npm run vendor` from scripts/echarts-entry.mjs): 339 → 218 KB gzip, 1034 → 643 KB to parse.
- [ ] Performance, next: lazy-load Leaflet (43 KB gzip) on first Map/Explore visit; Lighthouse
      on a real phone.
- [x] Warnings near Worcester (EA flood areas within 12 km) vs elsewhere in the 40 km search:
      only local ones colour the Overview verdict.
- [ ] Flood info drawer and map: tag each warning "near Worcester" or "elsewhere".
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
- 2026-10-26 — daily/2026-10-26-warning-order — Health: site live on desktop+mobile, no
  console errors, fully live in ~3.7 s (a first desktop probe read "loading" while the EA
  answered at ~8 s a request; transient); all 7 gauges reporting (Bransford ~83 min, others
  ~23 min); rivers rising (Bewdley 1.64 m, Diglis 0.90 m); deploy and the first weekly refresh
  green (the new all-gauge snapshot refreshed itself: 7 gauges, captured 05:45 UTC). Three Flood
  Alerts in force within 40 km, none near Worcester. Found on the live site: the Overview summary
  said "3 flood alerts elsewhere (River Wye in Gloucestershire; River Wye in Herefordshire)",
  cutting the third, River Severn in Shropshire, Worcester's own river. Change: the "elsewhere"
  list now puts warnings on the Severn/Teme first, then most severe, and names every one.
- 2026-10-25 — daily/2026-10-25-local-warnings — Health: site live on desktop+mobile, no
  console errors; 6 of 7 gauges current (~22 min); **Bransford ~8 h behind** (EA's own latest
  reading 23:30 UTC, so an EA-side delay; the site labels it delayed). Rivers rising after
  rain (Bewdley 1.07 m, Diglis 0.78 m). Clocks went back today: times show GMT correctly.
  Found on the live site: a Flood Alert for the River Wye in Herefordshire (~40 km away) turned
  Worcester's headline amber and read "Flood alert in force nearby". Change: only warnings for
  EA flood areas within 12 km of Worcester colour the verdict; others are reported as
  "elsewhere within 40 km" with their area name. Verified against today's live EA data.
- 2026-10-22 — daily/2026-10-22-slim-echarts — Health: site live on desktop+mobile, no
  console errors; all 7 gauges reporting (Bransford ~52 min, others ~22 min); deploy green;
  PR #8 (outage fallback) still awaiting review, so not touched. Change: ECharts slimmed to the
  parts in use, cutting the Overview's first load from ~472 KB to ~350 KB transferred.
  Verified by rendering all 10 charts with the full and the slim library at a fixed clock:
  pixel-identical (a control build missing markLine differed on 6 of 10, so the check bites).
- 2026-10-21 — daily/2026-10-21-outage-fallback — Health: site live on desktop+mobile, no
  console errors; all 7 gauges reporting (Bransford ~36 min, others ~21 min; one Bewdley
  fetch failed once on desktop, then recovered); deploy and weekly refresh green; EA API
  responding but slow (~55 s per request through this environment). Change: outage fallback
  now uses an all-gauge snapshot (last 25 h of readings, station metadata, rain 1773),
  refreshed weekly by the data workflow; banner says "could not be reached" / "having
  problems (error 503)" instead of raw browser errors. Verified in a browser with EA blocked.
- 2026-10-20 — second external review — `?demo=feb2020` replay (real EA 15-min archive
  readings, 6–16 Feb 2020, shifted to now; illustrative warnings; banner, status pill and
  hero title say DEMO on every view; built by research/build_demo.py); typical-range pill in
  words ("Near typical low") with the % in its tooltip; reference-line labels get a backing
  box and the History "Latest" label sits below its line; archive lag counted in whole
  calendar days (was 8, now 7); "Loading readings…" inside empty charts; 18 px Explore
  checkboxes and 44 px rows on touch. Kept: `?compare` on Analysis, because its
  multi-station chart uses that selection.
- 2026-10-20 — external review — Actioned a usability review: Overview now answer-first
  (verdict, official-warning line, then the number with % of typical range); "Unofficial
  site, use GOV.UK" line at the warnings card; "intelligence" wording removed; staggered
  reference-line labels; axis decimals from data span; heatmap coloured by EA reference
  bands with blank no-data days; 44 px touch targets and bottom-nav clearance; URL carries
  only the current view's state; archive lag stated; delayed-gauge wording; simulator
  collapsed with its caveat drawn on the chart. New e2e replay of a high-water state
  (Feb 2020 peak + TEST Flood Warning), which also caught a "Below typical high −2.47 m" bug.
  (Earlier that day: EA real-time API outage 06:52–~08:30 UTC; site correctly fell back.)
- 2026-10-19 — daily/2026-10-19-accessibility — Health: site live on desktop+mobile, no
  console errors; all 7 gauges reporting (22–37 min old); no warnings in force; EA API
  shapes unchanged; Pages deploy and Monday's scheduled data refresh green. Change:
  accessibility pass. Charts now give plain-English screen-reader summaries (ECharts' own
  text read raw epoch milliseconds); map-marker labels pick the higher-contrast ink
  (white text measured ~2:1 on dark-theme fills); light-theme "rising"/"steady" chip text
  darkened to ≥5:1; h1 on every view; nested <aside> landmarks fixed; map zoom control
  moved so it no longer covers the station panel; search box moves beside an open panel
  instead of being hidden under it; mobile layer list starts collapsed.
  axe-core WCAG 2.2 AA audit added to the e2e suite (one documented 2.5.8 "equivalent
  control" exception for the Explore mini-map).
- 2026-10-18 — #1–#3 — Dashboard v4 shipped, GitHub Pages deploy, weekly data refresh
  that commits only on real data changes.
