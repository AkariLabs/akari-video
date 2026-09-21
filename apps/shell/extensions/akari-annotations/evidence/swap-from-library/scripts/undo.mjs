// Focus the timeline (real click on an empty ruler spot given by x,y), press Cmd+Z once (real key events) and report edit.json sha256.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain } from './cdp-lib.mjs';
const [fx, fy, outFile] = process.argv.slice(2);
const EDIT = `${process.env.WS || '/tmp/swap-l1/ws'}/edit.json`;
const sha = () => createHash('sha256').update(readFileSync(EDIT)).digest('hex');
const cdp = await connectMain(Number(process.env.CDP_PORT || 9395));
const before = sha();
if (fx !== '-') {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: +fx, y: +fy, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: +fx, y: +fy, button: 'left', clickCount: 1 });
  await sleep(300);
}
const k = { modifiers: 4, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, commands: ['undo'] };
await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
await sleep(2000);
const rec = { at: new Date().toISOString(), focusClick: fx === '-' ? null : { x: +fx, y: +fy }, shaBefore: before, shaAfter: sha() };
writeFileSync(outFile, JSON.stringify(rec, null, 1)); console.log(JSON.stringify(rec)); process.exit(0);
