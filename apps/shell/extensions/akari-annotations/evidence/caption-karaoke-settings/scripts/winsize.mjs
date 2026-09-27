// ウィンドウの大きさを変える（Electron は CDP の Browser.setWindowBounds を持たないので window.resizeTo）。
// common.mjs の start から呼ぶ / 単体: node winsize.mjs 1440 900
import { CDP, evalOn, listTargets } from './cdp-lib.mjs';
import { sleep } from './l1-lib.mjs';
export async function setWindow(cdp, width, height) {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await evalOn(cdp, `(()=>{window.moveTo(0,0);window.resizeTo(${width},${height});return true})()`);
    await sleep(1500);
    return evalOn(cdp, '({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})');
}
if (import.meta.url === `file://${process.argv[1]}`) {
    const [width, height] = process.argv.slice(2).map(Number);
    const target = (await listTargets(Number(process.env.CDP_PORT || 9639))).find(t => t.type === 'page');
    const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
    console.log(JSON.stringify(await setWindow(cdp, width, height)));
    cdp.close(); process.exit(0);
}
