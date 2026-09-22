#!/usr/bin/env node
// 置いた文字の実機所見 5 点の L1（ラッパー作成の検証スクリプト）。fixture は gen-fixture.mjs で作る。
// 使い方: node l1.mjs <before|after|rebase|rebase2> <fixture dir> [--port=9447]
// rebase = 最新 main へ rebase した後の再スモーク（after と同じ判定 + 他席の右レール・インスペクター・台本との干渉確認）。
// rebase2 = 再 rebase（他席 P0 × 2 の合流後）の再スモーク。rebase の判定 + クリックで黄色い枠とハンドル / 2 本選択 → 何もない所で両方解除 / 編集中の Backspace。
// 実機の Electron を自分専用のポート・一時ディレクトリで起動し、CDP の実マウス・実キーで操作して実測する。
// before = 変更前ビルドの観測記録（判定はしない）/ after = 受け入れ条件の判定つき。
import { readFile, cp, rm, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { CDP, evalOn, listTargets, realClick, realDragMod } from './cdp-lib.mjs';
import { S, command, launch, sanitize, saveJson, screenshot, sleep, stop, waitEval } from './l1-lib.mjs';

const PHASE = process.argv[2];
if (!['before', 'after', 'rebase', 'rebase2'].includes(PHASE)) throw new Error('phase must be before|after|rebase|rebase2');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
// electron は apps/shell/node_modules に無い配置（ルートへ巻き上げ）もあるので両方を見る。
const ELECTRON_REL = 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
const ELECTRON = existsSync(path.join(SHELL, ELECTRON_REL)) ? path.join(SHELL, ELECTRON_REL) : path.join(REPO, ELECTRON_REL);
const FIXTURE_SRC = path.resolve(process.argv[3] ?? path.join(os.tmpdir(), 'ptfp-l1', 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9447);
const TMP = path.join(os.tmpdir(), 'ptfp-l1');
const RUNS = path.join(TMP, 'runs');
const RESULTS = path.join(ROOT, PHASE.startsWith('rebase') ? `${PHASE}-results.json` : `results-${PHASE}.json`);
const STRICT = PHASE !== 'before';
const out = { phase: PHASE, status: 'running', checks: [], screenshots: [] };
const P1 = 'c-0101';
const TARGETS_LAST = { x: 0.33, y: 0.68 };
const SPOKEN1 = 'c-0001';

const assert = (condition, message) => { if (STRICT && !condition) throw new Error(message); };
async function check(name, operation) {
    const record = { name, pass: false };
    out.checks.push(record);
    try { record.detail = await operation(); record.pass = true; }
    catch (error) { record.error = sanitize(error, REPO); }
    finally { await saveJson(RESULTS, out); }
    return record.detail;
}
async function shot(cdp, name) { await sleep(500); const file = `${PHASE}-${name}.png`; await screenshot(cdp, path.join(ROOT, file)); out.screenshots.push(file); }
const captionsOf = async project => { const p = JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8')); return Array.isArray(p) ? p : p.captions; };
const rowOf = async (project, id) => (await captionsOf(project)).find(c => c.id === id);
async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(250); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const shellCall = body => `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const s=window.theia.container.get(k);${body};return true})()`;

// ---- webview（入れ子 iframe の内側）への到達と座標の対応 ----
async function view(port) {
    let cdp, ctx;
    const attach = async () => {
        cdp?.close(); cdp = undefined;
        // webview は複数ありうる（台本・他のタブ）。#preview-stage を持つ文脈が見つかるまで全ターゲットを回る。
        await waitFor('preview stage', async () => {
            const targets = (await listTargets(port)).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
            for (const target of targets) {
                const client = new CDP(target.webSocketDebuggerUrl);
                try { await client.connect(); } catch { continue; }
                const contexts = []; client.on('Runtime.executionContextCreated', p => contexts.push(p.context));
                try { await client.send('Runtime.enable'); } catch { client.close(); continue; }
                await sleep(300);
                for (const c of [undefined, ...contexts.map(c => c.id)]) {
                    try { if (await evalOn(client, `Boolean(document.getElementById('preview-stage'))`, c)) { cdp = client; ctx = c; return true; } } catch {}
                }
                client.close();
            }
            return false;
        }, 180_000);
    };
    await attach();
    return {
        get cdp() { return cdp; },
        eval: async expr => { try { return await evalOn(cdp, expr, ctx); } catch { await attach(); return evalOn(cdp, expr, ctx); } }
    };
}
// webview 内の clientX/Y → ページ座標の対応（ずれと倍率）を実マウスの 2 点で測る。
async function calibrate(session, v) {
    await v.eval(`(()=>{if(!window.__ptfpHooked){window.__ptfpHooked=true;window.addEventListener('pointermove',e=>window.__ptfpPointer={x:e.clientX,y:e.clientY},true)}return true})()`);
    const frame = await evalOn(session.cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return{left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    const probe = async (x, y) => {
        await v.eval('window.__ptfpPointer=null');
        await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 3, y: y - 3, button: 'none' }); await sleep(80);
        await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(250);
        return waitFor('pointer', () => v.eval('window.__ptfpPointer'));
    };
    const a = { x: Math.round(frame.left + frame.width * 0.3), y: Math.round(frame.top + frame.height * 0.3) };
    const b = { x: Math.round(frame.left + frame.width * 0.7), y: Math.round(frame.top + frame.height * 0.6) };
    const la = await probe(a.x, a.y), lb = await probe(b.x, b.y);
    const sx = (b.x - a.x) / (lb.x - la.x), sy = (b.y - a.y) / (lb.y - la.y);
    return { sx, sy, dx: a.x - la.x * sx, dy: a.y - la.y * sy };
}
const toPage = (off, pt) => ({ x: pt.x * off.sx + off.dx, y: pt.y * off.sy + off.dy });

const FRAME = `(()=>{const c=[...document.querySelectorAll('#preview-stage canvas, #preview-stage video')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>50).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return c?{x:c.x,y:c.y,w:c.width,h:c.height}:null})()`;
const PLATE = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!p)return null;const l=p.querySelector('.akari-caption__line')||p.querySelector('.akari-caption__plate')||p;const r=l.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,cx:r.left+r.width/2,cy:r.top+r.height/2,w:r.width,h:r.height,text:l.textContent,selected:p.hasAttribute('data-selected')}})()`;
// 字幕層の中で outline / border を持つ要素と選択枠を全部拾う（「枠が何本出ているか」の実測）。
const FRAMES_DOM = `(()=>{const px=v=>Math.round(v*100)/100;const rect=e=>{const r=e.getBoundingClientRect();return{left:px(r.left),top:px(r.top),width:px(r.width),height:px(r.height)}};const layer=document.getElementById('caption-plate');const list=[];for(const e of [layer,...layer.querySelectorAll('*')]){const cs=getComputedStyle(e);if(cs.outlineStyle!=='none'&&parseFloat(cs.outlineWidth)>0)list.push({el:(e.id?'#'+e.id:'')+'.'+[...e.classList].join('.'),editing:e.getAttribute('data-akari-caption-editing'),outlineStyle:cs.outlineStyle,outlineWidth:cs.outlineWidth,outlineColor:cs.outlineColor,outlineOffset:cs.outlineOffset,rect:rect(e)})}const box=document.getElementById('caption-select-box');const bcs=getComputedStyle(box);const ed=document.querySelector('[data-akari-caption-editing="true"]');const ecs=ed&&getComputedStyle(ed);return{outlined:list,selectBox:{active:box.classList.contains('is-active'),display:bcs.display,border:bcs.borderTopStyle+' '+bcs.borderTopWidth+' '+bcs.borderTopColor,rect:rect(box)},editing:ed?{el:'.'+[...ed.classList].join('.'),outlineStyle:ecs.outlineStyle,outlineWidth:ecs.outlineWidth,outlineColor:ecs.outlineColor,outlineOffset:ecs.outlineOffset,rect:rect(ed),focused:document.activeElement===ed,text:ed.textContent}:null,layer:{position:getComputedStyle(layer).position,pointerEvents:getComputedStyle(layer).pointerEvents,rect:rect(layer)}}})()`;
const PREVIEW_STATE = `(()=>{const box=document.getElementById('caption-select-box');return{selectBoxActive:box.classList.contains('is-active'),selectedPlates:[...document.querySelectorAll('.caption-row-plate[data-selected]')].map(p=>p.id),editing:Boolean(document.querySelector('[data-akari-caption-editing="true"]'))}})()`;
const HOST_SELECTION = `(()=>({daihonRows:[...document.querySelectorAll('.akari-daihon-row.selected')].map(r=>r.dataset.captionId),daihonPlaced:[...document.querySelectorAll('.akari-daihon-placed-bar.selected, .akari-daihon-placed-tag.selected')].map(e=>e.dataset.captionId||e.getAttribute('data-placed-id')||e.className),timeline:[...document.querySelectorAll('[data-akari-item-kind="caption"]')].filter(e=>[...e.classList].some(c=>/selected/.test(c))).map(e=>e.dataset.akariItemId+':'+[...e.classList].filter(c=>/selected/.test(c)).join('+'))}))()`;

async function openAll(session, project, seek) {
    await evalOn(session.cdp, command('akari.annotations.open'));
    await waitEval(session.cdp, `Boolean(document.querySelector('.akari-annotations-widget, .akari-annotations'))||document.querySelectorAll('[class*="akari-timeline"]').length>0`, { label: 'timeline', timeoutMs: 120_000 });
    await waitFor('preview webview', async () => {
        await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time: seek }));
        await sleep(3000);
        return (await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
    }, 120_000);
    await evalOn(session.cdp, command('akari.daihon.open'));
    await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-row').length>0`, { label: 'daihon rows', timeoutMs: 120_000 });
    await sleep(2500);
    const v = await view(PORT).catch(async error => { await screenshot(session.cdp, path.join(TMP, `fail-${PHASE}.png`)).catch(() => {}); throw error; });
    await waitFor('p1 plate', () => v.eval(PLATE(P1)), 60_000);
    return v;
}
const seek = (session, project, time) => evalOn(session.cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time }));

