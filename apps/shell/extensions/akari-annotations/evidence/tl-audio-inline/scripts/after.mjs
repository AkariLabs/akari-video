#!/usr/bin/env node
// 音声クリップの直接編集の AFTER 一式（ラッパー作成の検証スクリプト）。起動済みの実機（launch.mjs）に対して順に操作し、
// 各操作の前後で edit.json（sha256・対象アイテム）・表示（readout・曲線・メニュー）を採り、Cmd+Z 1 手で byte 一致に戻るかを見る。
// 前提: a-bgm / a-nar の行は 72px（resize.mjs）、a-sfx は既定 28px。
// 使い方: node after.mjs <project> <outDir> [--only=T1,T3]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { realClick, screenshot } from './cdp-lib.mjs';
import { CLIP, DIALOG, MENU, READOUT, UNDO, DELETE, attach, audioItem, editSha, editText, evalOn, key, sleep, waitChange, S } from './l1-common.mjs';

const [project, outDir] = process.argv.slice(2);
const only = process.argv.find(v => v.startsWith('--only='))?.slice(7).split(',');
const cdp = await attach();
const ev = expr => evalOn(cdp, expr);
const FPS = 30;
const results = {};
const NOTICE = `[...document.querySelectorAll('.theia-notification-list-item, .akari-annotations-widget [role=status]')].map(e=>e.textContent.trim()).filter(Boolean).slice(-3)`;
const FOOTER = `(()=>{const w=document.querySelector('.akari-annotations-widget');const d=[...w.children].filter(c=>c.tagName==='DIV').pop();return d?d.textContent.trim():null})()`;

async function move(x, y, buttons = 0, modifiers = 0) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: buttons ? 'left' : 'none', buttons, modifiers });
}
// 実マウスで (x0,y0) → (x1,y1)。離す直前に readout を採る。
async function drag(x0, y0, x1, y1, { modifiers = 0, steps = 14 } = {}) {
    await move(x0, y0, 0, modifiers); await sleep(80);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1, modifiers }); await sleep(60);
    for (let s = 1; s <= steps; s++) { await move(x0 + (x1 - x0) * s / steps, y0 + (y1 - y0) * s / steps, 1, modifiers); await sleep(28); }
    await sleep(250);
    const during = await ev(READOUT);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1, modifiers });
    return during;
}
async function undoOnce(before) {
    await ev(`(()=>{document.activeElement?.blur?.();return true})()`);
    await key(cdp, UNDO);
    for (let i = 0; i < 40 && editText(project) !== before; i++) await sleep(200);
    await sleep(800);
    return editText(project) === before;
}
const clip = id => ev(CLIP(id));
// 音量線の上の点（クリップ左端からの比率 fx）: 線の path を標本化して y を求める。
const linePoint = (id, fx) => ev(`(()=>{const e=document.querySelector('[data-akari-item-kind="audio"][data-akari-item-id=${S(id)}]');const p=e&&e.querySelector('[data-akari-audio-gain-line]');if(!p)return null;const svg=p.ownerSVGElement;const r=svg.getBoundingClientRect();const vb=svg.viewBox.baseVal;const tx=${fx}*vb.width;const L=p.getTotalLength();let best=null;for(let i=0;i<=600;i++){const q=p.getPointAtLength(L*i/600);if(!best||Math.abs(q.x-tx)<Math.abs(best.x-tx))best=q}return{x:r.left+best.x*r.width/vb.width,y:r.top+best.y*r.height/vb.height}})()`);
const pick = (item, keys) => item ? Object.fromEntries(keys.map(k => [k, item[k]])) : null;
const KEYS = ['gain_db', 'fade_in', 'fade_out', 'fade_in_shape', 'fade_out_shape', 'keyframes'];

async function run(name, fn) {
    if (only && !only.includes(name)) return;
    try { results[name] = await fn(); } catch (error) { results[name] = { error: String(error?.stack || error) }; }
    console.log(name, JSON.stringify(results[name]).slice(0, 900));
    await ev(`(()=>{document.querySelector('[data-akari-audio-fade-menu]')?.remove();return true})()`).catch(() => {});
}

// T1: 72px の BGM で左上の丸を右へ 80px ドラッグ → fade_in・曲線・Cmd+Z
await run('T1', async () => {
    const before = editText(project), c = await clip('bgm');
    const h = c.fadeHandles.find(x => x.attrs.akariAudioFadeHandle === 'in');
    const during = await drag(h.cx, h.cy, h.cx + 80, h.cy + 2);
    const changed = await waitChange(project, before);
    const item = audioItem(project, 'bgm-1');
    const after = await clip('bgm');
    await screenshot(cdp, path.join(outDir, 't1-fade-in.png'));
    const readoutSec = during ? Number((during.text.match(/([0-9.]+)\s*秒/) || [])[1]) : null;
    const undo = changed ? await undoOnce(before) : null;
    return { rowH: c.h, clipW: c.w, handle: h, during, changed, item: pick(item, KEYS), readoutSec,
        readoutMatchesWithin1Frame: readoutSec !== null && Math.abs(readoutSec - item.fade_in) <= 1 / FPS + 1e-9,
        curves: after.fadeCurves, undoByteEqual: undo };
});

