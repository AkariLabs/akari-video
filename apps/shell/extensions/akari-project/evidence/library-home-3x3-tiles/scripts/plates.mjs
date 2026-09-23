// プレビュー（webview 内）の字幕プレートを読む: node plates.mjs <out.json>
import { writeFile } from 'node:fs/promises';
import { view } from './l1-common.mjs';
import { PORT } from './common.mjs';
const v = await view(PORT);
const plates = await v.eval(`[...document.querySelectorAll('.caption-row-plate')].map(p=>{const l=p.querySelector('.akari-caption__line')||p;const cs=getComputedStyle(l);return{id:p.id,text:(l.textContent||'').trim(),classes:[...p.classList,...(p.querySelector('[class*=preset],[data-style-preset]')?[p.querySelector('[class*=preset],[data-style-preset]').className]:[])].join(' ').slice(0,160),stylePreset:p.dataset.stylePreset??p.querySelector('[data-style-preset]')?.dataset.stylePreset??null,color:cs.color,background:cs.backgroundColor,fontWeight:cs.fontWeight}})`);
const rec = { at: new Date().toISOString(), plates };
await writeFile(process.argv[2], JSON.stringify(rec, null, 1) + '\n'); console.log(JSON.stringify(rec)); process.exit(0);
