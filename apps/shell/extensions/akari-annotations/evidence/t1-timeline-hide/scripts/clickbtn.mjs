// タブバーの「タイムラインを隠す / 出す」ボタンを実マウスで押す: node clickbtn.mjs
import { connect, evalOn, sleep } from './common.mjs';
import { realClick } from './cdp-lib.mjs';
const cdp = await connect();
const p = await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('#theia-main-content-panel .lm-TabBar-toolbar button')].find(b=>/タイムラインを/.test(b.title)&&b.getBoundingClientRect().width>0);if(!b)return null;const r=b.getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2,b.title]})()`);
if (!p) { console.log(JSON.stringify({ clicked: false })); process.exit(1); }
await realClick(cdp, p[0], p[1]); await sleep(1500);
console.log(JSON.stringify({ clicked: true, at: [p[0], p[1]], title: p[2] })); cdp.close(); process.exit(0);