// 何もない所の候補（どのプレートにも当たらない点）。webview のローカル座標で返す。
const EMPTY_POINTS = `(()=>{const f=${FRAME};const pane=(document.getElementById('preview-pane')||document.body).getBoundingClientRect();const pts={insideFrame:{x:f.x+f.w*0.08,y:f.y+f.h*0.1}};if(f.y-pane.top>24)pts.outsideFrame={x:f.x+f.w/2,y:f.y-10};else if(pane.bottom-(f.y+f.h)>24)pts.outsideFrame={x:f.x+f.w/2,y:f.y+f.h+10};else if(f.x-pane.left>24)pts.outsideFrame={x:f.x-10,y:f.y+f.h/2};for(const[k,p]of Object.entries(pts)){const hit=document.elementFromPoint(p.x,p.y);p.hit=hit?(hit.id?'#'+hit.id:hit.tagName.toLowerCase())+'.'+[...hit.classList].join('.'):null;p.onPlate=Boolean(hit?.closest?.('.caption-row-plate'))}return pts})()`;

// 高負荷の機械でも取りこぼさないドラッグ（終点で数回止まってから離す）。
async function steadyDrag(cdp, from, to) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' }); await sleep(150);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(150);
    for (let s = 1; s <= 16; s++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * s / 16, y: from.y + (to.y - from.y) * s / 16, button: 'left', buttons: 1 });
        await sleep(50);
    }
    for (let i = 0; i < 3; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, button: 'left', buttons: 1 }); await sleep(200); }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0 });
}

// プレートの位置が 3 回続けて変わらなくなるまで待って返す（保存後の再描画・再読込の途中を掴まない）。
async function stablePlate(v, id, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs; let last = null, same = 0;
    while (Date.now() < deadline) {
        const p = await v.eval(PLATE(id));
        if (p && last && Math.abs(p.cx - last.cx) < 0.5 && Math.abs(p.cy - last.cy) < 0.5 && Math.abs(p.w - last.w) < 0.5) { if (++same >= 2) return p; }
        else same = 0;
        last = p; await sleep(300);
    }
    return last;
}

async function clickLocal(session, off, pt, clickCount = 1) { const p = toPage(off, pt); await realClick(session.cdp, p.x, p.y, { clickCount }); }

