// 編集データのカードにマウスを載せた状態で背景色を記録する（ホバーで強調色が消えないこと）。usage: node card-hover.mjs <out.json>
import { connectMain, evalMain, sleep } from './cdp-lib.mjs';
import { writeFile } from 'node:fs/promises';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9451));
const expr = `(() => { const e = document.querySelector('[data-akari-output-emphasis="edit"]'); const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2, bg: getComputedStyle(e).backgroundColor, hover: e.matches(':hover') }; })()`;
const before = await evalMain(cdp, expr);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.x, y: before.y, button: 'none' });
await sleep(800);
const during = await evalMain(cdp, expr);
await writeFile(process.argv[2], JSON.stringify({ before, during }, null, 1));
console.log(JSON.stringify({ before, during }));
cdp.close(); process.exit(0);
