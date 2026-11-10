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
- [x] Performance, step 3: no layout jump while the first data arrives (CLS 0.6 → ~0.02 in Lighthouse mobile; see 2026-11-04).
- [x] Performance, step 4: ECharts (218 KB gzip) is fetched early at low priority but only run when a chart is
      about to be drawn (the Overview timeline when its panel nears the screen; Analysis, Explore and History
      before they mount); see 2026-11-05.
- [ ] Performance, next: a Lighthouse run on a real phone (all Lighthouse numbers so far are its emulated mobile:
      Moto G Power, 4x CPU slowdown, slow 4G). Remaining findings on 5 Nov: LCP about 3 s live (6 s on an
      uncompressed local server), 25 KiB unused JavaScript, main-thread style/layout work. GitHub Pages sets the
      cache lifetime, so "efficient cache lifetimes" cannot be fixed here.
      Tried and not shipped (2026-11-08): `<link rel="modulepreload">` for the 14 modules of js/main.js (the browser
      otherwise finds the import graph level by level). Real throttled timing, gzip server, 6-8 runs: first EA call
      1.29 → 0.85 s and river level on screen 2.0 → 1.6 s (-0.44 s), but first paint of the empty shell 0.46 → 0.58 s;
      Lighthouse mobile (gzip) shows no gain (LCP and TTI 2.9 s both ways) and a later FCP (1.1-1.3 → 1.6-1.7 s), score
      95-96 → 92-95. `preconnect` to the EA added nothing. `fetchpriority="low"` on the hints did not recover the paint.
      A real-phone or HTTP/2 result could differ; measure with `scripts/measure-load.mjs` before trying again.
- [x] Warnings near Worcester (EA flood areas within 12 km) vs elsewhere in the 40 km search:
      only local ones colour the Overview verdict.
- [x] Flood info drawer and header badge: warnings tagged "near Worcester" or "elsewhere".
- [x] Map: faraway active warnings (outside the 12 km set) were already drawn; their tooltips now say near Worcester or elsewhere (see 2026-10-31 second entry). This item's earlier wording was wrong.
- [ ] Chart time-axis ticks follow the viewer's local timezone; make tick placement
      follow UK midnights for non-UK viewers (labels are already UK time).
- [ ] Flood-warning history: show warnings issued in the last 24 h with their timeline
      (EA `/id/floods` includes severity 4 "no longer in force").
- [ ] Upstream travel-time explorer: cross-correlate Bewdley → Diglis level changes over
      recent events to show the *observed* lag range (descriptive, not a forecast).
      Checked 2026-11-08: the live feed's last 28 days (15-minute data) contain one real upstream-driven rise
      (23-31 Oct; Bewdley peak 27 Oct 01:15, Diglis 06:00 later) and a small one on 18 Oct whose Diglis peak came
      1.8 h after Bewdley's (local rain, not the same water). A "typical lag" from that would be one event
      presented as a pattern. Needs a longer 15-minute history with many events (check whether the EA Hydrology
      API can supply years of 15-minute Bewdley and Diglis data) and a minimum number of events before it shows a number.
- [x] Flow data, step 1: the map panel shows the EA's latest flow (m³/s, with time) for the gauges that
      publish it (Bewdley, Saxons Lode), labelled as EA-reported (see 2026-11-01).
- [ ] Flow data, step 2: flow history as an Explore measure; needs the flow readings endpoint, a
      units axis, and a decision on Saxons Lode (the EA reports 0.0 m³/s there, which may not mean
      the river is dry).
- [ ] Teme confluence view: Severn vs Teme contribution around Worcester during events.
- [ ] Offline/PWA: cache the shell and last readings so the page opens without signal,
      clearly marked as cached.
- [x] Print stylesheet: dated stamp, no dead buttons, chart fits the page (see 2026-11-06). It is three A4 pages, not one.
- [ ] Shareable PNG/CSV of any chart view. Step 1 done (2026-11-09): the Overview timeline has "Save image", a PNG with a
      title and period above the chart and, below it, which reading it shows (or that it is a demo or an offline snapshot),
      when it was saved, that it is unofficial, the EA source and licence, and the official-warnings pointer; a demo or
      snapshot also says so in the file name. Left: the same for Analysis, Explore and History (`chartPicture()` in
      `js/chart-image.js` takes any ECharts instance; each chart needs its own title and period lines), and a phone share
      sheet (`navigator.share` with a file), which needs a real phone to test.
