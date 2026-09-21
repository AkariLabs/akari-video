// Regression checks on the Library face: soon rows screenshot (scrolled), row click → category page,
// search result rows, and the "マイ" 3 tiles. usage: CDP_PORT=9412 node regress.mjs <prefix>
import { connectMain, evalMain, realClick } from '../../materials-tab-hardening/cdp-lib.mjs';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9412));
const prefix = process.argv[2];
const shot = async name => {
    const clip = await evalMain(cdp, `(() => { const r = document.getElementById('theia-left-content-panel').getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.right) + 4, height: innerHeight, scale: 1 }; })()`);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip }, 20000);
    writeFileSync(new URL(`../${prefix}-${name}.png`, import.meta.url), Buffer.from(data, 'base64'));
};
const out = {};
// soon rows
await evalMain(cdp, `(() => { const e=document.querySelector('[data-akari-library-home] button[data-akari-library-soon="true"]:not([title])'); e.scrollIntoView({ block: 'center' }); })()`);
await sleep(400); await shot('soon-rows');
// マイ tiles
out.myTiles = await evalMain(cdp, `(() => [...document.querySelectorAll('[data-akari-library-home] [style*="repeat(3"] > button')].map(b => { const r=b.getBoundingClientRect(); return { key: b.getAttribute('data-akari-library-category'), disabled: b.disabled, left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height), text: [...b.children].map(c=>c.textContent) }; }))()`);
// row click → category page (real mouse)
const pos = await evalMain(cdp, `(() => { const b=document.querySelector('[data-akari-library-home] button[data-akari-library-category="sfx"]') || document.querySelector('[data-akari-library-home] button[data-akari-library-category]:not([disabled]):not([title])'); b.scrollIntoView({ block: 'center' }); const r=b.getBoundingClientRect(); return { key: b.getAttribute('data-akari-library-category'), x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
await realClick(cdp, pos.x, pos.y); await sleep(1500);
out.rowClick = { clicked: pos.key, ...(await evalMain(cdp, `(() => ({ homeVisible: !!document.querySelector('[data-akari-library-home]'), back: !!document.querySelector('[data-akari-library-back]'), pageKey: document.querySelector('[data-akari-library-category]:not(button)')?.getAttribute('data-akari-library-category') ?? null, count: document.querySelector('[data-akari-library-category-count]')?.getAttribute('data-akari-library-category-count') ?? null }))()`)) };
await shot('category-page');
await evalMain(cdp, `document.querySelector('[data-akari-library-back]').click()`); await sleep(800);
// search results
const input = await evalMain(cdp, `(() => { const i=document.querySelector('[data-akari-panel-search]'); const e=i.tagName==='INPUT'?i:i.querySelector('input'); const r=e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height/2 }; })()`);
await realClick(cdp, input.x, input.y);
await cdp.send('Input.insertText', { text: process.env.Q || 'ドラム' }); await sleep(1500);
out.search = await evalMain(cdp, `(() => { const home=document.querySelector('[data-akari-library-home]'); const rows=[...home.querySelectorAll('[data-akari-library-search-kind]')].slice(0, 8).map(b => { const [i,l,c]=[...b.children].map(e=>e.getBoundingClientRect()); return { kind: b.getAttribute('data-akari-library-search-kind'), category: b.getAttribute('data-akari-library-category'), label: b.children[1].textContent, order: i.right <= l.left && l.right <= c.left, rowNoOverflow: b.scrollWidth <= b.clientWidth, padding: getComputedStyle(b).padding }; }); return { results: home.getAttribute('data-akari-library-search-results'), homePadding: getComputedStyle(home).padding, rows }; })()`);
await shot('search');
await evalMain(cdp, `(() => { const i=document.querySelector('[data-akari-panel-search]'); const e=i.tagName==='INPUT'?i:i.querySelector('input'); e.select(); })()`);
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
await sleep(800);
writeFileSync(new URL(`../${prefix}-regression.json`, import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out));
cdp.close(); process.exit(0);
