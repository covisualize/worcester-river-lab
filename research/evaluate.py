"""Exploratory chronological holdout; observation-time data, not operational validation."""
import json,datetime,pathlib,math
import numpy as np
R=pathlib.Path(__file__).resolve().parents[1]
d=json.load(open(R/'dist/history.json'))
def stamp(s):return int(datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp())
a={k:{stamp(r['dateTime']):r['value'] for r in v['readings']} for k,v in d['series'].items()}
y,u,r=a['diglis'],a['bewdley'],a['rain']
rows=[]
for t in sorted(y):
 if t%3600:continue
 required=[t,t-3600,t-10800,t-21600]
 if not all(v in y and v in u for v in required):continue
 rain=[r.get(t-i*900) for i in range(24)]
 if any(v is None or v<0 for v in rain):continue
 # Predict change from latest level; only present/past observations as features.
 features=[y[t]-y[t-3600],y[t]-y[t-10800],y[t]-y[t-21600],u[t]-u[t-3600],u[t]-u[t-10800],u[t]-u[t-21600],sum(rain)]
 rows.append((t,features))
results=[]
for h in [1,3,6]:
 valid=[(t,x) for t,x in rows if t+h*3600 in y]
 if len(valid)<100:continue
 split=int(len(valid)*.7);cut=valid[split][0]
 train=[(t,x) for t,x in valid[:split] if t+h*3600<cut];test=valid[split:]
 X=np.array([x for t,x in train]);Y=np.array([y[t+h*3600]-y[t] for t,x in train]);Xt=np.array([x for t,x in test]);truth=np.array([y[t+h*3600] for t,x in test]);base=np.array([y[t] for t,x in test])
 def predict(cols):
  mean=X[:,cols].mean(0);std=X[:,cols].std(0);std[std<1e-9]=1
  A=np.column_stack([np.ones(len(X)),(X[:,cols]-mean)/std]);B=np.column_stack([np.ones(len(Xt)),(Xt[:,cols]-mean)/std]);reg=np.eye(A.shape[1]);reg[0,0]=0
  beta=np.linalg.solve(A.T@A+reg,A.T@Y)
  return base+B@beta
 preds={'Persistence':base,'Diglis trend model':predict([0,1,2]),'Upstream + local rain':predict(list(range(7)))}
 metrics=[{'model':k,'maeCm':float(np.mean(np.abs(v-truth))*100),'rmseCm':float(np.sqrt(np.mean((v-truth)**2))*100)} for k,v in preds.items()]
 results.append({'horizon':h,'trainCount':len(train),'testCount':len(test),'testStart':test[0][0],'testEnd':test[-1][0],'metrics':metrics,'trace':[{'time':t+h*3600,'actual':float(truth[i]),'baseline':float(base[i]),'model':float(preds['Upstream + local rain'][i])} for i,(t,x) in enumerate(test)]})
out={'retrievedAt':d['retrievedAt'],'method':'Fixed ridge regression (alpha=1), 70/30 chronological split; training targets end before test starts; exact hourly timestamps; complete preceding six-hour rainfall intervals; no imputation. Standardisation uses training data only. Features use observation timestamps, not publication availability.','results':results,'alignedHours':len(rows)}
json.dump(out,open(R/'dist/experiment.json','w'),indent=2)
for z in results:print(z['horizon'],z['trainCount'],z['testCount'],z['metrics'])