- [x] Data-quality panel, step 1: per-gauge completeness for the last 24 h in the Flood info drawer's "Data
      confidence" section (readings received of 96, longest gap), see 2026-11-03.
- [ ] Data-quality panel, step 2: completeness for the window chosen in Explore, and for the Hydrology archive.
- [x] Unit tests for `api.js` normalisation and the `live.js` state machine (see 2026-10-29).
- [x] Phone nit: keep "24 h" together in the station-card change line (non-breaking space; done in PR #17, 2026-10-30).
- [ ] Optional custom domain once the owner buys one (see README).

## Log
<!-- newest first: date — PR — what changed / what was checked -->
- 2026-11-10 — daily/2026-11-10-delayed-legible — Health: site live on desktop+mobile, no console errors, no overflow;
  6 of 7 gauges current (20-36 min); Bransford 141 min old, over the 2 h flag (it publishes late in batches, as before;
  the pill says "1 gauge delayed" and its card says so); no warnings near Worcester (one elsewhere in England); EA shapes
  unchanged; deploys of #28 and #29 green and the river diagram is live; no open PRs. Change: the first real delayed gauge
  showed two flaws in yesterday's river diagram. (1) A delayed gauge faded all of its node, words included, so "delayed"
  (the point) was the least readable text in the drawing and, at 60% opacity, under the 4.5:1 contrast minimum. Now only the
  bar, dot and stem fade; the words stay at full contrast, in italic. (2) On the wide layout the Teme's curve touched the
  longer "Within typical range · delayed" text; the confluence moved 40 units right (still above Kempsey, which is below it
  on the river). Tests: 1 e2e step on the existing delayed-gauge scenario (words at effective opacity 1, graphics below 1,
  italic, same ink as the name, text ends before the curve); it fails on the old CSS (0.6 !== 1). Looked at against the live
  EA, desktop and phone. Lesson for the diagram: dim graphics, never text.
- 2026-11-09 — ccr-a935da98-tkn87x (owner request: graphical and design improvements) — "The river at a glance": a
  schematic above the station cards with the gauges in the order the water passes them, the Teme joining the Severn below
  Diglis, and at each gauge a bar from its EA typical low to typical high filled to the latest reading (a line above the
  bar when the reading is over the typical high), with the level, trend and range words. It draws only what the cards
  already state (an e2e step compares the two), says "No data" where there is none, fades a delayed reading, and its caption
  says it is a diagram, not a map, with nothing to scale. Left-to-right on wide screens, top-to-bottom below 900 px; colours
  come from the theme variables; a text alternative lists every gauge. Looked at with live EA data (light, dark, phone,
  tablet) and with the February 2020 demo replay for the high-water case. Tests: 7 unit, 2 e2e; axe audits and the
  layout-shift limits still pass (phone 0.047, desktop 0.024). Not done: clicking a gauge in the diagram (the cards have
  the Map and Explore buttons); the diagram is not in the saved picture or on the Map view.
- 2026-11-09 — daily/2026-11-09-share-image — Health: site live on desktop+mobile, no console errors, no horizontal
  overflow; all 7 gauges current (23 min); no warnings in force; EA shapes unchanged (station, latest readings, floods,
  flow measure); the 8 Nov PRs (#26 slow-EA notice, #27 measuring tools) are merged and live (the notice text is in the
  deployed main.js); deploys of both green, the Monday weekly refresh (run 6) and the deploy it triggered green (it changed
  only the offline snapshot); no open PRs. Change: the Overview timeline gets "Save image". A bare screenshot of a river
  level carries no date, source or "unofficial" note, and these pictures get pasted into group chats, so the PNG has a title and
  the period above the chart and, below it: the latest Diglis reading it shows (or DEMO REPLAY, or the offline snapshot's
  date, whichever applies), when it was saved, "unofficial summary of Environment Agency real-time data (Open Government
  Licence v3)", and the GOV.UK / Floodline pointer; a demo or snapshot also says so in the file name
  (`DEMO-replay-…`, `SNAPSHOT-…`). The zoom slider is left out (in a still picture it looks like a control that does
  nothing). The "which reading / is it current" sentence used to live inside the print stamp: it is now `dataBasis()` in
  data.js and the print stamp and the picture both use it, so they cannot disagree (the printout's text is unchanged,
  covered by the existing print tests). The picture code (`js/chart-image.js`) is fetched on the first click, so the page's
  start-up is unchanged. Tests: 8 unit (wording for live/demo/snapshot/no reading, file names including BST, text wrapping)
  and 6 e2e steps that really click, receive the download and decode the PNG (signature, size, text in the header and footer
  strips, chart in the middle) and capture every string drawn on the canvas, for live, compare view, demo replay and an
  offline snapshot, plus a failed fetch of the picture code (plain message, nothing saved). Codex review found a race in the
  first version: on the first click the caption was read before the picture code arrived, so switching to the Bewdley
  comparison in that window gave a change-in-cm chart labelled "metres above station datum". Reproduced first with a 1.5 s
  slow-picture scenario (the step failed on the old code), then fixed: nothing about the chart is read until the module is
  loaded, and the capture starts in the same synchronous run (the file name's range also comes from the drawing). Negative control: sending `mode: 'live'` whatever the real mode, and dropping the warnings line, made the
  live, demo and snapshot steps fail. Found by the snapshot test: an offline snapshot is days old, so the 24-hour chart is
  empty ("No readings for Last 24 hours") and the first version of the button said "not ready yet"; it now says there are no
  readings to save a picture of. Limits: checked in Chromium (desktop and phone emulation, light and dark) against the live
  EA, not on a real iPhone or Android; a phone share sheet is not done; the picture shows the chart as drawn, including its
  annotation pins (on a phone one can sit over the "EA typical range" label, as on screen).
- 2026-11-08 — daily/2026-11-08-measure-load — Health: site live on desktop+mobile, no console errors, both
  runs clean; all 7 gauges current (20 min; Bransford 95 min, under the 2 h flag); no warnings in force; last
  deploy green (#24); weekly refresh runs Monday; open PR: #26 (untouched; this branch is from main). Change:
  no site change today, because the two ideas I measured did not clear the bar. (1) Upstream travel-time
  explorer: the data can't support it yet (see that backlog item: one real event in 28 days, and the second
  rise gave 1.8 h against the first's 6.0 h). (2) `modulepreload` for the app's modules: faster data (-0.44 s)
  but a later first paint, and Lighthouse sees no gain (see "Performance, next"). Two instruments disagreeing
  with a measurable cost is not an improvement, so nothing was shipped. What is kept: `scripts/serve.mjs` can
  now serve gzip (`--gzip`, like GitHub Pages) and another copy of the site (`--dir`), and the new
  `scripts/measure-load.mjs A B [runs]` compares two copies under slow-4G throttling (first paint, first EA
  call, river level on screen; medians of interleaved runs), which reproduced the numbers above. Method notes:
  Playwright's `route.fulfill` skips the throttling for the page's own files and Playwright's `proxy` option
  forces localhost through the proxy, so the harness uses real local servers and Chromium's own proxy flags;
  an uncompressed server exaggerates the cost of extra files (Lighthouse FCP +0.6 s there, +0.5 s with gzip,
  Lighthouse score 76 → 74 and 95 → 92-95).
- 2026-11-07 — daily/2026-11-07-slow-ea-notice — Health: a first health run at 07:51 caught the EA in a slow
  spell: on desktop the page was still "loading" with three gauges missing after the script's 45 s wait, and the
  phone run logged console errors (text not captured, so I cannot say what they were). Direct requests to the EA at
  that moment took 10.3 s (readings, then 0.5 s), 11.5 s (station details) and 13.5 s (warnings), so it was the EA,
  not the site; six further runs (desktop and phone) over the next minutes were all healthy with no errors. All
  7 gauges current (Bransford 37 min); no warnings in force; the four PRs merged on 6 Nov are deployed (last
  deploy green, weekly refresh runs Monday); no open PRs. Change: simulating a slow EA (every answer 12 s late)
  showed that a visitor sees "Connecting to EA…" and "Checking the river…" for the whole wait, identical at 11 s
  to 1 s, with nothing saying that the wait is the EA's. After 6 s without any answer (gauge details count as an
  answer, so the 8 s slow-history case is unaffected) the pill now says "EA is slow to answer…" and the summary
  says the EA is taking longer than usual, that nothing is shown yet, that the page will fill in by itself, and
  gives GOV.UK Check for flooding and Floodline for official warnings; real data replaces it as soon as it
  arrives and no number is shown meanwhile. Tests: e2e `veryslow` scenario (every EA answer 9 s late) for the notice and its
  replacement, plus an assertion in the slow-history test that the notice is not shown when the EA has answered;
  the first fails on the old code. Follow-up idea: after the notice, offer the saved snapshot ("show the last saved
  readings from <date>") while waiting; not done, because showing old readings as a choice needs its own labelling.
- 2026-11-06 — daily/2026-11-06-print — Health: site live on desktop+mobile, no console errors; all 7 gauges
  current (20 min; Bransford 50 min); no warnings in force; last deploy green, weekly refresh runs Monday;
  PRs #22, #23 and #24 are still open and untouched (branched from main, the change avoids the files they
  rewrite). Change: looked at what printing the Overview produces (A4, via Chromium's print renderer, live
  data) and fixed what a person holding the paper would notice. (1) The timeline chart was cut off at the
  right edge (a canvas keeps its screen width): on `beforeprint` the page gets an `is-printing` class that
  gives charts a 17.5 cm width and redraws them, undone on `afterprint`. (2) Buttons, toggles, the range
  picker, the "what does this mean" box and the demo link printed as dead controls: hidden in print.
  (3) "Observed 21 min ago, up to date" is wrong on paper read later, and the page said nothing about when it
  was made: a print-only stamp at the top gives the print time, the latest Diglis reading time (absolute),
  that readings and warnings may have changed, and where the official warnings are (GOV.UK, Floodline); a
  demo replay prints "DEMO REPLAY of February 2020: illustrative, not current conditions" and an offline
  snapshot prints when it was taken. (4) Cards and the chart do not split across pages and the station cards
  use three columns. Result: three A4 pages with nothing clipped (before: two pages with the chart cut off and
  about twenty buttons and toggles); a one-page report was the backlog's hope, but the hero, KPIs, chart and seven station
  cards do not fit one page legibly. Tests: e2e for the stamp text (live, snapshot, demo), the hidden
  controls, the figures still printed, and the chart fitting 17.5 cm and returning to full width afterwards;
  all three fail on the old code. The e2e restores screen media in a `finally`, because a failing print test
  otherwise breaks every later step (found when my first regex was wrong). The first stamp version parsed
  the snapshot time (already epoch ms) as a date string and so never printed it; the offline e2e caught it.
  Not verified: a real browser's print dialog (Chromium's PDF output was used), other browsers' `beforeprint`.
