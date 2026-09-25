// セレクタの要素を実マウスで右クリックし、出たメニューの項目を返す: node rclick.mjs '<selector>'
import { connect, evalOn, sleep, S } from './common.mjs';
const cdp = await connect();
const p = await evalOn(cdp, `(()=>{const b=document.querySelector(${S(process.argv[2])});if(!b)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return[r.left+r.width/2,r.top+Math.min(30,r.height/2)]})()`);
if (!p) { console.log('not found'); process.exit(1); }
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1] });
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p[0], y: p[1], button: 'right', clickCount: 1 });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p[0], y: p[1], button: 'right', clickCount: 1 });
await sleep(800);
console.log(JSON.stringify(await evalOn(cdp, `[...document.querySelectorAll('[role=menuitem], .akari-context-menu *, [data-akari-context-menu] *')].filter(e=>e.children.length===0&&e.getBoundingClientRect().width>0).map(e=>e.textContent.trim()).filter(Boolean)`)));
cdp.close(); process.exit(0);
