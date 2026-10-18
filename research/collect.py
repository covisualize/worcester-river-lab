import json,urllib.request,datetime,concurrent.futures,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE='https://environment.data.gov.uk/flood-monitoring'
MEASURES={'diglis':'2085-level-stage-i-15_min-mASD','bewdley':'2001-level-stage-i-15_min-mASD','rain':'1773-rainfall-tipping_bucket_raingauge-t-15_min-mm'}
def get(pair):
 key,measure=pair
 url=BASE+'/id/measures/'+measure+'/readings?_sorted&_limit=3000'
 with urllib.request.urlopen(url,timeout=60) as r: data=json.load(r)
 rows={r['dateTime']:r for r in data['items'] if isinstance(r.get('value'),(int,float))}
 return key,{'url':url,'measure':measure,'readings':sorted(rows.values(),key=lambda x:x['dateTime'])}
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool: series=dict(pool.map(get,MEASURES.items()))
 out={'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'series':series}
 json.dump(out,open(ROOT/'dist/history.json','w'))
 for k,v in series.items():print(k,len(v['readings']),v['readings'][0]['dateTime'],v['readings'][-1]['dateTime'])
