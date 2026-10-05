#!/usr/bin/env node
// 横 / 縦ズームバー・100% より引く・終わりより先への配置・端ドラッグの自動送り・最下段バーへの報告を実機で採る（ラッパー作成の検証スクリプト）。
// 使い方: node interact.mjs <apps/shell> <project> <isoDir> <recDir> [--port=9462] [--only=a,b,...]
// 記録物（JSON・PNG）は recDir（リポの外）へ書く。起動した Electron はこのスクリプトが自分の PID だけ止める。
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { keyPress, realClick, screenshot } from './cdp-lib.mjs';
import { CHROME, PORT_DEFAULT, S, evalOn, sleep, start, stop, tidy, waitEval } from './l1-common.mjs';

const [shellDir, project, isoDir, recDir] = process.argv.slice(2);
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? PORT_DEFAULT);
const ONLY = process.argv.find(v => v.startsWith('--only='))?.slice(7).split(',');
const want = name => !ONLY || ONLY.includes(name);
const EDIT = path.join(project, 'edit.json');
const sha = () => createHash('sha256').update(readFileSync(EDIT)).digest('hex');
const editJson = () => JSON.parse(readFileSync(EDIT, 'utf8'));
const itemOf = id => editJson().tracks.flatMap(t => t.items.map(i => ({ track: t.id, ...i }))).find(i => i.id === id);
const r3 = v => Math.round(v * 1000) / 1000;

const WGT = `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');return window.theia.container.get(k).getWidgets('bottom').find(w=>w.id==='akari-annotations-widget')})()`;
const STATE = `(()=>{const W=${WGT};return{start:W.viewStart,dur:W.visibleDuration(),contentEnd:W.contentEndDuration(),label:W.zoomLabel.textContent,slider:Number(W.zoomSlider.value),scale:W.trackHeightScale,fps:W.fps,playhead:W.playheadT}})()`;
const RECT = sel => `(()=>{const e=document.querySelector(${S(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left,y:r.top,w:r.width,h:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2,r:r.right,b:r.bottom}})()`;
const ITEM = id => `#akari-annotations-widget [data-akari-item-id=${S(id)}]`;
const HBAR = '#akari-annotations-widget .akari-timeline-zoom-bar--h';
const VBAR = '#akari-annotations-widget .akari-timeline-zoom-bar--v';
const STRIP = '#akari-annotations-widget .akari-annotations-strip';
const ROW_HEIGHTS = `(()=>{const px=v=>Math.round(v*10)/10;return [...document.querySelectorAll('#akari-annotations-widget .akari-track-header-row')].map(e=>({id:e.dataset.akariTimelineTrackId,h:px(e.getBoundingClientRect().height)}))})()`;
const STATUS_TEXT = `(()=>{const e=document.getElementById('theia-statusBar');const m=[...(e?.querySelectorAll('.element')??[])].find(x=>/タイムライン|シーク|しました|できません/.test(x.textContent||'')&&x.closest('.area.right'));const t=document.getElementById('status-bar-akari-timeline-message');const el=t||m;return el?{text:(el.textContent||'').trim(),color:getComputedStyle(el).color,id:el.id}:null})()`;
const BEYOND = `(()=>{const e=document.querySelector('#akari-annotations-widget .akari-annotations-strip-beyond-end');const l=document.querySelector('#akari-annotations-widget .akari-annotations-strip-end-line');const s=document.querySelector(${S(STRIP)});const bx=e?.getBoundingClientRect(),lx=l?.getBoundingClientRect(),sx=s.getBoundingClientRect();const cs=e&&getComputedStyle(e);return{beyond:e?{display:cs.display,left:bx.left,width:bx.width,background:cs.backgroundColor,opacity:cs.opacity}:null,endLine:l?{display:getComputedStyle(l).display,left:lx.left,width:lx.width}:null,strip:{left:sx.left,right:sx.right}}})()`;

