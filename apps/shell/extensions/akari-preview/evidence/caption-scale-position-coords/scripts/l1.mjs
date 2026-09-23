#!/usr/bin/env node
// 字幕の拡縮・回転のあとに動かすと位置が飛ぶ件の L1（ラッパー作成の検証スクリプト）。fixture は gen-fixture.mjs で作る。
// 使い方: node l1.mjs <before|after> [fixture dir] [--port=9479]
// 実機の Electron を自分専用のポート・一時ディレクトリで起動し、CDP の実マウスで操作して実測する。
// 流れ: 初期描画の記録 → (a)(b)(c) 角のつまみ 1.5 倍 / 0.7 倍・回転つまみ 15° → 再読込 R0 →
//       3 回繰り返し（全ケースを本体ドラッグ +20px → 離す → 再読込 R1〜R3）→ 全字幕モード（⌥ドラッグ）→ 再読込 R4 → 全字幕の最終位置。
// 「再読込」= Electron を自分専用の一時ディレクトリで起動し直す（captions.json をディスクから読み直す）。
// 「px」はプレビュー上の表示 px（webview の CSS px。ウィンドウ 1440×900・倍率 1）。
// before = 変更前ビルドの観測記録（判定はしない）/ after = 受け入れ条件の判定つき。
import { readFile, cp, rm, realpath, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';
import { S, command, launch, sanitize, saveJson, sleep, stop as stopSession, waitEval } from './l1-lib.mjs';
import { spawnSync } from 'node:child_process';
// 自分の一時ディレクトリで起動した Electron（Helper を含む）だけを止める。
async function stop(session) { await stopSession(session); if (session?.isoDir) spawnSync('/usr/bin/pkill', ['-f', '--', `--user-data-dir=${session.isoDir}`]); }

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON_REL = 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
const ELECTRON = existsSync(path.join(SHELL, ELECTRON_REL)) ? path.join(SHELL, ELECTRON_REL) : path.join(REPO, ELECTRON_REL);
const TMP = path.join(os.tmpdir(), 'caption-scale-position-coords-l1');
const FIXTURE_SRC = path.resolve(process.argv.slice(3).find(v => !v.startsWith('--')) ?? path.join(TMP, 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9479);
const RUNS = path.join(TMP, 'runs');
const RESULTS = path.join(ROOT, `results-${PHASE}.json`);
const STRICT = PHASE !== 'before';
const ALT = 1, SHIFT = 8;
const out = { phase: PHASE, status: 'running', checks: [], screenshots: [], pids: [] };

const IDS = ['c-0001', 'c-0002', 'c-0003', 'c-0004', 'c-0005', 'c-0006', 'c-0007', 'c-0008', 'c-0101', 'c-0009', 'c-0010', 'c-0011', 'c-0012', 'c-0013', 'c-0014'];
const SEEK = Object.fromEntries(IDS.map((id, index) => [id, index * 4 + 1.5]));
// 本体ドラッグの繰り返しの対象（dx = 押したまま動かす量）。
const DRAG_CASES = [
    { id: 'c-0001', name: '(a) 1.5 倍', dx: 20 },
    { id: 'c-0002', name: '(b) 0.7 倍', dx: 20 },
    { id: 'c-0003', name: '(c) 回転 15°', dx: 20 },
    { id: 'c-0004', name: '(d) 1 行・拡縮回転なし', dx: 20 },
    { id: 'c-0005', name: '(d) 複数行', dx: 20 },
    { id: 'c-0006', name: '(d) プリセット相当（subtitle-news）', dx: 20 },
    { id: 'c-0007', name: '(d) アンカー mc', dx: 20 },
    { id: 'c-0008', name: '(d) アンカー tc', dx: 20 },
    { id: 'c-0101', name: '(d) 置いた文字', dx: 20 },
    { id: 'c-0009', name: '(d) 画面の外（x −0.2）', dx: 20 },
    { id: 'c-0010', name: '(d) 中央吸着（+6px）', dx: 6 }
];
const TRANSFORMS = [
    { id: 'c-0001', name: '(a) 角のつまみ 1.5 倍', kind: 'scale', value: 1.5 },
    { id: 'c-0002', name: '(b) 角のつまみ 0.7 倍', kind: 'scale', value: 0.7 },
    { id: 'c-0003', name: '(c) 回転つまみ 15°', kind: 'rotate', value: 15 }
];

// 位置 x を持つ字幕（3 回動かした c-0004・fixture で x を持つ c-0012 / c-0013）でのつまみ。
const X_TRANSFORMS = [
    { id: 'c-0004', name: '(x あり) 角のつまみ 1.5 倍', kind: 'scale', value: 1.5 },
    { id: 'c-0012', name: '(x あり) 回転つまみ 15°', kind: 'rotate', value: 15 },
    { id: 'c-0013', name: '(x あり・既に 1.5 倍) 角のつまみで 2 倍', kind: 'scale', value: 2, factor: 2 / 1.5 }
];
const assert = (condition, message) => { if (STRICT && !condition) throw new Error(message); };
async function check(name, operation) {
    const record = { name, pass: false };
    out.checks.push(record);
    try { record.detail = await operation(); record.pass = true; }
    catch (error) { record.error = sanitize(error, REPO); }
    finally { await saveJson(RESULTS, out); }
    return record.detail;
}
const rootOf = async project => JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8'));
const rowOf = async (project, id) => { const p = await rootOf(project); return (Array.isArray(p) ? p : p.captions).find(c => c.id === id); };
async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(250); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
// コマンドを実行して完了を待たない（再読込直後はコマンドの Promise が返らないことがある）。
const commandNoWait = (id, arg) => `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');window.theia.container.get(C).executeCommand(${S(id)}${arg === undefined ? '' : `,${S(arg)}`}).catch(()=>{});return true})()`;
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
        close: () => cdp?.close(),
        eval: async expr => { try { return await evalOn(cdp, expr, ctx); } catch { await attach(); return evalOn(cdp, expr, ctx); } }
    };
}
async function calibrate(session, v) {
    await v.eval(`(()=>{if(!window.__cspcHooked){window.__cspcHooked=true;window.addEventListener('pointermove',e=>window.__cspcPointer={x:e.clientX,y:e.clientY},true)}return true})()`);
    const frame = await evalOn(session.cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return{left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    // 高負荷の機械では webview の入力処理が遅れる → 同じ点へ動かし直しながら最大 180 秒待つ。
    const probe = async (x, y) => {
        await v.eval('window.__cspcPointer=null');
        return waitFor('pointer', async () => {
            await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 3, y: y - 3, button: 'none' }); await sleep(80);
            await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(400);
            const p = await v.eval('window.__cspcPointer');
            return p;
        }, 180_000);
    };
    const a = { x: Math.round(frame.left + frame.width * 0.3), y: Math.round(frame.top + frame.height * 0.3) };
    const b = { x: Math.round(frame.left + frame.width * 0.7), y: Math.round(frame.top + frame.height * 0.6) };
    const la = await probe(a.x, a.y), lb = await probe(b.x, b.y);
    const sx = (b.x - a.x) / (lb.x - la.x), sy = (b.y - a.y) / (lb.y - la.y);
    return { sx, sy, dx: a.x - la.x * sx, dy: a.y - la.y * sy, iframe: frame };
}
const toPage = (off, pt) => ({ x: pt.x * off.sx + off.dx, y: pt.y * off.sy + off.dy });

