#!/usr/bin/env node
// 文字範囲（runs）の操作画面の L1（ラッパー作成の検証スクリプト）。fixture は gen-fixture.mjs で作る。
// 使い方: node l1.mjs [fixture dir] [--port=9499]
// 実機の Electron を自分専用のポート・一時ディレクトリで起動し、CDP の実マウス・実キーで操作して実測する。
//   1 範囲なしのミニパネル（今どおり: 字幕全体の text_style に書く・範囲用アイコンは出ない）
//   2 「最高」をなぞる / Shift+矢印で広げる・戻す
//   3 赤 → 大きく → 上へ → 回転 → 役割（各 1 回の書き込み・undo 1 回で戻る・redo で戻す）。編集中の見た目
//   4 範囲にマイスタイル（「アイデア」に look を当てる・語彙外は 1 行の知らせ）
//   5 保存・再読込（Electron の起動し直し）で同じ
//   6 インスペクターの「文字範囲」一覧（行を押すとプレビューで範囲が選ばれる・外す → undo）
//   7 台本で「最高」を消す → 右下に「文字範囲 1 件（「最高」）が外れました」
// 書き出し（GPU）は export-frame.mjs（この結果の再読込後の実測と比べる）。
import { readFile, cp, rm, mkdir, writeFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { evalOn, realClick } from './cdp-lib.mjs';
import { S, command, launch, sanitize, saveJson, sleep, stop, waitEval } from './l1-lib.mjs';
import { PLATE, calibrate, clickLocal, dragLocal, openPreview, seek, toPage, view, waitFor } from './view-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON_REL = 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
const ELECTRON = existsSync(path.join(SHELL, ELECTRON_REL)) ? path.join(SHELL, ELECTRON_REL) : path.join(REPO, ELECTRON_REL);
const TMP = path.join(os.tmpdir(), 'caption-runs-edit-ui-l1');
const FIXTURE_SRC = path.resolve(process.argv.slice(2).find(v => !v.startsWith('--')) ?? path.join(TMP, 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9499);
const RESULTS = path.join(ROOT, 'results-after.json');
const out = { phase: 'after', status: 'running', checks: [], screenshots: [] };

const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function check(name, operation) {
    const record = { name, pass: false };
    out.checks.push(record);
    try { record.detail = await operation(); record.pass = true; }
    catch (error) {
        record.error = sanitize(error, REPO);
        // 失敗時の画面（一時ディレクトリへ。証跡には入れない）
        try { const { data } = await ctx.session.cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(TMP, `fail-${out.checks.length}.png`), Buffer.from(data, 'base64')); } catch {}
        if (process.env.L1_STOP_ON_FAIL) throw error;
    }
    finally { await saveJson(RESULTS, out); }
    return record.detail;
}
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// ---- 作業コピー ----
const WORK = path.join(TMP, 'work');
await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });
await cp(FIXTURE_SRC, WORK, { recursive: true });
const PROJECT = await realpath(path.join(WORK, 'project'));
const LIBRARY = await realpath(path.join(WORK, 'library'));
const ISO = path.join(TMP, 'iso-caption-runs-edit-ui');
const CAPTIONS = path.join(PROJECT, 'captions.json');
out.fixtureProject = '<tmp>/work/project';
const readCaptions = () => readFile(CAPTIONS, 'utf8');
const rowOf = async id => JSON.parse(await readCaptions()).captions.find(c => c.id === id);

process.chdir(REPO); // 素材の置き場の解決（asset-resolver の候補）が cwd を見るため、リポ直下から起動する
const prepare = async iso => {
    await mkdir(path.join(iso, 'akari-home'), { recursive: true });
    await writeFile(path.join(iso, 'akari-home', 'library-location.json'), `${JSON.stringify({ version: 0, root: LIBRARY, state: 'done' }, null, 2)}\n`);
};
const shellCall = body => `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const s=window.theia.container.get(k);${body};return true})()`;
const clearNotices = async session => {
    await evalOn(session.cdp, command('notifications.commands.clearAll')).catch(() => {});
    await sleep(400);
};
// 右下のトーストと通知の一覧に同じ項目が 2 つ並ぶので、文言で 1 つにまとめる。
const NOTICES = `[...new Set([...document.querySelectorAll('.theia-notification-list-item')].map(e=>(e.querySelector('.theia-notification-message')||e).innerText.trim()))]`;