- 2026-11-05 — daily/2026-11-05-defer-echarts — Health: site live on desktop+mobile, no console errors; all 7
  gauges current (21 min; Bransford 36 min, back under the 2 h flag); no warnings in force; last deploy green,
  weekly refresh runs Monday; open PRs #22 and #23 untouched (branched from main). Change: Lighthouse
  (4 Nov) put ECharts first in its JavaScript execution list (about 1.5 s of script evaluation under the 4x CPU
  slowdown, in a 2.3 s total) with 101 KiB of it unused on first paint. It was a `defer` script, so it
  ran before the page was interactive, though the first thing a visitor needs (hero, KPIs, stations) uses no
  chart. Now `index.html` only preloads it (low priority, no execution) and `loadECharts()` in ui.js runs it
  on demand: the Overview watches its timeline panel (only after the first data render, because before that
  the panel sits high on the screen) and loads it 300 px before it scrolls into view, so on a phone it is not
  run at all until the visitor scrolls, and on desktop it runs at once; Analysis, Explore and History load
  it before they mount (navigation links start the load on hover/focus, as for Leaflet). Failures are handled
  like Leaflet's: "Charts unavailable" with a retry on the three views, and a retry under the Overview
  timeline while the hero and KPIs keep working. Same Lighthouse mobile run, old vs new build served locally
  with live EA data, 3 runs each: total blocking time 520-1,240 ms → 20-80 ms; start-up JavaScript 1.8-2.5 s →
  0.3-0.5 s; time to interactive 7.6-8.4 s → 5.9 s; unused JavaScript 301 → 25 KiB; performance score 29-41 →
  55. With the layout-shift fix of PR #23 applied as well (not merged yet): CLS 0.015-0.019, TBT 10-60 ms,
  score 77-78. Tests: e2e that ECharts is fetched but not run on a phone until the timeline nears (and is
  fetched only once), that a failed library leaves hero and KPIs working with a retry on the timeline and on
  the Analysis view, and that a direct link to a chart view still draws; the first three fail on the old code
  (the direct-link one is a regression guard). Found while testing: starting to watch the timeline at mount
  made it "near" before the data arrived (placeholder layout), so ECharts loaded at once on a phone; and the
  timeline's own refresh would have cleared the library error, so that error carries its own class.
  Found when merging this with the print change (2026-11-06): on a phone that has not scrolled to the timeline the
  charting library is not loaded, so a print would have had an empty chart box with no explanation. The print
  stamp now says "The timeline chart had not loaded when this was printed" and the Overview starts the chart
  (a second print has it); e2e covers it and fails without it.