const FRAME = `(()=>{const c=[...document.querySelectorAll('#preview-stage canvas, #preview-stage video')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>50).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return c?{x:c.x,y:c.y,w:c.width,h:c.height}:null})()`;
const PLATE_EL = id => `const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));`;
// 文字の見た目の矩形（.akari-caption__block か .akari-caption__line の外接矩形 = OH の captionVisualRect と同じ取り方。
// getBoundingClientRect なので拡縮・回転の後の見た目）と、行ごとの矩形・行数・掴む点。
const PLATE = id => `(()=>{${PLATE_EL(id)}if(!p)return null;const cs0=getComputedStyle(p);if(cs0.display==='none'||cs0.visibility==='hidden')return null;const block=p.querySelector('.akari-caption__block');const lineEls=[...p.querySelectorAll('.akari-caption__line')];const els=block?[block]:lineEls;const rs=(els.length?els:[p]).map(e=>e.getBoundingClientRect());const r={left:Math.min(...rs.map(x=>x.left)),right:Math.max(...rs.map(x=>x.right)),top:Math.min(...rs.map(x=>x.top)),bottom:Math.max(...rs.map(x=>x.bottom))};if(!(r.right-r.left>0))return null;const tops=new Set();for(const e of (lineEls.length?lineEls:[block||p])){const range=document.createRange();range.selectNodeContents(e);for(const x of range.getClientRects())if(x.width>0&&x.height>0)tops.add(Math.round(x.top))}const g=(lineEls[0]||block||p).getBoundingClientRect();const px=v=>Math.round(v*100)/100;const plate=p.querySelector('.akari-caption__plate');const pr=plate?.getBoundingClientRect();const pcs=plate?getComputedStyle(plate):null;return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,cx:(r.left+r.right)/2,cy:(r.top+r.bottom)/2,w:r.right-r.left,h:r.bottom-r.top,lines:tops.size,lineRects:lineEls.map(e=>{const b=e.getBoundingClientRect();return{left:px(b.left),right:px(b.right),top:px(b.top)}}),text:(block||p).textContent.slice(0,24),selected:p.hasAttribute('data-selected'),plateBox:pr?{left:px(pr.left),right:px(pr.right),width:px(pr.width),transform:pcs.transform,origin:pcs.transformOrigin}:null,grab:{x:g.left+g.width/2,y:g.top+g.height/2}}})()`;
const HANDLE = (id, h) => `(()=>{${PLATE_EL(id)}const e=p?.querySelector('.akari-caption-handle[data-h=${S(h)}]');if(!e)return null;const cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden')return null;const r=e.getBoundingClientRect();if(!(r.width>0))return null;const x=r.left+r.width/2,y=r.top+r.height/2;for(const[fx,fy]of[[0,0],[0,.3],[-.3,0],[.3,0],[0,-.3],[-.3,.3],[.3,.3],[-.3,-.3],[.3,-.3]]){const px=x+fx*r.width,py=y+fy*r.height;const hit=document.elementFromPoint(px,py);if(hit&&(hit===e||e.contains(hit)))return{x:px,y:py,hit:true}}const h=document.elementFromPoint(x,y);return{x,y,hit:false,cover:h?h.outerHTML.slice(0,160):null}})()`;

