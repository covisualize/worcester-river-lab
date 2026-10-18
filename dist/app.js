'use strict';
const API='https://environment.data.gov.uk/flood-monitoring';
const MEASURE='2085-level-stage-i-15_min-mASD';
const $=id=>document.getElementById(id);
let observations=[],station=null,hours=24,visible=[];
const fmt=t=>new Date(t).toLocaleString('en-GB',{timeZone:'Europe/London',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
function clean(items){return [...new Map(items.filter(r=>typeof r.value==='number'&&Number.isFinite(r.value)&&Number.isFinite(Date.parse(r.dateTime))&&r.measure?.endsWith('/'+MEASURE)).map(r=>[r.dateTime,r])).values()].sort((a,b)=>Date.parse(a.dateTime)-Date.parse(b.dateTime));}
async function json(url){const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json();}
function render(){if(!observations.length){$('chart').textContent='No usable observations available.';return;}
const latest=observations.at(-1),end=Date.parse(latest.dateTime),target=end-6*3600000;
$('level').textContent=latest.value.toFixed(3)+' m';$('time').textContent='Observed '+fmt(end);
const near=observations.reduce((best,r)=>Math.abs(Date.parse(r.dateTime)-target)<Math.abs(Date.parse(best.dateTime)-target)?r:best,observations[0]);
if(Math.abs(Date.parse(near.dateTime)-target)<=30*60000){const d=latest.value-near.value;$('change').textContent=(d>0?'+':'')+(d*100).toFixed(1)+' cm';$('change-note').textContent=fmt(near.dateTime)+' → '+fmt(end);}else{$('change').textContent='Unavailable';$('change-note').textContent='No reading within 30 minutes of the comparison time';}
const scale=station?.stageScale;$('range').textContent=Number.isFinite(scale?.typicalRangeLow)&&Number.isFinite(scale?.typicalRangeHigh)?scale.typicalRangeLow.toFixed(2)+'–'+scale.typicalRangeHigh.toFixed(2)+' m':'Unavailable';
const start=end-hours*3600000;visible=observations.filter(r=>Date.parse(r.dateTime)>=start);const vals=visible.map(r=>r.value),lo=Math.min(...vals),hi=Math.max(...vals),pad=Math.max(.01,(hi-lo)*.15),min=lo-pad,max=hi+pad;
const x=t=>65+(t-start)/(end-start)*800,y=v=>230-(v-min)/(max-min)*190;
let svg='<svg viewBox="0 0 900 280" role="img" aria-label="River level observations over the selected period. Exact readings are available in the table below.">';
for(let i=0;i<5;i++){const v=min+(max-min)*i/4,yy=y(v);svg+=`<line x1="65" y1="${yy}" x2="865" y2="${yy}" stroke="#e3e9e1"/><text x="52" y="${yy+4}" text-anchor="end" font-size="12" fill="#5b706b">${v.toFixed(3)}</text>`;}
let path='',gaps=0;visible.forEach((r,i)=>{const gap=i&&Date.parse(r.dateTime)-Date.parse(visible[i-1].dateTime)>30*60000;if(gap)gaps++;path+=(i===0||gap?'M':'L')+x(Date.parse(r.dateTime))+','+y(r.value)+' ';});
svg+=`<path d="${path}" fill="none" stroke="#27756a" stroke-width="3"/>`;
for(let i=0;i<3;i++){const t=start+(end-start)*i/2;svg+=`<text x="${x(t)}" y="262" text-anchor="${i===0?'start':i===2?'end':'middle'}" font-size="12" fill="#5b706b">${fmt(t)}</text>`;}svg+='</svg>';$('chart').innerHTML=svg;
$('coverage').textContent=`${visible.length} readings · ${fmt(visible[0].dateTime)} to ${fmt(end)} · ${gaps} gaps longer than 30 minutes. Chart window ends at the latest available reading; the vertical axis is zoomed to show small changes.`;
$('table').replaceChildren(...visible.slice().reverse().map(r=>{const tr=document.createElement('tr');for(const v of [fmt(r.dateTime),r.value.toFixed(3)]){const td=document.createElement('td');td.textContent=v;tr.append(td);}return tr;}));$('download').disabled=false;
}
async function load(){ $('refresh').disabled=true;$('status').textContent='Checking the Environment Agency feed…';let mode='Latest feed retrieved';try{const [s,r]=await Promise.all([json(API+'/id/stations/2085.json'),json(API+'/id/measures/'+MEASURE+'/readings?_sorted&_limit=1000')]);station=s.items;observations=clean(r.items);if(!observations.length)throw Error('Empty feed');}catch(e){try{const s=await json('snapshot.json');station=s.station;observations=clean(s.readings);mode='Saved snapshot — live refresh unavailable. Captured '+fmt(s.retrievedAt);}catch(e2){$('status').textContent='Data unavailable. Please try Refresh data or use the official source links below.';$('refresh').disabled=false;return;}}
render();const age=(Date.now()-Date.parse(observations.at(-1).dateTime))/3600000;const freshness=age>2?`Reading is ${Math.floor(age)} hours old — treat as delayed data.`:age<0?'Source timestamp is in the future — verify with the official source.':'Latest observation: '+fmt(observations.at(-1).dateTime)+'.';$('status').textContent=mode+'. '+freshness;$('refresh').disabled=false;}
$('refresh').onclick=load;document.querySelectorAll('[data-hours]').forEach(b=>b.onclick=()=>{hours=Number(b.dataset.hours);document.querySelectorAll('[data-hours]').forEach(v=>v.setAttribute('aria-pressed',String(v===b)));render();});
$('download').onclick=()=>{const csv='timestamp_utc,level_mASD,station_reference\n'+visible.map(r=>`${r.dateTime},${r.value},2085`).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='diglis-readings-'+hours+'h.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};load();
