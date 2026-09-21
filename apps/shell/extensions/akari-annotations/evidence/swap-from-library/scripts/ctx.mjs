// Real right-click at (x, y) on a timeline clip, record menu labels, and (optionally) real-click the item whose label equals argv[4].
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, realClick } from './cdp-lib.mjs';
const [x, y, out, pick] = process.argv.slice(2);
const cdp = await connectMain(Number(process.env.CDP_PORT || 9395));
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: +x, y: +y });
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: +x, y: +y, button: 'right', clickCount: 1 });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: +x, y: +y, button: 'right', clickCount: 1 });
await sleep(600);
const menu = await evalMain(cdp, `[...document.querySelectorAll('[data-akari-context-menu] button, [data-akari-context-menu] [role=menuitem]')].filter(b=>b.getBoundingClientRect().width>0).map(b => { const r=b.getBoundingClientRect(); return { label: b.textContent.trim(), x: r.left + r.width/2, y: r.top + r.height/2 }; })`, 30000);
const rec = { at: new Date().toISOString(), point: [+x, +y], labels: menu.map(m => m.label), hasSwap: menu.some(m => m.label === '入れ替え…') };
if (pick) {
  const m = menu.find(m => m.label === pick); rec.picked = !!m;
  const vh = await evalMain(cdp, 'innerHeight', 30000);
  if (m && m.y < vh - 4) { rec.activation = 'real-click'; await realClick(cdp, m.x, m.y); }
  else if (m) {
    // The timeline context menu is not clamped to the viewport (pre-existing); an item below the window edge
    // cannot receive a real click, so activate it with element.click() and record that.
    rec.activation = `element.click() (item y=${Math.round(m.y)} > viewport ${vh})`;
    await evalMain(cdp, `[...document.querySelectorAll('[data-akari-context-menu] button')].find(b => b.textContent.trim() === ${JSON.stringify(pick)}).click()`, 30000);
  }
  await sleep(3000);
}
else { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300); }
writeFileSync(out, JSON.stringify(rec, null, 1)); console.log(JSON.stringify(rec)); process.exit(0);
