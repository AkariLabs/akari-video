#!/usr/bin/env node
// 置いた文字の残課題 3 点の L1（ラッパー作成の検証スクリプト）。fixture は gen-fixture.mjs で作る。
// 使い方: node l1.mjs <before|after> <fixture dir> [--port=9457]
// (a) akari.caption.placeText の既定で置いた文字の位置 / (b) 右端へドラッグしたときの文字の行の幅 /
// (c) 書き込みを 10 回連続で行う間の字幕の本数（webview 内で DOM をポーリング）。
// 実機の Electron を自分専用のポート・一時ディレクトリで起動し、CDP の実マウスで操作して実測する。
// before = 変更前ビルドの観測記録（判定はしない）/ after = 受け入れ条件の判定つき。
import { readFile, writeFile, cp, rm, realpath, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';
import { S, command, launch, sanitize, saveJson, screenshot, sleep, stop, waitEval } from './l1-lib.mjs';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON_REL = 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
const ELECTRON = existsSync(path.join(SHELL, ELECTRON_REL)) ? path.join(SHELL, ELECTRON_REL) : path.join(REPO, ELECTRON_REL);
const FIXTURE_SRC = path.resolve(process.argv[3] ?? path.join(os.tmpdir(), 'placed-text-position-polish-l1', 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9457);
const TMP = path.join(os.tmpdir(), 'placed-text-position-polish-l1');
const RUNS = path.join(TMP, 'runs');
const RESULTS = path.join(ROOT, `results-${PHASE}.json`);
const STRICT = PHASE !== 'before';
const out = { phase: PHASE, status: 'running', checks: [], screenshots: [] };
const P1 = 'c-0101';
const SPOKEN1 = 'c-0001';
const SPOKEN_LONG = 'c-0003';
const PLACE_AT = { start: 20, end: 23 };
const NEW_DROPS = [{ name: '左上寄り', x: 0.3, y: 0.3 }, { name: '右下寄り', x: 0.7, y: 0.75 }];

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

// ---- webview（入れ子 iframe の内側）への到達と座標の対応（placed-text-feedback-polish の l1.mjs と同じ） ----
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
    await v.eval(`(()=>{if(!window.__ptppHooked){window.__ptppHooked=true;window.addEventListener('pointermove',e=>window.__ptppPointer={x:e.clientX,y:e.clientY},true)}return true})()`);
    const frame = await evalOn(session.cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return{left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    const probe = async (x, y) => {
        await v.eval('window.__ptppPointer=null');
        await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 3, y: y - 3, button: 'none' }); await sleep(80);
        await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(250);
        return waitFor('pointer', () => v.eval('window.__ptppPointer'));
    };
    const a = { x: Math.round(frame.left + frame.width * 0.3), y: Math.round(frame.top + frame.height * 0.3) };
    const b = { x: Math.round(frame.left + frame.width * 0.7), y: Math.round(frame.top + frame.height * 0.6) };
    const la = await probe(a.x, a.y), lb = await probe(b.x, b.y);
    const sx = (b.x - a.x) / (lb.x - la.x), sy = (b.y - a.y) / (lb.y - la.y);
    return { sx, sy, dx: a.x - la.x * sx, dy: a.y - la.y * sy };
}
const toPage = (off, pt) => ({ x: pt.x * off.sx + off.dx, y: pt.y * off.sy + off.dy });

const FRAME = `(()=>{const c=[...document.querySelectorAll('#preview-stage canvas, #preview-stage video')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>50).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return c?{x:c.x,y:c.y,w:c.width,h:c.height}:null})()`;
// 文字の行（.akari-caption__line）の矩形と、幅を決めている要素の computed style（(b) の原因の実測用）。
const PLATE = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!p)return null;const l=p.querySelector('.akari-caption__line')||p.querySelector('.akari-caption__plate')||p;const r=l.getBoundingClientRect();const px=v=>Math.round(v*100)/100;const info=e=>{if(!e)return null;const b=e.getBoundingClientRect();const cs=getComputedStyle(e);return{cls:[...e.classList].join('.'),left:px(b.left),top:px(b.top),width:px(b.width),height:px(b.height),position:cs.position,styleLeft:cs.left,styleRight:cs.right,styleWidth:cs.width,maxWidth:cs.maxWidth,whiteSpace:cs.whiteSpace,transform:cs.transform,display:cs.display}};const lh=parseFloat(getComputedStyle(l).lineHeight)||0;return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,cx:r.left+r.width/2,cy:r.top+r.height/2,w:r.width,h:r.height,lines:l.getClientRects().length,lineHeight:lh,text:l.textContent,selected:p.hasAttribute('data-selected'),chain:{row:info(p),plate:info(p.querySelector('.akari-caption__plate')),line:info(l)}}})()`;
const VISIBLE_PLATES = `[...document.querySelectorAll('.caption-row-plate')].filter(p=>{const r=p.getBoundingClientRect();const cs=getComputedStyle(p);return r.width>0&&r.height>0&&cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity)>0&&(p.textContent||'').trim()}).length`;

async function openAll(session, project, seekTo) {
    await evalOn(session.cdp, command('akari.annotations.open'));
    await waitEval(session.cdp, `Boolean(document.querySelector('.akari-annotations-widget, .akari-annotations'))||document.querySelectorAll('[class*="akari-timeline"]').length>0`, { label: 'timeline', timeoutMs: 120_000 });
    await waitFor('preview webview', async () => {
        await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time: seekTo }));
        await sleep(3000);
        return (await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
    }, 120_000);
    // 起動直後に開くと台本が空のまま残ることがある（高負荷時）→ 行が出るまで開き直す。
    await waitFor('daihon rows', async () => {
        await evalOn(session.cdp, command('akari.daihon.open'));
        return waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-row').length>0`, { label: 'daihon rows', timeoutMs: 20_000 }).catch(() => false);
    }, 300_000).catch(async error => {
        out.daihonDiag = await evalOn(session.cdp, `(()=>{const w=document.querySelector('.akari-daihon-widget');return{widget:Boolean(w),text:(w?.innerText||'').slice(0,600),title:document.title,tabs:[...document.querySelectorAll('.lm-TabBar-tab')].map(t=>t.title||t.textContent.trim()).slice(0,20)}})()`).catch(e => String(e));
        await screenshot(session.cdp, path.join(TMP, `fail-daihon-${PHASE}.png`)).catch(() => {});
        throw error;
    });
    await sleep(2500);
    const v = await view(PORT).catch(async error => { await screenshot(session.cdp, path.join(TMP, `fail-${PHASE}.png`)).catch(() => {}); throw error; });
    await waitFor('p1 plate', () => v.eval(PLATE(P1)), 60_000);
    return v;
}
const seek = (session, project, time) => evalOn(session.cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time }));

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
// プレートの位置と幅が 3 回続けて変わらなくなるまで待って返す（保存後の再描画・再読込の途中を掴まない）。
async function stablePlate(v, id, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs; let last = null, same = 0;
    while (Date.now() < deadline) {
        const p = await v.eval(PLATE(id));
        if (p && last && Math.abs(p.cx - last.cx) < 0.5 && Math.abs(p.cy - last.cy) < 0.5 && Math.abs(p.w - last.w) < 0.5) { if (++same >= 3) return p; }
        else same = 0;
        last = p; await sleep(400);
    }
    return last;
}
async function clickLocal(session, off, pt, clickCount = 1) { const p = toPage(off, pt); await realClick(session.cdp, p.x, p.y, { clickCount }); }
async function deselect(session, off, v) {
    const free = await v.eval(`(()=>{const f=${FRAME};for(const[x,y]of[[.92,.08],[.08,.1],[.6,.12],[.92,.3],[.3,.12]]){const p={x:f.x+f.w*x,y:f.y+f.h*y};const h=document.elementFromPoint(p.x,p.y);if(h&&!h.closest('.caption-row-plate, #caption-select-box'))return p}return null})()`);
    if (free) { await clickLocal(session, off, free); await sleep(600); }
}
// 置いた文字を「プレートの中心を掴んで、中心が target に来る所」へドラッグし、保存値と描画位置を返す。
async function dragTo(session, off, v, project, id, target) {
    const fr = await v.eval(FRAME);
    const plate = await stablePlate(v, id);
    const before = await rowOf(project, id);
    const drop = { x: fr.x + fr.w * target.x, y: fr.y + fr.h * target.y };
    await steadyDrag(session.cdp, toPage(off, { x: plate.cx, y: plate.cy }), toPage(off, drop));
    const row = await waitFor('saved', async () => { const r = await rowOf(project, id); return S(r.text_style) !== S(before.text_style) && r; }, 10_000).catch(() => rowOf(project, id));
    const after = await stablePlate(v, id);
    await deselect(session, off, v);
    const settled = await stablePlate(v, id);
    const rendered = { x: round((settled.cx - fr.x) / fr.w), y: round((settled.cy - fr.y) / fr.h) };
    return {
        target: target.name, drop: { x: target.x, y: target.y }, saved: row.text_style,
        widthBeforePx: round(plate.w, 2), widthAfterDropPx: round(after.w, 2), widthSettledPx: round(settled.w, 2),
        widthRatio: round(settled.w / fr.w), lines: settled.lines, heightPx: round(settled.h, 2), text: settled.text,
        rendered, renderedError: { x: round(rendered.x - target.x), y: round(rendered.y - target.y) }, chain: settled.chain
    };
}

