# Worcester River Lab

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
