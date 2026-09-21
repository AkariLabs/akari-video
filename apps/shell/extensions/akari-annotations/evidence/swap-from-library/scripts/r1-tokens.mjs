import { readFileSync } from 'node:fs';
const since = Date.parse(process.argv[2] || '1970');
const L = readFileSync('/tmp/swap-l1/electron.log','utf8').split('\n').filter(l=>l.includes('[akari-swap-trial] ')).map(l=>{try{return {wall:Date.parse(l.slice(0,24)),...JSON.parse(l.split('[akari-swap-trial] ')[1])}}catch{return null}}).filter(x=>x&&x.wall>=since);
const by = new Map(); for (const l of L) { if(!by.has(l.token)) by.set(l.token, []); by.get(l.token).push(l); }
for (const [k,v] of by) console.log(k.split(':').pop(), new Date(v[0].wall).toISOString().slice(11,23), v.map(l=>l.event+'@'+l.t+(l.result?'='+l.result:'')+(l.reason?'('+String(l.reason).slice(0,50)+')':'')).join(' '));