async function openAll(session, project, seekTo) {
    await evalOn(session.cdp, commandNoWait('akari.annotations.open'));
    await waitEval(session.cdp, `Boolean(document.querySelector('.akari-annotations-widget, .akari-annotations'))||document.querySelectorAll('[class*="akari-timeline"]').length>0`, { label: 'timeline', timeoutMs: 120_000 });
    await waitFor('preview webview', async () => {
        await evalOn(session.cdp, commandNoWait('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time: seekTo }));
        await sleep(3000);
        return (await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
    }, 120_000);
    await sleep(2500);
    const v = await view(PORT);
    await waitFor('c-0001 plate', async () => { await seek(session, project, seekTo); await sleep(1200); return v.eval(PLATE('c-0001')); }, 120_000);
    await evalOn(session.cdp, shellCall(`s.collapsePanel('left');s.collapsePanel('right')`)).catch(() => {});
    await sleep(3000);
    const off = await calibrate(session, v);
    return { v, off };
}
const seek = (session, project, time) => evalOn(session.cdp, commandNoWait('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time }));
async function seekTo(session, v, project, id) {
    return waitFor(`${id} plate`, async () => { await seek(session, project, SEEK[id]); await sleep(1200); return v.eval(PLATE(id)); }, 60_000);
}
async function shot(session, off, name) {
    await sleep(500);
    const file = `${PHASE}-${name}.png`;
    const f = off.iframe;
    const { data } = await session.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: f.left, y: f.top, width: f.width, height: f.height, scale: 1 } });
    await writeFile(path.join(ROOT, file), Buffer.from(data, 'base64'));
    out.screenshots.push(file);
}
// 位置と幅が 3 回続けて変わらなくなるまで待って返す（保存後の再描画・再読込の途中を掴まない）。
async function stablePlate(v, id, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs; let last = null, same = 0;
    while (Date.now() < deadline) {
        const p = await v.eval(PLATE(id));
        if (p && last && Math.abs(p.left - last.left) < 0.3 && Math.abs(p.top - last.top) < 0.3 && Math.abs(p.w - last.w) < 0.3) { if (++same >= 3) return p; }
        else same = 0;
        last = p; await sleep(350);
    }
    return last;
}
async function grabPoint(v, p) {
    const hit = await v.eval(`(()=>{const h=document.elementFromPoint(${p.grab.x},${p.grab.y});return Boolean(h&&h.closest('.caption-row-plate'))})()`);
    if (!hit) throw new Error(`grab point ${S(p.grab)} does not hit the caption`);
    return p.grab;
}
async function clickLocal(session, off, pt, opts = {}) { const p = toPage(off, pt); await realClick(session.cdp, p.x, p.y, opts); }
async function deselect(session, off, v) {
    const free = await v.eval(`(()=>{const f=${FRAME};for(const[x,y]of[[.92,.05],[.08,.05],[.6,.05],[.92,.3],[.3,.05]]){const p={x:f.x+f.w*x,y:f.y+f.h*y};const h=document.elementFromPoint(p.x,p.y);if(h&&!h.closest('.caption-row-plate, #caption-select-box'))return p}return null})()`);
    if (free) { await clickLocal(session, off, free); await sleep(600); }
}
const rel = (p, fr) => p ? ({ cx: round(p.cx - fr.x), cy: round(p.cy - fr.y), left: round(p.left - fr.x), top: round(p.top - fr.y), right: round(p.right - fr.x), bottom: round(p.bottom - fr.y), w: round(p.w), h: round(p.h), lines: p.lines, lineLefts: p.lineRects.map(l => round(l.left - fr.x)), plateBox: p.plateBox ? { left: round(p.plateBox.left - fr.x), width: p.plateBox.width, transform: p.plateBox.transform, origin: p.plateBox.origin } : null }) : null;
const diff = (a, b) => (a && b ? { cx: round(b.cx - a.cx), cy: round(b.cy - a.cy), left: round(b.left - a.left), top: round(b.top - a.top), w: round(b.w - a.w), lines: b.lines - a.lines } : null);
const styleOf = row => row?.text_style ?? null;

async function mouse(cdp, type, pt, modifiers = 0, extra = {}) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: type === 'mouseMoved' ? (extra.buttons ? 'left' : 'none') : 'left', buttons: extra.buttons ?? 0, clickCount: extra.clickCount ?? (type === 'mouseMoved' ? 0 : 1), modifiers });
}
/** from / waypoints は webview ローカル座標。各 waypoint = { x, y, modifiers?, probe?: label }。 */
async function probeDrag(session, off, from, waypoints, onProbe, { steps = 10, pressModifiers = 0 } = {}) {
    const cdp = session.cdp;
    const start = toPage(off, from);
    await mouse(cdp, 'mouseMoved', start, pressModifiers); await sleep(150);
    await mouse(cdp, 'mousePressed', start, pressModifiers, { buttons: 1 }); await sleep(150);
    let prev = from; const probes = {};
    for (const wp of waypoints) {
        for (let s = 1; s <= steps; s++) {
            const pt = { x: prev.x + (wp.x - prev.x) * s / steps, y: prev.y + (wp.y - prev.y) * s / steps };
            await mouse(cdp, 'mouseMoved', toPage(off, pt), wp.modifiers ?? 0, { buttons: 1 }); await sleep(40);
        }
        for (let i = 0; i < 2; i++) { await mouse(cdp, 'mouseMoved', toPage(off, wp), wp.modifiers ?? 0, { buttons: 1 }); await sleep(150); }
        if (wp.probe) probes[wp.probe] = await onProbe(wp.probe);
        prev = wp;
    }
    const last = waypoints.at(-1);
    await mouse(cdp, 'mouseReleased', toPage(off, last), last.modifiers ?? 0, { buttons: 0 });
    return probes;
}
async function waitChanged(read, before, label, timeoutMs = 15_000) {
    return waitFor(label, async () => { const now = await read(); return S(now) !== S(before) && { value: now }; }, timeoutMs).then(r => r.value).catch(() => read());
}

