#!/usr/bin/env node
// 字幕の動き（textanim）のプレビュー側 L1（ラッパー作成の検証スクリプト）。fixture は gen-fixture.mjs で作る。
// 使い方: node l1.mjs <before|after> [fixture dir] [--port=9493] [--only=captures,playback,interaction|overlap]
// 実機の Electron を自分専用のポート・一時ディレクトリで起動し、
//   captures    : captures.mjs の各時刻へシーク → webview の領域を撮る（倍率 2）+ 字幕の板の計算済みスタイルと animation の currentTime を記録
//   playback    : 再生中の板の姿を rAF で採取 → 一時停止 → 止まった時刻の姿とシークで得た同じ時刻の姿を比べる → コマ送り 3 回も同様
//   interaction : 選択・ドラッグ中・拡縮つまみ中・回転つまみ中・ダブルクリック編集中の板の姿と、選択を外した後の姿
//   overlap     : （fixture-overlap 用）同時に見える 3 本の板の姿（行ごとの宣言が他の行へ漏れないか）。結果は results-<phase>-overlap.json
// 見た目の比較（書き出しとの画素の差）は compare.mjs が行う。
import { cp, rm, realpath, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';
import { S, launch, sanitize, saveJson, sleep, stop as stopSession, waitEval, pressKey } from './l1-lib.mjs';
import { CAPTURES } from './captures.mjs';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ONLY = (process.argv.find(v => v.startsWith('--only='))?.slice(7) ?? 'captures,playback,interaction').split(',');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const TMP = path.join(os.tmpdir(), 'preview-caption-textanim-l1');
const FIXTURE_SRC = path.resolve(process.argv.slice(3).find(v => !v.startsWith('--')) ?? path.join(TMP, 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9493);
const RAW = path.join(TMP, `raw-${PHASE}`);
const RESULTS = path.join(ROOT, `results-${PHASE}${ONLY.includes('overlap') ? '-overlap' : ''}.json`);
const out = { phase: PHASE, status: 'running', frame: null, captures: [], playback: null, interaction: null, screenshots: [] };
if (!existsSync(ELECTRON)) throw new Error('electron is missing');

async function stop(session) { await stopSession(session); if (session?.isoDir) spawnSync('/usr/bin/pkill', ['-f', '--', `--user-data-dir=${session.isoDir}`]); }
const commandNoWait = (id, arg) => `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');window.theia.container.get(C).executeCommand(${S(id)}${arg === undefined ? '' : `,${S(arg)}`}).catch(()=>{});return true})()`;
const shellCall = body => `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const s=window.theia.container.get(k);${body};return true})()`;
async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(250); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

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
        close: () => cdp?.close(),
        eval: async expr => { try { return await evalOn(cdp, expr, ctx); } catch { await attach(); return evalOn(cdp, expr, ctx); } }
    };
}
// webview ローカル座標 → ページ座標（pointermove を実際に拾って対応を測る）
async function calibrate(session, v) {
    await v.eval(`(()=>{if(!window.__pctHooked){window.__pctHooked=true;window.addEventListener('pointermove',e=>window.__pctPointer={x:e.clientX,y:e.clientY},true)}return true})()`);
    const frame = await evalOn(session.cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return{left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    const probe = async (x, y) => {
        await v.eval('window.__pctPointer=null');
        return waitFor('pointer', async () => {
            await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 3, y: y - 3, button: 'none' }); await sleep(80);
            await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(400);
            return v.eval('window.__pctPointer');
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
// 字幕の板の姿: .akari-caption__plate の計算済み opacity / transform / clip-path、行の外接矩形（webview の CSS px）、
// 行（.caption-row-plate）配下の全 animation（名前・currentTime・playState・対象）。
const STATE = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const row=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!row)return null;const cs0=getComputedStyle(row);if(cs0.display==='none'||cs0.visibility==='hidden')return null;const plate=row.querySelector('.akari-caption__plate');if(!plate)return{plate:false};const cs=getComputedStyle(plate);const r1=v=>Math.round(v*10)/10;const anims=row.getAnimations({subtree:true}).map(a=>({name:a.animationName||a.id||'',ct:a.currentTime==null?null:r1(Number(a.currentTime)),ps:a.playState,target:String(a.effect?.target?.className||'').slice(0,48)}));const ls=[...plate.querySelectorAll('.akari-caption__line')].map(e=>e.getBoundingClientRect());const b=ls.length?{left:Math.min(...ls.map(x=>x.left)),top:Math.min(...ls.map(x=>x.top)),right:Math.max(...ls.map(x=>x.right)),bottom:Math.max(...ls.map(x=>x.bottom))}:null;const edit=row.querySelector('[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"]');return{selected:row.hasAttribute('data-selected'),editing:Boolean(edit),opacity:cs.opacity,transform:cs.transform,clipPath:cs.clipPath,animationName:cs.animationName,plateAnimation:cs.animationName==='none'?null:cs.animationName+' | '+cs.animationDuration+' | '+cs.animationDelay+' | '+cs.animationPlayState,anims,box:b&&{x:r1(b.left),y:r1(b.top),w:r1(b.right-b.left),h:r1(b.bottom-b.top)},grab:b&&{x:(b.left+b.right)/2,y:(b.top+b.bottom)/2},text:plate.textContent}})()`;
const TEXTANIM = s => (s?.anims ?? []).filter(a => /^akari-anim-/u.test(a.name));
// 比較用の姿（位置は除く）: opacity・transform・clip-path と textanim の currentTime
const pose = s => s && ({ opacity: s.opacity, transform: s.transform, clipPath: s.clipPath, textanim: TEXTANIM(s).map(a => `${a.name}@${a.ct}`) });

let session;
try {
    await mkdir(RAW, { recursive: true });
    const work = path.join(TMP, `run-${PHASE}`);
    await rm(work, { recursive: true, force: true });
    await cp(FIXTURE_SRC, work, { recursive: true });
    const project = await realpath(path.join(work, 'project'));
    const isoDir = path.join(TMP, `iso-preview-caption-textanim-${PHASE}${ONLY.includes('overlap') ? '-overlap' : ''}`);
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir });
    session.isoDir = isoDir;
    await session.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    out.pid = session.pid;
    const editUri = `file://${path.join(project, 'edit.json')}`;
    const seek = time => evalOn(session.cdp, commandNoWait('akari.preview.seekOutput', { editUri, time }));
    const cmd = (id, arg) => evalOn(session.cdp, commandNoWait(id, arg));
    await evalOn(session.cdp, commandNoWait('akari.annotations.open'));
    await waitEval(session.cdp, `Boolean(document.querySelector('.akari-annotations-widget, .akari-annotations'))||document.querySelectorAll('[class*="akari-timeline"]').length>0`, { label: 'timeline', timeoutMs: 120_000 });
    await waitFor('preview webview', async () => { await seek(1.5); await sleep(3000); return (await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url)); }, 120_000);
    await sleep(2500);
    const v = await view(PORT);
    const FIRST = ONLY.includes('overlap') ? 'o-mid' : 'c-0001';
    await waitFor(`${FIRST} plate`, async () => { await seek(1.5); await sleep(1200); return v.eval(STATE(FIRST)); }, 120_000);
    await evalOn(session.cdp, shellCall(`s.collapsePanel('left');s.collapsePanel('right')`)).catch(() => {});
    await sleep(3000);
    // ポインタの対応づけ（calibrate）は操作する interaction だけが要る。撮影は webview の iframe の領域で行う。
    const iframeRect = await evalOn(session.cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return{left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    const off = ONLY.includes('interaction') ? await calibrate(session, v) : { iframe: iframeRect };
    out.frame = await v.eval(FRAME);
    out.calibration = off;
    const seekState = async (id, t, settle = 1200) => {
        let state = null;
        state = await waitFor(`${id} at ${t}`, async () => { await seek(t); await sleep(settle); return v.eval(STATE(id)); }, 30_000).catch(() => null);
        await seek(t); await sleep(settle);
        return (await v.eval(STATE(id))) ?? state;
    };
    const shotIframe = async file => {
        const f = off.iframe;
        const { data } = await session.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: f.left, y: f.top, width: f.width, height: f.height, scale: 1 } });
        await writeFile(file, Buffer.from(data, 'base64'));
    };

    if (ONLY.includes('captures')) {
        for (const capture of CAPTURES) {
            out.step = `capture ${capture.name}`;
            const first = await seekState(capture.id, capture.t, 1500);
            const again = await seekState(capture.id, capture.t, 1500);
            await shotIframe(path.join(RAW, `preview-${capture.name}.png`));
            out.captures.push({ ...capture, state: again ?? first, stableBetweenSeeks: S(pose(first)) === S(pose(again)) });
            await saveJson(RESULTS, out);
        }
    }

    if (ONLY.includes('playback')) {
        out.step = 'playback';
        const pb = out.playback = {};
        // c-0001（0〜3 秒・fade-up / float / fade-up）を 0 秒から再生し、rAF ごとに板の姿を採取する。
        await seekState('c-0001', 0.0, 1500);
        await v.eval(`(()=>{window.__pctSamples=[];const tick=()=>{const s=(${STATE('c-0001')});if(s)window.__pctSamples.push({now:Math.round(performance.now()),opacity:s.opacity,transform:s.transform,textanim:s.anims.filter(a=>/^akari-anim-/.test(a.name)).map(a=>a.name+'@'+a.ct+'/'+a.ps),any:s.anims.map(a=>a.name+'@'+a.ct)});if(window.__pctSampling)requestAnimationFrame(tick)};window.__pctSampling=true;requestAnimationFrame(tick);return true})()`);
        await cmd('akari.preview.play', { editUri });
        await sleep(1800);
        await cmd('akari.preview.pause', { editUri });
        await sleep(800);
        await v.eval('window.__pctSampling=false');
        const samples = await v.eval('window.__pctSamples');
        pb.sampleCount = samples.length;
        pb.distinctOpacity = new Set(samples.map(s => s.opacity)).size;
        pb.distinctTransform = new Set(samples.map(s => s.transform)).size;
        pb.samples = samples.filter((_, i) => i % Math.max(1, Math.floor(samples.length / 24)) === 0).slice(0, 30);
        // 一時停止した時刻の姿と、同じ時刻へシークし直した姿を比べる。
        const paused = await v.eval(STATE('c-0001'));
        pb.paused = pose(paused);
        const pausedCt = TEXTANIM(paused)[0]?.ct ?? paused?.anims?.[0]?.ct ?? null;
        pb.pausedLocalMs = pausedCt;
        if (pausedCt !== null) {
            // 再生で止まった時刻へ別の時刻経由でシークし直して同じ姿になるか
            await seekState('c-0001', 2.9, 800);
            const reseek = await seekState('c-0001', pausedCt / 1000, 1500);
            pb.reseek = pose(reseek);
            pb.pausedEqualsSeek = S(pb.paused) === S(pb.reseek);
        }
        // コマ送り（プレビューの「1コマ進む」ボタン #frame-forward）3 回: 各回の姿と、その時刻へシークした姿が一致するか
        pb.frameStep = [];
        await seekState('c-0001', 0.2, 1500);
        for (let i = 0; i < 3; i++) {
            await v.eval(`(()=>{const b=document.getElementById('frame-forward');if(!b)throw new Error('frame-forward missing');b.click();return true})()`);
            await sleep(1200);
            const stepped = await v.eval(STATE('c-0001'));
            const ct = TEXTANIM(stepped)[0]?.ct ?? stepped?.anims?.[0]?.ct ?? null;
            const entry = { step: i + 1, localMs: ct, pose: pose(stepped) };
            if (ct !== null) {
                const direct = await seekState('c-0001', ct / 1000, 1200);
                entry.seekPose = pose(direct);
                entry.equal = S(entry.pose) === S(entry.seekPose);
                await seek(ct / 1000); await sleep(800);
            }
            pb.frameStep.push(entry);
        }
        await saveJson(RESULTS, out);
    }

    if (ONLY.includes('interaction')) {
        out.step = 'interaction';
        const it = out.interaction = { id: 'c-0002', t: 4.3, steps: [] };
        const record = async (label, extra = {}) => {
            const s = await v.eval(STATE(it.id));
            it.steps.push({ label, ...extra, selected: s?.selected, editing: s?.editing, pose: pose(s), box: s?.box });
            await saveJson(RESULTS, out);
            return s;
        };
        const mouse = async (type, pt, buttons = 0, clickCount = 1) => {
            const p = toPage(off, pt);
            await session.cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? (buttons ? 'left' : 'none') : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
        };
        // 押したまま from → to へ動かし、動かしている途中で姿を測る（離す前）
        const probeDrag = async (label, from, to) => {
            await mouse('mouseMoved', from); await sleep(150);
            await mouse('mousePressed', from, 1); await sleep(150);
            for (let s = 1; s <= 10; s++) { await mouse('mouseMoved', { x: from.x + (to.x - from.x) * s / 10, y: from.y + (to.y - from.y) * s / 10 }, 1); await sleep(40); }
            await sleep(300);
            const during = await record(`${label}（押したまま）`);
            await mouse('mouseReleased', to, 0); await sleep(1500);
            return during;
        };
        const deselect = async () => {
            const free = await v.eval(`(()=>{const f=${FRAME};for(const[x,y]of[[.92,.08],[.08,.1],[.6,.12],[.92,.3],[.3,.12]]){const p={x:f.x+f.w*x,y:f.y+f.h*y};const h=document.elementFromPoint(p.x,p.y);if(h&&!h.closest('.caption-row-plate, #caption-select-box'))return p}return null})()`);
            if (free) { await mouse('mouseMoved', free); await mouse('mousePressed', free, 1); await sleep(40); await mouse('mouseReleased', free); await sleep(1000); }
        };
        const handle = kind => v.eval(`(()=>{const h=document.querySelector('.caption-row-plate[data-selected] .akari-caption-handle[data-h=${kind}]');if(!h)return null;const r=h.getBoundingClientRect();return r.width>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`);

        const base = await seekState(it.id, it.t, 1500);
        await record('シーク直後（未選択・登場の途中）');
        await shotIframe(path.join(ROOT, `${PHASE}-interaction-1-unselected.png`)); out.screenshots.push(`${PHASE}-interaction-1-unselected.png`);
        // 選択（クリック）
        const grab = base.grab;
        await mouse('mouseMoved', grab); await mouse('mousePressed', grab, 1); await sleep(40); await mouse('mouseReleased', grab); await sleep(1200);
        const sel = await record('選択中');
        await shotIframe(path.join(ROOT, `${PHASE}-interaction-2-selected.png`)); out.screenshots.push(`${PHASE}-interaction-2-selected.png`);
        // ドラッグ（本体）
        if (sel?.grab) await probeDrag('ドラッグ中', sel.grab, { x: sel.grab.x + 40, y: sel.grab.y - 30 });
        await record('ドラッグ後（選択のまま）');
        // 拡縮つまみ（se）
        const se = await handle('se');
        if (se) await probeDrag('拡縮つまみ操作中', se, { x: se.x + 30, y: se.y + 15 }); else it.steps.push({ label: '拡縮つまみ', missing: true });
        // 回転つまみ
        const rot = await handle('rot');
        if (rot) await probeDrag('回転つまみ操作中', rot, { x: rot.x + 40, y: rot.y + 10 }); else it.steps.push({ label: '回転つまみ', missing: true });
        await record('つまみ操作後（選択のまま）');
        // 選択を外す → 現在時刻の姿に戻る
        await deselect();
        const back = await record('選択を外した後');
        await shotIframe(path.join(ROOT, `${PHASE}-interaction-3-deselected.png`)); out.screenshots.push(`${PHASE}-interaction-3-deselected.png`);
        // ダブルクリックで文字の編集
        const g2 = back?.grab ?? grab;
        await mouse('mouseMoved', g2); await mouse('mousePressed', g2, 1, 1); await sleep(30); await mouse('mouseReleased', g2, 0, 1); await sleep(60);
        await mouse('mousePressed', g2, 1, 2); await sleep(30); await mouse('mouseReleased', g2, 0, 2); await sleep(1200);
        await record('ダブルクリックの文字編集中');
        await shotIframe(path.join(ROOT, `${PHASE}-interaction-4-editing.png`)); out.screenshots.push(`${PHASE}-interaction-4-editing.png`);
        await pressKey(session.cdp, 'Escape', 'Escape', 27, 0); await sleep(1000);
        await record('Escape で編集を抜けた後');
        await deselect();
        await record('選択を外した後（編集のあと）');
        // 同じ時刻へシークし直した姿（基準）
        await seekState(it.id, 3.0, 800);
        await seekState(it.id, it.t, 1500);
        await record('同じ時刻へシークし直した姿（基準）');
    }
    if (ONLY.includes('overlap')) {
        out.step = 'overlap';
        const ov = out.overlap = [];
        for (const t of [0.3, 1.5, 2.7]) {
            await seekState('o-mid', t, 1500);
            const entry = { t };
            for (const id of ['o-top', 'o-mid', 'o-bottom']) {
                const s = await v.eval(STATE(id));
                const attrs = await v.eval(`(()=>{const row=document.getElementById('caption-plate-'+encodeURIComponent(${S(id)}));const p=row?.querySelector('.akari-caption__plate');return p?{textanimAttr:p.hasAttribute('data-akari-textanim'),inlineStyle:p.getAttribute('style')}:null})()`);
                entry[id] = { ...pose(s), ...attrs };
            }
            ov.push(entry);
            if (t === 0.3) { await shotIframe(path.join(ROOT, `${PHASE}-overlap-t0.3.png`)); out.screenshots.push(`${PHASE}-overlap-t0.3.png`); }
        }
    }
    out.status = 'done';
} catch (error) {
    out.status = 'error';
    out.error = sanitize(error, REPO);
} finally {
    delete out.step;
    await saveJson(RESULTS, out);
    await stop(session);
}
console.log(JSON.stringify({ status: out.status, error: out.error, captures: out.captures.length, playback: Boolean(out.playback), interaction: out.interaction?.steps?.length ?? 0 }));