// ---- (c) webview 内で字幕の本数をポーリングする記録器 ----
const RECORDER_START = `(()=>{window.__ptppRec={samples:0,min:Infinity,zeros:0,zeroSpans:[],counts:{},startedAt:performance.now()};let zeroFrom=null;const tick=()=>{const r=window.__ptppRec;if(!r||r.stopped)return;const n=${VISIBLE_PLATES};r.samples++;r.counts[n]=(r.counts[n]||0)+1;if(n<r.min)r.min=n;if(n===0){r.zeros++;if(zeroFrom===null)zeroFrom=performance.now()}else if(zeroFrom!==null){r.zeroSpans.push(Math.round(performance.now()-zeroFrom));zeroFrom=null}};window.__ptppTimer=setInterval(tick,4);const raf=()=>{tick();if(!window.__ptppRec.stopped)requestAnimationFrame(raf)};requestAnimationFrame(raf);return true})()`;
const RECORDER_STOP = `(()=>{const r=window.__ptppRec;r.stopped=true;clearInterval(window.__ptppTimer);r.durationMs=Math.round(performance.now()-r.startedAt);return r})()`;

// 書き手が途中まで書いた状態を作る（前半を書いて一拍おいてから後半を書く）。captions.json の中身は毎回 1 行だけ変える。
async function chunkedWrite(file, text, gapMs) {
    const handle = await open(file, 'w');
    try {
        const half = Math.floor(text.length / 2);
        await handle.write(text.slice(0, half)); await handle.sync();
        await sleep(gapMs);
        await handle.write(text.slice(half));
    } finally { await handle.close(); }
}

