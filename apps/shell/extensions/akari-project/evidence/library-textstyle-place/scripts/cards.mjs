// テキストスタイルのカードの状態（draggable・＋・hint）を記録: node cards.mjs <out.json>
import { writeFile } from 'node:fs/promises';
import { CARDS, connect, evalOn } from './common.mjs';
const cdp = await connect();
const rec = { at: new Date().toISOString(), ...(await evalOn(cdp, CARDS)) };
rec.homeHint = await evalOn(cdp, `document.querySelector('[data-akari-library-category=textstyle]')?.textContent??null`);
await writeFile(process.argv[2], JSON.stringify(rec, null, 1) + '\n'); console.log(JSON.stringify(rec)); cdp.close(); process.exit(0);