async function start() {
    const session = await launch({ shellDir: SHELL, electron: ELECTRON, project: PROJECT, port: PORT, isoDir: ISO, prepare });
    const first = await openPreview(session, PROJECT, PORT, 1, 'c-0001');
    await evalOn(session.cdp, shellCall(`s.collapsePanel('left');s.collapsePanel('right');s.collapsePanel('bottom')`)).catch(() => {});
    await sleep(2500);
    first.close();
    const v = await view(PORT); // 畳んだ後に webview へ付け直す（古い接続のままだと入力が届かない）
    await waitFor('c-0001 plate after layout', async () => { await seek(session, PROJECT, 1); await sleep(800); return v.eval(PLATE('c-0001')); }, 60_000);
    await clearNotices(session);
    const off = await calibrate(session, v);
    return { session, v, off };
}
async function shot(ctx, name) {
    await sleep(400);
    const file = `after-${name}.png`;
    const f = ctx.off.iframe;
    const { data } = await ctx.session.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: f.left, y: f.top, width: f.width, height: f.height, scale: 1 } });
    await writeFile(path.join(ROOT, file), Buffer.from(data, 'base64'));
    out.screenshots.push(file);
}
async function shotWindow(ctx, name) {
    await sleep(400);
    const file = `after-${name}.png`;
    const { data } = await ctx.session.cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(ROOT, file), Buffer.from(data, 'base64'));
    out.screenshots.push(file);
}

