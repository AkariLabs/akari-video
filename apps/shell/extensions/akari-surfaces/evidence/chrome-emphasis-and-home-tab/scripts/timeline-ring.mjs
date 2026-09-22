// タイムラインのツールボタンをクリックしてから Tab で移動し、タイムライン内の操作部品のフォーカスリングを記録する。
// あわせてタイムラインのコンテナ自身（クリック直後のフォーカス先）に枠が出ないことも記録する。usage: node timeline-ring.mjs <out.json> [tabs=4]
import { connectMain, evalMain, realClick, screenshot, sleep } from './cdp-lib.mjs';
import { writeFile } from 'node:fs/promises';
const [out, nArg] = process.argv.slice(2);
const cdp = await connectMain(Number(process.env.CDP_PORT || 9451));
const probe = `(() => { const el = document.activeElement; const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  return { el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : ''), text: (el.textContent || el.value || '').trim().slice(0, 20), title: el.title || el.getAttribute('aria-label') || '', inTimeline: !!el.closest('#akari-annotations-widget'),
    focusVisible: el.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, rect: [r.left, r.top, r.width, r.height].map(Math.round) }; })()`;
const w = await evalMain(cdp, `(() => { const r = document.getElementById('akari-annotations-widget').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
// ツールの先頭ボタン「選択 (V)」を実クリック（既定のモードなので状態は変わらない）→ 以後 Tab で次の操作部品へ
const first = await evalMain(cdp, `(() => { const b = document.querySelector('#akari-annotations-widget button[title^="選択"]'); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
await realClick(cdp, first[0], first[1]); await sleep(800);
const steps = [{ step: 'click', ...(await evalMain(cdp, probe)) }];
for (let i = 0; i < Number(nArg || 4); i++) {
    for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await sleep(300); steps.push({ step: `tab${i + 1}`, ...(await evalMain(cdp, probe)) });
}
await screenshot(cdp, out.replace(/\.json$/, '.png')).catch(e => console.log('screenshot skipped:', e.message));
await writeFile(out, JSON.stringify({ widgetRect: w, steps }, null, 1));
for (const s of steps) console.log(s.step, s.el, JSON.stringify(s.text || s.title), 'inTimeline=' + s.inTimeline, 'fv=' + s.focusVisible, s.outline);
cdp.close(); process.exit(0);
