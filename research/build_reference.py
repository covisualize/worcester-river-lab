"""Build the static reference datasets used by the dashboard.

1. dist/data/main-rivers.geojson - EA Statutory Main River Map around Worcester,
   simplified for web display (Douglas-Peucker, ~10 m tolerance).
2. dist/data/archive-daily.json - EA Hydrology API daily maximum / minimum stage
   for the curated gauges (quality-flagged archive, compacted to arrays).

Both are snapshots: the dashboard shows their retrieval time and never presents
them as live data. Run: python research/build_reference.py
"""
import json, urllib.request, urllib.parse, datetime, pathlib, math

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist/data'
HYDRO = 'https://environment.data.gov.uk/hydrology'
WFS = 'https://environment.data.gov.uk/spatialdata/statutory-main-river-map/wfs'
LAYER = 'dataset-25dde009-ba7d-40de-8380-c5c3bb32ccdc:Statutory_Main_River_Map'
# EA flood-monitoring station reference -> Hydrology archive station GUID
ARCHIVE = {
    '2085': '92fe5ece-51b6-4935-b975-1a069a13af65',  # Diglis
    '2642': '9e4a857f-063f-442b-a79d-911e6aca03ec',  # Worcester (Barbourne)
    '2001': '8820d897-a09e-4857-8095-5834fee6962f',  # Bewdley
    '2616': '06199463-5e08-45c8-aa43-f983ad299dc9',  # Kempsey Yacht Club
    '2086': '1fce8610-3521-4a3d-93bb-056ea60f97e3',  # Bransford (Teme)
    '2029': 'a473e348-c00a-46c6-a93b-921f9747f96f',  # Knightsford Bridge (Teme)
}
SINCE = '2000-01-01'


def get(url, timeout=180):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.load(r)


def perp(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    # Equirectangular metres around 52N are adequate for simplification.
    kx, ky = 68500, 111200
    dx, dy = (x2 - x1) * kx, (y2 - y1) * ky
    px, py = (x - x1) * kx, (y - y1) * ky
    if dx == dy == 0:
        return math.hypot(px, py)
    t = max(0, min(1, (px * dx + py * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - t * dx, py - t * dy)


def simplify(line, tol=10.0):
    if len(line) < 3:
        return line
    keep, stack = {0, len(line) - 1}, [(0, len(line) - 1)]
    while stack:
        s, e = stack.pop()
        best, idx = 0, None
        for i in range(s + 1, e):
            d = perp(line[i], line[s], line[e])
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol:
            keep.add(idx)
            stack += [(s, idx), (idx, e)]
    return [line[i] for i in sorted(keep)]


def rivers():
    q = urllib.parse.urlencode({
        'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature', 'typeNames': LAYER,
        'outputFormat': 'application/json', 'srsName': 'EPSG:4326',
        'bbox': '362000,232000,402000,282000,EPSG:27700', 'count': 5000})
    data = get(WFS + '?' + q)
    lines = []
    for f in data['features']:
        g = f['geometry']
        parts = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        for part in parts:
            s = [[round(x, 5), round(y, 5)] for x, y in simplify(part)]
            if len(s) > 1:
                lines.append(s)
    return {
        'type': 'FeatureCollection',
        'metadata': {
            'source': 'Environment Agency Statutory Main River Map (WFS)',
            'url': WFS, 'licence': 'Open Government Licence v3.0',
            'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'processing': 'Douglas-Peucker simplification at ~10 m; coordinates rounded to 5 dp.'},
        'features': [{'type': 'Feature', 'properties': {'status': 'Main River'},
                      'geometry': {'type': 'MultiLineString', 'coordinates': lines}}]}


def daily(guid, kind):
    m = f'{guid}-level-{kind}-86400-m-qualified'
    rows = get(f'{HYDRO}/id/measures/{m}/readings?mineq-date={SINCE}&_limit=20000')['items']
    # The archive can return more than one row per date (revisions); keep the
    # most extreme value per date for max, least for min.
    best = {}
    for r in rows:
        v = r.get('value')
        if not isinstance(v, (int, float)):
            continue
        d = r['date']
        if d not in best or (v > best[d][0] if kind == 'max' else v < best[d][0]):
            best[d] = (v, r.get('quality', ''))
    return m, best


def archive():
    stations = {}
    for ref, guid in ARCHIVE.items():
        mx_id, mx = daily(guid, 'max')
        _, mn = daily(guid, 'min')
        dates = sorted(mx)
        stations[ref] = {
            'hydrologyId': guid, 'measure': mx_id,
            # [date, dailyMax, dailyMin|null, quality code of the max: G/U/S/E]
            'rows': [[d, mx[d][0], mn[d][0] if d in mn else None, (mx[d][1] or '?')[0]] for d in dates]}
        print(ref, len(dates), dates[0] if dates else '-', dates[-1] if dates else '-')
    return {
        'source': 'Environment Agency Hydrology API (daily max/min stage, qualified series)',
        'url': HYDRO, 'licence': 'Open Government Licence v3.0',
        'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'qualityCodes': {'G': 'Good', 'U': 'Unchecked', 'S': 'Suspect', 'E': 'Estimated', '?': 'Not stated'},
        'notes': 'Daily values are in metres above each station\'s own stage datum (mASD). '
                 'Dates follow the archive day boundary (GMT). Recent values may be unchecked.',
        'stations': stations}


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    r = rivers()
    json.dump(r, open(OUT / 'main-rivers.geojson', 'w'), separators=(',', ':'))
    print('rivers', sum(len(l) for l in r['features'][0]['geometry']['coordinates']), 'points')
    json.dump(archive(), open(OUT / 'archive-daily.json', 'w'), separators=(',', ':'))