let fixture;
try {
    await rm(path.join(TMP, `work-${PHASE}`), { recursive: true, force: true });
    await cp(FIXTURE_SRC, path.join(TMP, `work-${PHASE}`), { recursive: true });
    // /var → /private/var のシンボリックリンクを解く（ワークスペース外判定を避ける）。
    fixture = await realpath(path.join(TMP, `work-${PHASE}`, 'polish'));
    let session = await launch({ shellDir: SHELL, electron: ELECTRON, project: fixture, port: PORT, isoDir: path.join(RUNS, `${PHASE}-1`) });
    // 字幕の読込失敗（hiding captions）などプレビューの警告を記録する。
    out.previewWarnings = [];
    session.cdp.on('Runtime.consoleAPICalled', p => {
        if (p.type !== 'warning' && p.type !== 'error') return;
        const text = p.args.map(a => a.value ?? a.description ?? '').join(' ');
        if (/akari-preview/.test(text)) out.previewWarnings.push(sanitize(text.slice(0, 300), REPO));
    });
    try {
        await seek(session, fixture, 1).catch(() => {});
        const v = await openAll(session, fixture, 1);
        // 台本は右パネルにあるので閉じない。左パネル（プロジェクト）だけ畳んでプレビューを広げる。
        await evalOn(session.cdp, shellCall(`s.collapsePanel('left')`)).catch(() => {});
        await sleep(3000);
        let off = await calibrate(session, v);
        out.calibration = off;

        // ===== §4 タイムラインの T ボタン / 台本の T ボタン =====
        await check('§4 タイムラインのツールバーに「T 文字を置く」が無い', async () => {
            const m = await evalOn(session.cdp, `({timelineButton:[...document.querySelectorAll('.akari-timeline-place-text')].map(b=>b.textContent.trim()),timelineTextMatches:[...document.querySelectorAll('button')].filter(b=>/文字を置く/.test(b.textContent)&&!b.closest('.akari-daihon-widget')).map(b=>b.textContent.trim()),daihonButton:[...document.querySelectorAll('.akari-daihon-place-text')].map(b=>(b.textContent||b.title||'').trim())})`);
            assert(m.timelineButton.length === 0 && m.timelineTextMatches.length === 0, S(m));
            return m;
        });

        // ===== §0/§1 ダブルクリック編集中の枠 =====
        const frame = await v.eval(FRAME);
        out.frame = frame;
        await check('§0/§1 置いた文字をダブルクリック → 枠の実測', async () => {
            const plate = await v.eval(PLATE(P1));
            await clickLocal(session, off, { x: plate.cx, y: plate.cy }, 2);
            await waitFor('editing', () => v.eval(`Boolean(document.querySelector('[data-akari-caption-editing="true"]'))`), 10_000);
            await sleep(400);
            const m = await v.eval(FRAMES_DOM);
            const extra = m.outlined.filter(o => true);
            if (STRICT) {
                assert(m.editing && (m.editing.outlineStyle === 'none'
                    || ['left', 'top', 'width', 'height'].every(k => Math.abs(m.editing.rect[k] - m.selectBox.rect[k]) <= 1)), `editing outline ${S(m.editing)}`);
                assert(extra.length === 0, `outlined elements remain ${S(extra)}`);
                assert(m.selectBox.active, 'select box inactive');
            }
            return m;
        });
        await shot(session.cdp, '01-dblclick-editing');

        // ===== §2 枠と枠の間 / 何もない所のクリック =====
        const empties = await v.eval(EMPTY_POINTS);
        out.emptyPoints = empties;
        await check('§0/§2 編集中に「選択枠のすぐ外（枠と枠の間）」をクリック', async () => {
            const m = await v.eval(FRAMES_DOM);
            const pt = { x: m.selectBox.rect.left - 2.5, y: m.selectBox.rect.top + m.selectBox.rect.height / 2 };
            const hit = await v.eval(`(()=>{const h=document.elementFromPoint(${pt.x},${pt.y});return h?(h.id?'#'+h.id:h.tagName.toLowerCase())+'.'+[...h.classList].join('.'):null})()`);
            await clickLocal(session, off, pt);
            await sleep(700);
            const state = await v.eval(PREVIEW_STATE);
            return { point: pt, hit, state };
        });
        await check('§0/§2 編集中に文字を足してから、フレーム内の何もない所を 1 回クリック → 確定 + 選択解除', async () => {
            let state = await v.eval(PREVIEW_STATE);
            if (!state.editing) {
                const plate = await v.eval(PLATE(P1));
                await clickLocal(session, off, { x: plate.cx, y: plate.cy }, 2);
                await waitFor('editing again', () => v.eval(`Boolean(document.querySelector('[data-akari-caption-editing="true"]'))`), 10_000);
            }
            await session.cdp.send('Input.insertText', { text: '★' });
            await sleep(300);
            const before = await v.eval(PREVIEW_STATE);
            const hostBefore = await evalOn(session.cdp, HOST_SELECTION);
            await clickLocal(session, off, empties.insideFrame);
            await sleep(1200);
            state = await v.eval(PREVIEW_STATE);
            const host = await evalOn(session.cdp, HOST_SELECTION);
            const row = await waitFor('text committed', async () => { const r = await rowOf(fixture, P1); return r.text.endsWith('★') ? r : (STRICT ? null : r); }, STRICT ? 10_000 : 3_000).catch(async () => rowOf(fixture, P1));
            assert(row.text.endsWith('★'), `not committed: ${row.text}`);
            assert(!state.editing && !state.selectBoxActive && state.selectedPlates.length === 0, `still selected ${S(state)}`);
            assert(host.daihonRows.length === 0 && host.daihonPlaced.length === 0 && host.timeline.length === 0, `host selection ${S(host)}`);
            return { point: empties.insideFrame, before, hostBefore, after: state, hostAfter: host, savedText: row.text };
        });
        await shot(session.cdp, '02-after-empty-click-editing');
        await check('§0/§2 選択中（編集なし）に何もない所をクリック（フレーム内 / フレーム外）', async () => {
            const results = {};
            for (const [key, pt] of Object.entries(empties)) {
                const plate = await v.eval(PLATE(P1));
                await clickLocal(session, off, { x: plate.cx, y: plate.cy });
                await sleep(700);
                const selected = await v.eval(PREVIEW_STATE);
                const hostSelected = await evalOn(session.cdp, HOST_SELECTION);
                await clickLocal(session, off, pt);
                await sleep(900);
                const after = await v.eval(PREVIEW_STATE);
                const host = await evalOn(session.cdp, HOST_SELECTION);
                results[key] = { point: pt, selected, hostSelected, after, hostAfter: host };
                assert(selected.selectBoxActive, `${key}: not selected first ${S(selected)}`);
                assert(!after.selectBoxActive && after.selectedPlates.length === 0, `${key}: still selected ${S(after)}`);
                assert(host.daihonRows.length === 0 && host.daihonPlaced.length === 0 && host.timeline.length === 0, `${key}: host selection ${S(host)}`);
            }
            return results;
        });
        if (PHASE === 'rebase2') {
            // ===== rebase2: 他席 P0（字幕ハンドルの退行修正・文字編集中のキー閉じ込め）と本タスクの組み合わせ =====
            const HANDLES = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!p)return null;const t=p.querySelector('.akari-caption__plate')||p;const cs=getComputedStyle(p.classList.contains('akari-caption-host--styled')?t:p);const hs=[...p.querySelectorAll('.akari-caption-handle')].map(h=>{const r=h.getBoundingClientRect();const c=getComputedStyle(h);return{kind:h.getAttribute('data-h'),w:Math.round(r.width),h:Math.round(r.height),display:c.display,visibility:c.visibility,border:c.borderTopColor}});return{selected:p.hasAttribute('data-selected'),outline:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor,handles:hs}})()`;
            await check('rebase2 他席 P0 の回帰なし: 置いた文字をクリック → 黄色い枠とハンドルが出る', async () => {
                const plate = await stablePlate(v, P1);
                await clickLocal(session, off, { x: plate.cx, y: plate.cy });
                await sleep(800);
                const state = await v.eval(PREVIEW_STATE);
                const m = await v.eval(HANDLES(P1));
                const visible = m.handles.filter(h => h.w > 0 && h.h > 0 && h.display !== 'none' && h.visibility !== 'hidden');
                assert(state.selectBoxActive && m.selected, `not selected ${S({ state, m })}`);
                assert(/solid/.test(m.outline) && /245, 196, 81/.test(m.outline), `yellow outline ${m.outline}`);
                assert(visible.length === 5 && ['nw', 'ne', 'sw', 'se', 'rot'].every(k => visible.some(h => h.kind === k)), `handles ${S(m.handles)}`);
                await shot(session.cdp, '10-click-handles');
                await clickLocal(session, off, empties.insideFrame); await sleep(700);
                return { state, ...m };
            });
            await check('rebase2 2 本（話した言葉の字幕 + 置いた文字）を選ぶ → 何もない所を 1 回クリックで両方解除', async () => {
                const attempts = [];
                const twoSelected = async () => { const st = await v.eval(PREVIEW_STATE); return st.selectedPlates.length >= 2 ? st : null; };
                const clearAll = async () => { await clickLocal(session, off, empties.insideFrame); await sleep(700); };
                // (a) プレビューで Shift クリック
                const pp = await stablePlate(v, P1), sp = await stablePlate(v, SPOKEN1);
                await clickLocal(session, off, { x: pp.cx, y: pp.cy }); await sleep(600);
                { const q = toPage(off, { x: sp.cx, y: sp.cy }); await realClick(session.cdp, q.x, q.y, { modifiers: 8 }); }
                await sleep(900);
                let state = await twoSelected();
                attempts.push({ path: 'preview Shift+click', preview: await v.eval(PREVIEW_STATE), host: await evalOn(session.cdp, HOST_SELECTION) });
                // (b) タイムラインで Shift クリック（字幕の項目）
                if (!state) {
                    await clearAll();
                    // 2 本は同じ時刻から始まるので、実際にその項目が当たる点を項目の矩形の中から探す。
                    const itemPoint = id => `(()=>{const e=[...document.querySelectorAll('[data-akari-item-kind="caption"]')].find(e=>e.dataset.akariItemId===${S(id)});if(!e)return null;e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();if(r.width<2||r.height<2)return null;for(const fy of [.5,.3,.7,.15,.85])for(const fx of [.5,.3,.7,.15,.85,.05,.95]){const x=r.left+r.width*fx,y=r.top+r.height*fy;const h=document.elementFromPoint(x,y)?.closest?.('[data-akari-item-kind="caption"]');if(h&&h.dataset.akariItemId===${S(id)})return{x,y,rect:{l:r.left,t:r.top,w:r.width,h:r.height}}}return{miss:true,rect:{l:r.left,t:r.top,w:r.width,h:r.height}}})()`;
                    const a = await evalOn(session.cdp, itemPoint(SPOKEN1)), b = await evalOn(session.cdp, itemPoint(P1));
                    if (a && b && !a.miss && !b.miss) {
                        await realClick(session.cdp, a.x, a.y); await sleep(600);
                        await realClick(session.cdp, b.x, b.y, { modifiers: 8 }); await sleep(1200);
                        state = await twoSelected();
                    }
                    attempts.push({ path: 'timeline Shift+click', points: { a, b }, preview: await v.eval(PREVIEW_STATE), host: await evalOn(session.cdp, HOST_SELECTION) });
                }
                // (c) 台本で行を選び、置いた文字のバーを Shift クリック
                if (!state) {
                    await clearAll();
                    const rowPt = await evalOn(session.cdp, `(()=>{const r=document.querySelector('.akari-daihon-row[data-caption-id=${S(SPOKEN1)}] .akari-daihon-row-text');r.scrollIntoView({block:'center'});const b=r.getBoundingClientRect();return{x:b.right-4,y:b.top+b.height/2}})()`);
                    await realClick(session.cdp, rowPt.x, rowPt.y, { modifiers: 4 }); await sleep(700);
                    const barPt = await evalOn(session.cdp, `(()=>{const b=[...document.querySelectorAll('.akari-daihon-placed-bar')].find(b=>(b.dataset.captionId||b.dataset.placedId)===${S(P1)});if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
                    if (barPt) { await realClick(session.cdp, barPt.x, barPt.y, { modifiers: 8 }); await sleep(1200); }
                    state = await twoSelected();
                    attempts.push({ path: 'daihon Cmd+click row + Shift+click placed bar', preview: await v.eval(PREVIEW_STATE), host: await evalOn(session.cdp, HOST_SELECTION) });
                    if (!state && barPt) {
                        await realClick(session.cdp, barPt.x, barPt.y, { modifiers: 4 }); await sleep(1200);
                        state = await twoSelected();
                        attempts.push({ path: 'daihon Cmd+click row + Cmd+click placed bar', preview: await v.eval(PREVIEW_STATE), host: await evalOn(session.cdp, HOST_SELECTION) });
                    }
                }
                // (d) 実 UI で 2 本にならない場合: 他席 P0 の L1 と同じく、台本の選択通知（ホストのイベント）で 2 本を選ばせる。
                //     解除はこのあと実マウスの空クリックで行う（判定の対象はそちら）。
                if (!state) {
                    await clearAll();
                    const editUri = `file://${path.join(fixture, 'edit.json')}`;
                    await evalOn(session.cdp, `window.dispatchEvent(new CustomEvent('akari.daihon.selectionChanged',{detail:${S({ editUri, captionIds: [SPOKEN1, P1] })}}))`);
                    await sleep(500);
                    await evalOn(session.cdp, `window.dispatchEvent(new CustomEvent('akari.timeline.primarySelected',{detail:${S({ editUri, selection: { kind: 'caption', id: P1 } })}}))`);
                    await sleep(1200);
                    state = await twoSelected();
                    attempts.push({ path: 'host event akari.daihon.selectionChanged [spoken, placed] + primarySelected(placed)（計装）', preview: await v.eval(PREVIEW_STATE), host: await evalOn(session.cdp, HOST_SELECTION) });
                }
                assert(state, `2 本選択にならない ${S(attempts)}`);
                const handlesTwo = { spoken: await v.eval(HANDLES(SPOKEN1)), placed: await v.eval(HANDLES(P1)) };
                const host = await evalOn(session.cdp, HOST_SELECTION);
                await shot(session.cdp, '11-two-selected');
                await clickLocal(session, off, empties.insideFrame);
                await sleep(1200);
                const after = await v.eval(PREVIEW_STATE);
                const hostAfter = await evalOn(session.cdp, HOST_SELECTION);
                assert(!after.selectBoxActive && after.selectedPlates.length === 0, `still selected ${S(after)}`);
                const synthetic = attempts.at(-1).path.startsWith('host event');
                // 計装で 2 本にした場合、台本自身は選択を持っていない（イベントだけ）ので、タイムラインへ写った分は台本の解除通知では消えない。
                // その場合はプレビューと台本だけを判定し、タイムラインの残りは記録する（実 UI の経路は次の項目で判定する）。
                assert(hostAfter.daihonRows.length === 0 && hostAfter.daihonPlaced.length === 0 && (synthetic || hostAfter.timeline.length === 0), `host selection ${S(hostAfter)}`);
                await shot(session.cdp, '12-two-released');
                const handlesAfter = { spoken: await v.eval(HANDLES(SPOKEN1)), placed: await v.eval(HANDLES(P1)) };
                assert(!handlesAfter.spoken.selected && !handlesAfter.placed.selected && handlesAfter.spoken.handles.length === 0 && handlesAfter.placed.handles.length === 0, `handles remain ${S(handlesAfter)}`);
                return { usedPath: attempts.at(-1).path, attempts, selected: state, handlesTwo, hostSelected: host, after, hostAfter, handlesAfter, timelineResidueFromSyntheticEvent: synthetic ? hostAfter.timeline : null };
            });
            await check('rebase2 実 UI: 台本で話した言葉の行を選ぶ（ホスト発の選択）→ プレビューの何もない所を 1 回クリックで解除', async () => {
                const editUri = `file://${path.join(fixture, 'edit.json')}`;
                // 前の項目の計装の残り（タイムラインの字幕選択）を外してから始める。
                await evalOn(session.cdp, `window.dispatchEvent(new CustomEvent('akari.daihon.selectionChanged',{detail:${S({ editUri, captionIds: [] })}}))`);
                await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
                await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
                await sleep(800);
                const start = await evalOn(session.cdp, HOST_SELECTION);
                const rowPt = await evalOn(session.cdp, `(()=>{const r=document.querySelector('.akari-daihon-row[data-caption-id=${S(SPOKEN1)}] .akari-daihon-row-text');r.scrollIntoView({block:'center'});const b=r.getBoundingClientRect();return{x:b.right-4,y:b.top+b.height/2}})()`);
                await realClick(session.cdp, rowPt.x, rowPt.y, { modifiers: 4 });
                await sleep(1200);
                const selected = await v.eval(PREVIEW_STATE);
                const hostSelected = await evalOn(session.cdp, HOST_SELECTION);
                const handles = await v.eval(HANDLES(SPOKEN1));
                await clickLocal(session, off, empties.insideFrame);
                await sleep(1200);
                const after = await v.eval(PREVIEW_STATE);
                const hostAfter = await evalOn(session.cdp, HOST_SELECTION);
                const handlesAfter = await v.eval(HANDLES(SPOKEN1));
                assert(hostSelected.daihonRows.includes(SPOKEN1) && selected.selectedPlates.length >= 1, `not selected first ${S({ selected, hostSelected })}`);
                assert(after.selectedPlates.length === 0 && !after.selectBoxActive && !handlesAfter.selected && handlesAfter.handles.length === 0, `preview still selected ${S({ after, handlesAfter })}`);
                assert(hostAfter.daihonRows.length === 0 && hostAfter.daihonPlaced.length === 0 && hostAfter.timeline.length === 0, `host selection ${S(hostAfter)}`);
                return { start, selected, hostSelected, handles, after, hostAfter, handlesAfter };
            });
            await check('rebase2 他席 P0: 編集中の Backspace は文字だけ消し、アイテムは消えない', async () => {
                const beforeRows = await captionsOf(fixture);
                const beforeText = beforeRows.find(c => c.id === P1).text;
                const beforeEdit = await readFile(path.join(fixture, 'edit.json'), 'utf8');
                const plate = await stablePlate(v, P1);
                await clickLocal(session, off, { x: plate.cx, y: plate.cy }, 2);
                await waitFor('editing', () => v.eval(`Boolean(document.querySelector('[data-akari-caption-editing="true"]'))`), 10_000);
                await sleep(400);
                // ダブルクリックで語が選ばれている場合があるので、行末へ caret を置いてから 1 回だけ Backspace。
                await v.eval(`(()=>{const e=document.querySelector('[data-akari-caption-editing="true"]');const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);return true})()`);
                const editingBefore = await v.eval(`document.querySelector('[data-akari-caption-editing="true"]').textContent`);
                const focusBefore = await v.eval(`(()=>{const e=document.querySelector('[data-akari-caption-editing="true"]');return document.activeElement===e})()`);
                await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
                await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
                // Backspace 直後の編集状態を 100ms 刻みで 1.5 秒追う（編集が閉じるか・いつ閉じるか）。
                const EDIT_PROBE = `(()=>{const e=document.querySelector('[data-akari-caption-editing="true"]');const a=document.activeElement;return{editing:e?e.textContent:null,focused:Boolean(e&&a===e),active:a?(a.id?'#'+a.id:a.tagName.toLowerCase())+'.'+[...a.classList].join('.'):null,plate:(()=>{const p=[...document.querySelectorAll('.caption-row-plate')].find(x=>x.id.startsWith('caption-plate-'+${S(P1)}));return p?p.textContent:null})()}})()`;
                const timeline = [];
                const t0 = Date.now();
                for (let i = 0; i < 15; i++) { timeline.push({ ms: Date.now() - t0, ...(await v.eval(EDIT_PROBE)) }); await sleep(100); }
                const editingAfter = timeline[0].editing;
                const plateStill = await v.eval(PLATE(P1));
                await clickLocal(session, off, empties.insideFrame);
                await sleep(1200);
                const afterRows = await waitFor('committed', async () => { const rows = await captionsOf(fixture); const r = rows.find(c => c.id === P1); return r && r.text !== beforeText ? rows : null; }, 10_000).catch(() => captionsOf(fixture));
                const afterEdit = await readFile(path.join(fixture, 'edit.json'), 'utf8');
                const row = afterRows.find(c => c.id === P1);
                assert(editingAfter === editingBefore.slice(0, -1), `editing text ${S({ editingBefore, editingAfter })}`);
                assert(plateStill && row, `item removed ${S({ plateStill: Boolean(plateStill), row })}`);
                assert(afterRows.length === beforeRows.length, `captions count ${beforeRows.length} → ${afterRows.length}`);
                assert(row.text === beforeText.slice(0, -1), `saved text ${S({ beforeText, saved: row.text })}`);
                assert(afterEdit === beforeEdit, 'edit.json changed');
                return { beforeText, editingBefore, focusBefore, editingAfter, afterBackspace: timeline, editingStillOpenAt1500ms: timeline.at(-1).editing !== null, savedText: row.text, captionsCount: { before: beforeRows.length, after: afterRows.length }, editJsonUnchanged: afterEdit === beforeEdit };
            });
        }
        await check('§2 回帰: 何も選んでいないときにフレーム内をクリックすると従来どおりカットが選ばれる（記録）', async () => {
            await clickLocal(session, off, empties.insideFrame); await sleep(900);
            const first = await v.eval(`(()=>({cut:document.getElementById('cut-select-box')?.classList.contains('is-active')??null,caption:document.getElementById('caption-select-box').classList.contains('is-active')}))()`);
            await clickLocal(session, off, empties.insideFrame); await sleep(900);
            const second = await v.eval(`(()=>({cut:document.getElementById('cut-select-box')?.classList.contains('is-active')??null,caption:document.getElementById('caption-select-box').classList.contains('is-active')}))()`);
            // 選択を外しておく（Escape）。
            await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await sleep(500);
            return { firstClick: first, secondClick: second };
        });
        // ===== §6 置いた文字のドラッグ =====
        const TARGETS = [
            { name: '中央付近', x: 0.52, y: 0.46 },
            { name: '左上', x: 0.16, y: 0.12 },
            { name: '右端', x: 0.86, y: 0.5 },
            { name: '下端付近', x: 0.14, y: 0.9 },
            { name: '任意', x: 0.33, y: 0.68 }
        ];
        const drags = [];
        await check('§6 置いた文字を 5 か所へドラッグ → 落とした位置（±1%）で保存・描画', async () => {
            for (const target of TARGETS) {
                const fr = await v.eval(FRAME);
                const plate = await stablePlate(v, P1);
                const before = await rowOf(fixture, P1);
                const drop = { x: fr.x + fr.w * target.x, y: fr.y + fr.h * target.y };
                await steadyDrag(session.cdp, toPage(off, { x: plate.cx, y: plate.cy }), toPage(off, drop));
                const row = await waitFor('saved', async () => { const r = await rowOf(fixture, P1); return S(r.text_style) !== S(before.text_style) && r; }, 8_000).catch(() => rowOf(fixture, P1));
                // 保存後の再描画が落ち着くまで待つ（2 回続けて同じ位置になるまで）。
                let after = await v.eval(PLATE(P1));
                for (let i = 0; i < 20; i++) { await sleep(400); const next = await v.eval(PLATE(P1)); if (Math.abs(next.cx - after.cx) < 0.5 && Math.abs(next.cy - after.cy) < 0.5 && i >= 2) { after = next; break; } after = next; }
                const rendered = { x: round((after.cx - fr.x) / fr.w), y: round((after.cy - fr.y) / fr.h) };
                const style = row.text_style ?? {};
                // 描画系の mc は「x = 左端・y = 縦の中心」（初期 x:0.5 の文字の左端がフレーム中央に来ることを BEFORE で実測）。
                // 落とした位置での左端 = 落とした中心 − 幅/2 を期待値にする。
                const halfW = (after.w / fr.w) / 2;
                const expectedSaved = { x: round(target.x - halfW), y: target.y };
                const record = { target: target.name, drop: { x: target.x, y: target.y }, plateTextAtGrab: plate.text, plateTextAfter: after.text, savedText: row.text, plateWidthRatio: round(after.w / fr.w), saved: style, expectedSaved, rendered,
                    renderedError: { x: round(rendered.x - target.x), y: round(rendered.y - target.y) } };
                if (style.position) record.savedError = { x: round((style.position.x ?? NaN) - expectedSaved.x), y: round(style.position.y - expectedSaved.y) };
                drags.push(record);
                out.drags = drags;
                await saveJson(RESULTS, out);
                // 次のドラッグの前に選択を外す（その時点でどのプレートにも当たらない点をクリック）。
                const free = await v.eval(`(()=>{const f=${FRAME};for(const[x,y]of[[.92,.08],[.08,.1],[.6,.25],[.9,.3],[.3,.3]]){const p={x:f.x+f.w*x,y:f.y+f.h*y};const h=document.elementFromPoint(p.x,p.y);if(h&&!h.closest('.caption-row-plate, #caption-select-box'))return p}return null})()`);
                await clickLocal(session, off, free); await sleep(500);
                const shotName = `03-drag-${TARGETS.indexOf(target) + 1}`;
                if (TARGETS.indexOf(target) === 2) await shot(session.cdp, shotName);
            }
            for (const d of drags) {
                assert(d.saved.text_anchor === 'mc', `${d.target}: anchor ${d.saved.text_anchor}`);
                assert(d.savedError && Math.abs(d.savedError.x) <= 0.01 && Math.abs(d.savedError.y) <= 0.01, `${d.target}: saved ${S(d.saved)}`);
                assert(Math.abs(d.renderedError.x) <= 0.01 && Math.abs(d.renderedError.y) <= 0.01, `${d.target}: rendered ${S(d.rendered)}`);
            }
            return drags;
        });
        await check('§6 置いた文字の選択中チップ（はみ出し防止）の表示', async () => {
            const plate = await v.eval(PLATE(P1));
            await clickLocal(session, off, { x: plate.cx, y: plate.cy }); await sleep(600);
            const chip = await v.eval(`(()=>{const c=document.querySelector('#caption-select-box .akari-caption-clamp-chip');return c?{text:c.textContent.trim(),on:c.classList.contains('on'),display:getComputedStyle(c).display}:null})()`);
            await clickLocal(session, off, empties.insideFrame); await sleep(500);
            assert(chip && !chip.on, `chip ${S(chip)}`);
            return chip;
        });
        await check('§6 回帰: 話した言葉の字幕のドラッグ（中央揃え・はみ出し防止）', async () => {
            const fr = await v.eval(FRAME);
            const plate = await stablePlate(v, SPOKEN1);
            const before = await rowOf(fixture, SPOKEN1);
            // 中央から 2% 右・少し上へ → 中央吸着で x を持たない / 右端のはるか外へ → はみ出し防止で枠内。
            await realDragMod(session.cdp, [toPage(off, { x: plate.cx, y: plate.cy }), toPage(off, { x: plate.cx + fr.w * 0.02, y: plate.cy - fr.h * 0.1 })], { steps: 12, stepDelayMs: 30 });
            const r1 = await waitFor('spoken saved', async () => { const r = await rowOf(fixture, SPOKEN1); return S(r.text_style) !== S(before.text_style) && r; }, 8_000).catch(() => rowOf(fixture, SPOKEN1));
            await sleep(800);
            await clickLocal(session, off, empties.insideFrame); await sleep(500);
            const p2 = await stablePlate(v, SPOKEN1);
            await realDragMod(session.cdp, [toPage(off, { x: p2.cx, y: p2.cy }), toPage(off, { x: fr.x + fr.w * 1.05, y: p2.cy })], { steps: 12, stepDelayMs: 30 });
            const r2 = await waitFor('spoken saved 2', async () => { const r = await rowOf(fixture, SPOKEN1); return S(r.text_style) !== S(r1.text_style) && r; }, 8_000).catch(() => rowOf(fixture, SPOKEN1));
            await sleep(800);
            const p3 = await stablePlate(v, SPOKEN1);
            await clickLocal(session, off, empties.insideFrame); await sleep(500);
            const nearCenter = r1.text_style, farRight = r2.text_style;
            assert(nearCenter?.position && nearCenter.position.x === undefined, `near center keeps x: ${S({ nearCenter, plate, frame: fr })}`);
            assert(p3.right <= fr.x + fr.w + 1, `spoken plate outside frame ${S(p3)}`);
            return { nearCenter, farRight, farRightPlateRightRatio: round((p3.right - fr.x) / fr.w) };
        });

        await check('§2 回帰: 話した言葉の字幕もクリック選択 → 何もない所で解除 / ダブルクリック編集が開く', async () => {
            const plate = await stablePlate(v, SPOKEN1);
            await clickLocal(session, off, { x: plate.cx, y: plate.cy });
            await sleep(700);
            const selected = await v.eval(PREVIEW_STATE);
            await clickLocal(session, off, empties.insideFrame);
            await sleep(900);
            const after = await v.eval(PREVIEW_STATE);
            await clickLocal(session, off, { x: plate.cx, y: plate.cy }, 2);
            const editing = await waitFor('spoken editing', () => v.eval(`Boolean(document.querySelector('[data-akari-caption-editing="true"]'))`), 10_000).catch(() => false);
            await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await sleep(600);
            await clickLocal(session, off, empties.insideFrame);
            await sleep(600);
            assert(selected.selectBoxActive && !after.selectBoxActive && editing, S({ selected, after, editing }));
            return { selected, after, dblclickEditing: editing };
        });

        // ===== §3 台本の行とバー =====
        await seek(session, fixture, 1); await sleep(1500);
        const ROW_CSS = id => `(()=>{const r=document.querySelector('.akari-daihon-row[data-caption-id=${S(id)}]');const cs=getComputedStyle(r);const b=getComputedStyle(r,'::before');const a=getComputedStyle(r,'::after');const pseudo=x=>({content:x.content,width:x.width,height:x.height,borderRadius:x.borderRadius,background:x.backgroundColor,left:x.left,top:x.top,bottom:x.bottom});return{classes:r.className,borderLeftWidth:cs.borderLeftWidth,borderLeftColor:cs.borderLeftColor,borderLeftStyle:cs.borderLeftStyle,borderRadius:cs.borderRadius,boxShadow:cs.boxShadow,background:cs.backgroundColor,outline:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor,before:pseudo(b),after:pseudo(a)}})()`;
        await check('§3 台本: 再生中の行（.active）の目印', async () => {
            const m = await waitFor('active row', async () => { const x = await evalOn(session.cdp, ROW_CSS(SPOKEN1)); return x.classes.includes('active') && x; }, 15_000);
            const transparent = m.borderLeftColor === 'rgba(0, 0, 0, 0)' || m.borderLeftWidth === '0px' || m.borderLeftStyle === 'none';
            assert(transparent, `active border-left ${S(m)}`);
            return m;
        });
        await check('§3 台本: 選択中かつ再生中（.selected.active）', async () => {
            // 行の選択は ⌘クリック（追加選択）で行う（本文クリックは単語シークになるため）。
            const pt = await evalOn(session.cdp, `(()=>{const r=document.querySelector('.akari-daihon-row[data-caption-id=${S(SPOKEN1)}] .akari-daihon-row-text');r.scrollIntoView({block:'center'});const b=r.getBoundingClientRect();return{x:b.right-4,y:b.top+b.height/2}})()`);
            await realClick(session.cdp, pt.x, pt.y, { modifiers: 4 });
            const m = await waitFor('selected active', async () => { const x = await evalOn(session.cdp, ROW_CSS(SPOKEN1)); return x.classes.includes('selected') && x.classes.includes('active') && x; }, 10_000);
            assert(m.boxShadow === 'none', `selected.active box-shadow ${m.boxShadow}`);
            const transparent = m.borderLeftColor === 'rgba(0, 0, 0, 0)' || m.borderLeftWidth === '0px' || m.borderLeftStyle === 'none';
            assert(transparent, `selected.active border-left ${S(m)}`);
            return m;
        });
        await shot(session.cdp, '04-daihon-active-selected');
        const BARS = `[...document.querySelectorAll('.akari-daihon-placed-bar')].map(b=>{const cs=getComputedStyle(b);const row=b.closest('.akari-daihon-row');const r=b.getBoundingClientRect();const rr=row.getBoundingClientRect();return{row:row?.dataset.captionId,id:b.dataset.captionId||b.dataset.placedId||null,classes:b.className,top:cs.top,bottom:cs.bottom,width:cs.width,borderRadius:cs.borderRadius,boxShadow:cs.boxShadow,outline:cs.outlineStyle,opacity:cs.opacity,filter:cs.filter,background:cs.backgroundColor,insetTop:Math.round((r.top-rr.top)*100)/100,insetBottom:Math.round((rr.bottom-r.bottom)*100)/100,height:Math.round(r.height*100)/100,rowHeight:Math.round(rr.height*100)/100}})`;
        await check('§3 置いた文字のバー: 直線の棒（top/bottom 0・角丸 0・幅 4px）', async () => {
            // 行の選択を外す（Escape）。
            await evalOn(session.cdp, `(()=>{document.activeElement?.blur?.();return true})()`);
            const bars = await evalOn(session.cdp, BARS);
            const bad = bars.filter(b => b.top !== '0px' || b.bottom !== '0px' || b.borderRadius !== '0px' || b.width !== '4px');
            assert(bars.length > 0 && bad.length === 0, `bars ${S(bad.slice(0, 4))}`);
            return { count: bars.length, bars };
        });
        await check('§3 置いた文字のバー: 選択中も角丸・リングなし（太さか明るさで示す）', async () => {
            const pt = await evalOn(session.cdp, `(()=>{const b=document.querySelector('.akari-daihon-row[data-caption-id="c-0003"] .akari-daihon-placed-bar')||document.querySelector('.akari-daihon-placed-bar');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
            await realClick(session.cdp, pt.x, pt.y);
            await sleep(900);
            const bars = await evalOn(session.cdp, BARS);
            const selected = bars.filter(b => /\bselected\b/.test(b.classes));
            const normal = bars.find(b => !/\bselected\b/.test(b.classes));
            assert(selected.length > 0, 'no selected bar');
            assert(selected.every(b => b.boxShadow === 'none' && b.borderRadius === '0px' && b.top === '0px' && b.bottom === '0px'), `selected bars ${S(selected)}`);
            assert(selected.every(b => b.width !== normal.width || b.opacity !== normal.opacity || b.filter !== normal.filter || b.background !== normal.background), `selected not distinguished ${S({ selected: selected[0], normal })}`);
            return { selected, normalSample: normal };
        });
        await shot(session.cdp, '05-daihon-bar-selected');

        // ===== §4 台本の T ボタンは従来どおり → §5 色 =====
        await check('§4 台本の「T この行から文字を置く」は従来どおり動く（10 本目を置く）', async () => {
            const beforeCount = (await captionsOf(fixture)).filter(c => c.time_domain === 'output').length;
            // 行の選択 = 行の「操作要素でない所」を ⌘クリック（語・札・ボタンの上は行クリックにならない）。
            await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await sleep(300);
            const ROW_POINTS = id => `(()=>{const row=document.querySelector('.akari-daihon-row[data-caption-id='+${S(S(id))}+']');row.scrollIntoView({block:'center'});const r=row.getBoundingClientRect();const I=${S('.akari-daihon-placed-bar, .akari-daihon-placed-tag, .akari-daihon-speaker, button, .akari-daihon-word, .akari-daihon-word-unk, input, .akari-daihon-gapchip, .akari-daihon-gapzone, .akari-daihon-wgap, .akari-daihon-wordbar')};const cands=[{x:r.right-6,y:r.bottom-4},{x:r.right-6,y:r.top+6},{x:r.left+r.width*0.8,y:r.top+r.height/2},{x:r.right-30,y:r.top+r.height/2}];return cands.map(p=>{const h=document.elementFromPoint(p.x,p.y);return{...p,hit:h?h.className:null,ok:Boolean(h&&row.contains(h)&&!h.closest(I))}})})()`;
            const tried = [];
            let selectedRows = [];
            const rowSelected = async () => evalOn(session.cdp, `[...document.querySelectorAll('.akari-daihon-row.selected')].map(r=>r.dataset.captionId)`);
            for (let i = 0; i < 4; i++) {
                selectedRows = await rowSelected();
                if (selectedRows.length === 1 && selectedRows[0] === 'c-0008') break;
                for (const id of selectedRows.filter(x => x !== 'c-0008')) {
                    const q = (await evalOn(session.cdp, ROW_POINTS(id))).find(p => p.ok);
                    if (q) { await realClick(session.cdp, q.x, q.y, { modifiers: 4 }); await sleep(500); }
                }
                selectedRows = await rowSelected();
                if (!selectedRows.includes('c-0008')) {
                    const pts = await evalOn(session.cdp, ROW_POINTS('c-0008'));
                    const q = pts.find(p => p.ok) ?? pts[0];
                    tried.push(q);
                    await realClick(session.cdp, q.x, q.y, { modifiers: 4 }); await sleep(700);
                }
            }
            selectedRows = await rowSelected();
            const btn = await evalOn(session.cdp, `(()=>{const b=document.querySelector('.akari-daihon-place-text');if(!b)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,text:b.textContent.trim()}})()`);
            await realClick(session.cdp, btn.x, btn.y);
            const diag = { selectedRows, button: btn.text, tried };
            const placed = await waitFor('placed row', async () => { const list = (await captionsOf(fixture)).filter(c => c.time_domain === 'output'); return list.length > beforeCount && list; }, 15_000)
                .catch(async error => { diag.notices = await evalOn(session.cdp, `[...document.querySelectorAll('.theia-notification-list-item')].map(e=>e.textContent.trim())`); await shot(session.cdp, '06x-place-text-failed'); throw new Error(`${error.message} ${S(diag)}`); });
            const originalIds = new Set(Array.from({ length: 9 }, (_, i) => `c-${String(i + 101).padStart(4, '0')}`));
            const added = placed.find(c => !originalIds.has(c.id));
            assert(added && added.start === 28 && added.end === 31.2, `added ${S(added)}`);
            return { selectedRows, button: btn.text, added, placedCount: placed.length };
        });
        await sleep(1500);
        await check('§5 置いた文字の色が 8 色以上で循環する（DOM の computed color）', async () => {
            const m = await evalOn(session.cdp, `(()=>{const seen=new Map();for(const b of document.querySelectorAll('.akari-daihon-placed-bar, .akari-daihon-placed-tag')){const id=b.dataset.captionId||b.dataset.placedId||b.getAttribute('data-id')||b.title;const key=b.className.includes('tag')?'tag':'bar';const c=getComputedStyle(b);const col=key==='bar'?c.backgroundColor:(c.borderColor+'|'+c.color+'|'+c.backgroundColor);const cur=seen.get(id)||{};cur[key]=col;cur.var=getComputedStyle(b).getPropertyValue('--placed-color').trim();seen.set(id,cur)}return[...seen.entries()].map(([id,v])=>({id,...v}))})()`);
            const vars = m.map(x => x.var).filter(Boolean);
            const distinct = [...new Set(vars)];
            assert(m.length >= 9 && distinct.length >= 8, `colors ${S(m)}`);
            return { placed: m.length, distinctColors: distinct.length, colors: m };
        });
        await shot(session.cdp, '06-daihon-colors');
        if (PHASE.startsWith('rebase')) {
            // 他席の変更（右レール 1 本 + 区切り線 / インスペクターの持ち物カード）と干渉していないこと。
            const RAIL = `(()=>{const rail=document.querySelector('.akari-right-rail');const tabs=rail?[...rail.querySelectorAll('.lm-TabBar-tab')].map(t=>t.title||t.textContent.trim()).filter(Boolean):[];const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'};const insp=document.getElementById('akari-inspector-widget');const daihon=document.querySelector('.akari-daihon-widget');return{rail:vis(rail),railTabs:tabs,inspector:vis(insp),inspectorCards:insp?insp.querySelectorAll('section, [class*="card"]').length:0,daihon:vis(daihon),daihonRows:document.querySelectorAll('.akari-daihon-row').length}})()`;
            await check('rebase 他席との干渉なし: 右レールとインスペクターが開き、台本パネルが従来どおり出る', async () => {
                const railBefore = await evalOn(session.cdp, RAIL);
                assert(railBefore.rail && railBefore.railTabs.length >= 2, `rail ${S(railBefore)}`);
                await evalOn(session.cdp, command('akari.inspector.open'));
                const inspector = await waitFor('inspector visible', async () => { const x = await evalOn(session.cdp, RAIL); return x.inspector && x; }, 30_000);
                await sleep(1000);
                await shot(session.cdp, '08-inspector');
                await evalOn(session.cdp, command('akari.daihon.open'));
                const daihon = await waitFor('daihon visible', async () => { const x = await evalOn(session.cdp, RAIL); return x.daihon && x.daihonRows > 0 && x; }, 30_000);
                assert(daihon.rail, `rail after daihon ${S(daihon)}`);
                await sleep(1000);
                await shot(session.cdp, '09-daihon-back');
                return { railBefore, inspector, daihon };
            });
        }
        v.cdp.close();
    } finally { await stop(session); }

    // ===== §6 再読込後も同じ位置 =====
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: fixture, port: PORT, isoDir: path.join(RUNS, `${PHASE}-2`) });
    try {
        const v = await openAll(session, fixture, 1);
        await evalOn(session.cdp, shellCall(`s.collapsePanel('left')`)).catch(() => {});
        await sleep(3000);
        await check('§6 再読込後も最後に落とした位置に描かれる', async () => {
            const fr = await v.eval(FRAME);
            const plate = await stablePlate(v, P1);
            const row = await rowOf(fixture, P1);
            const last = TARGETS_LAST;
            const rendered = { x: round((plate.cx - fr.x) / fr.w), y: round((plate.cy - fr.y) / fr.h) };
            const err = { x: round(rendered.x - last.x), y: round(rendered.y - last.y) };
            assert(Math.abs(err.x) <= 0.01 && Math.abs(err.y) <= 0.01, `reload rendered ${S({ rendered, row: row.text_style })}`);
            return { saved: row.text_style, rendered, error: err };
        });
        await shot(session.cdp, '07-reload');
        v.cdp.close();
    } finally { await stop(session); }
    out.status = STRICT ? (out.checks.every(c => c.pass) ? 'pass' : 'fail') : 'recorded';
} catch (error) {
    out.status = 'fail'; out.error = sanitize(error, REPO);
} finally { await saveJson(RESULTS, out); }
console.log(out.status);
