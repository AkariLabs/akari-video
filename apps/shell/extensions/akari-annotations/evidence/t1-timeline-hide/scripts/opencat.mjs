// ライブラリのホームへ戻ってカテゴリ（data-akari-library-category=<key>）を開く: node opencat.mjs <key>
import { connect, evalOn, sleep } from './common.mjs';
import { realClick } from './cdp-lib.mjs';
const cdp = await connect();
const back = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^←?\\s*ライブラリ$/.test(e.textContent.trim())&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().top>80);if(!e)return null;const r=e.getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2]})()`);
if (back) { await realClick(cdp, back[0], back[1]); await sleep(800); }
const pos = await evalOn(cdp, `(()=>{const b=document.querySelector('[data-akari-library-category=${process.argv[2]}]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2]})()`);
await realClick(cdp, pos[0], pos[1]); await sleep(2500);
console.log(JSON.stringify(await evalOn(cdp, `({cards:[...document.querySelectorAll('[data-akari-catalog-item]')].slice(0,6).map(e=>({key:e.getAttribute('data-akari-catalog-item'),draggable:e.getAttribute('draggable'),state:e.getAttribute('data-akari-catalog-item-state')})),count:document.querySelectorAll('[data-akari-catalog-item]').length})`)));
cdp.close(); process.exit(0);