let fixture;
try {
    await rm(path.join(TMP, `work-${PHASE}`), { recursive: true, force: true });
    await cp(FIXTURE_SRC, path.join(TMP, `work-${PHASE}`), { recursive: true });
    fixture = await realpath(path.join(TMP, `work-${PHASE}`, 'position'));
    let session = await launch({ shellDir: SHELL, electron: ELECTRON, project: fixture, port: PORT, isoDir: path.join(RUNS, `${PHASE}-1`) });
    out.pids = [session.pid];
    out.previewWarnings = [];
    const watchWarnings = s => s.cdp.on('Runtime.consoleAPICalled', p => {
        if (p.type !== 'warning' && p.type !== 'error') return;
        const text = p.args.map(a => a.value ?? a.description ?? '').join(' ');
        if (/akari-preview|caption|字幕/.test(text)) out.previewWarnings.push(sanitize(text.slice(0, 300), REPO));
    });
    watchWarnings(session);
    let placedId;
    try {
        await seek(session, fixture, 1).catch(() => {});
        const v = await openAll(session, fixture, 1);
        await evalOn(session.cdp, shellCall(`s.collapsePanel('left')`)).catch(() => {});
        await sleep(3000);
        const off = await calibrate(session, v);
        out.calibration = off;
        out.frame = await v.eval(FRAME);

        // ===== 話した言葉の字幕の寸法（折り返しは従来どおりかの比較用） =====
        await check('回帰: 話した言葉の字幕の寸法（1 行 / 折り返す長い行）', async () => {
            const fr = await v.eval(FRAME);
            const short = await stablePlate(v, SPOKEN1);
            await seek(session, fixture, 9); await sleep(1500);
            const long = await waitFor('long spoken plate', () => v.eval(PLATE(SPOKEN_LONG)), 20_000).then(() => stablePlate(v, SPOKEN_LONG));
            await seek(session, fixture, 1); await sleep(1500);
            const pick = p => ({ w: round(p.w, 2), h: round(p.h, 2), lines: p.lines, cx: round((p.cx - fr.x) / fr.w), cy: round((p.cy - fr.y) / fr.h), maxWidth: p.chain.line.maxWidth, whiteSpace: p.chain.line.whiteSpace });
            const m = { short: pick(short), long: pick(long) };
            if (STRICT) {
                const before = JSON.parse(await readFile(path.join(ROOT, 'results-before.json'), 'utf8')).checks.find(c => c.name.startsWith('回帰: 話した言葉'))?.detail;
                if (before) {
                    m.before = before;
                    for (const k of ['short', 'long']) for (const f of ['w', 'h']) assert(Math.abs(m[k][f] - before[k][f]) <= 1, `${k}.${f} ${m[k][f]} vs before ${before[k][f]}`);
                }
            }
            return m;
        });

        // ===== (a) 既定で置いた文字の位置 =====
        await check('(a) akari.caption.placeText の既定で置いた文字の位置（プレート中心）', async () => {
            const ids = (await captionsOf(fixture)).map(c => c.id);
            await evalOn(session.cdp, command('akari.caption.placeText', PLACE_AT));
            const row = await waitFor('placed row', async () => (await captionsOf(fixture)).find(c => !ids.includes(c.id)), 30_000);
            placedId = row.id;
            out.placedId = placedId;
            await seek(session, fixture, PLACE_AT.start + 1); await sleep(1500);
            await waitFor('placed plate', () => v.eval(PLATE(placedId)), 30_000);
            await deselect(session, off, v);
            const fr = await v.eval(FRAME);
            const p = await stablePlate(v, placedId);
            const center = { x: round((p.cx - fr.x) / fr.w), y: round((p.cy - fr.y) / fr.h) };
            const leftEdge = round((p.left - fr.x) / fr.w);
            const m = { id: placedId, saved: { text: row.text, text_style: row.text_style, time_domain: row.time_domain }, center, leftEdge, widthRatio: round(p.w / fr.w), lines: p.lines, chain: p.chain };
            assert(Math.abs(center.x - 0.5) <= 0.01, `center.x ${center.x}`);
            assert(center.y >= 0.4 && center.y <= 0.6, `center.y ${center.y}`);
            return m;
        });
        await shot(session.cdp, '01-default-placed');

        // ===== (a) 既定で置いた文字をドラッグ → 落とした位置で保存・描画 =====
        const newDrags = [];
        await check('(a) 既定で置いた文字をドラッグ → 落とした位置（±1%）で保存・描画・アンカー不変', async () => {
            const anchor0 = (await rowOf(fixture, placedId)).text_style?.text_anchor;
            for (const target of NEW_DROPS) {
                const d = await dragTo(session, off, v, fixture, placedId, target);
                newDrags.push(d); out.newDrags = newDrags; await saveJson(RESULTS, out);
            }
            for (const d of newDrags) {
                assert(d.saved?.text_anchor === anchor0, `${d.target}: anchor ${d.saved?.text_anchor} vs ${anchor0}`);
                assert(Math.abs(d.renderedError.x) <= 0.01 && Math.abs(d.renderedError.y) <= 0.01, `${d.target}: rendered ${S(d.rendered)}`);
            }
            return { anchor: anchor0, drags: newDrags };
        });
        await shot(session.cdp, '02-default-dragged');

        // ===== (b) 置いた文字（旧来の mc・x 0.5）を右端へ → 行の幅 =====
        await seek(session, fixture, 1); await sleep(1500);
        await waitFor('p1 plate again', () => v.eval(PLATE(P1)), 20_000);
        const widthDrags = [];
        await check('(b) 置いた文字を右へ動かしたときの文字の行の幅（旧来の mc の行）', async () => {
            const fr = await v.eval(FRAME);
            const initial = await stablePlate(v, P1);
            const m = { initial: { w: round(initial.w, 2), widthRatio: round(initial.w / fr.w), lines: initial.lines, chain: initial.chain }, drags: widthDrags };
            for (const target of [{ name: '中央やや左', x: 0.4, y: 0.4 }, { name: '右寄り', x: 0.7, y: 0.4 }, { name: '右端', x: 0.86, y: 0.5 }, { name: '右端の外へはみ出す', x: 0.97, y: 0.6 }]) {
                widthDrags.push(await dragTo(session, off, v, fixture, P1, target)); out.widthDrags = widthDrags; await saveJson(RESULTS, out);
                if (target.name === '右端') await shot(session.cdp, '03-right-edge');
            }
            await shot(session.cdp, '04-overflow');
            for (const d of widthDrags) assert(Math.abs(d.widthSettledPx - m.initial.w) <= 1 && d.lines === 1, `${d.target}: width ${d.widthSettledPx} vs ${m.initial.w} lines ${d.lines}`);
            // はみ出し防止は既定 OFF のまま: 右端の外へ落とした文字はフレームからはみ出す。
            const last = widthDrags.at(-1);
            m.overflowRightEdge = round(last.rendered.x + last.widthRatio / 2);
            assert(m.overflowRightEdge > 1, `overflow right edge ${m.overflowRightEdge}`);
            return m;
        });
        await check('(b) 既定で置いた文字を右端へ → 行の幅', async () => {
            await seek(session, fixture, PLACE_AT.start + 1); await sleep(1500);
            await waitFor('placed plate', () => v.eval(PLATE(placedId)), 20_000);
            const initial = await stablePlate(v, placedId);
            const d = await dragTo(session, off, v, fixture, placedId, { name: '右端', x: 0.9, y: 0.5 });
            assert(Math.abs(d.widthSettledPx - initial.w) <= 1 && d.lines === 1, `width ${d.widthSettledPx} vs ${initial.w}`);
            assert(Math.abs(d.renderedError.x) <= 0.01 && Math.abs(d.renderedError.y) <= 0.01, `rendered ${S(d.rendered)}`);
            return { initialW: round(initial.w, 2), drag: d };
        });
        // 最後に既定で置いた文字を任意の位置へ置き直す（再読込後の確認用）。
        out.lastNewDrop = { name: '再読込の確認用', x: 0.62, y: 0.35 };
        await check('(a) 再読込の確認用に既定で置いた文字をもう一度ドラッグ', async () => {
            const d = await dragTo(session, off, v, fixture, placedId, out.lastNewDrop);
            assert(Math.abs(d.renderedError.x) <= 0.01 && Math.abs(d.renderedError.y) <= 0.01, `rendered ${S(d.rendered)}`);
            return d;
        });

        // ===== (c) 書き込みを 10 回連続で行う間の字幕の本数 =====
        await seek(session, fixture, 1); await sleep(2000);
        await waitFor('p1 plate for c', () => v.eval(PLATE(P1)), 20_000);
        await check('(c) アプリ内の書き込み（置いた文字のドラッグ）を 10 回連続 → 字幕の本数の最小値', async () => {
            const fr = await v.eval(FRAME);
            const baseline = await v.eval(VISIBLE_PLATES);
            await v.eval(RECORDER_START);
            const warnBefore = out.previewWarnings.length;
            let writes = 0;
            for (let i = 0; i < 10; i++) {
                const plate = await v.eval(PLATE(P1));
                if (!plate) { await sleep(300); continue; }
                const before = S((await rowOf(fixture, P1)).text_style);
                const target = { x: fr.x + fr.w * (i % 2 ? 0.35 : 0.55), y: fr.y + fr.h * (0.3 + 0.03 * i) };
                await steadyDrag(session.cdp, toPage(off, { x: plate.cx, y: plate.cy }), toPage(off, target));
                if (await waitFor('saved', async () => S((await rowOf(fixture, P1)).text_style) !== before, 5_000).catch(() => false)) writes++;
            }
            await sleep(2500);
            const rec = await v.eval(RECORDER_STOP);
            await deselect(session, off, v);
            const m = { baseline, writes, samples: rec.samples, min: rec.min, zeroSamples: rec.zeros, zeroSpansMs: rec.zeroSpans, counts: rec.counts, durationMs: rec.durationMs, warnings: out.previewWarnings.slice(warnBefore) };
            assert(writes === 10, `writes ${writes}`);
            assert(rec.min > 0 && rec.zeros === 0, `captions dropped to 0: ${S(m)}`);
            return m;
        });
        await check('(c) captions.json への書き込み途中を挟む外部書き込みを 10 回連続 → 字幕の本数の最小値', async () => {
            const file = path.join(fixture, 'captions.json');
            const baseline = await v.eval(VISIBLE_PLATES);
            await v.eval(RECORDER_START);
            const warnBefore = out.previewWarnings.length;
            for (let i = 0; i < 10; i++) {
                const root = JSON.parse(await readFile(file, 'utf8'));
                const row = root.captions.find(c => c.id === 'c-0005');
                row.text = `蒸らしは 30 秒くらい (${i + 1})`;
                await chunkedWrite(file, `${JSON.stringify(root, null, 2)}\n`, 120);
                await sleep(250);
            }
            await sleep(3000);
            const rec = await v.eval(RECORDER_STOP);
            const m = { baseline, writes: 10, samples: rec.samples, min: rec.min, zeroSamples: rec.zeros, zeroSpansMs: rec.zeroSpans, counts: rec.counts, durationMs: rec.durationMs, warnings: out.previewWarnings.slice(warnBefore),
                finalText: (await rowOf(fixture, 'c-0005')).text, afterPlates: await v.eval(VISIBLE_PLATES) };
            assert(rec.min > 0 && rec.zeros === 0, `captions dropped to 0: ${S({ ...m, warnings: m.warnings.length })}`);
            return m;
        });
        await shot(session.cdp, '05-after-writes');
        await check('(c) 書き込みが落ち着いた後は最後の書き込みの内容が表示される（直前の字幕に張り付かない）', async () => {
            await seek(session, fixture, 17); await sleep(2000);
            const plate = await waitFor('c-0005 plate', async () => { const p = await v.eval(PLATE('c-0005')); return p?.text?.includes('(10)') && p; }, 30_000)
                .catch(async () => v.eval(PLATE('c-0005')));
            const m = { file: (await rowOf(fixture, 'c-0005')).text, rendered: plate?.text ?? null };
            assert(m.rendered === m.file, S(m));
            return m;
        });
        v.cdp.close();
    } finally { await stop(session); }

    // ===== 再読込後も同じ位置 =====
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: fixture, port: PORT, isoDir: path.join(RUNS, `${PHASE}-2`) });
    out.pids.push(session.pid);
    try {
        const v = await openAll(session, fixture, 1);
        await evalOn(session.cdp, shellCall(`s.collapsePanel('left')`)).catch(() => {});
        await sleep(3000);
        await check('(a) 再読込後も既定で置いた文字が最後に落とした位置に描かれる', async () => {
            // シークが効くまで繰り返す（起動直後は 1 回目のシークを取りこぼすことがある）。
            await waitFor('placed plate after reload', async () => {
                await seek(session, fixture, PLACE_AT.start + 1); await sleep(2500);
                return v.eval(PLATE(placedId));
            }, 90_000).catch(async error => {
                out.reloadDiag = await v.eval(`[...document.querySelectorAll('.caption-row-plate')].map(p=>[p.id,(p.textContent||'').slice(0,12),p.getBoundingClientRect().width>0])`).catch(e => String(e));
                throw error;
            });
            const fr = await v.eval(FRAME);
            const plate = await stablePlate(v, placedId);
            const row = await rowOf(fixture, placedId);
            const last = out.lastNewDrop;
            const rendered = { x: round((plate.cx - fr.x) / fr.w), y: round((plate.cy - fr.y) / fr.h) };
            const err = { x: round(rendered.x - last.x), y: round(rendered.y - last.y) };
            assert(Math.abs(err.x) <= 0.01 && Math.abs(err.y) <= 0.01, `reload rendered ${S({ rendered, row: row.text_style })}`);
            return { saved: row.text_style, rendered, error: err, w: round(plate.w, 2) };
        });
        await shot(session.cdp, '06-reload');
        v.cdp.close();
    } finally { await stop(session); }
    out.status = STRICT ? (out.checks.every(c => c.pass) ? 'pass' : 'fail') : 'recorded';
} catch (error) {
    out.status = 'fail'; out.error = sanitize(error, REPO);
} finally { await saveJson(RESULTS, out); }
console.log(out.status);
