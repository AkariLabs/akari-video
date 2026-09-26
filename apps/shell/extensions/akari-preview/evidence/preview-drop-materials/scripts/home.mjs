// ライブラリのホームへ戻る: node home.mjs
import { connect, evalOn, sleep } from './common.mjs';
import { realClick } from './cdp-lib.mjs';
const cdp = await connect();
const back = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^←?\\s*ライブ/.test(e.textContent.trim())&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().top>80);if(!e)return null;const r=e.getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2]})()`);
if (back) { await realClick(cdp, back[0], back[1]); await sleep(1000); }
console.log(JSON.stringify({ back: !!back, tile: await evalOn(cdp, `Boolean(document.querySelector('[data-akari-library-primary-tile=text]'))`) }));
cdp.close(); process.exit(0);
