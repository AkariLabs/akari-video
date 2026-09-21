import { connectMain, evalMain } from '../../materials-tab-hardening/cdp-lib.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
const cdp = await connectMain(9377);
const [x, y] = process.argv.slice(2).map(Number);
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
await sleep(800);
console.log(JSON.stringify(await evalMain(cdp, `[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/^\\d+:\\d\\d(\\.\\d+)?\\s*\\/|\\d+:\\d\\d:\\d\\d/.test(e.textContent.trim())&&e.getBoundingClientRect().width>0).map(e=>e.textContent.trim()).slice(0,6)`)));
process.exit(0);
