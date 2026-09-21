// Plain mouse drag (press → moves → release), e.g. for splitters.
import { connectMain } from './cdp-lib.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9395));
const [x1, y1, x2, y2] = process.argv.slice(2).map(Number);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 });
for (let k = 1; k <= 10; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * k / 10, y: y1 + (y2 - y1) * k / 10, button: 'left', buttons: 1 }); await sleep(30); }
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 });
await sleep(600); cdp.close(); process.exit(0);
