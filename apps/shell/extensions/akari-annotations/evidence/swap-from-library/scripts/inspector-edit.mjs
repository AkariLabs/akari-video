// Regression: select a clip (real click), open the inspector's first tab, type a new value into the first numeric
// input (real keys + Enter), record edit.json diff, then Cmd+Z once and check byte identity.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, realClick } from './cdp-lib.mjs';
const [itemId, tabLabel, value, out] = process.argv.slice(2);
const EDIT = '/tmp/swap-l1/ws/edit.json';
const sha = () => createHash('sha256').update(readFileSync(EDIT)).digest('hex');
const cdp = await connectMain(Number(process.env.CDP_PORT || 9395));
const ev = e => evalMain(cdp, e, 30000);
const center = sel => ev(`(() => { const e = ${sel}; if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null; })()`);
await realClick(cdp, ...(await center(`document.querySelector('.akari-annotations-widget [data-akari-item-id=${JSON.stringify(itemId)}]')`))); await sleep(1200);
const tab = await center(`[...document.querySelectorAll('#akari-inspector-widget button, #akari-inspector-widget [role=tab]')].find(b => b.textContent.trim() === ${JSON.stringify(tabLabel)} && b.getBoundingClientRect().width > 0)`);
if (tab) { await realClick(cdp, ...tab); await sleep(800); }
const input = await ev(`(() => { const i = [...document.querySelectorAll('#akari-inspector-widget input')].find(i => i.getBoundingClientRect().width > 0 && (i.type === 'number' || /^-?[0-9.]+$/.test(i.value))); if (!i) return null; const r = i.getBoundingClientRect(); const row = i.closest('div')?.parentElement?.textContent.trim().slice(0, 30); return { x: r.left + r.width / 2, y: r.top + r.height / 2, value: i.value, row }; })()`);
const before = sha();
await realClick(cdp, input.x, input.y, { clickCount: 3 }); await sleep(200);
await cdp.send('Input.insertText', { text: value });
await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
let changed = false; for (let k = 0; k < 20 && !changed; k++) { await sleep(300); changed = sha() !== before; }
const doc = JSON.parse(readFileSync(EDIT, 'utf8'));
const item = doc.tracks.flatMap(t => t.items).find(i => i.id === itemId);
const afterEdit = sha();
await realClick(cdp, 700, 479); await sleep(300); // timeline ruler (inside the timeline widget)
const k = { modifiers: 4, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, commands: ['undo'] };
await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
await sleep(2000);
const rec = { at: new Date().toISOString(), itemId, tabLabel, input, typed: value, shaBefore: before, changed, shaAfterEdit: afterEdit, itemAfterEdit: item, shaAfterUndo: sha(), undoByteIdentical: sha() === before };
writeFileSync(out, JSON.stringify(rec, null, 1)); console.log(JSON.stringify({ input: input && { value: input.value, row: input.row }, changed, gain_db: item?.gain_db, undoByteIdentical: rec.undoByteIdentical })); process.exit(0);
