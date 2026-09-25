// セレクタの要素を実マウスでクリック: node clicksel.mjs '<selector>' [待ちミリ秒]
import { connect, evalOn, sleep, S } from './common.mjs';
import { realClick } from './cdp-lib.mjs';
const [sel, wait] = process.argv.slice(2);
const cdp = await connect();
const pos = await evalOn(cdp, `(()=>{const b=document.querySelector(${S(sel)});if(!b)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2]})()`);
if (!pos) { console.log('not found'); process.exit(1); }
await realClick(cdp, pos[0], pos[1]); await sleep(Number(wait ?? 1200));
console.log('clicked'); cdp.close(); process.exit(0);
