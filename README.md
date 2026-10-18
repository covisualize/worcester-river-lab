# Worcester River Lab

**Live River Severn intelligence for Worcester** — a static, no-build web app (served from `dist/`) built on Environment Agency open data. It shows the latest verified river levels, official flood warnings, nearby gauges, an interactive map, 26 years of history and explainable charts. It does **not** forecast floods.

## Milestone 4: interactive intelligence dashboard

`dist/index.html` is the new dashboard. The original milestone 1–3 page (observation desk, research snapshot explorer, forecasting experiment) is preserved unchanged in function at `dist/lab.html` ("Research lab" in the navigation).

### Views
| View | What it does |
|---|---|
| **Overview** | Diglis level with plain-English summary, trend and typical-range chips, animated gauge against EA reference levels, official warning card, six KPI cards (hover details, sparklines, click-through), timeline (24 h / 7 d / 30 d / custom dates, annotations, Bewdley comparison, CSV), seven nearby Severn & Teme gauges. |
| **Map** | Leaflet map: live gauge markers coloured by typical-range band, EA Statutory Main Rivers, EA flood-warning polygons coloured by live status, EA rain gauges (24 h totals), optional RainViewer radar, place/postcode/station search, reset, full screen, station detail panel. |
| **Analysis** | (1) multi-station comparison in stage / change / % of typical range / derived mAOD; (2) level gauge with EA stageScale table; (3) typical-range comparison bars; (4) rate of change (cm/h); (5) rainfall vs river level; (6) a clearly labelled *simulation* (linear what-if, never a forecast). |
| **Explore** | Pick stations, dates and measures; click to pin notes; automatic annotations (peak, low, fastest rise/fall); playable/scrubbable animation; linked mini-map with two-way highlighting; insight list; shareable URL; CSV. |
| **History** | EA Hydrology daily maxima since 2000: long-term chart, largest independent events (≥14 days apart), peak-aligned event overlay, year calendar heatmap, quality flags. |
| **Flood intelligence** (drawer) | Official warnings within 40 km with messages and GOV.UK links, observed changes at all gauges, verified reference levels, historical comparison, data confidence & freshness, official guidance and Floodline. |

Every view is URL-addressable (`?view=explore&compare=2001,2085&range=7d&metric=range&notes=…`). Keyboard: `1`–`5` switch views, `R` refreshes, `F` opens flood intelligence, `Esc` closes it. Light/dark themes; `prefers-reduced-motion` disables animation.

### Data sources (all checked live before integration)
- **EA real-time flood-monitoring API** (Beta, OGL v3): station metadata incl. `stageScale` (typical range, highest recent, max/min on record, stage datum), 15-minute level readings (~4 weeks retained), tipping-bucket rainfall, `/id/floods` warnings, flood areas and polygons. CORS-enabled, no key. Polled every 5 minutes while visible; incremental refresh fetches only recent hours.
- **EA Hydrology API** (quality-flagged archive): 15-minute data for custom date ranges older than four weeks (≤62 days per request) and daily max/min since 2000 (snapshot in `dist/data/archive-daily.json`).
- **EA Statutory Main River Map** (WFS): simplified to `dist/data/main-rivers.geojson`.
- Base map © OpenStreetMap contributors; optional radar © RainViewer; search via postcodes.io and Nominatim (on submit only).

Rebuild the static reference files with `python research/build_reference.py`.

### Honesty rules built into the code
- No reading, threshold, warning or forecast is invented. The typical range is EA metadata and is always described as *not* a flood-warning threshold; the EA does not publish warning trigger levels through this API, so none are shown.
- "Derived mAOD" = stage + EA `stageScale.datum` (documented by the EA as the gauge datum on OS datum), labelled as derived.
- Changes need a real reading within 30 minutes of the comparison time; rate of change needs readings ~1 h apart (±10 min); gaps > 30 min break chart lines; rain totals use only complete hours. No interpolation anywhere.
- Status pill and banners distinguish live, delayed (> 2 h), failed-refresh (cached) and offline-snapshot modes. Offline falls back to the shipped, timestamped snapshot with a prominent warning.
- All displayed times use Europe/London (GMT/BST); CSV exports carry UTC plus UK local time.

### Code structure (`dist/js/`)
`config.js` (IDs, conventions) · `api.js` (fetching, caching, de-duplication, timeouts, fallback) · `data.js` (pure calculations & UK-time formatting) · `store.js` (state ↔ URL) · `live.js` (refresh scheduling & status) · `charts.js` (pure ECharts option builders + SVG gauge/sparklines) · `ui.js` (DOM helpers) · `views/*.js` (one module per view) · `main.js` (bootstrap & routing). Libraries: ECharts 5.6.0 and Leaflet 1.9.4, vendored into `dist/vendor/` by `npm run vendor` (no CDN, no build step).

### Run & test
```
npm install            # dev only: libraries to vendor + Playwright
npm run serve          # http://localhost:8080
npm test               # 24 unit tests (data, URL state, chart builders) + milestone 3 explorer check
npm run test:e2e       # headless Chromium: 15 checks incl. offline fallback and mobile layout
```
The end-to-end test serves `dist/` through request interception and answers EA calls from `tests/fixtures/ea.json` (real responses captured once) with a fixed clock, so it is deterministic and offline. Its flood alert is a labelled test fixture and is never shipped.

