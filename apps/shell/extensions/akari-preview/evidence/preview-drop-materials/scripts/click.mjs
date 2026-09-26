// 実マウスクリック: node click.mjs <x> <y>  または  node click.mjs --text '<葉要素の文言>'
import { CDP, evalOn, listTargets, realClick, sleep } from './cdp-lib.mjs';
const port = Number(process.env.CDP_PORT || 9621);
const target = (await listTargets(port)).find(t => t.type === 'page');
const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
let [x, y] = process.argv.slice(2);
if (x === '--text') {
  const p = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()===${JSON.stringify(y)}&&e.getBoundingClientRect().width>0);if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2]})()`);
  if (!p) { console.log('not found'); process.exit(1); }
  [x, y] = p;
}
await realClick(cdp, +x, +y); await sleep(800); console.log(JSON.stringify({ x: +x, y: +y }));
cdp.close(); process.exit(0);
