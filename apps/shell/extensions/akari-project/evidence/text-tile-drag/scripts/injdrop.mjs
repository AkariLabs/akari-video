// 受け口だけを確かめる: 任意のライブラリ・ペイロードを Input.dispatchDragEvent で直接タイムラインへ落とす（ラッパー作成の検証スクリプト）。
// 使い方: node injdrop.mjs <project> '<payload json>' <dropSpec> <out.json>
import { writeFile } from 'node:fs/promises';
import { CHIPS, PROBE, ROWS, TIME_X, captionRows, connect, evalOn, readCaptionsText, readEditText, sleep } from './common.mjs';
const [project, payload, dropSpec, outFile] = process.argv.slice(2);
const cdp = await connect();
const m = /^t=([\d.]+)@(.+)$/.exec(dropSpec);
const tx = await evalOn(cdp, TIME_X); const rows = await evalOn(cdp, ROWS);
const drop = { x: Math.round(tx.x0 + Number(m[1]) * tx.pps), y: rows.find(r => r.text === m[2]).cy, targetTime: Number(m[1]), row: m[2] };
const rec = { payload: JSON.parse(payload), drop, at: new Date().toISOString() };
const data = { items: [{ mimeType: 'application/x-akari-library-item', data: payload }], dragOperationsMask: 1 };
const capBefore = await readCaptionsText(project), editBefore = await readEditText(project);
for (const type of ['dragEnter', 'dragOver', 'dragOver']) { await cdp.send('Input.dispatchDragEvent', { type, x: drop.x, y: drop.y, data }); await sleep(150); }
rec.duringDrag = await evalOn(cdp, PROBE);
await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: drop.x, y: drop.y, data });
await sleep(3000);
const capAfter = await readCaptionsText(project);
rec.captionsChanged = capAfter !== capBefore; rec.editChanged = (await readEditText(project)) !== editBefore;
const ids = new Set(captionRows(capBefore).map(c => c.id));
rec.newCaptions = captionRows(capAfter).filter(c => !ids.has(c.id));
rec.chips = (await evalOn(cdp, CHIPS)).filter(c => rec.newCaptions.some(n => n.id === c.id));
await writeFile(outFile, JSON.stringify(rec, null, 1) + '\n'); console.log(JSON.stringify(rec).slice(0, 1200)); cdp.close(); process.exit(0);
