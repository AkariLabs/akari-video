// Finder からのファイルドラッグ（DragData.files のみ）を素材パネルへ落とす回帰確認。取り込みの枠の表示と、落としたあとの assets/ を記録する。
// Usage: node ospanel.mjs <absFile> <out.json> [shot.png]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, screenshot } from './cdp-lib.mjs';
const [file, outFile, shot] = process.argv.slice(2);
const WS = process.env.WS || '/tmp/dfp-l1/ws';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9423));
const ev = e => evalMain(cdp, e, 30000);
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p).map(x => join(n, x)) : [n]; });
const probe = `(() => { const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none';};
  const hits=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/ここに落とすと|取り込みます/.test(e.textContent)&&vis(e)).map(e=>e.textContent.trim()); return { importOverlayShown: hits.length>0, overlayTexts: hits }; })()`;
const before = walk(join(WS, 'assets'));
const pt = await ev(`(() => { const r=document.getElementById('akari-role-buckets-widget').getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height*0.6 }; })()`);
const data = { items: [], files: [file], dragOperationsMask: 1 };
const rec = { file, point: pt };
await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', ...pt, data });
for (let k = 0; k < 3; k++) { await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', ...pt, data }); await sleep(150); }
rec.duringDrag = await ev(probe);
if (shot) await screenshot(cdp, shot);
await cdp.send('Input.dispatchDragEvent', { type: 'drop', ...pt, data });
let added = [];
for (let i = 0; i < 30 && added.length === 0; i++) { await sleep(500); added = walk(join(WS, 'assets')).filter(a => !before.includes(a)); }
rec.assetsAdded = added;
rec.afterDrop = await ev(probe);
rec.toasts = await ev(`[...document.querySelectorAll('.theia-notification-message, .theia-notification-list-item')].map(e=>e.textContent.trim()).filter(Boolean).slice(-4)`);
writeFileSync(outFile, JSON.stringify(rec, null, 1)); console.log(JSON.stringify(rec)); process.exit(0);
