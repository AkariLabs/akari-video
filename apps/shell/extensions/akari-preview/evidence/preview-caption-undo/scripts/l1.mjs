#!/usr/bin/env node
// 出力プレビュー発の字幕の書き込みを Cmd+Z で戻す・Cmd+Shift+Z でやり直す の L1（ラッパー作成の検証スクリプト）。
// fixture は gen-fixture.mjs で作る。使い方: node l1.mjs <before|after> [fixture dir] [--port=9481]
//   AKARI_L1_SHELL=<apps/shell> で起動する shell を差し替えられる（BEFORE を基点ビルドの複製で走らせるため）。
// 実機の Electron を自分専用のポート・一時ディレクトリで起動し、CDP の実マウス・実キーで操作して実測する。
// before = 変更前ビルドの観測記録（判定はしない）/ after = 受け入れ条件の判定つき。
// undo / redo は実キー（Cmd+Z / Cmd+Shift+Z を Input.dispatchKeyEvent で送る）。キーで戻らなければ
// 割り当て先のコマンド（akari.timeline.undo / redo）も試し、どちらで戻ったかを記録する（via）。
//   P1 1 本の移動 / P2 複数選択 3 本の移動 / P3 全字幕モード（⌥ドラッグ）/ P4 角のつまみの拡縮 / P5 回転
//   P6 太字 / P7 色（パレット）/ P8 座布団 / P9 既定に戻す / P10 はみ出し防止の切り替え（書き込みがあるかの観測）
//   各操作: 操作 → Cmd+Z 1 回 → captions.json が操作前とバイト一致・プレビューの描画も操作前 → Cmd+Shift+Z → 操作後とバイト一致
//   T0 タイムライン発（字幕のチップを時間方向へドラッグ）の undo / redo（比較の基準）
//   X  タイムライン発とプレビュー発を交互に 4 回 → undo 4 回が新しい順に 1 つずつ戻る → redo 4 回
//   C  プレビュー発の書き込みの後に captions.json を外から書き換え → Cmd+Z は戻さずに知らせる
import { readFile, writeFile, cp, rm, realpath } from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';
import { S, command, launch, sanitize, saveJson, sleep, stop, waitEval } from './l1-lib.mjs';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = process.env.AKARI_L1_SHELL ? path.resolve(process.env.AKARI_L1_SHELL) : path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
if (!existsSync(ELECTRON)) throw new Error('electron binary not found under the shell');
const TMP = path.join(os.tmpdir(), 'preview-caption-undo-l1');
const FIXTURE_SRC = path.resolve(process.argv.slice(3).find(v => !v.startsWith('--')) ?? path.join(TMP, 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9481);
const RUNS = path.join(TMP, 'runs');
const RESULTS = path.join(ROOT, `results-${PHASE}.json`);
const STRICT = PHASE !== 'before';
const out = { phase: PHASE, status: 'running', checks: [], screenshots: [] };
const META = 4, ALT = 1, SHIFT = 8;
const DRAG_PX = 40;
const PLACED = ['c-0101', 'c-0102', 'c-0103'];
const SPOKEN_T = { 'c-0001': 2.8, 'c-0002': 6.8, 'c-0003': 10.8, 'c-0004': 14.8 };
const PLACED_T = 19;
const assert = (condition, message) => { if (STRICT && !condition) throw new Error(message); };
async function check(name, operation) {
    const record = { name, pass: false };
    out.checks.push(record);
    try { record.detail = await operation(); record.pass = true; }
    catch (error) { record.error = sanitize(error, REPO); }
    finally { await saveJson(RESULTS, out); }
    return record.detail;
}
const readCaptions = async project => readFile(path.join(project, 'captions.json'), 'utf8');
const captionsOf = async project => { const p = JSON.parse(await readCaptions(project)); return Array.isArray(p) ? p : p.captions; };
const rootOf = async project => JSON.parse(await readCaptions(project));
async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(250); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const shellCall = body => `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const s=window.theia.container.get(k);${body};return true})()`;

// ---- webview（入れ子 iframe の内側）への到達と座標の対応（caption-drag-and-icon-tools の l1.mjs と同じ） ----
async function view(port) {
    let cdp, ctx;
    const attach = async () => {
        cdp?.close(); cdp = undefined;
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
async function calibrate(session, v) {
    await v.eval(`(()=>{if(!window.__cmmHooked){window.__cmmHooked=true;window.addEventListener('pointermove',e=>window.__cmmPointer={x:e.clientX,y:e.clientY},true)}return true})()`);
    const frame = await evalOn(session.cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return{left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    const probe = async (x, y) => {
        await v.eval('window.__cmmPointer=null');
        await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 3, y: y - 3, button: 'none' }); await sleep(80);
        await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(250);
        return waitFor('pointer', () => v.eval('window.__cmmPointer'));
    };
    const a = { x: Math.round(frame.left + frame.width * 0.3), y: Math.round(frame.top + frame.height * 0.3) };
    const b = { x: Math.round(frame.left + frame.width * 0.7), y: Math.round(frame.top + frame.height * 0.6) };
    const la = await probe(a.x, a.y), lb = await probe(b.x, b.y);
    const sx = (b.x - a.x) / (lb.x - la.x), sy = (b.y - a.y) / (lb.y - la.y);
    return { sx, sy, dx: a.x - la.x * sx, dy: a.y - la.y * sy, iframe: frame };
}
const toPage = (off, pt) => ({ x: pt.x * off.sx + off.dx, y: pt.y * off.sy + off.dy });

const FRAME = `(()=>{const c=[...document.querySelectorAll('#preview-stage canvas, #preview-stage video')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>50).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return c?{x:c.x,y:c.y,w:c.width,h:c.height}:null})()`;
const PLATE_EL = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});return document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want))||null})()`;
// 文字の実寸（.akari-caption__block か .akari-caption__line の外接矩形）と掴む点（1 行目の文字の中心）。
const PLATE = id => `(()=>{const p=${PLATE_EL(id)};if(!p)return null;const cs0=getComputedStyle(p);if(cs0.display==='none'||cs0.visibility==='hidden')return null;const block=p.querySelector('.akari-caption__block');const els=block?[block]:[...p.querySelectorAll('.akari-caption__line')];const rs=(els.length?els:[p]).map(e=>e.getBoundingClientRect());const r={left:Math.min(...rs.map(x=>x.left)),right:Math.max(...rs.map(x=>x.right)),top:Math.min(...rs.map(x=>x.top)),bottom:Math.max(...rs.map(x=>x.bottom))};if(!(r.right-r.left>0))return null;const g=((p.querySelector('.akari-caption__line')||block||p)).getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,cx:(r.left+r.right)/2,cy:(r.top+r.bottom)/2,w:r.right-r.left,h:r.bottom-r.top,text:(block||p).textContent,selected:p.hasAttribute('data-selected'),grab:{x:g.left+g.width/2,y:g.top+g.height/2}}})()`;
// 見えている字幕ごとに: data-selected・つまみの数・文字を囲む枠（outline / 4 辺の border。つまみ・ミニパネルは除く）。
const PREVIEW_SELECTION = `(()=>{const px=v=>Math.round(v*100)/100;const visible=e=>{let n=e;while(n&&n.nodeType===1){const cs=getComputedStyle(n);if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0)return false;n=n.parentElement}const b=e.getBoundingClientRect();return b.width>0&&b.height>0};const all=[...document.querySelectorAll('*')].filter(visible);const plates=[...document.querySelectorAll('.caption-row-plate')].filter(visible);return plates.map(p=>{const block=p.querySelector('.akari-caption__block');const els=block?[block]:[...p.querySelectorAll('.akari-caption__line')];const rs=els.map(e=>e.getBoundingClientRect());if(!rs.length)return null;const ink={left:Math.min(...rs.map(x=>x.left)),right:Math.max(...rs.map(x=>x.right)),top:Math.min(...rs.map(x=>x.top)),bottom:Math.max(...rs.map(x=>x.bottom))};const area=(ink.right-ink.left)*(ink.bottom-ink.top);const frames=[];for(const e of all){const cs=getComputedStyle(e);const ol=cs.outlineStyle!=='none'&&parseFloat(cs.outlineWidth)>0;const bd=['Top','Right','Bottom','Left'].every(s=>cs['border'+s+'Style']!=='none'&&parseFloat(cs['border'+s+'Width'])>0&&!/rgba\\(\\d+, \\d+, \\d+, 0\\)|transparent/.test(cs['border'+s+'Color']));if(!ol&&!bd)continue;if(e.closest('.akari-caption-select-tools, .akari-caption-handle, [class*="palette"], [class*="tooltip"], [data-caption-tool]'))continue;const b=e.getBoundingClientRect();const ov=Math.max(0,Math.min(b.right,ink.right)-Math.max(b.left,ink.left))*Math.max(0,Math.min(b.bottom,ink.bottom)-Math.max(b.top,ink.top));if(area<=0||ov/area<0.8)continue;if(b.width>(ink.right-ink.left)*3&&b.height>(ink.bottom-ink.top)*6)continue;frames.push({id:e.id||null,cls:e.className&&String(e.className).slice(0,60),kind:ol?'outline':'border',style:ol?cs.outlineStyle:cs.borderTopStyle,color:ol?cs.outlineColor:cs.borderTopColor,width:px(ol?parseFloat(cs.outlineWidth):parseFloat(cs.borderTopWidth)),rect:{left:px(b.left),top:px(b.top),width:px(b.width),height:px(b.height)}})}return{plate:p.id,selected:p.hasAttribute('data-selected'),handles:p.querySelectorAll('.akari-caption-handle').length,frames}}).filter(Boolean)})()`;
const TOOLS = `(()=>{const t=[...document.querySelectorAll('.akari-caption-select-tools')].filter(e=>{const cs=getComputedStyle(e);const r=e.getBoundingClientRect();return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0});return t.map(e=>{const r=e.getBoundingClientRect();return{left:Math.round(r.left),top:Math.round(r.top),width:Math.round(r.width)}})})()`;
const HANDLE = (id, h) => `(()=>{const p=${PLATE_EL(id)};const e=p&&p.querySelector('.akari-caption-handle[data-h=${S(h)}]');if(!e)return null;const r=e.getBoundingClientRect();return r.width>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`;

// ---- タイムライン（メインのページ）。チップは幅の 30% の点を押す（中央は再生ヘッドと重なることがある） ----
const CHIP = id => `(()=>{const e=document.querySelector('.akari-annotations-strip-caption[data-akari-item-id=${S(id)}]');if(!e)return null;const r=e.getBoundingClientRect();return r.width>0?{left:r.left,right:r.right,top:r.top,bottom:r.bottom,x:r.left+r.width*0.3,y:r.top+r.height/2,selected:e.classList.contains('akari-annotations-selected')}:null})()`;
const TIMELINE_SELECTED = `[...document.querySelectorAll('.akari-annotations-strip-caption.akari-annotations-selected')].map(e=>e.dataset.akariItemId).filter(Boolean).sort()`;
const FREE_STRIP_POINT = (x, y) => `(()=>{const h=document.elementFromPoint(${x},${y});if(!h)return {ok:false};const strip=h.closest('.akari-annotations-strip, [class*="strip"]');return{ok:!!strip&&!h.closest('[data-akari-item-kind], .akari-beat-marker, .akari-track-header-row, .akari-annotations-pin'),hit:String(h.className).slice(0,80)}})()`;

async function openAll(session, project, seekTo, firstId) {
    await evalOn(session.cdp, command('akari.annotations.open'));
    await waitEval(session.cdp, `document.querySelectorAll('.akari-annotations-strip-caption').length>0`, { label: 'timeline caption chips', timeoutMs: 180_000 });
    await waitFor('preview webview', async () => {
        await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time: seekTo }));
        await sleep(3000);
        return (await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
    }, 120_000);
    await sleep(2500);
    const v = await view(PORT);
    await waitFor(`${firstId} plate`, async () => { await seek(session, project, seekTo); await sleep(1200); return v.eval(PLATE(firstId)); }, 120_000);
    return v;
}
const seek = (session, project, time) => evalOn(session.cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time }));
async function seekTo(session, v, project, time, id) {
    return waitFor(`${id} plate at ${time}`, async () => { await seek(session, project, time); await sleep(1000); return v.eval(PLATE(id)); }, 60_000);
}
async function shot(session, name, clip) {
    await sleep(500);
    const file = `${PHASE}-${name}.png`;
    const params = { format: 'png' };
    if (clip) params.clip = { ...clip, scale: 1 };
    const { data } = await session.cdp.send('Page.captureScreenshot', params);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(ROOT, file), Buffer.from(data, 'base64'));
    out.screenshots.push(file);
}
const previewClip = off => ({ x: off.iframe.left, y: off.iframe.top, width: off.iframe.width, height: off.iframe.height });
async function stablePlate(v, id, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs; let last = null, same = 0;
    while (Date.now() < deadline) {
        const p = await v.eval(PLATE(id));
        if (p && last && Math.abs(p.left - last.left) < 0.3 && Math.abs(p.top - last.top) < 0.3 && Math.abs(p.w - last.w) < 0.3) { if (++same >= 3) return p; }
        else same = 0;
        last = p; await sleep(300);
    }
    return last;
}
async function grabPoint(v, p) {
    // 1 行目の文字の中心 → 文字の外接矩形の中の格子点、の順に「字幕に当たり、つまみ・ミニパネルには当たらない」点を探す。
    const candidates = [p.grab];
    for (const fy of [0.5, 0.3, 0.7]) for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8]) candidates.push({ x: p.left + (p.right - p.left) * fx, y: p.top + (p.bottom - p.top) * fy });
    for (const c of candidates) {
        const hit = await v.eval(`(()=>{const h=document.elementFromPoint(${c.x},${c.y});return Boolean(h&&h.closest('.caption-row-plate')&&!h.closest('.akari-caption-handle, .akari-caption-select-tools'))})()`);
        if (hit) return c;
    }
    throw new Error(`grab point ${S(p.grab)} does not hit the caption`);
}
const rel = (p, fr) => p ? ({ left: round(p.left - fr.x), top: round(p.top - fr.y), w: round(p.w), h: round(p.h) }) : null;
async function mouse(cdp, type, pt, modifiers = 0, extra = {}) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: type === 'mouseMoved' ? (extra.buttons ? 'left' : 'none') : 'left', buttons: extra.buttons ?? 0, clickCount: extra.clickCount ?? (type === 'mouseMoved' ? 0 : 1), modifiers });
}
/** ページ座標で押して動かして離す（中継点ごとに 10 刻み）。 */
async function dragPage(cdp, from, to, { modifiers = 0, steps = 12 } = {}) {
    await mouse(cdp, 'mouseMoved', from, modifiers); await sleep(150);
    await mouse(cdp, 'mousePressed', from, modifiers, { buttons: 1 }); await sleep(150);
    for (let s = 1; s <= steps; s++) {
        await mouse(cdp, 'mouseMoved', { x: from.x + (to.x - from.x) * s / steps, y: from.y + (to.y - from.y) * s / steps }, modifiers, { buttons: 1 }); await sleep(40);
    }
    for (let i = 0; i < 2; i++) { await mouse(cdp, 'mouseMoved', to, modifiers, { buttons: 1 }); await sleep(150); }
    await mouse(cdp, 'mouseReleased', to, modifiers, { buttons: 0 });
}
async function clickChip(session, id, modifiers = 0) {
    const c = await waitFor(`chip ${id}`, () => evalOn(session.cdp, CHIP(id)), 20_000);
    await realClick(session.cdp, c.x, c.y, { modifiers });
    await sleep(700);
    // 起動直後の最初のクリックはタイムラインへのフォーカスだけで終わることがある → 選ばれていなければ間を空けてもう一度（修飾キーなしのときだけ）。
    if (!modifiers && !(await evalOn(session.cdp, CHIP(id)))?.selected) {
        await sleep(900);
        await realClick(session.cdp, c.x, c.y);
        await sleep(700);
    }
}
async function deselectPreview(session, off, v) {
    const free = await v.eval(`(()=>{const f=${FRAME};for(const[x,y]of[[.92,.5],[.08,.5],[.92,.3],[.08,.3]]){const p={x:f.x+f.w*x,y:f.y+f.h*y};const h=document.elementFromPoint(p.x,p.y);if(h&&!h.closest('.caption-row-plate, #caption-select-box'))return p}return null})()`);
    if (free) { const p = toPage(off, free); await realClick(session.cdp, p.x, p.y); await sleep(600); }
}
// captions.json への書き込み回数（fs.watch の change をまとめて 150ms 以内は 1 回とみなす）。
function countWrites(project) {
    const file = path.join(project, 'captions.json');
    let count = 0, lastAt = 0;
    const watcher = watch(file, () => { const now = Date.now(); if (now - lastAt > 150) count++; lastAt = now; });
    return { stop: () => { watcher.close(); return count; } };
}
const diffStyles = (beforeRows, afterRows) => {
    const byId = new Map(beforeRows.map(r => [r.id, r]));
    return afterRows.filter(r => S(r.text_style) !== S(byId.get(r.id)?.text_style)).map(r => ({ id: r.id, before: byId.get(r.id)?.text_style ?? null, after: r.text_style ?? null }));
};
async function historyCommand(session, id) {
    await evalOn(session.cdp, command(id));
    await sleep(1500);
}
async function waitBytes(project, expected, timeoutMs = 15_000) {
    return waitFor('captions bytes', async () => (await readCaptions(project)) === expected, timeoutMs).then(() => true).catch(() => false);
}
/** 各 id をそれぞれが見える時刻でシークして描画位置を測る（フレーム左上基準）。 */
async function measureAt(session, v, project, ids, timeOf) {
    const fr = await v.eval(FRAME);
    const m = {};
    for (const id of ids) {
        await seekTo(session, v, project, timeOf(id), id);
        m[id] = rel(await stablePlate(v, id), fr);
    }
    return m;
}
const deltas = (a, b) => Object.fromEntries(Object.keys(a).map(id => [id, a[id] && b[id] ? { dx: round(b[id].left - a[id].left), dy: round(b[id].top - a[id].top), dw: round(b[id].w - a[id].w) } : null]));

/** プレビューで id の字幕の本体を +DRAG_PX 横へドラッグして、書き込み（captions.json の変化）を待つ。 */
async function bodyDrag(session, off, v, project, id, { dx = DRAG_PX, dy = 0, modifiers = 0 } = {}) {
    const before = await readCaptions(project);
    const p = await stablePlate(v, id);
    const grab = await grabPoint(v, p);
    const writes = countWrites(project);
    await dragPage(session.cdp, toPage(off, grab), toPage(off, { x: grab.x + dx, y: grab.y + dy }), { modifiers });
    const changed = await waitFor('captions written', async () => (await readCaptions(project)) !== before, 15_000).then(() => true).catch(() => false);
    await sleep(1500);
    const writeCount = writes.stop();
    const after = await readCaptions(project);
    return { before, after, changed, writeCount, diff: diffStyles(JSON.parse(before).captions, JSON.parse(after).captions) };
}

// ---- 追加の小道具（本 L1） ----
// 字幕の描画の指紋: 文字の外接矩形・太さ・色・縁取り・座布団（行 / ブロック / plate の背景）・plate の transform。
const SIG = ids => `(()=>{const px=v=>Math.round(v*10)/10;const o={};for(const id of ${S(ids)}){const want='caption-plate-'+encodeURIComponent(id);const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!p){o[id]=null;continue}const cs0=getComputedStyle(p);if(cs0.display==='none'||cs0.visibility==='hidden'){o[id]=null;continue}const block=p.querySelector('.akari-caption__block');const line=p.querySelector('.akari-caption__line');const els=block?[block]:[...p.querySelectorAll('.akari-caption__line')];const rs=(els.length?els:[p]).map(e=>e.getBoundingClientRect());const r={left:Math.min(...rs.map(x=>x.left)),right:Math.max(...rs.map(x=>x.right)),top:Math.min(...rs.map(x=>x.top)),bottom:Math.max(...rs.map(x=>x.bottom))};const ls=getComputedStyle(line||block||p);const bs=getComputedStyle(block||line||p);o[id]={left:px(r.left),top:px(r.top),w:px(r.right-r.left),h:px(r.bottom-r.top),fontWeight:ls.fontWeight,color:ls.color,stroke:ls.webkitTextStrokeColor+' '+ls.webkitTextStrokeWidth,lineBg:ls.backgroundColor,blockBg:bs.backgroundColor,plateBg:cs0.backgroundColor,transform:cs0.transform}}return o})()`;
const sigDiff = (a, b) => {
    const diffs = {};
    for (const id of Object.keys(a ?? {})) {
        const x = a[id], y = b?.[id];
        if (!x || !y) { if (x !== y) diffs[id] = { a: x, b: y ?? null }; continue; }
        const d = {};
        for (const k of ['left', 'top', 'w', 'h']) if (Math.abs(x[k] - y[k]) > 1) d[k] = [x[k], y[k]];
        for (const k of ['fontWeight', 'color', 'stroke', 'lineBg', 'blockBg', 'plateBg', 'transform']) if (x[k] !== y[k]) d[k] = [x[k], y[k]];
        if (Object.keys(d).length) diffs[id] = d;
    }
    return diffs;
};
async function sigAt(session, v, time, ids) {
    await seekTo(session, v, fixture, time, ids[0]);
    await sleep(600);
    return v.eval(SIG(ids));
}
/** 描画が期待の指紋と一致するまで待つ（再読込の反映待ち）。一致しなければ最後の差分を返す。 */
async function waitSig(session, v, time, ids, expected, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) {
        await seek(session, fixture, time); await sleep(700);
        last = await v.eval(SIG(ids));
        const diff = sigDiff(expected, last);
        if (!Object.keys(diff).length) return { same: true };
        await sleep(500);
    }
    return { same: false, diff: sigDiff(expected, last) };
}
const KEY_Z = { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 6 };
async function historyKey(session, redo) {
    const k = { ...KEY_Z, ...(redo ? { key: 'Z' } : {}), modifiers: META | (redo ? SHIFT : 0) };
    await session.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
    await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
}
/** Cmd+Z / Cmd+Shift+Z を 1 回。captions.json が expected になるのを待つ。キーで変わらなければコマンドでも試す（記録用）。 */
async function history(session, redo, expected, { timeoutMs = 25_000, fallback = true } = {}) {
    const t0 = Date.now();
    const before = await readCaptions(fixture);
    // 押す前から期待の内容なら「戻った」とは数えない（BEFORE で undo が効かないときの redo が素通りで一致するのを区別する）。
    if (before === expected) {
        await historyKey(session, redo);
        await sleep(3000);
        return { restored: false, via: 'none', alreadyEqual: true, changedToOther: (await readCaptions(fixture)) !== before };
    }
    await historyKey(session, redo);
    const byKey = await waitBytes(fixture, expected, timeoutMs);
    if (byKey) return { restored: true, via: 'key', elapsedMs: Date.now() - t0 };
    const now = await readCaptions(fixture);
    if (now !== before) return { restored: false, via: 'key', changedToOther: true };
    if (!fallback) return { restored: false, via: 'none', keyOnly: true, elapsedMs: Date.now() - t0 };
    await evalOn(session.cdp, command(redo ? 'akari.timeline.redo' : 'akari.timeline.undo'));
    const byCommand = await waitBytes(fixture, expected, timeoutMs);
    if (byCommand) return { restored: true, via: 'command' };
    return { restored: false, via: 'none', changedToOther: (await readCaptions(fixture)) !== before };
}
async function selectOne(session, v, id, time) {
    await clickChip(session, id);
    await seekTo(session, v, fixture, time, id);
    await sleep(800);
}
async function selectPlaced(session, v) {
    await clickChip(session, PLACED[0]);
    await clickChip(session, PLACED[1], META);
    await clickChip(session, PLACED[2], META);
    await seekTo(session, v, fixture, PLACED_T, PLACED[2]);
    await sleep(800);
}
// 回転のつまみ: 中心がミニパネルに隠れることがあるので、つまみ（円 + 軸の線）の中で実際に当たる点を探す。
const ROT_POINT = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));const e=p&&p.querySelector('.akari-caption-handle[data-h="rot"]');if(!e)return null;const r=e.getBoundingClientRect();if(!(r.width>0))return null;const cx=r.left+r.width/2;for(const dy of [r.height/2,r.height+4,r.height+8,r.height+12,r.height+16,2,r.height-2]){const y=r.top+dy;const h=document.elementFromPoint(cx,y);if(h&&h.closest('.akari-caption-handle[data-h="rot"]'))return{x:cx,y,dy}}return{x:cx,y:r.top+r.height/2,blocked:String(document.elementFromPoint(cx,r.top+r.height/2)?.className||'').slice(0,60)}})()`;
const TOOL = name => `(()=>{const t=[...document.querySelectorAll('.akari-caption-select-tools')].find(e=>{const cs=getComputedStyle(e);const r=e.getBoundingClientRect();return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0});const b=t&&t.querySelector('[data-caption-tool=${S(name)}]');if(!b||b.hidden)return null;const r=b.getBoundingClientRect();return r.width>0?{x:r.left+r.width/2,y:r.top+r.height/2,pressed:b.getAttribute('aria-pressed'),on:b.classList.contains('on')}:null})()`;
async function clickInView(session, off, pt) { const p = toPage(off, pt); await realClick(session.cdp, p.x, p.y); }
async function clickTool(session, off, v, name) {
    const pt = await waitFor(`tool ${name}`, () => v.eval(TOOL(name)), 20_000);
    await clickInView(session, off, pt);
}
/** 書き込みを伴う操作 1 回を走らせて、書き込み前後の captions.json と書き込み回数を返す。 */
async function operate(project, action, { expectWrite = true } = {}) {
    const before = await readCaptions(project);
    const writes = countWrites(project);
    await action();
    const changed = await waitFor('captions written', async () => (await readCaptions(project)) !== before, expectWrite ? 20_000 : 4_000).then(() => true).catch(() => false);
    await sleep(1500);
    const writeCount = writes.stop();
    const after = await readCaptions(project);
    return { before, after, changed, writeCount, diff: diffStyles(JSON.parse(before).captions, JSON.parse(after).captions), defaultChanged: S(JSON.parse(before).default_text_style) !== S(JSON.parse(after).default_text_style) };
}
async function chipDrag(session, id, dx) {
    const c = await waitFor(`chip ${id}`, () => evalOn(session.cdp, CHIP(id)), 20_000);
    const from = { x: (c.left + c.right) / 2, y: (c.top + c.bottom) / 2 };
    await dragPage(session.cdp, from, { x: from.x + dx, y: from.y });
}
// 画面に出ている「元に戻す」関係の文言（トースト・タイムラインのフッター / notice）。子要素を持たない要素の文字だけを集める。
const NOTICES = `[...new Set([...document.querySelectorAll('body *')].filter(e=>e.children.length===0&&e.getClientRects().length>0).map(e=>(e.textContent||'').trim()).filter(t=>/元に戻|やり直|後から変更/.test(t)))].slice(0,10)`;

/**
 * プレビュー発の 1 操作の検査: 操作前の描画 → 操作 → Cmd+Z → バイト一致 + 描画一致 → Cmd+Shift+Z → バイト一致 + 描画一致。
 * ids / time = 描画を測る字幕と時刻。prepare = 選択など（書き込みなし）。
 */
async function previewOp(session, off, v, key, { ids, time, prepare, action, shots = false }) {
    await prepare();
    const preSig = await sigAt(session, v, time, ids);
    await prepare();
    const op = await operate(fixture, action);
    const postSig = await sigAt(session, v, time, ids);
    if (shots) await shot(session, `${key}-1-done`, previewClip(off));
    const undo = await history(session, false, op.before);
    const undoSig = await waitSig(session, v, time, ids, preSig);
    if (shots) await shot(session, `${key}-2-undone`, previewClip(off));
    const redo = await history(session, true, op.after);
    const redoSig = await waitSig(session, v, time, ids, postSig);
    const m = { changed: op.changed, writeCount: op.writeCount, changedIds: op.diff.map(x => x.id), defaultChanged: op.defaultChanged, renderChanged: sigDiff(preSig, postSig), undo, undoRender: undoSig, redo, redoRender: redoSig, final: sha(await readCaptions(fixture)) };
    out.ops[key] = m;
    await deselectPreview(session, off, v);
    assert(op.changed && op.writeCount === 1, `write ${S({ changed: op.changed, writeCount: op.writeCount })}`);
    assert(Object.keys(m.renderChanged).length > 0, 'operation did not change the preview');
    assert(undo.restored && undo.via === 'key', `undo ${S(undo)}`);
    assert(undoSig.same, `preview after undo ${S(undoSig)}`);
    assert(redo.restored && redo.via === 'key', `redo ${S(redo)}`);
    assert(redoSig.same, `preview after redo ${S(redoSig)}`);
    return m;
}
import { createHash } from 'node:crypto';
const sha = text => createHash('sha256').update(text).digest('hex').slice(0, 16);

let fixture;
try {
    await rm(path.join(TMP, `work-${PHASE}`), { recursive: true, force: true });
    await cp(FIXTURE_SRC, path.join(TMP, `work-${PHASE}`), { recursive: true });
    fixture = await realpath(path.join(TMP, `work-${PHASE}`, 'project'));
    out.ops = {};
    const session = await launch({ shellDir: SHELL, electron: ELECTRON, project: fixture, port: PORT, isoDir: path.join(RUNS, `${PHASE}-1`) });
    out.pids = [session.pid];
    out.consoleWarnings = [];
    session.cdp.on('Runtime.consoleAPICalled', p => {
        if (p.type !== 'warning' && p.type !== 'error') return;
        const text = p.args.map(a => a.value ?? a.description ?? '').join(' ');
        if (/akari-preview|caption|字幕|history|undo|redo/.test(text)) out.consoleWarnings.push(sanitize(text.slice(0, 300), REPO));
    });
    try {
        const v = await openAll(session, fixture, SPOKEN_T['c-0004'], 'c-0004');
        await evalOn(session.cdp, shellCall(`s.collapsePanel('left')`)).catch(() => {});
        await sleep(3000);
        const off = await calibrate(session, v);
        out.frame = await v.eval(FRAME);
        out.initial = sha(await readCaptions(fixture));
        const one = ['c-0004'];
        const t4 = SPOKEN_T['c-0004'];

        await check('P1 1 本の移動 → Cmd+Z 1 回で操作前とバイト一致・描画も戻る → Cmd+Shift+Z で操作後とバイト一致', () => previewOp(session, off, v, 'p1-move', {
            ids: one, time: t4, shots: true,
            prepare: () => selectOne(session, v, 'c-0004', t4),
            action: async () => { const p = await stablePlate(v, 'c-0004'); const g = await grabPoint(v, p); await dragPage(session.cdp, toPage(off, g), toPage(off, { x: g.x + DRAG_PX, y: g.y })); }
        }));
        await check('P2 複数選択 3 本の移動（Cmd クリック）→ undo / redo', () => previewOp(session, off, v, 'p2-multi-move', {
            ids: PLACED, time: PLACED_T, shots: true,
            prepare: () => selectPlaced(session, v),
            action: async () => { const p = await stablePlate(v, PLACED[2]); const g = await grabPoint(v, p); await dragPage(session.cdp, toPage(off, g), toPage(off, { x: g.x + DRAG_PX, y: g.y })); }
        }));
        await check('P3 全字幕モード（⌥ドラッグ）→ undo / redo', () => previewOp(session, off, v, 'p3-group', {
            ids: ['c-0003'], time: SPOKEN_T['c-0003'],
            prepare: () => selectOne(session, v, 'c-0003', SPOKEN_T['c-0003']),
            action: async () => { const p = await stablePlate(v, 'c-0003'); const g = await grabPoint(v, p); await dragPage(session.cdp, toPage(off, g), toPage(off, { x: g.x, y: g.y - 30 }), { modifiers: ALT }); }
        }));
        await check('P4 角のつまみの拡縮 → undo / redo', () => previewOp(session, off, v, 'p4-scale', {
            ids: one, time: t4, shots: true,
            prepare: () => selectOne(session, v, 'c-0004', t4),
            action: async () => { const h = await waitFor('se handle', () => v.eval(HANDLE('c-0004', 'se')), 15_000); await dragPage(session.cdp, toPage(off, h), toPage(off, { x: h.x + 30, y: h.y + 10 })); }
        }));
        await check('P6 ミニパネルの太字 → undo / redo', () => previewOp(session, off, v, 'p6-bold', {
            ids: one, time: t4, shots: true,
            prepare: () => selectOne(session, v, 'c-0004', t4),
            action: () => clickTool(session, off, v, 'bold')
        }));
        await check('P7 ミニパネルの色（パレットの文字色）→ undo / redo', () => previewOp(session, off, v, 'p7-color', {
            ids: one, time: t4, shots: true,
            prepare: () => selectOne(session, v, 'c-0004', t4),
            action: async () => {
                await clickTool(session, off, v, 'color');
                const pt = await waitFor('palette sample', () => v.eval(`(()=>{const vis=[...document.querySelectorAll('[data-palette-colors] [data-color], [data-color]')].filter(e=>e.getBoundingClientRect().width>0);const b=vis.find(e=>e.dataset.color==='#f26666')||vis[3];if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`), 15_000);
                await clickInView(session, off, pt);
            }
        }));
        await check('P8 ミニパネルの座布団 → undo / redo', () => previewOp(session, off, v, 'p8-cushion', {
            ids: one, time: t4,
            prepare: () => selectOne(session, v, 'c-0004', t4),
            action: () => clickTool(session, off, v, 'cushion')
        }));
        await check('P5 回転 → undo / redo', () => previewOp(session, off, v, 'p5-rotate', {
            ids: one, time: t4,
            prepare: () => selectOne(session, v, 'c-0004', t4),
            action: async () => { const h = await waitFor('rot handle', () => v.eval(ROT_POINT('c-0004')), 15_000); out.rotPoint = h; await dragPage(session.cdp, toPage(off, h), toPage(off, { x: h.x + 16, y: h.y })); }
        }));
        await check('P9 既定に戻す → undo / redo', () => previewOp(session, off, v, 'p9-reset', {
            ids: one, time: t4, shots: true,
            prepare: () => selectOne(session, v, 'c-0004', t4),
            action: () => clickTool(session, off, v, 'reset')
        }));
        // P10 はみ出し防止の切り替え: 書き込むかどうかを観測する（書き込まない = captions.json は変わらない = undo の対象外）。
        await check('P10 はみ出し防止の切り替え（観測: captions.json への書き込みがあるか）', async () => {
            await selectOne(session, v, 'c-0004', t4);
            const pre = await sigAt(session, v, t4, one);
            await selectOne(session, v, 'c-0004', t4);
            const op = await operate(fixture, () => clickTool(session, off, v, 'clamp'), { expectWrite: false });
            const post = await sigAt(session, v, t4, one);
            let undo = null;
            if (op.changed) undo = await history(session, false, op.before);
            // 状態を戻す（メモリ上の切り替えなのでもう一度押す）。
            await selectOne(session, v, 'c-0004', t4);
            await clickTool(session, off, v, 'clamp').catch(() => {});
            await sleep(1000);
            const m = { changed: op.changed, writeCount: op.writeCount, renderChanged: sigDiff(pre, post), undo };
            out.ops['p10-clamp'] = m;
            await deselectPreview(session, off, v);
            assert(!op.changed || undo?.restored, S(m));
            return m;
        });

        // T0 タイムライン発（比較の基準）
        await check('T0 タイムライン発（字幕のチップを時間方向へドラッグ）→ Cmd+Z / Cmd+Shift+Z', async () => {
            const op = await operate(fixture, () => chipDrag(session, 'c-0002', 30));
            const undo = await history(session, false, op.before);
            const redo = await history(session, true, op.after, { timeoutMs: 60_000 });
            const m = { changed: op.changed, writeCount: op.writeCount, undo, redo };
            out.ops['t0-timeline'] = m;
            assert(op.changed && undo.restored && redo.restored, S(m));
            return m;
        });

        // X タイムライン発とプレビュー発を交互に
        await check('X タイムライン発とプレビュー発を交互に 4 回 → Cmd+Z 4 回が新しい順に 1 つずつ戻る → Cmd+Shift+Z 4 回', async () => {
            const snaps = [await readCaptions(fixture)];
            const steps = [];
            const t1 = await operate(fixture, () => chipDrag(session, 'c-0002', 30)); steps.push({ kind: 'timeline', changed: t1.changed }); snaps.push(t1.after);
            await selectOne(session, v, 'c-0004', t4);
            const p1 = await operate(fixture, async () => { const p = await stablePlate(v, 'c-0004'); const g = await grabPoint(v, p); await dragPage(session.cdp, toPage(off, g), toPage(off, { x: g.x - DRAG_PX, y: g.y })); });
            steps.push({ kind: 'preview-move', changed: p1.changed }); snaps.push(p1.after);
            const t2 = await operate(fixture, () => chipDrag(session, 'c-0003', 30)); steps.push({ kind: 'timeline', changed: t2.changed }); snaps.push(t2.after);
            await selectOne(session, v, 'c-0004', t4);
            const p2 = await operate(fixture, () => clickTool(session, off, v, 'bold')); steps.push({ kind: 'preview-bold', changed: p2.changed }); snaps.push(p2.after);
            const undos = [];
            for (let i = 4; i >= 1; i--) { const r = await history(session, false, snaps[i - 1]); undos.push({ expect: `snap${i - 1}`, ...r }); }
            const redos = [];
            for (let i = 1; i <= 4; i++) { const r = await history(session, true, snaps[i], { timeoutMs: 60_000 }); redos.push({ expect: `snap${i}`, ...r }); }
            const m = { steps, snaps: snaps.map(sha), undos, redos };
            out.interleave = m;
            assert(steps.every(s => s.changed) && new Set(snaps.map(sha)).size === 5, `steps ${S(steps)}`);
            assert(undos.every(u => u.restored && u.via === 'key'), `undos ${S(undos)}`);
            assert(redos.every(u => u.restored && u.via === 'key'), `redos ${S(redos)}`);
            return m;
        });

        // C 挟まった書き込み
        await check('C プレビュー発の書き込みの後に captions.json を外から書き換え → Cmd+Z は戻さずに知らせる', async () => {
            await selectOne(session, v, 'c-0004', t4);
            const op = await operate(fixture, async () => { const p = await stablePlate(v, 'c-0004'); const g = await grabPoint(v, p); await dragPage(session.cdp, toPage(off, g), toPage(off, { x: g.x + DRAG_PX, y: g.y })); });
            const external = `${JSON.stringify(JSON.parse(op.after), null, 4)}\n`;
            await writeFile(path.join(fixture, 'captions.json'), external);
            await sleep(3000);
            const noticesBefore = await evalOn(session.cdp, NOTICES);
            await historyKey(session, false);
            await sleep(4000);
            const now = await readCaptions(fixture);
            const noticesAfter = await evalOn(session.cdp, NOTICES);
            const m = { opChanged: op.changed, keptExternal: now === external, restoredToBefore: now === op.before, noticesBefore, noticesAfter, newNotices: noticesAfter.filter(n => !noticesBefore.includes(n)) };
            out.conflict = m;
            await shot(session, 'c-conflict-notice');
            assert(m.keptExternal && !m.restoredToBefore && m.newNotices.some(n => /元に戻せませんでした/.test(n)) && !m.newNotices.some(n => /を元に戻しました/.test(n)), S(m));
            return m;
        });
        v.cdp.close();
    } finally { await stop(session); }
    out.finalCaptions = JSON.parse(await readCaptions(fixture));
    out.status = STRICT ? (out.checks.every(c => c.pass) ? 'pass' : 'fail') : 'recorded';
} catch (error) {
    out.status = 'fail'; out.error = sanitize(error, REPO);
} finally { await saveJson(RESULTS, out); }
console.log(out.status);
