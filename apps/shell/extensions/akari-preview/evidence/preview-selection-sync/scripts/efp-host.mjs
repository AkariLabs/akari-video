// ホストページと webview 外側文書で、出力座標に当たる要素を列挙
import { CDP, evalOn, listTargets } from './cdp-lib.mjs';
import { hostCdp, stageHost, toHost, viewCdp, PORT, sleep } from './pss.mjs';
const host = await hostCdp(); const view = await viewCdp();
const geo = await stageHost(host, view);
const target = (await listTargets(PORT)).find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
const outer = new CDP(target.webSocketDebuggerUrl); await outer.connect();
const contexts = []; outer.on('Runtime.executionContextCreated', p => contexts.push(p.context)); await outer.send('Runtime.enable'); await sleep(300);
const desc = `e=>{const cs=getComputedStyle(e);return (e.id?'#'+e.id:e.tagName)+'.'+String(e.className).slice(0,40)+'{pe:'+cs.pointerEvents+',z:'+cs.zIndex+'}'}`;
for (const [x, y] of [[450, 420], [220, 420], [120, 480], [700, 500], [260, 190]]) {
  const p = toHost(geo, x, y);
  const h = await evalOn(host, `(()=>{const d=${desc};return document.elementsFromPoint(${p.x},${p.y}).slice(0,4).map(d)})()`);
  const hf = await evalOn(host, `(()=>{const f=[...document.querySelectorAll('iframe')].find(f=>{const r=f.getBoundingClientRect();return r.width>100&&r.height>100&&/webview/.test(f.src||'')});const r=f.getBoundingClientRect();return{x:r.left,y:r.top}})()`);
  let o = null;
  for (const c of contexts) { try { o = await evalOn(outer, `(()=>{if(document.getElementById('preview-stage'))return null;const d=${desc};return document.elementsFromPoint(${p.x - hf.x},${p.y - hf.y}).slice(0,4).map(d)})()`, c.id); if (o) break; } catch {} }
  console.log(x, y, 'host', JSON.stringify(h), 'outer', JSON.stringify(o));
}
process.exit(0);