// T2: 丸をクリック → 4 種のメニュー → 等パワー
await run('T2', async () => {
    // 先にフェードを付けておく（形が見えるように）。この変更は最後に Cmd+Z で戻す。
    const base = editText(project);
    let c = await clip('bgm');
    let h = c.fadeHandles.find(x => x.attrs.akariAudioFadeHandle === 'in');
    await drag(h.cx, h.cy, h.cx + 100, h.cy);
    await waitChange(project, base);
    const before = editText(project);
    c = await clip('bgm');
    h = c.fadeHandles.find(x => x.attrs.akariAudioFadeHandle === 'in');
    const curveBefore = c.fadeCurves.find(x => x.attrs.akariAudioFadeCurve === 'in');
    await realClick(cdp, h.cx, h.cy);
    await sleep(500);
    const menu = await ev(MENU);
    await screenshot(cdp, path.join(outDir, 't2-menu.png'));
    const target = menu.find(m => m.shape === 'equal_power');
    if (target) await realClick(cdp, target.cx, target.cy);
    const changed = await waitChange(project, before, 5000);
    const item = audioItem(project, 'bgm-1');
    const after = await clip('bgm');
    const notices = await ev(NOTICE), footer = await ev(FOOTER);
    await screenshot(cdp, path.join(outDir, 't2-after-shape.png'));
    const undoShape = changed ? await undoOnce(before) : null;
    const undoFade = await undoOnce(base);
    return { menu, changed, item: pick(item, KEYS), curveBefore: curveBefore?.attrs, curveAfter: after.fadeCurves.find(x => x.attrs.akariAudioFadeCurve === 'in')?.attrs,
        notices, footer, undoShapeByteEqual: undoShape, undoFadeByteEqual: undoFade };
});

// T3: 線を上へ 20px ドラッグ → gain_db
await run('T3', async () => {
    const before = editText(project), c = await clip('bgm');
    const p = await linePoint('bgm', 0.5);
    const during = await drag(p.x, p.y, p.x + 1, p.y - 20);
    const changed = await waitChange(project, before);
    const item = audioItem(project, 'bgm-1');
    await screenshot(cdp, path.join(outDir, 't3-gain.png'));
    const readoutDb = during ? Number((during.text.match(/([+-]?[0-9.]+)\s*dB/) || [])[1]) : null;
    const undo = changed ? await undoOnce(before) : null;
    return { rowH: c.h, line: c.gainLine.length, start: p, during, changed, item: pick(item, KEYS), readoutDb,
        readoutMatches: readoutDb !== null && Math.abs(readoutDb - (item.gain_db ?? 0)) < 0.05, undoByteEqual: undo };
});

// T3f: ⌘ を押したまま同じ 20px → 1/10 の細かさ
await run('T3f', async () => {
    const before = editText(project);
    const p = await linePoint('bgm', 0.5);
    const during = await drag(p.x, p.y, p.x + 1, p.y - 20, { modifiers: 4 });
    const changed = await waitChange(project, before);
    const item = audioItem(project, 'bgm-1');
    const undo = changed ? await undoOnce(before) : null;
    return { during, changed, gain_db: item.gain_db, undoByteEqual: undo };
});

// T4: ⌥クリック（BGM: 点 0 → 追加 / ナレーション: 点 2 → 1 点追加）
await run('T4', async () => {
    const out = {};
    for (const [id, itemId, fx] of [['bgm', 'bgm-1', 0.5], ['nar-1', 'nar-1', 0.75]]) {
        const before = editText(project);
        const kfBefore = audioItem(project, itemId).keyframes ?? [];
        const p = await linePoint(id, fx);
        await realClick(cdp, p.x, p.y, { modifiers: 1 });
        const changed = await waitChange(project, before);
        const item = audioItem(project, itemId);
        const c = await clip(id);
        out[id] = { start: p, kfBefore, changed, keyframes: item.keyframes ?? null, kfPoints: c.kfPoints.length,
            allIntegerFrames: (item.keyframes ?? []).every(k => Number.isInteger(k.t)) };
        if (id === 'nar-1') await screenshot(cdp, path.join(outDir, 't4-alt-click-nar.png'));
        out[id].undoByteEqual = changed ? await undoOnce(before) : null;
    }
    return out;
});

