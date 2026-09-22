// タブ切替直後のフォーカス要素と outline を記録してスクショ + 角の切り抜きを保存する。
// usage: CDP_PORT=9451 node focus-switch.mjs <outPrefix> <click|keyboard>
//   click: note タブ → ホームタブを実クリック / keyboard: Ctrl+Tab（前のタブ）でホームへ戻る
import { connectMain, evalMain, realClick, screenshot, sleep } from './cdp-lib.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const [prefix, mode] = process.argv.slice(2);
const cdp = await connectMain(Number(process.env.CDP_PORT || 9451));
const probe = await readFile(new URL('./focus-probe.js', import.meta.url), 'utf8');
const tabPos = name => evalMain(cdp, `(() => { const t = [...document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tab')].find(t => t.textContent.includes(${JSON.stringify(name)})); t.scrollIntoView(); const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
let p = await tabPos('.md'); // ホーム以外の note タブ
await realClick(cdp, p.x, p.y); await sleep(1500);
const onNote = await evalMain(cdp, probe);
if (mode === 'keyboard') {
    // Theia 既定の「前のタブ」ctrl+shift+tab / 次 ctrl+tab。ホーム ⇄ note-01 の 2 タブ間なのでどちらでもホームへ
    for (const type of ['rawKeyDown', 'keyUp']) {
        await cdp.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 2 });
    }
    await sleep(300);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 });
} else {
    p = await tabPos('ホーム');
    await realClick(cdp, p.x, p.y);
}
await sleep(1500);
// マウスを中央のパネル外（ステータスバー付近）に逃がしてホバー札を消す
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
await sleep(1500);
const onHome = await evalMain(cdp, probe);
const current = await evalMain(cdp, `document.querySelector('#theia-main-content-panel .lm-TabBar-tab.lm-mod-current')?.textContent.trim()`);
const panel = await evalMain(cdp, `(() => { const r = document.getElementById('theia-main-content-panel').getBoundingClientRect(); return [r.left, r.top, r.width, r.height, devicePixelRatio]; })()`);
await screenshot(cdp, `${prefix}.png`);
const [x, y, w, h, dpr] = panel;
const c = 28; // CSS px の切り抜き（角）
const crop = (name, cx, cy) => { execFileSync('sips', ['-c', String(c * dpr), String(c * dpr), '--cropOffset', String(Math.round(cy * dpr)), String(Math.round(cx * dpr)), `${prefix}.png`, '--out', `${prefix}-${name}.png`], { stdio: 'ignore' }); execFileSync('sips', ['-Z', String(c * dpr * 4), `${prefix}-${name}.png`], { stdio: 'ignore' }); };
crop('corner-bl', x - 2, y + h - c + 2); crop('corner-br', x + w - c + 2, y + h - c + 2);
await writeFile(`${prefix}.json`, JSON.stringify({ mode, current, panelRect: panel, onNote, onHome }, null, 1));
console.log(JSON.stringify({ current, active: onHome.active, fv: onHome.matchesFocusVisible, outline: onHome.outline }));
cdp.close(); process.exit(0);
