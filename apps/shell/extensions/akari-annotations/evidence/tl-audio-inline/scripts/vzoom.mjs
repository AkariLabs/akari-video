#!/usr/bin/env node
// 縦ズームバー（全体の行の高さ倍率）と音声クリップの出し分けの組み合わせ（ラッパー作成の検証スクリプト）。
// 既定 28px の音声行のまま、縦バーの下ハンドルを上へドラッグして倍率を上げる → 行が 64px 以上で音量線と点が出て、線を上へドラッグすると gain_db が変わる（Cmd+Z 1 手で byte 一致）。
// 続けて下ハンドルを下へ戻す → 64px 未満で丸だけになる。
// 使い方: node vzoom.mjs <project> <out.json>
import { writeFileSync } from 'node:fs';
import { realDragMod } from './cdp-lib.mjs';
import { CLIP, HEADERS, READOUT, UNDO, attach, audioItem, editText, evalOn, key, sleep, waitChange } from './l1-common.mjs';

const [project, out] = process.argv.slice(2);
const cdp = await attach();
const ev = expr => evalOn(cdp, expr);
const VBAR = '.akari-timeline-zoom-bar--v';
const handle = edge => ev(`(()=>{const e=document.querySelector(${JSON.stringify(`${VBAR} .akari-timeline-zoom-bar__handle--${edge}`)});if(!e)return null;const r=e.getBoundingClientRect();return{cx:r.left+r.width/2,cy:r.top+r.height/2,w:r.width,h:r.height}})()`);
const summary = async () => {
    const headers = await ev(HEADERS);
    const clips = {};
    for (const id of ['bgm', 'nar-1', 'sfx-1']) {
        const c = await ev(CLIP(id));
        clips[id] = c && { h: c.h, fadeHandles: c.fadeHandles.length, gainLine: c.gainLine.length, kfPoints: c.kfPoints.length };
    }
    return { headers, clips };
};
const rec = { at: new Date().toISOString() };
rec.initial = await summary();

// 倍率を上げる: 下ハンドルを上へ（倍率は exp(2·Δ/viewport) — 上限 3 まで、64px を越えるまで少しずつ）。
let steps = 0;
while (steps < 12) {
    const s = await summary();
    const bgmRow = s.headers.find(h => h.trackId === 'a-bgm');
    if (bgmRow && bgmRow.h >= 64) break;
    const h = await handle('end');
    await realDragMod(cdp, [{ x: h.cx, y: h.cy }, { x: h.cx, y: h.cy - 40 }], { steps: 8 });
    await sleep(700);
    steps += 1;
}
rec.scaledUp = { dragSteps: steps, ...(await summary()) };

// 倍率込みで 64px 以上になった BGM 行で、音量線を上へ 20px ドラッグ → gain_db。
const c = await ev(CLIP('bgm'));
const line = c.gainLine[0];
if (line) {
    const before = editText(project);
    const x0 = c.left + c.w * 0.5;
    const y0 = await ev(`(()=>{const e=document.querySelector('[data-akari-item-kind="audio"][data-akari-item-id="bgm"] [data-akari-audio-gain-line]');if(!e)return null;const b=e.getBoundingClientRect();return b.top+b.height/2})()`);
    const mv = (x, y, b) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: b ? 'left' : 'none', buttons: b });
    await mv(x0, y0, 0); await sleep(80);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 }); await sleep(80);
    for (let s = 1; s <= 10; s++) { await mv(x0, y0 - 20 * s / 10, 1); await sleep(30); }
    await sleep(200);
    const during = await ev(READOUT);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0, y: y0 - 20, button: 'left', buttons: 0, clickCount: 1 });
    const changed = await waitChange(project, before);
    const gain = audioItem(project, 'bgm-1').gain_db;
    let undo = null;
    if (changed) { await ev(`(()=>{document.activeElement?.blur?.();return true})()`); await key(cdp, UNDO); for (let i = 0; i < 40 && editText(project) !== before; i++) await sleep(200); undo = editText(project) === before; }
    rec.gainDrag = { start: { x: x0, y: y0 }, during, changed, gain_db: gain, undoByteEqual: undo };
} else {
    rec.gainDrag = { skipped: 'no gain line' };
}

// 倍率を下げる: 下ハンドルを下へ（64px 未満になるまで）。
steps = 0;
while (steps < 12) {
    const s = await summary();
    const bgmRow = s.headers.find(h => h.trackId === 'a-bgm');
    if (bgmRow && bgmRow.h < 64) break;
    const h = await handle('end');
    await realDragMod(cdp, [{ x: h.cx, y: h.cy }, { x: h.cx, y: h.cy + 40 }], { steps: 8 });
    await sleep(700);
    steps += 1;
}
rec.scaledDown = { dragSteps: steps, ...(await summary()) };
writeFileSync(out, `${JSON.stringify(rec, null, 1)}\n`);
console.log(JSON.stringify(rec));
cdp.close(); process.exit(0);