// T5: ナレーションの点（index 1）をドラッグ → その点だけ変わる
await run('T5', async () => {
    const before = editText(project), kfBefore = audioItem(project, 'nar-1').keyframes;
    const c = await clip('nar-1');
    const pt = c.kfPoints.find(x => x.attrs.akariAudioKfIndex === '1');
    const during = await drag(pt.cx, pt.cy, pt.cx - 30, pt.cy - 10);
    const changed = await waitChange(project, before);
    const kfAfter = audioItem(project, 'nar-1').keyframes;
    const undo = changed ? await undoOnce(before) : null;
    return { pt, during, changed, kfBefore, kfAfter, othersUnchanged: JSON.stringify(kfAfter.filter((_, i) => i !== 1)) === JSON.stringify(kfBefore.filter((_, i) => i !== 1)),
        tInteger: Number.isInteger(kfAfter[1].t), undoByteEqual: undo };
});

// T6: 点を選んで Delete（ナレーションに 1 点足して 3 点にしてから、足した点を消す）
await run('T6', async () => {
    const base = editText(project);
    const p = await linePoint('nar-1', 0.75);
    await realClick(cdp, p.x, p.y, { modifiers: 1 });
    await waitChange(project, base);
    const before = editText(project), kfBefore = audioItem(project, 'nar-1').keyframes;
    const c = await clip('nar-1');
    const added = c.kfPoints.at(-1);
    await realClick(cdp, added.cx, added.cy);
    await sleep(400);
    const selection = await ev(`(()=>{const a=document.activeElement;return{active:a?.dataset?.akariAudioKfIndex??a?.className??null}})()`);
    await key(cdp, DELETE);
    const changed = await waitChange(project, before);
    const kfAfter = audioItem(project, 'nar-1').keyframes;
    const undo = changed ? await undoOnce(before) : null;
    const undoAdd = await undoOnce(base);
    return { kfBefore, selection, changed, kfAfter, undoByteEqual: undo, undoAddByteEqual: undoAdd };
});

// T7: 28px（効果音）— 丸はある・線と点は無い・⌥クリックで何も起きない・フェードは変えられる
await run('T7', async () => {
    const c = await clip('sfx-1');
    const sha0 = editSha(project), before = editText(project);
    await realClick(cdp, c.left + c.w / 2, c.top + c.h / 2, { modifiers: 1 });
    await sleep(1500);
    const altByteEqual = editSha(project) === sha0;
    const h = c.fadeHandles.find(x => x.attrs.akariAudioFadeHandle === 'out');
    let fade = null;
    if (h) {
        const during = await drag(h.cx, h.cy, h.cx - 25, h.cy);
        const changed = await waitChange(project, before);
        fade = { during, changed, item: pick(audioItem(project, 'sfx-1'), KEYS) };
        fade.undoByteEqual = changed ? await undoOnce(before) : null;
    }
    await screenshot(cdp, path.join(outDir, 't7-28px.png'));
    return { rowH: c.h, fadeHandles: c.fadeHandles.length, gainLine: c.gainLine.length, kfPoints: c.kfPoints.length, altClickByteEqual: altByteEqual, fade };
});

// T8: クリップ本体のダブルクリック → 専用画面（形のセレクト 2 つ）。形を変えて適用 → edit.json
await run('T8', async () => {
    const before = editText(project), c = await clip('bgm');
    await realClick(cdp, c.left + c.w * 0.6, c.top + c.h * 0.8, { clickCount: 2 });
    await sleep(1500);
    const dialog = await ev(DIALOG);
    await screenshot(cdp, path.join(outDir, 't8-dialog.png'));
    let applied = null;
    if (dialog) {
        const set = await ev(`(()=>{const d=document.querySelector('.dialogOverlay');const s=[...d.querySelectorAll('select')].filter(s=>[...s.options].some(o=>o.value==='equal_power'));if(!s.length)return 0;s[0].value='slow';s[0].dispatchEvent(new Event('change',{bubbles:true}));if(s[1]){s[1].value='equal_power';s[1].dispatchEvent(new Event('change',{bubbles:true}))}return s.length})()`);
        await sleep(300);
        await ev(`(()=>{const b=[...document.querySelectorAll('.dialogOverlay button')].find(b=>b.textContent.trim()==='適用');b?.click();return Boolean(b)})()`);
        const changed = await waitChange(project, before, 5000);
        applied = { shapeSelects: set, changed, item: pick(audioItem(project, 'bgm-1'), KEYS), notices: await ev(NOTICE), footer: await ev(FOOTER) };
        applied.undoByteEqual = changed ? await undoOnce(before) : null;
        if (await ev(DIALOG)) { await key(cdp, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(500); }
    }
    return { opened: Boolean(dialog), dialog, applied };
});

writeFileSync(path.join(outDir, 'after-results.json'), `${JSON.stringify(results, null, 1)}\n`);
cdp.close(); process.exit(0);
