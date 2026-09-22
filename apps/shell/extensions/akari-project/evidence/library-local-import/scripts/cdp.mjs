// L1 helper for library-local-import (wrapper-written verification script).
// Usage: CDP_PORT=9447 node cdp.mjs eval '<expr>' | eval -f <file> | shot <png> | click <x> <y> | hover <x> <y>
//        | drop <x> <y> <path...>   (OS file drop via Input.dispatchDragEvent)
import { connectMain, evalMain, realClick, screenshot } from '../../materials-tab-hardening/cdp-lib.mjs';
import { readFileSync } from 'node:fs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9447));
const [cmd, ...args] = process.argv.slice(2);
const out = v => { console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1)); cdp.close(); process.exit(0); };
if (cmd === 'eval') out(await evalMain(cdp, args[0] === '-f' ? readFileSync(args[1], 'utf8') : args[0], 60000));
if (cmd === 'shot') { await screenshot(cdp, args[0]); out({ shot: args[0] }); }
if (cmd === 'click') { await realClick(cdp, Number(args[0]), Number(args[1])); out({ clicked: args }); }
if (cmd === 'hover') { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Number(args[0]), y: Number(args[1]), button: 'none' }); out({ hovered: args }); }
if (cmd === 'rclick') {
  const [x, y] = args.map(Number);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
  out({ rclicked: args });
}
if (cmd === 'drop') {
  const [x, y] = args.slice(0, 2).map(Number);
  const data = { items: [], files: args.slice(2), dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x, y, data });
  out({ dropped: args.slice(2) });
}
out({ error: 'unknown ' + cmd });
