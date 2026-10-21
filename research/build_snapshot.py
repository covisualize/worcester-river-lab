"""Build dist/data/fallback-snapshot.json: the outage fallback for all gauges.

The last 25 hours of real EA readings for every curated gauge (plus rain gauge
1773) and the EA station metadata, saved at build time. The dashboard shows it
only when the live EA service cannot be reached, always labelled "saved
snapshot" with its capture time. Unless every gauge returns metadata and
readings, the previous file is kept: one capture time must describe the whole file. Run: python research/build_snapshot.py
"""
import json, pathlib, datetime, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist/data/fallback-snapshot.json'
EA = 'https://environment.data.gov.uk/flood-monitoring'
STATION_IDS = ['2001', '2642', '2085', '2616', '2032', '2029', '2086']
RAIN = '1773-rainfall-tipping_bucket_raingauge-t-15_min-mm'


def get(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


def readings(measure, since):
    d = get(f'{EA}/id/measures/{measure}/readings?_sorted&_limit=10000&since={since}')
    rows = []
    for it in d.get('items', []):
        v = it.get('value')
        if isinstance(v, (int, float)):
            t = datetime.datetime.fromisoformat(it['dateTime'].replace('Z', '+00:00'))
            rows.append([int(t.timestamp() * 1000), v])
    return sorted(rows)


def level_measure(item):
    ms = item.get('measures') or []
    ms = ms if isinstance(ms, list) else [ms]
    ids = [str(m.get('notation') or m.get('@id', '')).split('/')[-1] for m in ms]
    return next((i for i in ids if i.endswith('level-stage-i-15_min-mASD')), None)


now = datetime.datetime.now(datetime.timezone.utc)
since = (now - datetime.timedelta(hours=25)).strftime('%Y-%m-%dT%H:%M:%SZ')
stations, series = {}, {}
for sid in STATION_IDS:
    try:
        item = get(f'{EA}/id/stations/{sid}.json')['items']
        stations[sid] = item
        m = level_measure(item)
        series[sid] = readings(m, since) if m else []
    except Exception as e:  # one gauge failing must not lose the others
        print(f'{sid}: {e}')
try:
    rain = readings(RAIN, since)
except Exception as e:
    print(f'rain: {e}')
    rain = []

missing = [sid for sid in STATION_IDS if sid not in stations or not series.get(sid)]
if missing:
    print(f'No metadata or readings for {", ".join(missing)}; keeping the previous snapshot.')
else:
    OUT.write_text(json.dumps({'retrievedAt': now.isoformat(timespec='seconds'), 'stations': stations, 'series': series, 'rain1773': rain}, separators=(',', ':')))
    print(OUT.name, {k: len(v) for k, v in series.items()}, 'rain', len(rain), OUT.stat().st_size, 'bytes')
