"""Build dist/data/demo-feb2020.json: the demo replay used by ?demo=feb2020.

Real 15-minute stage readings from the EA Hydrology archive (quality-checked)
for the curated gauges, 10 days up to 16 Feb 2020 18:00 GMT, the rising limb of
the Storm Dennis flood at Worcester. The dashboard shifts these times so the
replay's "now" lines up with the viewer's clock and labels every view as a
demo. Station metadata (typical range, records) is current EA
metadata, bundled so the demo works offline. Flood warnings in the demo are illustrative and labelled as such; they
are not stored here. Run: python research/build_demo.py
"""
import json, pathlib, datetime, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
HYDRO = 'https://environment.data.gov.uk/hydrology'
EA = 'https://environment.data.gov.uk/flood-monitoring'
STATION_IDS = ['2001', '2642', '2085', '2616', '2032', '2029', '2086']
ARCHIVE = {
    '2001': '8820d897-a09e-4857-8095-5834fee6962f',  # Bewdley
    '2642': '9e4a857f-063f-442b-a79d-911e6aca03ec',  # Worcester (Barbourne)
    '2085': '92fe5ece-51b6-4935-b975-1a069a13af65',  # Diglis
    '2616': '06199463-5e08-45c8-aa43-f983ad299dc9',  # Kempsey Yacht Club
    '2029': 'a473e348-c00a-46c6-a93b-921f9747f96f',  # Knightsford Bridge (Teme)
    '2086': '1fce8610-3521-4a3d-93bb-056ea60f97e3',  # Bransford (Teme)
}
NOW = datetime.datetime(2020, 2, 16, 18, 0, tzinfo=datetime.timezone.utc)  # GMT in February
START = NOW - datetime.timedelta(days=10)


def ms(dt):
    return int(dt.timestamp() * 1000)


def readings(guid):
    url = (f'{HYDRO}/id/measures/{guid}-level-i-900-m-qualified/readings'
           f'?mineq-date={START:%Y-%m-%d}&maxeq-date={NOW:%Y-%m-%d}&_limit=5000')
    with urllib.request.urlopen(url, timeout=120) as r:
        items = json.load(r)['items']
    out = []
    for it in items:
        t = datetime.datetime.fromisoformat(it['dateTime'].replace('Z', '')).replace(tzinfo=datetime.timezone.utc)
        if START <= t <= NOW and isinstance(it.get('value'), (int, float)):
            out.append([ms(t), round(it['value'], 3)])
    return sorted(out)


def station(sid):
    # EA station metadata (typical range, highest recent, record) so the replay
    # can classify levels even when the live EA service is down.
    with urllib.request.urlopen(f'{EA}/id/stations/{sid}.json', timeout=60) as r:
        return json.load(r)['items']


series = {sid: readings(guid) for sid, guid in ARCHIVE.items()}
stations = {sid: station(sid) for sid in STATION_IDS}
doc = {
    'id': 'feb2020',
    'label': 'February 2020 flood (Storm Dennis)',
    'source': 'EA Hydrology API, 15-minute stage, quality-checked archive',
    'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
    'start': ms(START),
    'now': ms(NOW),
    'stations': stations,
    'series': series,
}
out = ROOT / 'dist/data/demo-feb2020.json'
out.write_text(json.dumps(doc, separators=(',', ':')))
print(out, {k: (len(v), v[-1] if v else None) for k, v in series.items()}, out.stat().st_size)