// ---- 再読込 = Electron を起動し直す（captions.json をディスクから読み直す）----
// 高負荷の機械ではウィンドウの再読み込み（Page.reload）後に webview へ入力が届かないことがあったため、毎回起動し直す。
let session, reloadCount = 0;
async function startSession(label) {
    const isoDir = path.join(RUNS, `${PHASE}-${label}`);
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: fixture, port: PORT, isoDir });
    session.isoDir = isoDir;
    out.pids.push(session.pid);
    for (let attempt = 1; ; attempt++) {
        try { out.step = `open ${label} ${attempt}`; return await openAll(session, fixture, 1); }
        catch (error) { if (attempt >= 3) throw error; await sleep(5000); }
    }
}
async function reloadWindow(_session, _project, ctx) {
    out.step = 'reload';
    ctx.v.close();
    await stop(session);
    session = undefined;
    reloadCount += 1;
    return startSession(`r${reloadCount}`);
}
async function measureAll(session, ctx, project, ids) {
    out.step = `measure ${ids.join(',')}`;
    const fr = await ctx.v.eval(FRAME);
    const m = { frame: fr };
    for (const id of ids) { await seekTo(session, ctx.v, project, id); m[id] = rel(await stablePlate(ctx.v, id), fr); }
    return m;
}

