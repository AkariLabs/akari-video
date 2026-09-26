// タイムラインのストリップの上で実ホイール（縦）。帯 <id> がスクロール容器の中に収まるまで 40px ずつ回す: node wheel.mjs <itemId>
import { S, connect, evalOn, sleep } from './common.mjs';
const cdp = await connect(); const id = process.argv[2];
const Q = `(()=>{const w=document.getElementById('akari-annotations-widget');const sc=w.querySelector('.akari-timeline-scroll').getBoundingClientRect();const ce=[...w.querySelectorAll('[data-akari-item-id=${S(id)}]')].find(e=>/strip-overlay/.test(e.className));const c=ce.getBoundingClientRect();return{x:sc.left+sc.width/2,y:sc.top+sc.height/2,top:sc.top,bottom:sc.bottom-14,ct:c.top,cb:c.bottom}})()`;
let q;
for (let i = 0; i < 20; i++) {
  q = await evalOn(cdp, Q);
  if (q.ct >= q.top && q.cb <= q.bottom) break;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: q.x, y: q.y, deltaX: 0, deltaY: q.ct < q.top ? -40 : 40 });
  await sleep(300);
}
console.log(JSON.stringify(q)); cdp.close(); process.exit(0);
