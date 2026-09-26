// ライブラリのホーム → 詳細 → 「スタイル・動き・フォント」（テキストスタイルのカード）を開く: node openlook.mjs
import { connect, evalOn, sleep } from './common.mjs';
const cdp = await connect();
await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^←?\\s*ライブラリ$/.test(e.textContent.trim())&&e.getBoundingClientRect().top>80);b?.click();return true})()`); await sleep(800);
await evalOn(cdp, `(()=>{const t=document.querySelector('[data-akari-library-details-toggle]');if(t&&/▸/.test(t.textContent))t.click();return true})()`); await sleep(800);
await evalOn(cdp, `(()=>{document.querySelector('[data-akari-library-text-look-row]')?.click();return true})()`); await sleep(1500);
console.log(await evalOn(cdp, `document.querySelectorAll('[data-akari-catalog-preset-item^="textstyle/"]').length`));
cdp.close(); process.exit(0);
