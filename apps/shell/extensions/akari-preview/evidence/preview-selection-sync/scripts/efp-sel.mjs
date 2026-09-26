// 図形 A を選んだ状態で指定点の elementsFromPoint（内側文書）とホスト側
import { evalOn } from './cdp-lib.mjs';
import { clickOutput, hostCdp, stageHost, sleep, viewCdp } from './pss.mjs';
const [preX = '520', preY = '240', x = '450', y = '420'] = process.argv.slice(2);
const host = await hostCdp(); const view = await viewCdp();
await clickOutput(host, view, Number(preX), Number(preY)); await sleep(1000);
const r = await view.eval(`(()=>{const s=document.getElementById('preview-stage').getBoundingClientRect();const cx=s.left+${x}/1280*s.width, cy=s.top+${y}/720*s.height;return document.elementsFromPoint(cx,cy).slice(0,8).map(e=>{const cs=getComputedStyle(e);const rr=e.getBoundingClientRect();return (e.id?'#'+e.id:e.tagName)+'.'+String(e.className?.baseVal ?? e.className).slice(0,30)+(e.getAttribute('data-overlay-id')?'[ov='+e.getAttribute('data-overlay-id')+']':'')+(e.closest('[data-overlay-id]')?'(in '+e.closest('[data-overlay-id]').getAttribute('data-overlay-id')+')':'')+(e.getAttribute('data-akari-interaction')?'[ix='+e.getAttribute('data-akari-interaction')+']':'')+'{pe:'+cs.pointerEvents+',vis:'+cs.visibility+',op:'+cs.opacity+'} rect:'+[(rr.left-s.left)/s.width*1280,(rr.top-s.top)/s.height*720,(rr.right-s.left)/s.width*1280,(rr.bottom-s.top)/s.height*720].map(Math.round)})})()`);
console.log(r.join('\n'));
const geo = await stageHost(host, view); const px = geo.x + x / 1280 * geo.w, py = geo.y + y / 720 * geo.h;
console.log('host', await evalOn(host, `(()=>{const e=document.elementFromPoint(${px},${py});return e.tagName+'.'+e.className})()`));
process.exit(0);