- 2026-11-04 — daily/2026-11-04-layout-shift — Health: site live on desktop+mobile, no console errors; all 7
  gauges reporting (22 min; Bransford 127 min, over the 2 h flag again); no warnings in force; last deploy and
  weekly refresh green; open PR #22 untouched (branched from main). Bransford, third morning running: its
  six days of readings have no gap over 45 minutes (568 readings; Diglis 571) but its newest reading is always
  hours old when looked at, so the EA publishes that gauge's data late, in batches, and fills it in afterwards.
  "Delayed" on its card and in the pill is accurate; nothing is missing. Change: a first Lighthouse run (emulated
  mobile) scored accessibility, best practices and SEO 100 but performance 47, mostly layout shift 0.6. Measured
  in the browser (PerformanceObserver) the hero text, gauge and KPI row are empty or short until the data arrives
  and then push everything below them down (0.18 on a phone unthrottled, 0.09 on desktop). While the status pill
  is "loading", CSS (`body:has(#live-status[data-mode="loading"])`) now holds the space they will fill, using
  settled heights measured at each breakpoint and taken slightly under, plus the usual widths for the level number
  and chips so the row wraps the same way from the start. Released as soon as the status leaves "loading".
  Result, same Lighthouse mobile run on old vs new build (live EA data): CLS 0.60 → 0.02, performance 46-50 → 71;
  in the browser phone 0.18 → 0.03 and desktop 0.09 → 0.003-0.023. Tests: e2e with a `late` scenario (every EA
  answer 1.5 s late, so placeholders paint first) asserting CLS under 0.1 on a phone and 0.05 on desktop; both
  fail on the old CSS (0.150 and 0.093). A first version of the test passed on the old CSS too (the fixtures
  answer instantly, so no shift happened); caught by the negative control and fixed. Not covered: widths between
  the measured ones may settle a few px differently, and `:has()` needs a 2023+ browser (older ones just keep the
  old behaviour).
