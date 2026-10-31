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
- [x] Performance, step 2: Leaflet (+ its stylesheet, 45,890 bytes gzip) loads on first Map/Explore
      use.
- [ ] Performance, next: Lighthouse on a real phone; consider deferring the ECharts bundle (218 KB
      gzip) the same way for views that draw no chart on first paint (it is needed on Overview).
- [x] Warnings near Worcester (EA flood areas within 12 km) vs elsewhere in the 40 km search:
      only local ones colour the Overview verdict.
- [x] Flood info drawer and header badge: warnings tagged "near Worcester" or "elsewhere".
- [ ] Map: warning areas outside the 12 km set are not drawn at all; show faraway active ones.
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
- [x] Unit tests for `api.js` normalisation and the `live.js` state machine (see 2026-10-29).
- [x] Phone nit: keep "24 h" together in the station-card change line (non-breaking space; done in PR #17, 2026-10-30).
- [ ] Optional custom domain once the owner buys one (see README).

## Log
<!-- newest first: date — PR — what changed / what was checked -->
- 2026-10-31 — daily/2026-10-31-pin-runner — Found when merging #14–#17: the Pages workflow's test job
  failed on every push since 30 Oct (so the site has not redeployed since 26 Oct) because
  `ubuntu-latest` is now Ubuntu 26.04, which Playwright 1.56.1 cannot install a browser on
  ("does not support chromium on ubuntu26.04-x64"). Unit tests passed; the e2e step never ran.
  Fix: pin the test job to `ubuntu-24.04`. Revisit (move back to latest) when Playwright is upgraded
  to a version that supports 26.04.
- 2026-10-30 — daily/2026-10-30-nbsp-24h — Health: site live on desktop+mobile, no console errors;
  all 7 gauges current (23 min; Diglis, Kempsey and Bransford 38 min, normal for their 15-min
  cycle); no warnings in force; rivers falling (Bewdley 1.28 m, Diglis 0.82 m); Pages deploy and
  weekly refresh green (last 26 Oct; next refresh Mon 2 Nov). PRs #14, #15 and #16 still open, so
  untouched (branched from main). Change: the station-card change label ("−12.5 cm / 24 h") used
  ordinary spaces and could break so "h" sat alone on a phone line; it now uses non-breaking
  spaces. Test: new e2e at 320 px that squeezes the line and fails if the label wraps; confirmed it
  fails on the old code. Checked against live EA data at 320 px: all seven cards on one line.
- 2026-10-29 — daily/2026-10-29-data-layer-tests — Health: site live on desktop+mobile, no console
  errors; all 7 gauges current (~21 min; Bransford ~36 min); no warnings in force; rivers falling
  (Bewdley 1.40 m, Diglis 0.87 m); deploys green. PRs #14 and #15 still open, so untouched. Change:
  unit tests for the data layer, which had three incidents in a week and no unit coverage:
  tests/unit/api-shapes.test.js (floods/areas/stations normalisation, reading cache and merge,
  archive-vs-live ranges, snapshot fallbacks) and tests/unit/live-states.test.js (healthy, slow
  readings, early draw, failed history and its retries, failed warnings, late area list, snapshot,
  total outage), both on a stub that serves the real captured EA responses
  (tests/unit/helpers/ea-stub.mjs). Writing them found four defects, fixed: (1) the PR #12 retry
  check `stations.status === 'fulfilled'` was always true, so a retry with every gauge failing
  stayed "live" instead of going stale; (2) a failed gauge-details refresh threw away the last known
  latest value and typical range; (3) with the EA down and the shipped snapshot unreadable the page
  said "saved snapshot" with no data instead of an error; (4) a browser reporting no navigator.onLine
  value was treated as offline. Small code hooks for tests: api.resetForTests(), live.stop() now also
  cancels the 60 s retry. Found, not fixed: "−12.5 cm / 24 h" in the station cards can wrap its "h"
  onto its own line on a phone (use a non-breaking space).
- 2026-10-28 — daily/2026-10-28-lazy-leaflet — Health: site live on desktop+mobile, no console
  errors; all 7 gauges current (~22 min; Bransford ~52 min); rivers falling back after the rise
  (Bewdley 1.52 m, Diglis 0.90 m); one alert elsewhere; deploys green. PR #14 (near/elsewhere
  drawer) still open, so untouched. Change: Leaflet and its stylesheet (45,890 bytes gzip) now load
  on first use of Map or Explore, not with every page. Hover/focus on the Map/Explore links starts
  the download, a direct ?view=map link preloads it, a failed load shows "Map unavailable" with
  Try again. The stylesheet is inserted ahead of app.css so the cascade is unchanged (the first
  attempt appended it and broke a dark-theme contrast rule; the axe audit caught it). Verified
  with live EA data on desktop and mobile; new e2e checks fail against the old eager loading.
- 2026-10-27 — daily/2026-10-27-near-elsewhere — Health: site live on desktop+mobile, no console
  errors; all 7 gauges current (~21 min, Bransford too); rivers rising after rain (Bewdley 2.04 m,
  Kempsey 2.57 m, Diglis 1.04 m, all inside typical range); deploys green; no open PRs. Found on
  the live site: the Overview said "No warnings near Worcester" but the Flood info drawer said
  "1 in force" with no location and the header badge still counted the faraway alert. Change: the
  drawer and header badge use the Overview's near/elsewhere rule (near first, tagged; elsewhere
  under its own heading; badge counts only near; title says how many are elsewhere). The new
  open-drawer axe audit (light and dark) also found three older drawer issues, now fixed: the
  alert label's contrast, card titles skipping a heading level, and the scrollable tables not
  being keyboard-focusable; plus the "falling" chip's contrast.
- 2026-10-26 — owner request ("show Diglis as soon as its data arrives") — The first picture no
  longer waits for all seven gauges: Diglis's own metadata (latest level, typical range) draws it
  the moment it arrives, the warnings join when they arrive, and Diglis's reading history starts
  loading at once (the later request shares that in-flight fetch). Checked against live EA data
  with every other gauge held back 20 s and readings 30 s: first picture at 3.3 s. Found and fixed
  on the way: if the warnings arrive before the flood-area list, the page cautiously counts them as
  local and now corrects itself when the list lands (before, only once fully live). Tests: new
  e2e for slow other gauges and for the late area list (fails against the old logic).
- 2026-10-26 — hotfix (owner report: "none of the info loads") — Cause: the EA reading-history
  endpoint was taking ~35 s (station and warning calls ~1-3 s). The page only drew after the
  history arrived, so visitors saw "Checking the river…" and dashes for ~45 s, then an older
  "Offline snapshot" even though the EA was reachable. Fix: draw the gauges' own latest values
  and warnings as soon as they arrive ("Loading readings…" in the status pill); allow the history
  45 s instead of 20 s ×2; if it still fails, keep the live latest values with a "Reading history
  unavailable" notice (retry after 60 s) instead of swapping to the snapshot. Reproduced with a
  30 s artificial delay on the live site, then verified with the fix against live EA data. New e2e
  scenarios: slow history (8 s) and failed history.
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
