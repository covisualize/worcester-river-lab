const fs=require('fs'),vm=require('vm'),assert=require('assert');
const nodes=new Map(),tabs=['replay','calendar','accuracy','quality'].map(view=>({dataset:{view},setAttribute(){}}));
function node(id){if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',setAttribute(){},click(){}});return nodes.get(id);}
const context={console,Date,Math,Number,Map,Array,Promise,Error,Blob,URL,setTimeout,clearTimeout,setInterval,clearInterval,document:{getElementById:node,querySelectorAll:q=>q==='[data-view]'?tabs:[],addEventListener(){},createElement:()=>({click(){}})},fetch:p=>Promise.resolve({ok:true,json:()=>Promise.resolve(JSON.parse(fs.readFileSync('dist/'+p)))})};
vm.createContext(context);vm.runInContext(fs.readFileSync('dist/explorer.js','utf8'),context);
setTimeout(()=>{
 assert(node('replay-chart').innerHTML.includes('<svg'));
 assert(!node('replay-chart').innerHTML.includes('NaN'));
 node('time-range').oninput({target:{value:'120'}});
 assert(node('replay-time').textContent.includes('UK time'));
 tabs[1].onclick();assert(node('explorer-body').innerHTML.includes('day-cell'));
 node('calendar-metric').onchange({target:{value:'level'}});assert(node('explorer-body').innerHTML.includes('Daily Diglis maximum'));
 tabs[2].onclick();assert(node('explorer-body').innerHTML.includes('Predicted vs observed'));
 for(const h of ['1','3','6']){node('micro-horizon').onchange({target:{value:h}});assert(!node('explorer-body').innerHTML.includes('NaN'));assert(node('explorer-body').innerHTML.includes('exact predictions'));}
 tabs[3].onclick();assert(node('explorer-body').innerHTML.includes('Daily coverage table'));
 tabs[0].onclick();node('replay-day').onchange({target:{value:'2026-10-01'}});assert(node('replay-chart').innerHTML.includes('<svg'));assert(!node('replay-chart').innerHTML.includes('NaN'));
 console.log('PASS: replay scrub, day filter, rainfall/level tiles, 3 forecast horizons, coverage view; actual snapshot values produce finite chart coordinates.');
},30);