// 角のつまみ（scale）・回転つまみ（rotate）の操作 1 回。つまみを押す前と、押したまま・離して再描画した後の文字の中心を測る。
async function transformCase(ctx, t) {
    const { v, off } = ctx;
    const fr = await v.eval(FRAME);
    await seekTo(session, v, fixture, t.id);
    const p0 = await stablePlate(v, t.id);
    await clickLocal(session, off, await grabPoint(v, p0)); await sleep(800);
    // 回転つまみ（文字の上 34px）はミニパネルの道具に重なることがある（BEFORE で実測）。つまみを押すためだけに
    // その間だけ道具を見えなくする（位置の計算には関与しない）。
    if (t.kind === 'rotate') await v.eval(`(()=>{const s=document.createElement('style');s.id='cspc-hide-tools';s.textContent='#caption-select-box .akari-caption-select-tools,#caption-select-box [data-caption-tool],#caption-select-box [data-caption-palette]{visibility:hidden!important;pointer-events:none!important}';document.head.appendChild(s);return true})()`);
    const h = await waitFor(`${t.id} handle`, () => v.eval(HANDLE(t.id, t.kind === 'scale' ? 'se' : 'rot')), 10_000);
    if (!h.hit) throw new Error(`${t.kind} handle is covered by ${h.cover}`);
    const c = { x: p0.cx, y: p0.cy };
    const vx = h.x - c.x, vy = h.y - c.y;
    let waypoints;
    if (t.kind === 'scale') {
        const f = t.factor ?? t.value;
        waypoints = [{ x: c.x + vx * f, y: c.y + vy * f, probe: 'hold' }];
    } else {
        // 中心の周りに 5 段で +15°（画面座標 = 時計回り）。最後は Shift で 15° 刻みへスナップ。
        waypoints = [1, 2, 3, 4, 5].map(k => {
            const a = (t.value * k / 5) * Math.PI / 180;
            return { x: c.x + vx * Math.cos(a) - vy * Math.sin(a), y: c.y + vx * Math.sin(a) + vy * Math.cos(a), ...(k === 5 ? { modifiers: SHIFT, probe: 'hold' } : {}) };
        });
    }
    const before = styleOf(await rowOf(fixture, t.id));
    const probes = await probeDrag(session, off, h, waypoints, () => v.eval(PLATE(t.id)), { steps: 8 });
    const saved = await waitChanged(async () => styleOf(await rowOf(fixture, t.id)), before, `${t.id} ${t.kind} saved`);
    await sleep(800);
    const settled = await stablePlate(v, t.id);
    const m = { before: rel(p0, fr), hold: rel(probes.hold, fr), settled: rel(settled, fr), saved,
        centerShiftHold: diff(rel(p0, fr), rel(probes.hold, fr)), centerShiftSettled: diff(rel(p0, fr), rel(settled, fr)) };
    out.transforms ??= {};
    if (TRANSFORMS.includes(t)) out.transforms[t.id] = m;
    await v.eval(`(()=>{document.getElementById('cspc-hide-tools')?.remove();return true})()`);
    await deselect(session, off, v);
    assert(Math.abs((saved?.[t.kind] ?? 0) - t.value) <= 0.02, `saved ${t.kind} ${S(saved)}`);
    assert(Math.abs(m.centerShiftHold.cx) <= 1 && Math.abs(m.centerShiftHold.cy) <= 1, `hold center shift ${S(m.centerShiftHold)}`);
    assert(Math.abs(m.centerShiftSettled.cx) <= 1 && Math.abs(m.centerShiftSettled.cy) <= 1, `settled center shift ${S(m.centerShiftSettled)}`);
    return m;
}

