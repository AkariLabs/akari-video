#!/usr/bin/env node
// 「選択文字を大きく」の L1（ラッパー作成の検証スクリプト）。fixture は gen-fixture.mjs で作る。
// 使い方: node l1.mjs <before|after> [fixture dir] [--port=9626]
// 実機の Electron を専用のポート・一時ディレクトリで起動し、CDP の実マウス・実キーで
// 字幕を文字編集 → 範囲をなぞる → 「大きく」を 1・3・5 回（累計）押し、そのたびに編集を抜けて描画を実測する。
//   各文字の矩形（run の span は変形後の矩形 + 変形前のレイアウト幅）・隣との隙間 px・行 / プレート / 選択枠の幅
// 最後に選択を外した状態で各字幕の中点を撮り（出力 1280 幅に揃える）、書き出し比較（export.mjs）の入力にする。
import { readFile, cp, rm, mkdir, writeFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { evalOn } from './cdp-lib.mjs';
import { S, command, launch, sanitize, saveJson, sleep, stop } from './l1-lib.mjs';
import { PLATE, calibrate, clickLocal, dragLocal, openPreview, seek, toPage, view, waitFor } from './view-lib.mjs';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON_REL = 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
const ELECTRON = existsSync(path.join(SHELL, ELECTRON_REL)) ? path.join(SHELL, ELECTRON_REL) : path.join(REPO, ELECTRON_REL);
const TMP = path.join(os.tmpdir(), 'caption-run-size-l1');
const FIXTURE_SRC = path.resolve(process.argv.slice(3).find(v => !v.startsWith('--')) ?? path.join(TMP, 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9626);
// RESULTS_TAG: 一部の字幕だけ撮り直すとき（ONLY=a,c）の結果ファイル名の接尾辞
const RESULTS = path.join(ROOT, `results-${PHASE}${process.env.RESULTS_TAG ?? ''}.json`);
// FRAMES_FROM=<captions.json>: その captions.json で開き、操作はせず各字幕の中点の撮影だけ行う（書き出しとの比較用）
const FRAMES_FROM = process.env.FRAMES_FROM;
const out = { phase: PHASE, status: 'running', scenarios: [], screenshots: [], errors: [] };

import { SCENARIOS } from './scenarios.mjs';
const PRESSES = [1, 3, 5];

// ---- 作業コピー ----
const WORK = path.join(TMP, `work-${PHASE}`);
await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });
await cp(FIXTURE_SRC, WORK, { recursive: true });
const PROJECT = await realpath(path.join(WORK, 'project'));
const LIBRARY = await realpath(path.join(WORK, 'library'));
const ISO = path.join(TMP, `iso-caption-run-size-${PHASE}`);
const CAPTIONS = path.join(PROJECT, 'captions.json');
if (FRAMES_FROM) await writeFile(CAPTIONS, await readFile(FRAMES_FROM, 'utf8'));
const readCaptions = () => readFile(CAPTIONS, 'utf8');
const rowOf = async id => JSON.parse(await readCaptions()).captions.find(c => c.id === id);

process.chdir(REPO);
const prepare = async iso => {
    await mkdir(path.join(iso, 'akari-home'), { recursive: true });
    await writeFile(path.join(iso, 'akari-home', 'library-location.json'), `${JSON.stringify({ version: 0, root: LIBRARY, state: 'done' }, null, 2)}\n`);
};
const shellCall = body => `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const s=window.theia.container.get(k);${body};return true})()`;

async function start() {
    const session = await launch({ shellDir: SHELL, electron: ELECTRON, project: PROJECT, port: PORT, isoDir: ISO, prepare });
    const first = await openPreview(session, PROJECT, PORT, 1.8, 'c-0001');
    await evalOn(session.cdp, shellCall(`s.collapsePanel('left');s.collapsePanel('right');s.collapsePanel('bottom')`)).catch(() => {});
    await sleep(2500);
    first.close();
    const v = await view(PORT);
    await waitFor('c-0001 plate after layout', async () => { await seek(session, PROJECT, 1.8); await sleep(800); return v.eval(PLATE('c-0001')); }, 60_000);
    let off;
    for (let i = 0; i < 4 && !off; i++) { try { off = await calibrate(session, v); } catch (error) { if (i === 3) throw error; await sleep(3000); } }
    return { session, v, off };
}