// ---- webview の小道具 ----
const FRAME = `(()=>{const c=[...document.querySelectorAll('#preview-stage canvas, #preview-stage video')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>50).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return c?{x:c.x,y:c.y,w:c.width,h:c.height}:null})()`;
const EDITING = `Boolean(document.querySelector('[data-akari-caption-editing]'))`;
// 編集中の要素の書記素 from..to の文字の矩形（なぞる始点・終点）。
const CHAR_RECT = (from, to) => `(()=>{const e=document.querySelector('[data-akari-caption-editing]');if(!e)return null;const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);const nodes=[];let n;while((n=w.nextNode()))nodes.push(n);const text=nodes.map(x=>x.textContent).join('');const seg=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)];const at=off=>{let o=off;for(const x of nodes){if(o<=x.textContent.length)return[x,o];o-=x.textContent.length}return[nodes.at(-1),nodes.at(-1).textContent.length]};const rect=i=>{const r=document.createRange();const[a,ao]=at(seg[i].index);const[b,bo]=at(seg[i].index+seg[i].segment.length);r.setStart(a,ao);r.setEnd(b,bo);const q=r.getBoundingClientRect();return{l:q.left,r:q.right,t:q.top,b:q.bottom}};const a=rect(${from}),z=rect(${to}-1);return{x0:a.l+1,x1:z.r-1,y0:(a.t+a.b)/2,y1:(z.t+z.b)/2}})()`;
const RUN_STATE = `(()=>{const box=document.getElementById('caption-select-box');const vis=e=>e&&!e.hidden&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>0;const tools=box?[...box.querySelectorAll('[data-caption-tool]')].filter(vis).map(b=>b.dataset.captionTool):[];const bar=box?.querySelector('.akari-caption-select-tools')?.getBoundingClientRect();return{sel:String(getSelection()),from:box?.dataset.akariRunFrom??null,to:box?.dataset.akariRunTo??null,editing:${EDITING},tools,runTools:box?[...box.querySelectorAll('[data-akari-run-tool]')].filter(vis).map(b=>b.dataset.akariRunTool):[],bar:bar?{top:Math.round(bar.top),left:Math.round(bar.left),width:Math.round(bar.width),height:Math.round(bar.height)}:null,viewport:{w:innerWidth,h:innerHeight}}})()`;
const RUN_SPANS = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!p)return[];const px=v=>Math.round(v*100)/100;return[...p.querySelectorAll('.akari-caption__run')].map(s=>{const cs=getComputedStyle(s);const r=s.getBoundingClientRect();return{text:s.textContent,color:cs.color,fontWeight:cs.fontWeight,transform:cs.transform,letterSpacing:cs.letterSpacing,stroke:cs.webkitTextStrokeColor+' '+cs.webkitTextStrokeWidth,rect:{left:px(r.left),top:px(r.top),width:px(r.width),height:px(r.height)}}})})()`;
const EDIT_SPANS = `(()=>{const e=document.querySelector('[data-akari-caption-editing]');if(!e)return null;return[...e.querySelectorAll('.akari-caption__run')].map(s=>{const cs=getComputedStyle(s);return{text:s.textContent,color:cs.color,transform:cs.transform}})})()`;
const SEL_RECT = selector => `(()=>{const b=document.querySelector(${S(selector)});if(!b)return null;const cs=getComputedStyle(b);if(b.hidden||cs.display==='none'||cs.visibility==='hidden')return null;const r=b.getBoundingClientRect();return r.width>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`;

async function clickIn(ctx, selector) {
    const pt = await waitFor(`${selector} visible`, () => ctx.v.eval(SEL_RECT(selector)), 10_000);
    const hit = await ctx.v.eval(`(()=>{const h=document.elementFromPoint(${pt.x},${pt.y});const want=document.querySelector(${S(selector)});return{ok:!!(h&&want&&(h===want||want.contains(h))),hit:h?h.outerHTML.slice(0,100):null,inView:${pt.y}>=0&&${pt.y}<=innerHeight&&${pt.x}>=0&&${pt.x}<=innerWidth}})()`);
    if (!hit.ok || !hit.inView) throw new Error(`${selector} is not clickable at ${S(pt)}: ${S(hit)}`);
    await clickLocal(ctx.session, ctx.off, pt);
    await sleep(500);
}
async function beginEdit(ctx, id, time) {
    if (await ctx.v.eval(EDITING)) return;
    const p = await waitFor(`${id} plate`, async () => { await seek(ctx.session, PROJECT, time); await sleep(900); return ctx.v.eval(PLATE(id)); }, 60_000);
    for (let i = 0; i < 3 && !(await ctx.v.eval(PLATE(id)))?.selected; i++) { await clickLocal(ctx.session, ctx.off, { x: p.cx, y: p.cy }); await sleep(600); }
    await clickLocal(ctx.session, ctx.off, { x: p.cx, y: p.cy }, { clickCount: 2 });
    await waitFor('editing', () => ctx.v.eval(EDITING), 10_000);
    await sleep(300);
}
async function selectRange(ctx, from, to) {
    const cr = await waitFor('char rect', () => ctx.v.eval(CHAR_RECT(from, to)), 10_000);
    await dragLocal(ctx.session, ctx.off, { x: cr.x0, y: cr.y0 }, { x: cr.x1, y: cr.y1 });
    await sleep(300);
    return ctx.v.eval(RUN_STATE);
}
async function key(ctx, keyName, code, keyCode, modifiers = 0) {
    await ctx.session.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
    await ctx.session.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
    await sleep(250);
}
async function waitFileChange(before, timeoutMs = 15_000) {
    return waitFor('captions.json changed', async () => { const now = await readCaptions(); return now !== before ? now : null; }, timeoutMs);
}
/** 書き込みの回数を数える: 操作の後 2.5 秒間 captions.json の内容の移り変わりを 100ms 刻みで数える。 */
async function countWrites(before, ms = 2500) {
    let last = before, count = 0; const deadline = Date.now() + ms;
    while (Date.now() < deadline) { const now = await readCaptions(); if (now !== last) { count++; last = now; } await sleep(100); }
    return { count, text: last };
}
/** undo / redo は akari.timeline.undo / redo（Cmd+Z の割り当て先）。 */
// タイムラインが前面に無いと handler が無効になる（インスペクター・台本を開いた後）ので、そのときはタイムラインを前面に出して打ち直す（out.historyVia に記録）。
async function history(ctx, redo) {
    const id = redo ? 'akari.timeline.redo' : 'akari.timeline.undo';
    try { await evalOn(ctx.session.cdp, command(id)); (out.historyVia ??= {}).direct = (out.historyVia.direct ?? 0) + 1; }
    catch (error) {
        if (!/no active handlers/.test(error.message)) throw error;
        await evalOn(ctx.session.cdp, shellCall(`s.activateWidget('akari-annotations-widget')`));
        await sleep(800);
        await evalOn(ctx.session.cdp, command(id));
        (out.historyVia ??= {}).afterActivatingTimeline = (out.historyVia.afterActivatingTimeline ?? 0) + 1;
    }
    await sleep(300);
}

async function operate(ctx, label, action, expect) {
    const before = await readCaptions();
    await action();
    await waitFileChange(before);
    const { count, text: after } = await countWrites(before);
    const writes = count;
    const run = JSON.parse(after).captions.find(c => c.id === 'c-0001').runs;
    expect(run);
    const editSpans = await ctx.v.eval(EDIT_SPANS);
    const state = await ctx.v.eval(RUN_STATE);
    await history(ctx, false);
    const undone = await waitFor('undo restored', async () => (await readCaptions()) === before, 10_000).then(() => true).catch(() => false);
    const afterUndoState = await ctx.v.eval(RUN_STATE);
    await history(ctx, true);
    const redone = await waitFor('redo restored', async () => (await readCaptions()) === after, 10_000).then(() => true).catch(() => false);
    assert(writes === 1, `${label}: writes ${writes}`);
    assert(undone, `${label}: undo did not restore captions.json`);
    assert(redone, `${label}: redo did not restore captions.json`);
    return { runs: run, writes, undoRestoresBytes: undone, redoRestoresBytes: redone, editingAfter: state.editing, selectionAfter: { sel: state.sel, from: state.from, to: state.to }, selectionAfterUndo: { sel: afterUndoState.sel, from: afterUndoState.from, to: afterUndoState.to }, editSpans };
}

let ctx;
try {
    ctx = await start();
    out.frame = await ctx.v.eval(FRAME);

    // ===== 1. 範囲なしのミニパネル =====
    await check('範囲なし: ミニパネルは今どおり（範囲用アイコンなし・B は字幕全体の text_style）', async () => {
        const p = await waitFor('c-0002 plate', async () => { await seek(ctx.session, PROJECT, 5); await sleep(900); return ctx.v.eval(PLATE('c-0002')); }, 60_000);
        const hitCaption = await ctx.v.eval(`(()=>{const h=document.elementFromPoint(${p.cx},${p.cy});return h?h.outerHTML.slice(0,80):null})()`);
        // 最初のクリックは webview へのフォーカスで消えることがあるので、選ばれるまで押し直す（最大 3 回）
        for (let i = 0; i < 3 && !(await ctx.v.eval(PLATE('c-0002')))?.selected; i++) { await clickLocal(ctx.session, ctx.off, { x: p.cx, y: p.cy }); await sleep(700); }
        out.selectHit = hitCaption;
        const state = await ctx.v.eval(RUN_STATE);
        assert(state.runTools.length === 0, `run tools visible without a range: ${state.runTools}`);
        const before = await readCaptions();
        await clickIn(ctx, '#caption-select-box [data-caption-tool="bold"]');
        await waitFileChange(before);
        const row = await rowOf('c-0002');
        assert(row.text_style?.font_weight === 900 && !row.runs, `bold did not write whole-caption style: ${S(row)}`);
        await history(ctx, false);
        const undone = await waitFor('undo', async () => (await readCaptions()) === before, 10_000).then(() => true).catch(() => false);
        assert(undone, 'undo did not restore');
        await shot(ctx, '01-no-range-tools');
        return { tools: state.tools, runTools: state.runTools, written: { text_style: row.text_style, runs: row.runs ?? null }, undoRestoresBytes: undone };
    });

    // ===== 2. なぞる / Shift+矢印 =====
    await check('「最高」をなぞって選ぶ → 書記素 3〜5・範囲用アイコンが出る・ツールバーはプレビューの中に 1 段', async () => {
        await beginEdit(ctx, 'c-0001', 1);
        const state = await selectRange(ctx, 3, 5);
        assert(state.sel === '最高' && state.from === '3' && state.to === '5', `selection ${S(state)}`);
        assert(state.runTools.length >= 6, `run tools ${state.runTools}`);
        assert(state.bar && state.bar.top >= 0 && state.bar.height <= 44, `toolbar out of view or wrapped: ${S(state.bar)}`);
        await shot(ctx, '02-selected');
        return state;
    });
    await check('Shift+→ で 1 文字広げる → 3〜6 / Shift+← で戻す → 3〜5', async () => {
        await key(ctx, 'ArrowRight', 'ArrowRight', 39, 8);
        const wider = await ctx.v.eval(RUN_STATE);
        await key(ctx, 'ArrowLeft', 'ArrowLeft', 37, 8);
        const back = await ctx.v.eval(RUN_STATE);
        assert(wider.from === '3' && wider.to === '6' && wider.sel === '最高の', `wider ${S(wider)}`);
        assert(back.from === '3' && back.to === '5' && back.sel === '最高', `back ${S(back)}`);
        return { wider: { sel: wider.sel, from: wider.from, to: wider.to }, back: { sel: back.sel, from: back.from, to: back.to } };
    });

    // ===== 3. 赤 → 大きく → 上へ → 回転 → 役割 =====
    const RED = '#f26666';
    await check('赤: 色 → 見本の赤 → runs[0].style.color・書き込み 1 回・undo 1 回で戻る', () => operate(ctx, '赤', async () => {
        await clickIn(ctx, '#caption-select-box [data-caption-tool="color"]');
        await clickIn(ctx, `#caption-select-box [data-palette-colors] [data-color="${RED}"]`);
    }, runs => assert(runs?.length === 1 && runs[0].from === 3 && runs[0].to === 5 && runs[0].style?.color === RED, `runs ${S(runs)}`)));
    // パレットを閉じる（開いたままでも次のアイコンは押せるが、画面写真のため）
    await ctx.v.eval(`(()=>{const p=document.querySelector('#caption-select-box [data-caption-palette]');if(p&&!p.hidden)document.querySelector('#caption-select-box [data-caption-tool="color"]').click();return true})()`);
    await sleep(300);
    const STEPS = [
        ['大きく', 'bigger', runs => runs[0].style?.scale > 1],
        ['上へ', 'up', runs => runs[0].style?.baseline_shift_em < 0],
        ['回転', 'rotate', runs => typeof runs[0].style?.rotate_deg === 'number' && runs[0].style.rotate_deg !== 0]
    ];
    for (const [label, tool, ok] of STEPS) {
        await check(`${label}: 書き込み 1 回・同じ run を更新・undo 1 回で戻る`, () => operate(ctx, label, () => clickIn(ctx, `#caption-select-box [data-akari-run-tool="${tool}"]`),
            runs => assert(runs?.length === 1 && runs[0].style?.color === RED && ok(runs), `runs ${S(runs)}`)));
    }
    await check('編集中も範囲の見た目が出る（赤・大きく・上へ・回転）', async () => {
        const spans = await ctx.v.eval(EDIT_SPANS);
        assert(spans?.length === 2 && spans.every(s => s.color === 'rgb(242, 102, 102)' && s.transform !== 'none'), `edit spans ${S(spans)}`);
        await shot(ctx, '03-editing-red-big-up-rotate');
        return spans;
    });
    await check('役割: 強調（emphasis）を選ぶ → runs[0].role・書き込み 1 回・undo 1 回で戻る', () => operate(ctx, '役割', async () => {
        await clickIn(ctx, '#caption-select-box [data-akari-run-tool="role"]');
        const labels = await ctx.v.eval(`[...document.querySelectorAll('#caption-select-box [data-akari-run-menu] [data-akari-run-role]')].map(b=>b.dataset.akariRunRole+'='+b.textContent.trim())`);
        out.roleMenu = labels;
        await clickIn(ctx, '#caption-select-box [data-akari-run-menu] [data-akari-run-role="emphasis"]');
    }, runs => assert(runs?.length === 1 && runs[0].role === 'emphasis' && runs[0].style?.color === RED, `runs ${S(runs)}`)));
    await check('編集を抜ける（Escape）→ 範囲用アイコンが消え、描画は赤・大きく・上へ・回転', async () => {
        await key(ctx, 'Escape', 'Escape', 27);
        await sleep(1200);
        const state = await ctx.v.eval(RUN_STATE);
        const spans = await ctx.v.eval(RUN_SPANS('c-0001'));
        assert(!state.editing && state.runTools.length === 0, `after escape ${S(state)}`);
        assert(spans.length === 2 && spans.every(s => s.color === 'rgb(242, 102, 102)' && s.transform !== 'none'), `spans ${S(spans)}`);
        await shot(ctx, '04-after-escape');
        return { state: { editing: state.editing, runTools: state.runTools, tools: state.tools }, spans, runs: (await rowOf('c-0001')).runs };
    });

    // ===== 4. 範囲にマイスタイル =====
    await check('範囲にマイスタイル: 「アイデア」に「緑の強調（L1）」の見た目 → run 追加（語彙内だけ）・語彙外は 1 行の知らせ・undo 1 回で戻る', async () => {
        await clearNotices(ctx.session);
        await beginEdit(ctx, 'c-0001', 1);
        const sel = await selectRange(ctx, 6, 10);
        assert(sel.sel === 'アイデア' && sel.from === '6' && sel.to === '10', `selection ${S(sel)}`);
        const before = await readCaptions();
        await clickIn(ctx, '#caption-select-box [data-akari-run-tool="style"]');
        const choices = await waitFor('style choices', async () => { const c = await ctx.v.eval(`[...document.querySelectorAll('#caption-select-box [data-akari-run-menu] [data-akari-run-style]')].map(b=>b.dataset.akariRunStyle+'='+b.textContent.trim())`); return c.some(x => x.startsWith('mine:')) ? c : null; }, 20_000);
        await shot(ctx, '05-style-menu');
        await clickIn(ctx, '#caption-select-box [data-akari-run-menu] [data-akari-run-style="mine:runs-l1-green"]');
        await waitFileChange(before);
        const { count, text: after } = await countWrites(before);
        const runs = JSON.parse(after).captions.find(c => c.id === 'c-0001').runs;
        const added = runs.find(r => r.from === 6 && r.to === 10);
        assert(count === 1, `writes ${count}`);
        assert(added && added.style?.color?.toLowerCase() === '#22c55e' && added.style.font_weight === 900 && added.style.stroke?.color?.toLowerCase() === '#0b3d1e', `added ${S(added)}`);
        const allowed = ['color', 'font_weight', 'scale', 'baseline_shift_em', 'rotate_deg', 'letter_spacing_em', 'stroke', 'italic', 'underline'];
        assert(Object.keys(added.style).every(k => allowed.includes(k)), `non-vocabulary keys ${Object.keys(added.style)}`);
        const notices = await waitFor('omitted notice', async () => { const n = await evalOn(ctx.session.cdp, NOTICES); return n.length ? n : null; }, 10_000).catch(() => []);
        assert(notices.length === 1, `notices ${S(notices)}`);
        await history(ctx, false);
        const undone = await waitFor('undo', async () => (await readCaptions()) === before, 10_000).then(() => true).catch(() => false);
        await history(ctx, true);
        const redone = await waitFor('redo', async () => (await readCaptions()) === after, 10_000).then(() => true).catch(() => false);
        assert(undone && redone, `undo ${undone} redo ${redone}`);
        await key(ctx, 'Escape', 'Escape', 27);
        await sleep(1200);
        await shot(ctx, '06-mystyle-applied');
        return { choices, added, writes: count, notices, undoRestoresBytes: undone, redoRestoresBytes: redone, spans: await ctx.v.eval(RUN_SPANS('c-0001')) };
    });

    // ===== 5. 保存・再読込 =====
    const beforeReload = { file: await readCaptions(), spans: await ctx.v.eval(RUN_SPANS('c-0001')), frame: await ctx.v.eval(FRAME) };
    await writeFile(path.join(TMP, 'captions-after-reload.json'), beforeReload.file); // export-frame.mjs が書き出しに使う（台本の手順より前の状態）
    await check('保存・再読込（Electron を起動し直す）→ runs と描画が同じ', async () => {
        await stop(ctx.session); ctx.v.close();
        ctx = await start();
        await seek(ctx.session, PROJECT, 1); await sleep(1500);
        const spans = await waitFor('spans', async () => { const s = await ctx.v.eval(RUN_SPANS('c-0001')); return s.length === 6 ? s : null; }, 60_000);
        const frame = await ctx.v.eval(FRAME);
        const file = await readCaptions();
        assert(file === beforeReload.file, 'captions.json changed by reload');
        const diffs = spans.map((s, i) => { const b = beforeReload.spans[i]; return { text: s.text, sameStyle: s.color === b.color && s.transform === b.transform && s.fontWeight === b.fontWeight, dLeft: round((s.rect.left - frame.x) - (b.rect.left - beforeReload.frame.x)), dTop: round((s.rect.top - frame.y) - (b.rect.top - beforeReload.frame.y)) }; });
        assert(diffs.every(d => d.sameStyle && Math.abs(d.dLeft) <= 1 && Math.abs(d.dTop) <= 1), `diffs ${S(diffs)}`);
        await shot(ctx, '07-after-reload');
        out.frameAfterReload = frame;
        out.spansAfterReload = spans;
        return { runs: JSON.parse(file).captions[0].runs, diffs };
    });

    // ===== 6. インスペクターの一覧 =====
    await check('インスペクター: 「文字範囲」の一覧 2 行 → 行を押すとプレビューで範囲が選ばれる → 外す → undo 1 回で戻る', async () => {
        await evalOn(ctx.session.cdp, command('akari.inspector.open'));
        await sleep(1500);
        ctx.off = await calibrate(ctx.session, ctx.v); // インスペクターが開いてプレビューの幅が変わる
        const p = await waitFor('c-0001 plate', async () => { await seek(ctx.session, PROJECT, 1); await sleep(900); return ctx.v.eval(PLATE('c-0001')); }, 60_000);
        for (let i = 0; i < 3 && !(await ctx.v.eval(PLATE('c-0001')))?.selected; i++) { await clickLocal(ctx.session, ctx.off, { x: p.cx, y: p.cy }); await sleep(700); }
        const rows = await waitFor('run rows', async () => { const r = await evalOn(ctx.session.cdp, `[...document.querySelectorAll('[data-akari-caption-run-index]')].map(r=>({index:r.dataset.akariCaptionRunIndex,text:r.innerText.replace(/\\s+/g,' ').trim()}))`); return r.length >= 2 ? r : null; }, 30_000);
        await evalOn(ctx.session.cdp, `document.querySelector('[data-akari-caption-run-index="0"]').scrollIntoView({block:'center'})`);
        await shotWindow(ctx, '08-inspector-list');
        // 行（選ぶボタン）を押す
        const selPt = await evalOn(ctx.session.cdp, `(()=>{const r=document.querySelector('[data-akari-caption-run-index="1"]');r.scrollIntoView({block:'center'});const b=[...r.querySelectorAll('button')].find(b=>!/外す/.test(b.textContent));const q=b.getBoundingClientRect();return{x:q.left+q.width/2,y:q.top+q.height/2}})()`);
        await sleep(300);
        await realClick(ctx.session.cdp, selPt.x, selPt.y);
        const picked = await waitFor('preview range selected', async () => { const s = await ctx.v.eval(RUN_STATE); return s.from === '6' && s.to === '10' ? s : null; }, 15_000);
        await shotWindow(ctx, '09-inspector-row-selects');
        const before = await readCaptions();
        const rmPt = await evalOn(ctx.session.cdp, `(()=>{const r=document.querySelector('[data-akari-caption-run-index="1"]');r.scrollIntoView({block:'center'});const b=[...r.querySelectorAll('button')].find(b=>/外す/.test(b.textContent));const q=b.getBoundingClientRect();return{x:q.left+q.width/2,y:q.top+q.height/2}})()`);
        await sleep(300);
        await realClick(ctx.session.cdp, rmPt.x, rmPt.y);
        await waitFileChange(before);
        const { count, text: after } = await countWrites(before);
        const runsAfter = JSON.parse(after).captions[0].runs;
        assert(count === 1 && runsAfter.length === 1 && runsAfter[0].from === 3, `after remove ${count} ${S(runsAfter)}`);
        const rowsAfter = await waitFor('rows updated', async () => { const r = await evalOn(ctx.session.cdp, `document.querySelectorAll('[data-akari-caption-run-index]').length`); return r === 1 ? r : null; }, 10_000).catch(() => null);
        await history(ctx, false);
        const undone = await waitFor('undo', async () => (await readCaptions()) === before, 10_000).then(() => true).catch(() => false);
        assert(undone, 'undo did not restore removed run');
        assert(rowsAfter === 1, 'inspector list not updated after remove');
        return { rows, picked: { sel: picked.sel, from: picked.from, to: picked.to, editing: picked.editing }, writes: count, runsAfterRemove: runsAfter, rowsAfterRemove: rowsAfter, undoRestoresBytes: undone };
    });

    // ===== 7. 台本で「最高」を消す =====
    await check('台本で「最高」を消す → 右下に「文字範囲 1 件（「最高」）が外れました」', async () => {
        await clearNotices(ctx.session);
        await evalOn(ctx.session.cdp, command('akari.daihon.open'));
        const pt = await waitFor('daihon row', () => evalOn(ctx.session.cdp, `(()=>{const t=document.querySelector('.akari-daihon-row[data-caption-id="c-0001"] .akari-daihon-row-text');if(!t)return null;t.scrollIntoView({block:'center'});const r=t.getBoundingClientRect();return r.width>0?{x:r.left+30,y:r.top+r.height/2}:null})()`), 30_000);
        await sleep(400);
        await realClick(ctx.session.cdp, pt.x, pt.y, { clickCount: 2 });
        await waitFor('daihon input', () => evalOn(ctx.session.cdp, `document.activeElement?.getAttribute('aria-label')==='c-0001 の字幕本文'`), 10_000);
        await ctx.session.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4, commands: ['selectAll'] });
        await ctx.session.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 });
        await ctx.session.cdp.send('Input.insertText', { text: 'これはのアイデアです' });
        await sleep(200);
        await ctx.session.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await ctx.session.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        const notices = await waitFor('notice', async () => { const n = await evalOn(ctx.session.cdp, NOTICES); return n.some(x => x.includes('文字範囲')) ? n : null; }, 15_000);
        const row = await rowOf('c-0001');
        assert(notices.includes('文字範囲 1 件（「最高」）が外れました'), `notices ${S(notices)}`);
        assert(row.text === 'これはのアイデアです' && row.runs?.length === 1 && row.runs[0].from === 4, `row ${S(row)}`);
        await shotWindow(ctx, '10-daihon-notice');
        return { notices, text: row.text, runs: row.runs };
    });

    out.status = out.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
    out.status = 'error';
    out.error = sanitize(error, REPO);
} finally {
    await saveJson(RESULTS, out);
    if (ctx) { ctx.v?.close(); await stop(ctx.session); }
}
console.log(JSON.stringify({ status: out.status, pass: out.checks.filter(c => c.pass).length, total: out.checks.length, failed: out.checks.filter(c => !c.pass).map(c => c.name + ': ' + c.error) }, null, 2));
