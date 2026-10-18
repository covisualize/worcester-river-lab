"""Guard for the weekly refresh: refuse to commit truncated or broken data.

Exits non-zero if the archive or river network look incomplete, so a partial
API response never replaces a good snapshot. Run: python research/check_reference.py
"""
import json, pathlib, sys, datetime

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'dist/data'
MIN_ROWS = 5000          # every curated gauge has > 6,000 archived days
MAX_LAG_DAYS = 45        # newest archived day should be recent
errors = []

archive = json.load(open(ROOT / 'archive-daily.json'))
today = datetime.date.today()
for ref, st in archive.get('stations', {}).items():
    rows = st.get('rows', [])
    if len(rows) < MIN_ROWS:
        errors.append(f'station {ref}: only {len(rows)} rows')
        continue
    last = datetime.date.fromisoformat(rows[-1][0])
    if (today - last).days > MAX_LAG_DAYS:
        errors.append(f'station {ref}: newest day {last} is over {MAX_LAG_DAYS} days old')
    if any(not isinstance(r[1], (int, float)) for r in rows):
        errors.append(f'station {ref}: non-numeric daily max')
if len(archive.get('stations', {})) < 6:
    errors.append(f"only {len(archive.get('stations', {}))} stations in archive")

rivers = json.load(open(ROOT / 'main-rivers.geojson'))
points = sum(len(l) for f in rivers.get('features', []) for l in f['geometry']['coordinates'])
if points < 3000:
    errors.append(f'river network has only {points} points')

if errors:
    print('Reference data check FAILED:\n  ' + '\n  '.join(errors))
    sys.exit(1)
print(f"Reference data OK: {len(archive['stations'])} stations, {points} river points.")