let fixture;
try {
    const work = path.join(TMP, `work-${PHASE}`);
    await rm(work, { recursive: true, force: true });
    await cp(FIXTURE_SRC, work, { recursive: true });
    fixture = await realpath(path.join(work, 'project'));
    try {
        let ctx = await startSession('r0');
        out.frame = await ctx.v.eval(FRAME);
        out.initial = await measureAll(session, ctx, fixture, IDS);
        await shot(session, ctx.off, '00-initial-c-0013');

        // ===== (a)(b)(c) 角のつまみ・回転つまみ =====
        out.transforms = {};
        for (const t of TRANSFORMS) {
            out.step = `transform ${t.id}`;
            await check(`${t.name}: つまみの操作で文字の中心が動かない`, () => transformCase(ctx, t));
        }
        await seekTo(session, ctx.v, fixture, 'c-0001');
        await shot(session, ctx.off, '01-a-scaled-1.5');
        ctx = await reloadWindow(session, fixture, ctx);
        out.reload0 = await measureAll(session, ctx, fixture, TRANSFORMS.map(t => t.id));
        await check('つまみの操作 → 再読込: 文字の中心が保存前と同じ', async () => {
            const m = {};
            for (const t of TRANSFORMS) {
                m[t.id] = diff(out.transforms[t.id]?.settled, out.reload0[t.id]);
                assert(m[t.id] && Math.abs(m[t.id].cx) <= 1 && Math.abs(m[t.id].cy) <= 1, `${t.id} ${S(m[t.id])}`);
            }
            return m;
        });

        // ===== 本体ドラッグ → 離す → 再読込 を 3 回 =====
        out.iterations = [];
        for (let i = 1; i <= 3; i++) {
            const iteration = { index: i, cases: {} };
            out.iterations.push(iteration);
            for (const dc of DRAG_CASES) {
                out.step = `iteration ${i} ${dc.id}`;
                const { v, off } = ctx;
                const fr = await v.eval(FRAME);
                try {
                    await seekTo(session, v, fixture, dc.id);
                    const pre = await stablePlate(v, dc.id);
                    const from = await grabPoint(v, pre);
                    const before = styleOf(await rowOf(fixture, dc.id));
                    const probes = await probeDrag(session, off, from, [{ x: from.x + dc.dx, y: from.y, probe: 'hold' }], () => v.eval(PLATE(dc.id)));
                    const saved = await waitChanged(async () => styleOf(await rowOf(fixture, dc.id)), before, `${dc.id} saved`);
                    await sleep(800);
                    await deselect(session, off, v);
                    const settled = await stablePlate(v, dc.id);
                    iteration.cases[dc.id] = { name: dc.name, pre: rel(pre, fr), hold: rel(probes.hold, fr), settled: rel(settled, fr), saved,
                        moved: diff(rel(pre, fr), rel(probes.hold, fr)), holdToSettled: diff(rel(probes.hold, fr), rel(settled, fr)) };
                } catch (error) {
                    iteration.cases[dc.id] = { name: dc.name, error: sanitize(error, REPO) };
                    await deselect(session, off, v).catch(() => {});
                }
                await saveJson(RESULTS, out);
            }
            if (i === 1) { await seekTo(session, ctx.v, fixture, 'c-0001'); await shot(session, ctx.off, '02-a-after-drag-1'); }
            ctx = await reloadWindow(session, fixture, ctx);
            const reloaded = await measureAll(session, ctx, fixture, DRAG_CASES.map(d => d.id));
            for (const dc of DRAG_CASES) {
                const c = iteration.cases[dc.id];
                if (!c || c.error) continue;
                c.reloaded = reloaded[dc.id];
                c.holdToReloaded = diff(c.hold, c.reloaded);
            }
            await saveJson(RESULTS, out);
            if (i === 3) {
                for (const id of ['c-0001', 'c-0002', 'c-0003', 'c-0005']) { await seekTo(session, ctx.v, fixture, id); await shot(session, ctx.off, `03-after-3-reloads-${id}`); }
            }
        }
        await check('本体ドラッグ 3 回: 離した瞬間と再読込後の文字の中心の差（(a)(b)(c) は ±1px・累積なし）', async () => {
            const m = {};
            for (const dc of DRAG_CASES) {
                m[dc.id] = { name: dc.name, holdToReloaded: out.iterations.map(it => it.cases[dc.id]?.holdToReloaded ?? it.cases[dc.id]?.error ?? null),
                    moved: out.iterations.map(it => it.cases[dc.id]?.moved?.cx ?? null) };
                const cumulative = out.iterations.at(-1).cases[dc.id]?.reloaded && out.iterations[0].cases[dc.id]?.pre
                    ? round(out.iterations.at(-1).cases[dc.id].reloaded.cx - out.iterations[0].cases[dc.id].pre.cx) : null;
                m[dc.id].cumulativeCx = cumulative;
                m[dc.id].expectedCumulativeCx = out.iterations.reduce((s, it) => s + (it.cases[dc.id]?.moved?.cx ?? 0), 0);
            }
            if (STRICT) {
                for (const dc of DRAG_CASES) for (const d of m[dc.id].holdToReloaded) {
                    assert(d && typeof d === 'object' && Math.abs(d.cx) <= 1 && Math.abs(d.cy) <= 1, `${dc.id} ${dc.name}: ${S(d)}`);
                }
            }
            return m;
        });

        // ===== 位置 x を持つ字幕のつまみ（x を持つと箱の左端が x に来る = BEFORE で基準点が文字から外れていた形）=====
        out.xTransforms = {};
        for (const t of X_TRANSFORMS) {
            out.step = `x-transform ${t.id}`;
            await check(`${t.name}: つまみの操作で文字の中心が動かない`, async () => { const m = await transformCase(ctx, t); out.xTransforms[t.id] = m; return m; });
        }
        await check('位置 x を持つ字幕のつまみ → 本体ドラッグ +20px → 離す → 再読込', async () => {
            const m = {};
            for (const t of X_TRANSFORMS) {
                const { v, off } = ctx;
                const fr = await v.eval(FRAME);
                await seekTo(session, v, fixture, t.id);
                const pre = await stablePlate(v, t.id);
                const from = await grabPoint(v, pre);
                const before = styleOf(await rowOf(fixture, t.id));
                const probes = await probeDrag(session, off, from, [{ x: from.x + 20, y: from.y, probe: 'hold' }], () => v.eval(PLATE(t.id)));
                const saved = await waitChanged(async () => styleOf(await rowOf(fixture, t.id)), before, `${t.id} saved`);
                await sleep(800);
                await deselect(session, off, v);
                m[t.id] = { name: t.name, pre: rel(pre, fr), hold: rel(probes.hold, fr), saved, moved: diff(rel(pre, fr), rel(probes.hold, fr)) };
            }
            await seekTo(session, ctx.v, fixture, 'c-0013');
            await shot(session, ctx.off, '04-x-caption-scaled-before-reload');
            ctx = await reloadWindow(session, fixture, ctx);
            const reloaded = await measureAll(session, ctx, fixture, X_TRANSFORMS.map(t => t.id));
            for (const t of X_TRANSFORMS) {
                m[t.id].reloaded = reloaded[t.id];
                m[t.id].holdToReloaded = diff(m[t.id].hold, reloaded[t.id]);
                assert(Math.abs(m[t.id].holdToReloaded.cx) <= 1 && Math.abs(m[t.id].holdToReloaded.cy) <= 1, `${t.id} ${S(m[t.id].holdToReloaded)}`);
            }
            return m;
        });

        // ===== (d) 全字幕モード（⌥ドラッグ） =====
        await check('(d) 全字幕モード: ⌥ドラッグ +20px → 離す → 再読込', async () => {
            const { v, off } = ctx;
            const fr = await v.eval(FRAME);
            const id = 'c-0011';
            await seekTo(session, v, fixture, id);
            const pre = await stablePlate(v, id);
            const from = await grabPoint(v, pre);
            const before = (await rootOf(fixture)).default_text_style;
            const probes = await probeDrag(session, off, from, [{ x: from.x + 20, y: from.y, modifiers: ALT, probe: 'hold' }], () => v.eval(PLATE(id)), { pressModifiers: ALT });
            const saved = await waitChanged(async () => (await rootOf(fixture)).default_text_style, before, 'default_text_style saved');
            await sleep(800);
            await deselect(session, off, v);
            const settled = await stablePlate(v, id);
            ctx = await reloadWindow(session, fixture, ctx);
            const reloaded = (await measureAll(session, ctx, fixture, [id]))[id];
            const m = { pre: rel(pre, fr), hold: rel(probes.hold, fr), settled: rel(settled, fr), reloaded, savedDefault: saved, cue: styleOf(await rowOf(fixture, id)),
                moved: diff(rel(pre, fr), rel(probes.hold, fr)), holdToReloaded: diff(rel(probes.hold, fr), reloaded) };
            assert(Math.abs(m.holdToReloaded.cx) <= 1 && Math.abs(m.holdToReloaded.cy) <= 1, S(m.holdToReloaded));
            return m;
        });
        out.captionsFinal = await rootOf(fixture);
        // 最後の再読込のまま、全字幕の最終位置を記録（初期描画との比較・書き出しとの比較に使う）。
        out.frameFinal = await ctx.v.eval(FRAME);
        out.final = await measureAll(session, ctx, fixture, IDS);
        ctx.v.close();
    } finally { await stop(session); }
    out.status = STRICT ? (out.checks.every(c => c.pass) ? 'pass' : 'fail') : 'recorded';
} catch (error) {
    out.status = 'fail'; out.error = sanitize(error, REPO);
} finally { await saveJson(RESULTS, out); }
console.log(out.status);
