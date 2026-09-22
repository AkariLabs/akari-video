// 操作部品のフォーカスリングが残っていることを確かめる。settings: 歯車で設定ダイアログを開き Tab 移動 / focus-at: 指定セレクタの要素へ Tab で到達させる
// usage: CDP_PORT=9451 node control-ring.mjs <out.json> settings
//        CDP_PORT=9451 node control-ring.mjs <out.json> tab <回数>   … 現在のフォーカスから Tab を N 回
import { connectMain, evalMain, realClick, screenshot, sleep } from './cdp-lib.mjs';
import { writeFile } from 'node:fs/promises';
const [out, mode, nArg] = process.argv.slice(2);
const cdp = await connectMain(Number(process.env.CDP_PORT || 9451));
const tab = async () => { for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await sleep(250); };
const probe = `(() => { const el = document.activeElement; const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  return { el: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : ''), text: (el.textContent || el.value || el.placeholder || '').trim().slice(0, 30), role: el.getAttribute('role'),
    focusVisible: el.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, boxShadow: cs.boxShadow, rect: [r.left, r.top, r.width, r.height].map(Math.round) }; })()`;
const steps = [];
if (mode === 'settings') {
    const g = await evalMain(cdp, `(() => { const el = [...document.querySelectorAll('#theia-left-content-panel .lm-TabBar-tab .codicon-settings-gear, .theia-app-left .lm-TabBar-tab .codicon-settings-gear')].find(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().left < 10); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await realClick(cdp, g.x, g.y); await sleep(2000);
    steps.push({ step: 'opened', dialog: await evalMain(cdp, `!!document.querySelector('.dialogOverlay, .p-Widget.dialogOverlay, .lm-Widget.dialogOverlay')`), ...(await evalMain(cdp, probe)) });
}
const n = Number(nArg || 4);
for (let i = 0; i < n; i++) { await tab(); steps.push({ step: `tab${i + 1}`, ...(await evalMain(cdp, probe)) }); }
await screenshot(cdp, out.replace(/\.json$/, '.png'));
await writeFile(out, JSON.stringify(steps, null, 1));
for (const s of steps) console.log(s.step, s.el, JSON.stringify(s.text), 'fv=' + s.focusVisible, s.outline);
if (mode === 'settings') { for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); }
cdp.close(); process.exit(0);