const rec = { at: new Date().toISOString(), steps: {} };
const save = () => writeFileSync(path.join(recDir, 'interact.json'), `${JSON.stringify(rec, null, 2)}\n`);
const session = await start({ shellDir, project, isoDir, port: PORT });
const { cdp } = session;
const ev = expr => evalOn(cdp, expr);
const state = () => ev(STATE);
const rect = sel => ev(RECT(sel));
const shot = name => screenshot(cdp, path.join(recDir, `${name}.png`));
const mouse = (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? (extra.buttons ? 'left' : 'none') : 'left', clickCount: 1, ...extra });
async function drag(from, to, { steps = 12, hold = 0, modifiers = 0 } = {}) {
    await mouse('mouseMoved', from.x, from.y, { modifiers }); await sleep(40);
    await mouse('mousePressed', from.x, from.y, { buttons: 1, modifiers }); await sleep(60);
    for (let s = 1; s <= steps; s++) {
        await mouse('mouseMoved', from.x + (to.x - from.x) * s / steps, from.y + (to.y - from.y) * s / steps, { buttons: 1, modifiers });
        await sleep(24);
    }
    if (hold) await sleep(hold);
    await sleep(60);
    await mouse('mouseReleased', to.x, to.y, { buttons: 0, modifiers });
    await sleep(500);
}
const undo = async () => { await keyPress(cdp, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 }); await sleep(1500); };
const waitSha = async (before, changed = true, ms = 15_000) => { const d = Date.now() + ms; while (Date.now() < d) { if ((sha() !== before) === changed) return true; await sleep(200); } return false; };
const fit = async () => { await tidy(cdp); await sleep(300); const b = await rect(HBAR); await realClick(cdp, b.x + b.w * 0.5, b.cy, { clickCount: 2 }); await sleep(800); };
const thumbRect = async () => ev(`(()=>{const q=s=>document.querySelector(${S(HBAR)}+' '+s).getBoundingClientRect();const t=q('.akari-timeline-zoom-bar__thumb'),a=q('.akari-timeline-zoom-bar__handle--start'),b=q('.akari-timeline-zoom-bar__handle--end'),c=q('.akari-timeline-zoom-bar__content'),m=q('.akari-timeline-zoom-bar__end-mark');return{thumb:{x:t.left,w:t.width,cy:t.top+t.height/2},start:{cx:a.left+a.width/2,cy:a.top+a.height/2},end:{cx:b.left+b.width/2,cy:b.top+b.height/2},content:{x:c.left,w:c.width},endMark:{x:m.left}}})()`);