Deployment is unchanged: `.openai/hosting.json` serves `dist/` as static files.

---

## Milestone 1: observation desk (now `lab.html`)

First milestone: one-gauge observation dashboard for Diglis (EA station 2085), with 24-hour, 3-day and 7-day views, CSV export and a timestamped fallback snapshot. It is not a flood forecasting or warning service.

## Run
Serve `dist/` with any static HTTP server. No installation or build required. Live data is requested by the visitor's browser on load and refresh; there is no background collection.

## Data
Environment Agency flood-monitoring API (Beta), Open Government Licence v3.0.
- Station: https://environment.data.gov.uk/flood-monitoring/id/stations/2085.json
- Readings: https://environment.data.gov.uk/flood-monitoring/id/measures/2085-level-stage-i-15_min-mASD/readings?_sorted&_limit=1000
- Reference: https://environment.data.gov.uk/flood-monitoring/doc/reference

The app excludes non-numeric and invalid-date readings and deduplicates timestamps. Chart segments break at gaps longer than 30 minutes. The approximate six-hour change requires an observation within 30 minutes of the comparison time. Data older than two hours receives a conservative delay label; this is an app convention, not an EA service guarantee. The displayed typical range is station metadata, never an official warning threshold. A 1000-record cap may shorten coverage when source records are missing. All displayed time labels use Europe/London; exported timestamps preserve UTC.

## Research protocol: next phase
1. Obtain historical, quality-qualified Diglis levels from the EA Hydrology archive; check station identifiers and datum changes.
2. Select upstream gauges and catchment rainfall using documented geographic and hydrological relevance.
3. Audit missing periods, duplicates, units, quality flags and reporting delays. Preserve raw data and retrieval timestamps.
4. Establish persistence forecasts at 1, 3 and 6 hours. Compare a recent-trend baseline and a small model using lagged upstream/rainfall features.
5. Use chronological train/validation/test splits and rolling-origin evaluation; fit transforms on training data only. Use only information available at each forecast issue time, accounting for reporting delay.
6. Report MAE/RMSE, skill versus persistence, and performance during high-water periods. Define event thresholds and separation rules before evaluation. For event classification report misses, false alarms and lead time, with event-level uncertainty.
7. Publish reproducible code and limitations. No operational warning claims, property risk scores or safety-critical deployment.

Rainfall ingestion, upstream stations, historical analysis, notifications and forecasts are not implemented in this milestone.

## Milestone 2: visual history and exploratory replay
Run `python research/collect.py` to retrieve up to 3000 readings per series, then `python research/evaluate.py` (requires NumPy) to regenerate the experiment. The collection is a snapshot, not a background task or the quality-qualified Hydrology archive. Bewdley may include older isolated readings; plots restrict by time and break long gaps. Station 1773 (52.222319, -2.17488) is local rainfall context, not catchment-average rainfall. The station diagram is explicitly schematic, not a geographical basemap.

The experiment uses exact hourly level timestamps and complete preceding six-hour rainfall intervals, with no interpolation. Predictors are 1/3/6-hour level changes at Diglis and Bewdley and preceding six-hour local rain totals. Fixed ridge regression predicts the change in Diglis level. Training is the earliest 70% of eligible examples; training targets are purged if they reach the test period. Scaling is fitted only on training data. The final 30% is held out. No parameter tuning is performed. A Diglis-only model distinguishes the added feature set from a simple trend model. Results do not isolate the individual causal contribution of rainfall and upstream levels.

Metrics are descriptive, with dependent/overlapping forecast horizons and no confidence interval. Observation timestamps are used without reconstructing publication availability or revision history. A short, potentially low-water sample cannot establish flood-warning skill. Required future checks include multi-event archive validation, reporting delays, catchment rainfall selection and rolling-origin evaluation.

## Milestone 3: interactive explorer
Four custom, dependency-free views inspired by Flourish's exploratory visualization patterns:
- Linked Diglis/Bewdley time replay with a manual slider, optional play/pause and daily filtering. Rainfall is the preceding four 15-minute totals, only when all are present. Playback stops on view changes and when the page is hidden.
- Chronologically ordered UTC day tiles showing complete-day rainfall or observed Diglis maxima. Incomplete rainfall totals remain missing; partial-day maxima are labelled. Tiles open the daily replay; CSV export includes counts.
- Forecast microscope with equal-scaled predicted/observed axes, a signed-error histogram, descriptive 90th percentile absolute error, exact prediction table and CSV export. The histogram is symmetric about zero and includes every held-out prediction.
- Per-day coverage bars and an accessible table for all three series. Expected count is 96 per UTC day; a current partial day is not classified as a confirmed outage.

These additions reuse the saved historical snapshot and experiment outputs; they do not introduce new validation, live forecasting, tracking or third-party embeds. Flourish inspiration: https://flourish.studio/examples/ and https://flourish.studio/visualisations/data-explorer/index.html . Custom implementation, not an official Flourish integration.

Verification: `node research/check-explorer.cjs` exercises view controls and geometry against the real data with a lightweight DOM stub; it does not verify browser layout or rendering.