// ---- webview の小道具 ----
const FRAME = `(()=>{const c=[...document.querySelectorAll('#preview-stage canvas, #preview-stage video')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>50).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return c?{x:c.x,y:c.y,w:c.width,h:c.height}:null})()`;
const EDITING = `Boolean(document.querySelector('[data-akari-caption-editing]'))`;
const CHAR_RECT = (from, to) => `(()=>{const e=document.querySelector('[data-akari-caption-editing]');if(!e)return null;const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);const nodes=[];let n;while((n=w.nextNode()))nodes.push(n);const text=nodes.map(x=>x.textContent).join('');const seg=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)];const at=off=>{let o=off;for(const x of nodes){if(o<=x.textContent.length)return[x,o];o-=x.textContent.length}return[nodes.at(-1),nodes.at(-1).textContent.length]};const rect=i=>{const r=document.createRange();const[a,ao]=at(seg[i].index);const[b,bo]=at(seg[i].index+seg[i].segment.length);r.setStart(a,ao);r.setEnd(b,bo);const q=r.getBoundingClientRect();return{l:q.left,r:q.right,t:q.top,b:q.bottom}};const a=rect(${from}),z=rect(${to}-1);return{x0:a.l+1,x1:z.r-1,y0:(a.t+a.b)/2,y1:(z.t+z.b)/2}})()`;
const RUN_STATE = `(()=>{const box=document.getElementById('caption-select-box');return{sel:String(getSelection()),from:box?.dataset.akariRunFrom??null,to:box?.dataset.akariRunTo??null,editing:${EDITING}}})()`;
// 描画中の字幕の実測: 各文字の矩形（run の span は変形後の矩形）・隣との隙間・行 / ブロック / プレート / 選択枠。
const MEASURE = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!p)return null;
const px=v=>Math.round(v*100)/100;const R=r=>({l:px(r.left),r:px(r.right),t:px(r.top),b:px(r.bottom),w:px(r.width),h:px(r.height)});
const vis=e=>{if(!e)return false;const cs=getComputedStyle(e);return !e.hidden&&cs.display!=='none'&&cs.visibility!=='hidden'&&e.getBoundingClientRect().width>0};
const lines=[...p.querySelectorAll('.akari-caption__line')];const chars=[];
lines.forEach((line,li)=>{const w=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){const run=n.parentElement.closest('.akari-caption__run');for(const s of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(n.textContent)){const range=document.createRange();range.setStart(n,s.index);range.setEnd(n,s.index+s.segment.length);const rr=range.getBoundingClientRect();const box=run?run.getBoundingClientRect():rr;const item={text:s.segment,line:li,box:R(box)};if(run){const cs=getComputedStyle(run);item.run={transform:cs.transform,fontSize:cs.fontSize,letterSpacing:cs.letterSpacing,layoutWidth:run.offsetWidth,layoutHeight:run.offsetHeight,style:run.getAttribute('style')}}chars.push(item)}}});
for(let i=1;i<chars.length;i++){if(chars[i].line===chars[i-1].line)chars[i].gapFromPrev=px(chars[i].box.l-chars[i-1].box.r)}
const plate=p.querySelector('.akari-caption__plate');const block=p.querySelector('.akari-caption__block');const box=document.getElementById('caption-select-box');
const pcs=plate?getComputedStyle(plate):null;const first=lines[0]?getComputedStyle(lines[0]):null;
return{text:p.textContent,selected:p.hasAttribute('data-selected'),chars,
 lines:lines.map(l=>R(l.getBoundingClientRect())),block:block?R(block.getBoundingClientRect()):null,plate:plate?R(plate.getBoundingClientRect()):null,
 plateCss:pcs?{width:pcs.width,scale:pcs.scale,transform:pcs.transform,fontSize:getComputedStyle(p).fontSize}:null,
 lineCss:first?{fontSize:first.fontSize,letterSpacing:first.letterSpacing,lineHeight:first.lineHeight,whiteSpace:first.whiteSpace,width:first.width,maxWidth:first.maxWidth}:null,
 captionVars:{width:p.style.getPropertyValue('--caption-width'),wrap:p.style.getPropertyValue('--caption-wrap-width'),scale:p.style.getPropertyValue('--caption-scale')},
 selectBox:vis(box)?R(box.getBoundingClientRect()):null}})()`;

// 描画が落ち着くまで待ってから測る（連続 2 回の実測で行の幅が同じになるまで）
async function measureStable(ctx, id) {
    let last = null;
    for (let i = 0; i < 20; i++) {
        const m = await ctx.v.eval(MEASURE(id));
        const key = m && S(m.lines.map(l => [l.w, l.h]).concat(m.chars.map(c => c.box.w)));
        if (m && last && key === last.key) return m;
        last = { key, m };
        await sleep(1000);
    }
    return last?.m ?? null;
}
async function clickIn(ctx, selector) {
    const pt = await waitFor(`${selector} visible`, () => ctx.v.eval(`(()=>{const b=document.querySelector(${S(selector)});if(!b)return null;const cs=getComputedStyle(b);if(b.hidden||cs.display==='none'||cs.visibility==='hidden')return null;const r=b.getBoundingClientRect();return r.width>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`), 10_000);
    const hit = await ctx.v.eval(`(()=>{const h=document.elementFromPoint(${pt.x},${pt.y});const want=document.querySelector(${S(selector)});return{ok:!!(h&&want&&(h===want||want.contains(h))),hit:h?h.outerHTML.slice(0,120):null,inView:${pt.y}>=0&&${pt.y}<=innerHeight&&${pt.x}>=0&&${pt.x}<=innerWidth}})()`);
    if (!hit.ok || !hit.inView) {
        const { data } = await ctx.session.cdp.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(path.join(TMP, `fail-${Date.now()}.png`), Buffer.from(data, 'base64'));
        throw new Error(`${selector} is not clickable at ${S(pt)}: ${S(hit)}`);
    }
    await clickLocal(ctx.session, ctx.off, pt);
    await sleep(500);
}
async function key(ctx, keyName, code, keyCode, modifiers = 0) {
    await ctx.session.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
    await ctx.session.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
    await sleep(300);
}
async function plateAt(ctx, id, t) {
    return waitFor(`${id} plate`, async () => { await seek(ctx.session, PROJECT, t); await sleep(900); return ctx.v.eval(PLATE(id)); }, 60_000);
}
async function selectPlate(ctx, id, t) {
    const p = await plateAt(ctx, id, t);
    for (let i = 0; i < 3 && !(await ctx.v.eval(PLATE(id)))?.selected; i++) { await clickLocal(ctx.session, ctx.off, { x: p.cx, y: p.cy }); await sleep(700); }
    return ctx.v.eval(PLATE(id));
}
async function beginEdit(ctx, id, t) {
    if (await ctx.v.eval(EDITING)) return;
    const p = await selectPlate(ctx, id, t);
    await clickLocal(ctx.session, ctx.off, { x: p.cx, y: p.cy }, { clickCount: 2 });
    await waitFor('editing', () => ctx.v.eval(EDITING), 10_000);
    await sleep(300);
}
async function leaveEdit(ctx) {
    for (let i = 0; i < 3 && await ctx.v.eval(EDITING); i++) await key(ctx, 'Escape', 'Escape', 27);
    await sleep(700);
}
async function deselect(ctx, id) {
    for (let i = 0; i < 4 && ((await ctx.v.eval(EDITING)) || (await ctx.v.eval(PLATE(id)))?.selected); i++) await key(ctx, 'Escape', 'Escape', 27);
    await sleep(600);
}
const clearNotices = async ctx => { await evalOn(ctx.session.cdp, command('notifications.commands.clearAll')).catch(() => {}); await sleep(400); };
async function shot(ctx, name) {
    await clearNotices(ctx);
    await sleep(400);
    const file = `${PHASE}-${name}.png`;
    const f = ctx.off.iframe;
    const { data } = await ctx.session.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: f.left, y: f.top, width: f.width, height: f.height, scale: 1 } });
    await writeFile(path.join(ROOT, file), Buffer.from(data, 'base64'));
    out.screenshots.push(file);
}
// 映像の枠だけを出力 1280 幅に揃えて撮る（書き出しフレームとの比較用。一時ディレクトリ）。
async function frameShot(ctx, file) {
    await clearNotices(ctx);
    const fr = await ctx.v.eval(FRAME);
    const a = toPage(ctx.off, { x: fr.x, y: fr.y }), b = toPage(ctx.off, { x: fr.x + fr.w, y: fr.y + fr.h });
    const dpr = await evalOn(ctx.session.cdp, 'window.devicePixelRatio');
    const width = b.x - a.x, height = b.y - a.y;
    const { data } = await ctx.session.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: a.x, y: a.y, width, height, scale: 1280 / (width * dpr) } });
    await writeFile(file, Buffer.from(data, 'base64'));
    return { pageRect: { x: a.x, y: a.y, width, height }, dpr };
}

let ctx;
try {
    ctx = await start();
    out.frame = await ctx.v.eval(FRAME);
    for (const sc of SCENARIOS.filter(s => !FRAMES_FROM && (!process.env.ONLY || process.env.ONLY.split(',').includes(s.key)))) {
        const record = { key: sc.key, id: sc.id, label: sc.label, t: sc.t, steps: [] };
        out.scenarios.push(record);
        try {
            await selectPlate(ctx, sc.id, sc.t);
            record.steps.push({ presses: 0, measure: await measureStable(ctx, sc.id) });
            await shot(ctx, `${sc.key}-x0`);
            if (sc.from === undefined) { await deselect(ctx, sc.id); await saveJson(RESULTS, out); continue; }
            let pressed = 0;
            for (const target of PRESSES) {
                await beginEdit(ctx, sc.id, sc.t);
                let state;
                for (let attempt = 0; attempt < 3; attempt++) {
                    if (!(await ctx.v.eval(EDITING))) await beginEdit(ctx, sc.id, sc.t);
                    var cr = await waitFor('char rect', () => ctx.v.eval(CHAR_RECT(sc.from, sc.to)), 10_000);
                    if (process.env.L1_DEBUG) (out.debugPre ??= []).push({ key: sc.key, pressed, attempt, cr, hit: await ctx.v.eval(`(()=>{const h=document.elementFromPoint(${cr.x0},${cr.y0});const e=document.querySelector('[data-akari-caption-editing]');const r=e?.getBoundingClientRect();return{hit:h?.outerHTML?.slice(0,200),inEdit:!!(e&&h&&e.contains(h)),editRect:r?{l:r.left,r:r.right,t:r.top,b:r.bottom}:null,editHtml:e?.outerHTML?.slice(0,800)}})()`) });
                    await dragLocal(ctx.session, ctx.off, { x: cr.x0, y: cr.y0 }, { x: cr.x1, y: cr.y1 });
                    await sleep(500);
                    state = await ctx.v.eval(RUN_STATE);
                    if (state.sel === sc.sel && state.from === String(sc.from) && state.to === String(sc.to)) break;
                    if (process.env.L1_DEBUG) {
                        const { data } = await ctx.session.cdp.send('Page.captureScreenshot', { format: 'png' });
                        await writeFile(path.join(TMP, `dbg-${sc.key}-${pressed}-${attempt}.png`), Buffer.from(data, 'base64'));
                        (out.debug ??= []).push({ key: sc.key, pressed, attempt, cr, state, editingHtml: await ctx.v.eval(`document.querySelector('[data-akari-caption-editing]')?.outerHTML?.slice(0,600) ?? null`) });
                    }
                }
                if (state.sel !== sc.sel || state.from !== String(sc.from) || state.to !== String(sc.to)) throw new Error(`selection ${S(state)}`);
                while (pressed < target) {
                    const again = await ctx.v.eval(RUN_STATE);
                    if (again.from !== String(sc.from) || again.to !== String(sc.to)) {
                        const r2 = await waitFor('char rect', () => ctx.v.eval(CHAR_RECT(sc.from, sc.to)), 10_000);
                        await dragLocal(ctx.session, ctx.off, { x: r2.x0, y: r2.y0 }, { x: r2.x1, y: r2.y1 });
                        await sleep(300);
                    }
                    // 高負荷でクリックが落ちることがある: 60 秒で書き込まれなければ（値が前のままなら）押し直す（最大 3 回）
                    const expected = Math.round((1 + 0.1 * (pressed + 1)) * 100) / 100;
                    const scaleNow = async () => (await rowOf(sc.id))?.runs?.find(r => r.from === sc.from && r.to === sc.to)?.style?.scale ?? 1;
                    let written = false;
                    for (let attempt = 0; attempt < 3 && !written; attempt++) {
                        if (attempt > 0 && Math.abs((await scaleNow()) - expected) > 1e-9) record.retries = (record.retries ?? 0) + 1;
                        else if (attempt > 0) break;
                        await clickIn(ctx, '#caption-select-box [data-akari-run-tool="bigger"]');
                        written = await waitFor(`scale ${expected} written`, async () => Math.abs((await scaleNow()) - expected) < 1e-9, 60_000).then(() => true).catch(() => false);
                    }
                    if (!written) throw new Error(`scale ${expected} not written (now ${await scaleNow()})`);
                    pressed++;
                }
                await leaveEdit(ctx);
                const row = await rowOf(sc.id);
                await sleep(500);
                record.steps.push({ presses: pressed, runs: row.runs ?? null, measure: await measureStable(ctx, sc.id) });
                await shot(ctx, `${sc.key}-x${pressed}`);
                await saveJson(RESULTS, out);
            }
            await deselect(ctx, sc.id);
        } catch (error) {
            record.error = sanitize(error, REPO);
            out.errors.push(`${sc.key}: ${record.error.split('\n')[0]}`);
            await leaveEdit(ctx).catch(() => {});
            await deselect(ctx, sc.id).catch(() => {});
        }
        await saveJson(RESULTS, out);
    }
    // 選択を外した描画を各字幕の中点で撮る（書き出しと並べる素材）
    await mkdir(path.join(TMP, `frames-${PHASE}`), { recursive: true });
    out.previewFrames = [];
    for (const sc of process.env.ONLY ? [] : SCENARIOS) {
        await plateAt(ctx, sc.id, sc.t);
        await deselect(ctx, sc.id);
        await sleep(800);
        const file = path.join(TMP, `frames-${PHASE}`, `preview-${sc.key}.png`);
        const info = await frameShot(ctx, file);
        out.previewFrames.push({ key: sc.key, t: sc.t, selected: (await ctx.v.eval(PLATE(sc.id)))?.selected ?? null, ...info });
    }
    if (!FRAMES_FROM) await writeFile(path.join(TMP, `captions-${PHASE}${process.env.RESULTS_TAG ?? ''}.json`), await readCaptions());
    out.status = out.errors.length ? 'partial' : 'done';
} catch (error) {
    out.status = 'error';
    out.error = sanitize(error, REPO);
    console.error(error);
} finally {
    await saveJson(RESULTS, out);
    await stop(ctx?.session);
}
console.log(JSON.stringify({ status: out.status, errors: out.errors, screenshots: out.screenshots.length }));
