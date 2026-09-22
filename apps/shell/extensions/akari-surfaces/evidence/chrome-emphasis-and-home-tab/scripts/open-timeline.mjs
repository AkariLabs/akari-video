// コマンドパレット（F1）から「タイムラインを開く」を実行する。usage: node open-timeline.mjs
import { connectMain, evalMain, realClick, sleep } from './cdp-lib.mjs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9451));
await realClick(cdp, 420, 400); await sleep(500);
for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
await sleep(2500);
await evalMain(cdp, `(() => { const i = document.querySelector('.quick-input-box input'); i.focus(); i.value = '>タイムラインを開く'; i.dispatchEvent(new Event('input', { bubbles: true })); return i.value; })()`);
await sleep(2500);
console.log(await evalMain(cdp, `[...document.querySelectorAll('.quick-input-list .monaco-list-row')].slice(0, 3).map(r => r.textContent.trim().slice(0, 40)).join(' / ')`));
for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await sleep(8000);
console.log(JSON.stringify(await evalMain(cdp, `({ bottom: [...document.querySelectorAll('#theia-bottom-content-panel .lm-TabBar-tab')].map(t => t.textContent.trim()), btns: [...document.querySelectorAll('#theia-bottom-content-panel button')].filter(b => b.getBoundingClientRect().width > 0).length })`)));
cdp.close(); process.exit(0);