try {
    rec.chrome = await ev(CHROME);
    rec.initial = await state();
    rec.fixtureContentEnd = 12;

    // (1) ルーラーをクリック → 再生ヘッドとプレビュー、最下段バーの報告（約 4 秒で消える）。足元行が無い。
    if (want('ruler')) {
        const ruler = await ev(`(()=>{const W=${WGT};const r=W.rulerBar.getBoundingClientRect();return{x:r.left,w:r.width,cy:r.top+r.height/2}})()`);
        const before = await state();
        const t0 = Date.now();
        await realClick(cdp, ruler.x + ruler.w * 0.4, ruler.cy);
        let appeared, text, color, gone;
        while (Date.now() - t0 < 20_000) {
            const s = await ev(STATUS_TEXT);
            if (s && /シーク|選択しました/.test(s.text) && appeared === undefined) { appeared = Date.now() - t0; text = s.text; color = s.color; await shot('ruler-status'); }
            if (appeared !== undefined && (!s || !/シーク|選択しました/.test(s.text))) { gone = Date.now() - t0; break; }
            await sleep(100);
        }
        const after = await state();
        const previewTargets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url)).length;
        rec.steps.ruler = { playheadBefore: before.playhead, playheadAfter: after.playhead, statusText: text, statusColor: color, appearedMs: appeared, goneMs: gone, visibleMs: gone !== undefined && appeared !== undefined ? gone - appeared : null, previewWebviews: previewTargets, footerRow: rec.chrome.lastChild };
        save();
    }

    // (2) 横バー: 右ハンドル / 左ハンドル / 本体 / ダブルクリック。
    if (want('hbar')) {
        await fit();
        const s0 = await state();
        let t = await thumbRect();
        await drag({ x: t.end.cx, y: t.end.cy }, { x: t.end.cx - 400, y: t.end.cy });
        const s1 = await state();
        t = await thumbRect();
        await drag({ x: t.start.cx, y: t.start.cy }, { x: t.start.cx + 120, y: t.start.cy });
        const s2 = await state();
        t = await thumbRect();
        await drag({ x: t.thumb.x + t.thumb.w / 2, y: t.thumb.cy }, { x: t.thumb.x + t.thumb.w / 2 + 150, y: t.thumb.cy });
        const s3 = await state();
        await shot('hbar-after-thumb');
        await fit();
        const s4 = await state();
        rec.steps.hbar = {
            fit: s0,
            rightHandleLeft400: { start: s1.start, end: r3(s1.start + s1.dur), dur: s1.dur, startUnchanged: Math.abs(s1.start - s0.start) < 1e-9, endBefore: r3(s0.start + s0.dur) },
            leftHandleRight120: { start: s2.start, end: r3(s2.start + s2.dur), endUnchanged: Math.abs((s2.start + s2.dur) - (s1.start + s1.dur)) < 1e-6 },
            thumbRight150: { start: s3.start, dur: s3.dur, durUnchanged: Math.abs(s3.dur - s2.dur) < 1e-9, startDelta: r3(s3.start - s2.start) },
            dblclick: { label: s4.label, start: s4.start, dur: s4.dur, expectedDur: r3(s4.contentEnd * 1.05), frameErr: r3(Math.abs(s4.dur - s4.contentEnd * 1.05) * s4.fps) }
        };
        save();
    }

    // (3) スライダー最小 / Ctrl+ホイールで 10%、終わりより先が別背景。そこへクリップを置き、100% の基準が新しい全長に。Cmd+Z で戻る。
    if (want('zoomout')) {
        await fit();
        await ev(`(()=>{const W=${WGT};W.zoomSlider.value='0';W.zoomSlider.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
        await sleep(800);
        const slider = await state();
        await fit();
        const sr = await rect(STRIP);
        for (let i = 0; i < 40; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: sr.x + sr.w * 0.3, y: sr.y + 40, deltaX: 0, deltaY: 120, modifiers: 2 }); await sleep(40); }
        await sleep(800);
        const wheel = await state();
        const beyond = await ev(BEYOND);
        await shot('zoomout-10pct');
        // V2 のクリップ（2 秒目）を 20 秒目へ（全長 12 秒より後ろ）。
        const clip = await rect(ITEM('1'));
        const st = await state();
        const pxPerSec = sr.w / st.dur;
        const shaBefore = sha();
        const atBefore = itemOf('clip-b').at;
        await drag({ x: clip.cx, y: clip.cy }, { x: clip.cx + 18 * pxPerSec, y: clip.cy }, { steps: 16 });
        await waitSha(shaBefore);
        const placed = itemOf('clip-b');
        await shot('zoomout-placed-beyond');
        await sleep(500);
        await ev(`(()=>{${WGT}.zoomLabel.click();return true})()`);
        await sleep(800);
        const refit = await state();
        const shaPlaced = sha();
        await undo();
        await waitSha(shaPlaced);
        rec.steps.zoomout = {
            sliderMin: { label: slider.label, dur: slider.dur, expected10pct: r3(slider.contentEnd * 1.05 * 10) },
            ctrlWheel: { label: wheel.label, dur: wheel.dur }, beyond,
            place: { atBeforeFrames: atBefore, atAfterFrames: placed.at, atAfterSeconds: r3(placed.at / st.fps), contentEndBefore: st.contentEnd, track: placed.track },
            refitAfterPlace: { label: refit.label, dur: refit.dur, contentEnd: refit.contentEnd, expectedDur: r3(refit.contentEnd * 1.05) },
            undo: { byteEqual: sha() === shaBefore, atAfterUndo: itemOf('clip-b').at }
        };
        save();
    }

    // (4) 縦バー: 下ハンドルを上へ → 全トラックが同じ比率で高くなる。再読み込み後も倍率が残る。ダブルクリックで元へ。
    if (want('vbar')) {
        await fit();
        const rows0 = await ev(ROW_HEIGHTS);
        const s0 = await state();
        const end = await rect(`${VBAR} .akari-timeline-zoom-bar__handle--end`);
        await drag({ x: end.cx, y: end.cy }, { x: end.cx, y: end.cy - 80 });
        await sleep(600);
        const rows1 = await ev(ROW_HEIGHTS);
        const s1 = await state();
        await shot('vbar-scaled');
        await ev(`(()=>{location.reload();return true})()`).catch(() => undefined);
        await sleep(3000);
        await waitEval(cdp, `Boolean(document.querySelectorAll('.akari-annotations-strip-caption').length>0)`, { label: 'timeline after reload', timeoutMs: 120_000 });
        await sleep(2500);
        await tidy(cdp);
        await sleep(1500);
        const rows2 = await ev(ROW_HEIGHTS);
        const s2 = await state();
        const vb = await rect(VBAR);
        await realClick(cdp, vb.cx, vb.y + vb.h * 0.5, { clickCount: 2 });
        await sleep(800);
        const rows3 = await ev(ROW_HEIGHTS);
        const s3 = await state();
        const ratio = rows1.map(r => { const b = rows0.find(x => x.id === r.id); return { id: r.id, before: b?.h, after: r.h, ratio: b ? r3(r.h / b.h) : null }; });
        rec.steps.vbar = { scaleBefore: s0.scale, scaleAfterDrag: s1.scale, rows: ratio, afterReload: { scale: s2.scale, rows: rows2 }, afterDblclick: { scale: s3.scale, rows: rows3, equalToOriginal: S(rows3) === S(rows0) } };
        save();
    }

    // (5) 端ドラッグの自動送り: 300% 付近まで寄せ、V2 のクリップを掴んで右端から 20px で 1 秒保持。
    if (want('autoscroll')) {
        await fit();
        await ev(`(()=>{const W=${WGT};W.applyViewDuration(W.contentEndDuration()*1.05/3,0,0);return true})()`);
        await sleep(800);
        const sr = await rect(STRIP);
        const clip = await rect(ITEM('1'));
        const s0 = await state();
        const shaBefore = sha();
        const from = { x: clip.x + 20, y: clip.cy };
        const hold = { x: sr.r - 10, y: clip.cy };
        await mouse('mouseMoved', from.x, from.y); await sleep(40);
        await mouse('mousePressed', from.x, from.y, { buttons: 1 }); await sleep(60);
        for (let s = 1; s <= 12; s++) { await mouse('mouseMoved', from.x + (hold.x - from.x) * s / 12, from.y, { buttons: 1 }); await sleep(24); }
        const samples = [];
        const t0 = Date.now();
        while (Date.now() - t0 < 1200) {
            const st = await state();
            const ghost = await ev(`(()=>{const W=${WGT};const g=W.dragFeedback;const e=document.querySelector(${S(ITEM('1'))});const r=e?.getBoundingClientRect();return{feedback:g?.style.display!=='none'?(g.textContent||'').trim().slice(0,40):null,itemLeft:r?.left,itemRight:r?.right}})()`);
            samples.push({ ms: Date.now() - t0, start: r3(st.start), ...ghost });
            await sleep(100);
        }
        await shot('autoscroll-holding');
        await mouse('mouseReleased', hold.x, hold.y, { buttons: 0 }); await sleep(600);
        await waitSha(shaBefore);
        const s1 = await state();
        const placed = itemOf('clip-b');
        rec.steps.autoscroll = {
            before: { start: s0.start, dur: s0.dur, visibleEnd: r3(s0.start + s0.dur) }, samples,
            after: { start: s1.start, dur: s1.dur }, placedAtSeconds: r3(placed.at / s0.fps), placedBeyondInitialView: placed.at / s0.fps > s0.start + s0.dur,
            pointerTimeAtRelease: r3(s1.start + (hold.x - sr.x) / sr.w * s1.dur), clipOffsetGrabSeconds: r3((from.x - clip.x) / sr.w * s0.dur)
        };
        const shaPlaced = sha();
        await undo(); await waitSha(shaPlaced);
        rec.steps.autoscroll.undoByteEqual = sha() === shaBefore;
        save();
    }

    // (6) 回帰: Ctrl+ホイール・% ボタン・トラック境目ドラッグ・トリム・分割ツール・素材 D&D・スナップ。
    if (want('regress')) {
        const out = {};
        await fit();
        const sr = await rect(STRIP);
        for (let i = 0; i < 6; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: sr.x + sr.w * 0.5, y: sr.y + 40, deltaX: 0, deltaY: -120, modifiers: 2 }); await sleep(40); }
        await sleep(600);
        out.ctrlWheelIn = await state();
        await ev(`(()=>{${WGT}.zoomLabel.click();return true})()`); await sleep(600);
        out.percentButton = await state();
        // トラック境目（V2 の行の下端）を 20px 下へ。
        const handle = await ev(`(()=>{const h=document.querySelector('#akari-annotations-widget .akari-track-header-row[data-akari-timeline-track-id="v2"] .akari-track-header-resize-handle');if(!h)return null;const r=h.getBoundingClientRect();return{cx:r.left+r.width/2,cy:r.top+r.height/2}})()`);
        const rowsBefore = await ev(ROW_HEIGHTS);
        if (handle) await drag({ x: handle.cx, y: handle.cy }, { x: handle.cx, y: handle.cy + 20 });
        out.trackBoundary = { before: rowsBefore.find(r => r.id === 'v2'), after: (await ev(ROW_HEIGHTS)).find(r => r.id === 'v2'), handleFound: Boolean(handle) };
        // トリム: V2 のクリップの右端を 60px 左へ。
        let clip = await rect(ITEM('1'));
        let shaBefore = sha();
        await drag({ x: clip.r - 2, y: clip.cy }, { x: clip.r - 62, y: clip.cy });
        await waitSha(shaBefore);
        out.trim = { durationBefore: 120, durationAfter: itemOf('clip-b').duration };
        let shaNow = sha(); await undo(); await waitSha(shaNow);
        out.trim.undoByteEqual = sha() === shaBefore;
        // 分割ツール（B）でクリップの中ほどをクリック。
        clip = await rect(ITEM('1'));
        shaBefore = sha();
        await realClick(cdp, clip.cx, clip.cy); await sleep(300);
        await keyPress(cdp, { key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66 }); await sleep(300);
        await realClick(cdp, clip.cx, clip.cy); await sleep(300);
        await waitSha(shaBefore);
        out.razor = { v2Items: editJson().tracks.find(t => t.id === 'v2').items.map(i => `${i.id}@${i.at}+${i.duration}`) };
        await keyPress(cdp, { key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86 }); await sleep(300);
        shaNow = sha(); await undo(); await waitSha(shaNow);
        out.razor.undoByteEqual = sha() === shaBefore;
        // スナップ: V2 のクリップを、先頭が Base の 0 秒の近く（+3px）へ寄せる → 0 に吸着。
        clip = await rect(ITEM('1'));
        shaBefore = sha();
        const st = await state();
        await drag({ x: clip.x + 30, y: clip.cy }, { x: sr.x + 3 + 30, y: clip.cy });
        await waitSha(shaBefore);
        out.snap = { atAfter: itemOf('clip-b').at, snapEnabled: await ev(`${WGT}.snapEnabled`), pxPerFrame: r3(sr.w / st.dur / st.fps) };
        shaNow = sha(); await undo(); await waitSha(shaNow);
        out.snap.undoByteEqual = sha() === shaBefore;
        // 素材 D&D: 効果音を A1 の 8 秒目へ。
        const payload = { relativePath: 'assets/audio/bell-short.wav', kind: 'audio', durationSeconds: 1.5 };
        const a1 = await rect(ITEM('bell-1'));
        const dropX = sr.x + 8 / st.dur * sr.w;
        shaBefore = sha();
        await ev(`(()=>{window.dispatchEvent(new CustomEvent('akari.material.dragStart',{detail:${S(payload)}}));return true})()`);
        await sleep(500);
        const data = { items: [{ mimeType: 'application/x-akari-material', data: S(payload) }], dragOperationsMask: 1 };
        await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: dropX, y: a1.cy, data });
        for (let k = 0; k < 3; k++) { await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: dropX, y: a1.cy, data }); await sleep(150); }
        await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: dropX, y: a1.cy, data });
        await ev(`(()=>{window.dispatchEvent(new CustomEvent('akari.material.dragEnd'));return true})()`);
        await waitSha(shaBefore, true, 30_000);
        out.materialDnd = { a1Items: editJson().tracks.filter(t => t.lane === 'audio').map(t => `${t.id}: ${t.items.map(i => `${i.id}@${i.at}+${i.duration}`).join(', ')}`) };
        shaNow = sha(); await undo(); await waitSha(shaNow);
        out.materialDnd.undoByteEqual = sha() === shaBefore;
        await shot('regress-end');
        rec.steps.regress = out;
        save();
    }
    // (7) 補足: 右ハンドルを土台の右端より先へ引くと表示終了が全長 × 1.05 より先へ伸びる。
    if (want('extend')) {
        await fit();
        const t = await thumbRect();
        await drag({ x: t.end.cx, y: t.end.cy }, { x: 1436, y: t.end.cy });
        const s = await state();
        const bar = await thumbRect();
        await shot('extend-right-handle');
        rec.steps.extend = { start: s.start, end: r3(s.start + s.dur), fitEnd: r3(s.contentEnd * 1.05), label: s.label, contentBandWidth: r3(bar.content.w), thumbWidth: r3(bar.thumb.w), endMarkX: r3(bar.endMark.x) };
        await fit();
        save();
    }

    // (8) 補足: 再生ヘッドのつまみのスクラブ・素材ドラッグでも端で表示が送られる。
    if (want('edges')) {
        await fit();
        await ev(`(()=>{const W=${WGT};W.applyViewDuration(W.contentEndDuration()*1.05/3,0,0);return true})()`);
        await sleep(800);
        const sr = await rect(STRIP);
        const handle = await ev(`(()=>{const W=${WGT};const r=W.playheadHandle.getBoundingClientRect();return{cx:r.left+r.width/2,cy:r.top+r.height/2,w:r.width}})()`);
        const s0 = await state();
        await mouse('mouseMoved', handle.cx, handle.cy); await sleep(40);
        await mouse('mousePressed', handle.cx, handle.cy, { buttons: 1 }); await sleep(60);
        for (let s = 1; s <= 12; s++) { await mouse('mouseMoved', handle.cx + (sr.r - 10 - handle.cx) * s / 12, handle.cy, { buttons: 1 }); await sleep(24); }
        await sleep(1000);
        const s1 = await state();
        await mouse('mouseReleased', sr.r - 10, handle.cy, { buttons: 0 }); await sleep(500);
        rec.steps.scrubEdge = { startBefore: s0.start, startAfter1s: r3(s1.start), playheadAfter: r3(s1.playhead), visibleEndAfter: r3(s1.start + s1.dur) };
        await fit();
        await ev(`(()=>{const W=${WGT};W.applyViewDuration(W.contentEndDuration()*1.05/3,0,0);return true})()`);
        await sleep(800);
        const m0 = await state();
        const payload = { relativePath: 'assets/audio/bell-short.wav', kind: 'audio', durationSeconds: 1.5 };
        const a1 = await rect(ITEM('bell-1'));
        const data = { items: [{ mimeType: 'application/x-akari-material', data: S(payload) }], dragOperationsMask: 1 };
        await ev(`(()=>{window.dispatchEvent(new CustomEvent('akari.material.dragStart',{detail:${S(payload)}}));return true})()`);
        await sleep(300);
        await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: sr.x + sr.w / 2, y: a1.cy, data });
        const t0 = Date.now();
        while (Date.now() - t0 < 1000) { await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: sr.r - 10, y: a1.cy, data }); await sleep(50); }
        const m1 = await state();
        await cdp.send('Input.dispatchDragEvent', { type: 'dragCancel', x: sr.r - 10, y: a1.cy, data });
        await ev(`(()=>{window.dispatchEvent(new CustomEvent('akari.material.dragEnd'));return true})()`);
        await sleep(500);
        rec.steps.materialEdge = { startBefore: m0.start, startAfter1s: r3(m1.start) };
        await fit();
        save();
    }

    // (9) 補足: 失敗・注意を含む報告は警告色で約 8 秒（足元の書き込み口へ直接書く）。
    if (want('warning')) {
        const t0 = Date.now();
        await ev(`(()=>{${WGT}.footer.textContent='検証: この操作はできません。';return true})()`);
        let appeared, gone, color;
        while (Date.now() - t0 < 15_000) {
            const s = await ev(STATUS_TEXT);
            if (s && /検証/.test(s.text) && appeared === undefined) { appeared = Date.now() - t0; color = s.color; }
            if (appeared !== undefined && (!s || !/検証/.test(s.text))) { gone = Date.now() - t0; break; }
            await sleep(100);
        }
        const warnToken = await ev(`getComputedStyle(document.body).getPropertyValue('--theia-editorWarning-foreground').trim()`);
        rec.steps.warning = { color, warnToken, visibleMs: gone !== undefined && appeared !== undefined ? gone - appeared : null };
        save();
    }
    rec.finalChrome = await ev(CHROME);
    save();
    console.log(JSON.stringify(rec, null, 2));
} finally {
    await stop(session);
}