- 2026-11-03 — daily/2026-11-03-data-completeness — Health: site live on desktop+mobile, no console
  errors; all 7 gauges current (20 min; Bransford 65 min, back under the 2 h flag); no warnings in force;
  rivers falling (Bewdley 0.62 m, Diglis 0.63 m); #20 and #21 are deployed and live (checked the served
  map.js and data.js), the last deploy and the weekly refresh are green, no open PRs. Change: the drawer's
  "Data confidence" section said only "Gauges reporting 7 of 7", which hides what Bransford has done on
  1-2 Nov (hours without a reading). It now has a per-gauge table: readings received in the last 24 h
  against the 96 the EA's 15-minute interval gives, and the longest gap (more than 30 min between readings;
  "ongoing" when nothing came in after it). New pure helper `completeness()` and `fmt.duration()` in
  data.js. Design points found while testing: (1) EA readings appear 20-40 min after their timestamp, so
  judging up to "now" flagged every healthy gauge as "94 of 96 / 31 min (ongoing)"; the period therefore
  ends one hour ago (the "up to date" threshold), which the 25 h of history covers exactly. (2) On first
  load the status is already "live" once Diglis has its history while the other six are still loading, so a
  naive table showed six gauges as "0 of 96"; caught by the live check, and the table now waits for the
  refresh to finish. Tests: unit tests for `completeness` (healthy, normal delay, stopped feed, hole in the
  middle, outside-window/empty, 30 vs 45 min breaks) and `fmt.duration`; e2e for the table (healthy gauges 96
  of 96, Bransford's stopped feed 84 of 96 with an ongoing 3 h gap, axe audit of the open section in both
  themes) and for the no-half-loaded-table case (new `primaryfirst` scenario); each fails without its code.
  Live check against the real EA API on desktop and a phone viewport: six gauges 96 of 96, Bransford 95 of
  96 (one missing reading, not a gap), no overflow, no errors. The "24 h" header uses a non-breaking space.
  Codex then found two more, both confirmed: (1) a gap was only measured inside the period ending one hour
  ago, so a gauge that had resumed in the last hour was still called "ongoing"; gaps are now found in the whole
  series up to now, and the stretch since the newest reading counts (as "ongoing") only past the 60 min
  "up to date" limit; (2) a gauge whose own history request failed (or came back empty) kept an old series
  and showed as "0 of 96" with a note blaming the EA; `live.historyLoaded` now records which gauges loaded in
  the latest refresh and the others show "not fetched this time". Unit tests for both (including the exact
  Codex scenario) and an e2e `badgauge` scenario; each fails on the previous code.
