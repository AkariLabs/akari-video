// Cmd+Z once (real key events) with timeline focused; report edit.json item count before/after.
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain } from './cdp-lib.mjs';
const [fx, fy, outFile] = process.argv.slice(2);
const EDIT = '/tmp/mdno-l1/ws/edit.json';
const cnt = () => { const j = JSON.parse(readFileSync(EDIT, "utf8")); return { items: j.tracks.flatMap(t => t.items).length, sfx: (j.audio?.sfx || []).length, sources: (j.sources||[]).length, tracks: j.tracks.length, sha: JSON.stringify(j).length }; };
const cdp = await connectMain(Number(process.env.CDP_PORT || 9391));
const before = cnt();
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: +fx, y: +fy, button: 'left', clickCount: 1 });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: +fx, y: +fy, button: 'left', clickCount: 1 });
await sleep(300);
const k = { modifiers: 4, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, commands: ['undo'] };
await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
await sleep(1500);
const after = cnt();
const rec = { focusClick: { x: +fx, y: +fy }, before, after };
writeFileSync(outFile, JSON.stringify(rec, null, 1)); console.log(JSON.stringify(rec)); process.exit(0);
