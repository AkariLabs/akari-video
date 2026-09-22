// L1 helper for library-reference-in-shell (wrapper-written verification script).
// Usage: CDP_PORT=9431 node cdp.mjs eval '<expr>' | shot <png> | click <x> <y> | key <cmd+z>
import { connectMain, evalMain, realClick, screenshot } from '../../materials-tab-hardening/cdp-lib.mjs';
import { readFileSync } from 'node:fs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9431));
const [cmd, ...args] = process.argv.slice(2);
const out = v => { console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1)); cdp.close(); process.exit(0); };
if (cmd === 'eval') out(await evalMain(cdp, args[0] === '-f' ? readFileSync(args[1], 'utf8') : args[0], 60000));
if (cmd === 'shot') { await screenshot(cdp, args[0]); out({ shot: args[0] }); }
if (cmd === 'click') { await realClick(cdp, Number(args[0]), Number(args[1]), args[2] === 'right' ? { button: 'right' } : {}); out({ clicked: args }); }
if (cmd === 'undo') {
  const k = { modifiers: 4, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, commands: ['undo'] };
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  out({ undo: true });
}
if (cmd === 'rclick') {
  const [x, y] = args.map(Number);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
  out({ rclicked: args });
}
out({ error: 'unknown ' + cmd });