- 2026-11-02 — daily/2026-11-02-delayed-gauge-pill — Health: site live on desktop+mobile, no console
  errors; weekly refresh (05:17) and the deploy after it green, 6 of 7 gauges current (25 min); no
  warnings in force; rivers falling (Bewdley 0.72 m, Diglis 0.66 m). PR #20 still open, so untouched
  (branched from main). Bransford is again delayed (205 min; also 140 min yesterday): the EA API itself
  has nothing newer than 04:30 UTC and no gaps before it, so it is the EA feed stopping, not our code.
  Found on the live site: the header pill said just "Live · 08:01" because it only checks Diglis, so a
  gauge hours behind was only visible on its own card. Change: the pill now adds "· 1 gauge delayed"
  (any gauge other than Diglis past the 2 h "Delayed" threshold; Diglis already turns the pill amber
  and says "reading N h old") and its tooltip names the gauge and its last reading time. New pure
  helper `delayedGauges()` in data.js. Tests: unit test (stale only; slightly late, fresh, no-data and
  the excepted primary are left out) and an e2e with a new `delayed` scenario (Bransford's feed stops
  4 h before "now"); the e2e fails on the old code. Live check against the real EA API showed
  "Live · 08:01 · 1 gauge delayed" with "Delayed: Bransford, last reading ... 04:30 GMT (3 h 31 min
  ago)". Note: on phones the pill is icon-only (CSS hides its text), so the extra wording is for
  desktop and tablet; phones still get the card message and the tooltip. Possible follow-up: tint
  the phone icon when any gauge is delayed.
  Codex then found, and I confirmed, that the history can lag a gauge's own metadata reading (histories fail
  but metadata updates), so `delayedGauges` now uses the newest of the two; unit test fails without it.
- 2026-11-01 — daily/2026-11-01-flow-in-map-panel — Health: site live on desktop+mobile, no console
  errors; deploy of #19 green and live (serves the map near/elsewhere tooltips); no open PRs. Six
  gauges current (20 min). Bransford is delayed: its last reading is 05:30 and the EA API itself has
  nothing newer (checked directly), so this is an EA publication delay; the site already says so on the
  card ("Delayed data: last reading 05:30 (2 h 21 min ago); the EA has not yet published a newer
  one"). The weekly data refresh runs tomorrow (Monday). Change: Bewdley and Saxons Lode publish
  discharge as well as level. The station normaliser now keeps the EA's own latest flow reading
  (`flow: {value, unit, t}`; absent, non-numeric or unexpanded readings give null), and the map panel
  shows it as "Flow (EA)" with its time and a note that it is shown as received. Tests: a unit test on the
  real captured responses and an e2e on the panel (Bewdley shows it, Bransford does not); both fail on
  the old code. Live check: Bewdley 44.6 m³/s at 07:30, matching the EA API. Noticed: the EA reports
  0.0 m³/s at Saxons Lode, which a visitor could read as a dry river; shown as published with the
  note, and flagged for the owner's call (hide it, or add a caveat) before flow history is built.
  Codex found, and I confirmed, that the Feb 2020 demo showed Bewdley's real flow from the day the
  bundled metadata was captured next to the replayed flood level; fixed twice over: the demo now clears
  flow, and the panel only shows a flow reading that is within 2 h of the level beside it. Both have an
  e2e test that fails without them.
- 2026-10-31 — daily/2026-10-31-map-near-elsewhere — Health: site live on desktop+mobile, no console
  errors; all 7 gauges current (20 min; Bransford 35 min); no warnings in force; rivers falling
  (Bewdley 1.03 m, Diglis 0.76 m); Pages deploy green again after #18 (the run on the #18 merge
  passed both jobs and the live site serves the 28 Oct lazy-map build); no open PRs. Change: the
  backlog said the map did not draw warnings outside the 12 km set; reading `loadWarnings()` showed
  it always has (any active warning gets its polygon). What was missing is that the map tooltip, unlike
  the Overview and the Flood info drawer, did not say whether a warning is near Worcester or
  elsewhere. It now does, from the same area list (`live.localAreas`), read when the tooltip opens so
  a late list still counts; nothing is tagged until the list is known, and "no longer in force" areas
  get no tag. Tests: two new e2e checks (faraway alert tagged elsewhere; local alert tagged near),
  both fail on the old code. Live check: map draws 22 warning areas against the real EA API with no
  errors; there is no live warning today, so a real faraway tooltip was not observed.
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
