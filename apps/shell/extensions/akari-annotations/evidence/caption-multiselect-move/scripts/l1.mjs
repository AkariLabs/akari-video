#!/usr/bin/env node
// タイムラインの複数選択 → 出力プレビューでまとめて動かす・大きさを変える の L1（ラッパー作成の検証スクリプト）。
// fixture は gen-fixture.mjs で作る。使い方: node l1.mjs <before|after> [fixture dir] [--port=9477]
// 実機の Electron を自分専用のポート・一時ディレクトリで起動し、CDP の実マウス・実キーで操作して実測する。
// before = 変更前ビルドの観測記録（判定はしない）/ after = 受け入れ条件の判定つき。
// 「px」はプレビュー上の表示 px（webview の CSS px。ウィンドウ 1440×900・倍率 1）。
//   S0 1 本だけ（タイムラインでクリック）→ 本体ドラッグ → undo（回帰の比較）
//   S1 Cmd クリック 3 本（置いた文字・同じ時刻）→ 枠 → 本体ドラッグ 40px → undo / redo → 角のつまみ
//   S2 範囲選択 3 本（話した言葉・時刻が別々）→ 枠 → 本体ドラッグ 40px → 各時刻で位置 → undo / redo
//   再読込 = Electron を起動し直して S1 / S2 の位置が同じ
//   S3 台本の Cmd+A → プレビューの選択 → 本体ドラッグ → undo（比較）
//   S4 全字幕モード（⌥ドラッグ）→ undo（回帰の比較）
//   （S3 / S4 は起動し直した後に行う — 書き込みが残っても S1 / S2 の比較を汚さない）
import { readFile, cp, rm, realpath } from 'node:fs/promises';
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
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON_REL = 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
const ELECTRON = existsSync(path.join(SHELL, ELECTRON_REL)) ? path.join(SHELL, ELECTRON_REL) : path.join(REPO, ELECTRON_REL);
const TMP = path.join(os.tmpdir(), 'caption-multiselect-move-l1');
const FIXTURE_SRC = path.resolve(process.argv.slice(3).find(v => !v.startsWith('--')) ?? path.join(TMP, 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9477);
const RUNS = path.join(TMP, 'runs');
const RESULTS = path.join(ROOT, `results-${PHASE}.json`);
const STRICT = PHASE !== 'before';
const out = { phase: PHASE, status: 'running', checks: [], screenshots: [] };
// AFTER の回帰比較に使う BEFORE の記録（無ければ比較は null）。
const BEFORE = STRICT ? await readFile(path.join(ROOT, 'results-before.json'), 'utf8').then(JSON.parse).catch(() => null) : null;
const META = 4, ALT = 1;
const DRAG_PX = 40;
const PLACED = ['c-0101', 'c-0102', 'c-0103'];
const SPOKEN = ['c-0001', 'c-0002', 'c-0003'];
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
    const hit = await v.eval(`(()=>{const h=document.elementFromPoint(${p.grab.x},${p.grab.y});return Boolean(h&&h.closest('.caption-row-plate'))})()`);
    if (!hit) throw new Error(`grab point ${S(p.grab)} does not hit the caption`);
    return p.grab;
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

let fixture;
try {
    await rm(path.join(TMP, `work-${PHASE}`), { recursive: true, force: true });
    await cp(FIXTURE_SRC, path.join(TMP, `work-${PHASE}`), { recursive: true });
    fixture = await realpath(path.join(TMP, `work-${PHASE}`, 'project'));
    let session = await launch({ shellDir: SHELL, electron: ELECTRON, project: fixture, port: PORT, isoDir: path.join(RUNS, `${PHASE}-1`) });
    out.pids = [session.pid];
    out.consoleWarnings = [];
    session.cdp.on('Runtime.consoleAPICalled', p => {
        if (p.type !== 'warning' && p.type !== 'error') return;
        const text = p.args.map(a => a.value ?? a.description ?? '').join(' ');
        if (/akari-preview|caption|字幕|history/.test(text)) out.consoleWarnings.push(sanitize(text.slice(0, 300), REPO));
    });
    const reloadRef = {};
    try {
        const v = await openAll(session, fixture, SPOKEN_T['c-0004'], 'c-0004');
        await evalOn(session.cdp, shellCall(`s.collapsePanel('left')`)).catch(() => {});
        await sleep(3000);
        const off = await calibrate(session, v);
        out.frame = await v.eval(FRAME);
        out.chips = Object.fromEntries(await Promise.all([...SPOKEN, 'c-0004', ...PLACED].map(async id => [id, await evalOn(session.cdp, CHIP(id))])));

        // ===== S0: 1 本だけ =====
        await check('S0 1 本だけ: タイムラインでクリック → 本体ドラッグで その 1 本だけ動く（保存値・移動量が BEFORE と同じ）', async () => {
            await clickChip(session, 'c-0004');
            await seekTo(session, v, fixture, SPOKEN_T['c-0004'], 'c-0004');
            const timeline = await evalOn(session.cdp, TIMELINE_SELECTED);
            const sel = await v.eval(PREVIEW_SELECTION);
            const pre = await measureAt(session, v, fixture, ['c-0004'], id => SPOKEN_T[id]);
            const d = await bodyDrag(session, off, v, fixture, 'c-0004');
            const post = await measureAt(session, v, fixture, ['c-0004'], id => SPOKEN_T[id]);
            await historyCommand(session, 'akari.timeline.undo');
            const undone = await waitBytes(fixture, d.before);
            const m = { timeline, preview: sel, changedIds: d.diff.map(x => x.id), diff: d.diff, writeCount: d.writeCount, delta: deltas(pre, post), undoRestoresBytes: undone };
            out.s0 = m;
            const b = BEFORE?.s0;
            assert(S(m.timeline) === S(['c-0004']) && S(m.changedIds) === S(['c-0004']) && Math.abs(m.delta['c-0004'].dx - DRAG_PX) <= 1, S(m));
            assert(m.writeCount === 1 && m.preview.find(p => p.plate.startsWith('caption-plate-c-0004'))?.frames.length === 1, S(m.preview));
            if (b) {
                m.vsBefore = { dx: round(m.delta['c-0004'].dx - b.delta['c-0004'].dx), dy: round(m.delta['c-0004'].dy - b.delta['c-0004'].dy), undoBefore: b.undoRestoresBytes, undoAfter: undone, savedSame: S(m.diff) === S(b.diff) };
                assert(Math.abs(m.vsBefore.dx) <= 1 && Math.abs(m.vsBefore.dy) <= 1 && m.vsBefore.savedSame, `vs BEFORE ${S(m.vsBefore)}`);
            }
            return m;
        });
        await deselectPreview(session, off, v);

        // ===== S1: Cmd クリック 3 本（置いた文字・同じ時刻） =====
        await check('S1 Cmd クリック 3 本: タイムラインとプレビューの選択・見えている 3 本に枠', async () => {
            await clickChip(session, PLACED[0]);
            await clickChip(session, PLACED[1], META);
            await clickChip(session, PLACED[2], META);
            await seekTo(session, v, fixture, PLACED_T, PLACED[2]);
            await sleep(800);
            const timeline = await evalOn(session.cdp, TIMELINE_SELECTED);
            const sel = await v.eval(PREVIEW_SELECTION);
            const tools = await v.eval(TOOLS);
            const m = { timeline, preview: sel, tools };
            out.s1Selection = m;
            const selected = sel.filter(p => p.selected).map(p => p.plate);
            assert(S(timeline) === S(PLACED), `timeline ${S(timeline)}`);
            assert(PLACED.every(id => selected.some(p => p.startsWith(`caption-plate-${id}`))), `preview selected ${S(selected)}`);
            assert(sel.filter(p => PLACED.some(id => p.plate.startsWith(`caption-plate-${id}`))).every(p => p.frames.length >= 1), 'frames per plate');
            assert(tools.length === 1, `mini panels ${tools.length}`);
            return m;
        });
        await shot(session, 's1-01-selected', previewClip(off));
        await check(`S1 本体ドラッグ ${DRAG_PX}px → 3 本とも同じ量・書き込み 1 回`, async () => {
            await seek(session, fixture, PLACED_T); await sleep(1000);
            const pre = await measureAt(session, v, fixture, PLACED, () => PLACED_T);
            const d = await bodyDrag(session, off, v, fixture, PLACED[2]);
            const post = await measureAt(session, v, fixture, PLACED, () => PLACED_T);
            await shot(session, 's1-02-dragged', previewClip(off));
            await historyCommand(session, 'akari.timeline.undo');
            const undone = await waitBytes(fixture, d.before);
            const afterUndo = await measureAt(session, v, fixture, PLACED, () => PLACED_T);
            await historyCommand(session, 'akari.timeline.redo');
            const redone = await waitBytes(fixture, d.after);
            const m = { changedIds: d.diff.map(x => x.id), diff: d.diff, writeCount: d.writeCount, delta: deltas(pre, post), undoRestoresBytes: undone, afterUndoDelta: deltas(pre, afterUndo), redoRestoresBytes: redone };
            out.s1Drag = m; reloadRef.s1 = post;
            assert(S([...m.changedIds].sort()) === S(PLACED), `changed ${S(m.changedIds)}`);
            for (const id of PLACED) assert(Math.abs(m.delta[id].dx - DRAG_PX) <= 1 && Math.abs(m.delta[id].dy - m.delta[PLACED[2]].dy) <= 1, `${id}: ${S(m.delta[id])}`);
            assert(m.writeCount === 1, `writes ${m.writeCount}`);
            return m;
        });
        await check('S1 undo 1 回で 3 本とも戻る（Cmd+Z = akari.timeline.undo）', async () => {
            const m = { undoRestoresBytes: out.s1Drag?.undoRestoresBytes ?? null, afterUndoDelta: out.s1Drag?.afterUndoDelta ?? null };
            assert(m.undoRestoresBytes === true, S(m));
            return m;
        });
        await check('S1 角のつまみ → 3 本とも同じ倍率', async () => {
            await seek(session, fixture, PLACED_T); await sleep(1000);
            const before = await captionsOf(fixture);
            const h = await waitFor('se handle', () => v.eval(HANDLE(PLACED[2], 'se')), 10_000);
            await dragPage(session.cdp, toPage(off, h), toPage(off, { x: h.x + 30, y: h.y + 10 }));
            await waitFor('scale written', async () => S(await captionsOf(fixture)) !== S(before), 15_000).catch(() => null);
            await sleep(1500);
            const rows = await captionsOf(fixture);
            const scales = Object.fromEntries(rows.filter(r => r.id.startsWith('c-0')).map(r => [r.id, r.text_style?.scale ?? null]));
            await shot(session, 's1-03-scaled', previewClip(off));
            const m = { scales };
            out.s1Scale = m;
            reloadRef.s1 = await measureAt(session, v, fixture, PLACED, () => PLACED_T);
            const s = PLACED.map(id => scales[id]);
            assert(s.every(x => typeof x === 'number' && x !== 1 && x === s[0]), `scales ${S(s)}`);
            return m;
        });
        await deselectPreview(session, off, v);

        // ===== S2: 範囲選択 3 本（話した言葉・時刻が別々） =====
        await check('S2 範囲選択 3 本: タイムラインとプレビューの選択・見えている選択中に枠', async () => {
            const c1 = await evalOn(session.cdp, CHIP(SPOKEN[0]));
            const c3 = await evalOn(session.cdp, CHIP(SPOKEN[2]));
            const pps = (c1.right - c1.left) / 3.6;
            const y = (c1.top + c1.bottom) / 2;
            const start = { x: c1.left - 0.6 * pps, y };
            const end = { x: c3.right + 0.2 * pps, y: y + 2 };
            const free = await evalOn(session.cdp, FREE_STRIP_POINT(start.x, start.y));
            await dragPage(session.cdp, start, end);
            await sleep(800);
            await seekTo(session, v, fixture, SPOKEN_T['c-0001'], 'c-0001');
            await sleep(800);
            const timeline = await evalOn(session.cdp, TIMELINE_SELECTED);
            const sel = await v.eval(PREVIEW_SELECTION);
            const tools = await v.eval(TOOLS);
            const m = { marquee: { start, end, startFree: free }, timeline, preview: sel, tools };
            out.s2Selection = m;
            assert(S(timeline) === S(SPOKEN), `timeline ${S(timeline)}`);
            const c1Plate = sel.find(p => p.plate.startsWith('caption-plate-c-0001'));
            assert(c1Plate?.selected && c1Plate.frames.length >= 1, `c-0001 ${S(c1Plate)}`);
            return m;
        });
        await shot(session, 's2-01-selected', previewClip(off));
        await check(`S2 本体ドラッグ ${DRAG_PX}px → 見えていない 2 本も同じ量・書き込み 1 回`, async () => {
            const pre = await measureAt(session, v, fixture, SPOKEN, id => SPOKEN_T[id]);
            await seekTo(session, v, fixture, SPOKEN_T['c-0001'], 'c-0001');
            const d = await bodyDrag(session, off, v, fixture, 'c-0001');
            const post = await measureAt(session, v, fixture, SPOKEN, id => SPOKEN_T[id]);
            await historyCommand(session, 'akari.timeline.undo');
            const undone = await waitBytes(fixture, d.before);
            await historyCommand(session, 'akari.timeline.redo');
            const redone = await waitBytes(fixture, d.after);
            const m = { changedIds: d.diff.map(x => x.id), diff: d.diff, writeCount: d.writeCount, delta: deltas(pre, post), undoRestoresBytes: undone, redoRestoresBytes: redone };
            out.s2Drag = m; reloadRef.s2 = post;
            assert(S([...m.changedIds].sort()) === S(SPOKEN), `changed ${S(m.changedIds)}`);
            for (const id of SPOKEN) assert(Math.abs(m.delta[id].dx - DRAG_PX) <= 1 && Math.abs(m.delta[id].dy - m.delta['c-0001'].dy) <= 1, `${id}: ${S(m.delta[id])}`);
            assert(m.writeCount === 1, `writes ${m.writeCount}`);
            return m;
        });
        await check('S2 undo 1 回で 3 本とも戻る（Cmd+Z = akari.timeline.undo）', async () => {
            const m = { undoRestoresBytes: out.s2Drag?.undoRestoresBytes ?? null };
            assert(m.undoRestoresBytes === true, S(m));
            return m;
        });
        await seekTo(session, v, fixture, SPOKEN_T['c-0002'], 'c-0002');
        await shot(session, 's2-02-dragged-c-0002', previewClip(off));
        await deselectPreview(session, off, v);

        v.cdp.close();
    } finally { await stop(session); }

    // ===== 再読込（Electron を起動し直す） =====
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: fixture, port: PORT, isoDir: path.join(RUNS, `${PHASE}-2`) });
    out.pids.push(session.pid);
    try {
        const v = await openAll(session, fixture, SPOKEN_T['c-0001'], 'c-0001');
        await evalOn(session.cdp, shellCall(`s.collapsePanel('left')`)).catch(() => {});
        await sleep(3000);
        await check('再読込: S1（拡縮後）/ S2 の位置が起動し直した後も同じ（±1px）', async () => {
            const s1 = await measureAt(session, v, fixture, PLACED, () => PLACED_T);
            const s2 = await measureAt(session, v, fixture, SPOKEN, id => SPOKEN_T[id]);
            const m = { s1: { before: reloadRef.s1, after: s1, diff: reloadRef.s1 ? deltas(reloadRef.s1, s1) : null }, s2: { before: reloadRef.s2, after: s2, diff: reloadRef.s2 ? deltas(reloadRef.s2, s2) : null } };
            for (const group of [m.s1, m.s2]) for (const [id, dd] of Object.entries(group.diff ?? {})) assert(dd && Math.abs(dd.dx) <= 1 && Math.abs(dd.dy) <= 1, `${id}: ${S(dd)}`);
            return m;
        });
        const off2 = await calibrate(session, v);
        // ===== S3: 台本の Cmd+A（比較） =====
        await check('S3 台本の Cmd+A → プレビューの選択 → 本体ドラッグ → undo', async () => {
            await evalOn(session.cdp, command('akari.daihon.open'));
            await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-row').length>0`, { label: 'daihon rows', timeoutMs: 60_000 });
            await sleep(1000);
            const row = await evalOn(session.cdp, `(()=>{const r=document.querySelector('.akari-daihon-row .akari-daihon-tc')||document.querySelector('.akari-daihon-row');r.scrollIntoView({block:'center'});const b=r.getBoundingClientRect();return{x:b.left+Math.min(12,b.width/2),y:b.top+b.height/2}})()`);
            await realClick(session.cdp, row.x, row.y);
            await sleep(600);
            const k = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: META };
            await session.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k, commands: ['selectAll'] });
            await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
            await sleep(1200);
            const daihonSelected = await evalOn(session.cdp, `[...document.querySelectorAll('.akari-daihon-row')].filter(r=>r.classList.contains('selected')||r.classList.contains('is-selected')||r.getAttribute('aria-selected')==='true'||r.hasAttribute('data-selected')).map(r=>r.dataset.captionId)`);
            const timeline = await evalOn(session.cdp, TIMELINE_SELECTED);
            await seekTo(session, v, fixture, SPOKEN_T['c-0001'], 'c-0001');
            await sleep(800);
            const sel = await v.eval(PREVIEW_SELECTION);
            const d = await bodyDrag(session, off2, v, fixture, 'c-0001');
            await historyCommand(session, 'akari.timeline.undo');
            const undone = await waitBytes(fixture, d.before);
            const m = { daihonSelected, timeline, preview: sel, changedIds: d.diff.map(x => x.id), writeCount: d.writeCount, undoRestoresBytes: undone };
            out.s3 = m;
            const b = BEFORE?.s3;
            if (b) {
                m.vsBefore = { daihonSame: S(daihonSelected) === S(b.daihonSelected), timelineSame: S(timeline) === S(b.timeline), before: { daihon: b.daihonSelected, timeline: b.timeline, changedIds: b.changedIds } };
                assert(m.vsBefore.daihonSame && m.vsBefore.timelineSame, `vs BEFORE ${S(m.vsBefore)}`);
            }
            assert(sel.find(p => p.plate.startsWith('caption-plate-c-0001'))?.selected, 'c-0001 selected in preview');
            return m;
        });
        await shot(session, 's3-01-daihon-select-all', previewClip(off2));
        await deselectPreview(session, off2, v);

        // ===== S4: 全字幕モード（⌥ドラッグ・比較） =====
        await check('S4 全字幕モード: ⌥ドラッグで群の既定位置 → undo', async () => {
            await clickChip(session, 'c-0004');
            await seekTo(session, v, fixture, SPOKEN_T['c-0004'], 'c-0004');
            const beforeRoot = await rootOf(fixture);
            const d = await bodyDrag(session, off2, v, fixture, 'c-0004', { dx: 0, dy: -30, modifiers: ALT });
            const afterRoot = JSON.parse(d.after);
            await historyCommand(session, 'akari.timeline.undo');
            const undone = await waitBytes(fixture, d.before);
            const m = { defaultTextStyle: { before: beforeRoot.default_text_style, after: afterRoot.default_text_style }, changedIds: d.diff.map(x => x.id), writeCount: d.writeCount, undoRestoresBytes: undone };
            out.s4 = m;
            const b = BEFORE?.s4;
            if (b) {
                // 群の既定位置の値そのものは掴んだ字幕の直前の位置（S0 / S3 の書き込みの残り）に依存するので、形（群の既定だけが変わる・cue は書かない）で比べる。
                const shape = t => t ? Object.keys(t).sort().join(',') : null;
                m.vsBefore = { defaultShapeSame: shape(m.defaultTextStyle.after) === shape(b.defaultTextStyle.after), changedSame: S(m.changedIds) === S(b.changedIds), undoBefore: b.undoRestoresBytes, before: b.defaultTextStyle };
                assert(m.vsBefore.defaultShapeSame && m.vsBefore.changedSame && m.writeCount === 1, `vs BEFORE ${S(m.vsBefore)}`);
            }
            return m;
        });
        await deselectPreview(session, off2, v);
        v.cdp.close();
    } finally { await stop(session); }
    out.finalCaptions = JSON.parse(await readCaptions(fixture));
    out.status = STRICT ? (out.checks.every(c => c.pass) ? 'pass' : 'fail') : 'recorded';
} catch (error) {
    out.status = 'fail'; out.error = sanitize(error, REPO);
} finally { await saveJson(RESULTS, out); }
console.log(out.status);
