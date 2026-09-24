// ウィンドウの大きさを変える（Browser.setWindowBounds）: node winsize.mjs 1440 900
import { connect, evalOn, sleep } from './common.mjs';
const [width, height] = process.argv.slice(2).map(Number);
const cdp = await connect();
await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
const { windowId } = await cdp.send('Browser.getWindowForTarget');
await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }).catch(() => {});
await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width, height } });
await sleep(1200);
console.log(JSON.stringify(await evalOn(cdp, '({w:innerWidth,h:innerHeight})')));
cdp.close(); process.exit(0);
