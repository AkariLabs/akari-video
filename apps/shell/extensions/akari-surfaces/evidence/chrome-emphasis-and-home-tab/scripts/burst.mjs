// マウスをホームタブに載せたまま、タブ帯まわりのスクショを連写する。usage: node burst.mjs <prefix> <n> [scrollLeft]
import { connectMain, evalMain, sleep } from './cdp-lib.mjs';
import { writeFile } from 'node:fs/promises';
const [prefix, n, sl] = process.argv.slice(2);
const cdp = await connectMain(Number(process.env.CDP_PORT || 9451));
const pos = await evalMain(cdp, `(() => { const sc = document.querySelector('#theia-main-content-panel .lm-TabBar-content').parentElement; ${sl !== undefined ? `sc.scrollLeft = ${sl};` : ''} const t = sc.querySelector('.lm-TabBar-tab').getBoundingClientRect(); const s = sc.getBoundingClientRect(); const bar = document.querySelector('#theia-main-content-panel .lm-TabBar').getBoundingClientRect(); return { x: (Math.max(t.left, s.left) + Math.min(t.right, s.right)) / 2, y: t.top + t.height / 2, bar: [bar.left, bar.top, bar.width, bar.height] }; })()`);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y, button: 'none' });
for (let i = 0; i < Number(n); i++) {
    const [x, y, w, h] = pos.bar;
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h + 30, scale: 2 } }, 240000);
    await writeFile(`${prefix}-${String(i).padStart(2, '0')}.png`, Buffer.from(data, 'base64'));
    await sleep(120);
}
console.log(JSON.stringify(pos));
cdp.close(); process.exit(0);
