// Real mouse click at CSS pixel (x, y).
import { connectMain, realClick } from './cdp-lib.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9395));
const [x, y, n] = process.argv.slice(2).map(Number);
await realClick(cdp, x, y, { clickCount: n || 1 });
await sleep(800); cdp.close(); process.exit(0);
