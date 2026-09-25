// 隠す切り替えの状態を記録: node state.mjs <out.json> [ラベル]
import { writeFile } from 'node:fs/promises';
import { connect, evalOn } from './common.mjs';
const [outFile, label] = process.argv.slice(2);
const cdp = await connect();
const rec = await evalOn(cdp, `(()=>{const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();return{x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}};
 const btn=[...document.querySelectorAll('#theia-main-content-panel .lm-TabBar-toolbar button')].find(b=>/タイムラインを/.test(b.title));
 const preview=[...document.querySelectorAll('#theia-main-content-panel .lm-Widget[id*="akari-output-preview-"]')].find(e=>e.getBoundingClientRect().width>0);
 return{hiddenFlag:document.documentElement.dataset.akariTimelineHidden,bottomPanel:r(document.getElementById('theia-bottom-content-panel')),mainPanel:r(document.getElementById('theia-main-content-panel')),preview:r(preview),
  button:btn?{title:btn.title,pressed:btn.getAttribute('aria-pressed'),icon:btn.querySelector('.codicon')?.className,rect:r(btn)}:null,
  timelineVisible:[...document.querySelectorAll('.akari-annotations')].some(e=>e.getBoundingClientRect().height>0)}})()`);
rec.label = label ?? null; rec.at = new Date().toISOString();
await writeFile(outFile, JSON.stringify(rec, null, 1) + '\n'); console.log(JSON.stringify(rec)); cdp.close(); process.exit(0);
