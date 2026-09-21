// Records material-card state (draggable + context menu) for every card in the project panel.
import { connectMain, evalMain, screenshot } from '../../materials-tab-hardening/cdp-lib.mjs';
import { writeFileSync, readdirSync } from 'node:fs';
const [label, outDir] = process.argv.slice(2);
const cdp = await connectMain(9377);
const cards = await evalMain(cdp, `[...document.querySelectorAll('[data-akari-material-path]')].map(e=>({path:e.getAttribute('data-akari-material-path'),assetGroup:e.getAttribute('data-akari-material-asset-group')==='true',unorganized:e.getAttribute('data-akari-material-unorganized')==='true',draggable:e.getAttribute('draggable')==='true',title:e.title}))`);
for (const c of cards) {
  c.contextMenu = await evalMain(cdp, `(async () => { document.querySelectorAll('[data-akari-context-menu]').forEach(p=>p.remove()); const el=document.querySelector('[data-akari-material-path=${JSON.stringify(c.path)}]'); const r=el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+20,button:2})); await new Promise(r=>setTimeout(r,400)); const items=[...document.querySelectorAll('[data-akari-context-menu] button')].map(b=>b.textContent.trim()); document.querySelectorAll('[data-akari-context-menu]').forEach(p=>p.remove()); return items; })()`);
  c.hasAddToTimeline = c.contextMenu.includes('タイムラインに追加');
}
await screenshot(cdp, `${outDir}/${label}-project-panel.png`);
writeFileSync(`${outDir}/${label}-cards.json`, JSON.stringify({ label, at: new Date().toISOString(), cards }, null, 1));
console.log(JSON.stringify(cards.map(c => [c.path, c.assetGroup, c.draggable, c.hasAddToTimeline])));
process.exit(0);
