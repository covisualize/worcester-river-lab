// Static configuration. Everything here is either an identifier, an app
// convention (documented as such in the UI) or a fallback label. Readings,
// thresholds and warnings are always fetched from the Environment Agency.

export const EA = 'https://environment.data.gov.uk/flood-monitoring';
export const HYDRO = 'https://environment.data.gov.uk/hydrology';
export const TZ = 'Europe/London';

export const HOME = { lat: 52.186, lng: -2.24, zoom: 11 };
export const PRIMARY = '2085';

// Curated gauges, ordered from upstream to downstream. Labels and coordinates
// are EA station metadata, used only until the live metadata arrives.
// `hydrology` is the EA Hydrology archive GUID (quality-flagged history).
export const STATIONS = [
  { id: '2001', label: 'Bewdley', river: 'River Severn', role: 'Upstream gauge', lat: 52.383563, lng: -2.322438, hydrology: '8820d897-a09e-4857-8095-5834fee6962f' },
  { id: '2642', label: 'Worcester (Barbourne)', river: 'River Severn', role: 'North Worcester, above Diglis weir', lat: 52.206967, lng: -2.235272, hydrology: '9e4a857f-063f-442b-a79d-911e6aca03ec' },
  { id: '2085', label: 'Diglis', river: 'River Severn', role: 'Primary gauge · central Worcester', lat: 52.179799, lng: -2.225461, hydrology: '92fe5ece-51b6-4935-b975-1a069a13af65', primary: true },
  { id: '2616', label: 'Kempsey Yacht Club', river: 'River Severn', role: 'Downstream, below the Teme confluence', lat: 52.158602, lng: -2.219449, hydrology: '06199463-5e08-45c8-aa43-f983ad299dc9' },
  { id: '2032', label: 'Saxons Lode', river: 'River Severn', role: 'Further downstream', lat: 52.049661, lng: -2.200744 },
  { id: '2029', label: 'Knightsford Bridge', river: 'River Teme', role: 'Teme, upstream', lat: 52.198971, lng: -2.389281, hydrology: 'a473e348-c00a-46c6-a93b-921f9747f96f' },
  { id: '2086', label: 'Bransford', river: 'River Teme', role: 'Teme, near the Severn confluence', lat: 52.177055, lng: -2.28833, hydrology: '1fce8610-3521-4a3d-93bb-056ea60f97e3' },
];

// EA tipping-bucket rain gauges around Worcester (point measurements).
export const RAIN_GAUGES = [
  { id: '1773', label: 'Rain gauge 1773 (N Worcester)', lat: 52.222319, lng: -2.17488 },
  { id: '1769', label: 'Rain gauge 1769 (E of Worcester)', lat: 52.199933, lng: -2.097246 },
  { id: '1819', label: 'Rain gauge 1819 (W of Worcester)', lat: 52.178577, lng: -2.411624 },
  { id: '1413', label: 'Rain gauge 1413 (Hartlebury area)', lat: 52.325619, lng: -2.226643 },
];

// App conventions (not EA definitions). Shown in the methodology notes.
export const RULES = {
  freshMinutes: 60,      // newer than this: "Up to date"
  staleMinutes: 120,     // older than this: "Delayed" (matches milestone 1 convention)
  gapMinutes: 30,        // chart lines break across gaps longer than this
  matchToleranceMin: 30, // change calculations need a reading this close to the target time
  steadyCmPerHour: 0.5,  // |rate| below this is described as "steady"
  refreshMs: 5 * 60 * 1000,
  warningRadiusKm: 40,
  floodAreaRadiusKm: 12,
};

export const RANGES = [
  { id: '24h', label: '24 hours', hours: 24 },
  { id: '7d', label: '7 days', hours: 24 * 7 },
  { id: '30d', label: '30 days', hours: 24 * 30 },
];

export const SEVERITY = {
  1: { key: 'severe', label: 'Severe Flood Warning', short: 'Severe warning', advice: 'Danger to life.' },
  2: { key: 'warning', label: 'Flood Warning', short: 'Flood warning', advice: 'Flooding is expected. Immediate action required.' },
  3: { key: 'alert', label: 'Flood Alert', short: 'Flood alert', advice: 'Flooding is possible. Be prepared.' },
  4: { key: 'removed', label: 'Warning no longer in force', short: 'No longer in force', advice: 'Removed in the last 24 hours.' },
};

export const GUIDANCE = [
  { label: 'Check for flooding (live warnings, river levels)', url: 'https://check-for-flooding.service.gov.uk/' },
  { label: 'Sign up for free flood warnings', url: 'https://www.gov.uk/sign-up-for-flood-warnings' },
  { label: 'What to do before, during and after a flood', url: 'https://www.gov.uk/help-during-flood' },
  { label: 'Prepare for flooding', url: 'https://www.gov.uk/prepare-for-flooding' },
  { label: 'Check your long-term flood risk', url: 'https://www.gov.uk/check-long-term-flood-risk' },
];

export const FLOODLINE = '0345 988 1188';
