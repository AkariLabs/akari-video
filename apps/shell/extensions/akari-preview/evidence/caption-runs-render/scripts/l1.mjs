#!/usr/bin/env node
// 字幕の文字範囲（runs）のプレビュー側 L1（ラッパー作成の検証スクリプト）。fixture は gen-fixture.mjs で作る。
// 使い方: node l1.mjs <before|after> [fixture dir] [--port=9487]
// 実機の Electron を自分専用のポート・一時ディレクトリで起動し、各字幕の代表時刻へシークして
// プレビューの映像枠を撮り（証跡 PNG + 解析用の等倍 PNG）、字幕の板の DOM（outerHTML・run / 文字 span の矩形）を記録する。
// 見た目の比較（書き出しとの中心の差）は compare.mjs が行う。
import { cp, rm, realpath, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CDP, evalOn, listTargets } from './cdp-lib.mjs';
import { S, command, launch, sanitize, saveJson, sleep, stop as stopSession, waitEval } from './l1-lib.mjs';
import { CAPTURES as ALL_CAPTURES } from './captures.mjs';
const SET = process.argv.find(v => v.startsWith('--set='))?.slice(6) ?? 'main';
const CAPTURES = ALL_CAPTURES.filter(c => SET === 'animator' ? c.id === 'c-0007' : c.id !== 'c-0007');

async function stop(session) { await stopSession(session); if (session?.isoDir) spawnSync('/usr/bin/pkill', ['-f', '--', `--user-data-dir=${session.isoDir}`]); }

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const TMP = path.join(os.tmpdir(), 'caption-runs-render-l1');
const FIXTURE_SRC = path.resolve(process.argv.slice(3).find(v => !v.startsWith('--')) ?? path.join(TMP, SET === 'animator' ? 'fixture-animator' : PHASE === 'before' ? 'fixture' : 'fixture-runs'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9487);
const RAW = path.join(TMP, `raw-${PHASE}`);
const RESULTS = path.join(ROOT, `results-${PHASE}${SET === 'main' ? '' : `-${SET}`}.json`);
const out = { phase: PHASE, status: 'running', frame: null, captures: [], screenshots: [] };
if (!existsSync(ELECTRON)) throw new Error('electron is missing');

const commandNoWait = (id, arg) => `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');window.theia.container.get(C).executeCommand(${S(id)}${arg === undefined ? '' : `,${S(arg)}`}).catch(()=>{});return true})()`;
const shellCall = body => `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const s=window.theia.container.get(k);${body};return true})()`;
async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(250); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}

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
async function calibrate(session, v) {
    await v.eval(`(()=>{if(!window.__crrHooked){window.__crrHooked=true;window.addEventListener('pointermove',e=>window.__crrPointer={x:e.clientX,y:e.clientY},true)}return true})()`);
    const frame = await evalOn(session.cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return{left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    const probe = async (x, y) => {
        await v.eval('window.__crrPointer=null');
        return waitFor('pointer', async () => {
            await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 3, y: y - 3, button: 'none' }); await sleep(80);
            await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(400);
            return v.eval('window.__crrPointer');
        }, 180_000);
    };
    const a = { x: Math.round(frame.left + frame.width * 0.3), y: Math.round(frame.top + frame.height * 0.3) };
    const b = { x: Math.round(frame.left + frame.width * 0.7), y: Math.round(frame.top + frame.height * 0.6) };
    const la = await probe(a.x, a.y), lb = await probe(b.x, b.y);
    const sx = (b.x - a.x) / (lb.x - la.x), sy = (b.y - a.y) / (lb.y - la.y);
    return { sx, sy, dx: a.x - la.x * sx, dy: a.y - la.y * sy, iframe: frame };
}

const FRAME = `(()=>{const c=[...document.querySelectorAll('#preview-stage canvas, #preview-stage video')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>50).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return c?{x:c.x,y:c.y,w:c.width,h:c.height}:null})()`;
// 字幕の板（DOM）: outerHTML と、run / 文字 / 行の span の矩形（映像枠の左上基準・表示 px）。
const PLATE = (id, fr) => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!p)return null;const cs=getComputedStyle(p);if(cs.display==='none'||cs.visibility==='hidden')return null;const fr=${S(fr)};const px=v=>Math.round(v*100)/100;const rel=e=>{const b=e.getBoundingClientRect();return{left:px(b.left-fr.x),top:px(b.top-fr.y),width:px(b.width),height:px(b.height)}};const pick=sel=>[...p.querySelectorAll(sel)].map(e=>{const s=getComputedStyle(e);return{text:e.textContent,cls:e.className,role:e.getAttribute('data-role'),rect:rel(e),color:s.color,fontWeight:s.fontWeight,letterSpacing:s.letterSpacing,transform:s.transform,rotate:s.rotate,scale:s.scale,translate:s.translate,display:s.display,animation:s.animationName==='none'?null:s.animationName+' '+s.animationDuration+' '+s.animationDelay+' '+s.animationPlayState,textDecoration:s.textDecorationLine}});const lines=[...p.querySelectorAll('.akari-caption__line')].map(rel);return{html:p.outerHTML,lines,runs:pick('.akari-caption__run, [data-akari-run]'),chars:pick('.akari-caption__char'),emphasis:pick('.akari-caption__emphasis, .akari-caption__emphasis-char, [class*="akari-caption__tok--"]'),text:p.textContent}})()`;

let session;
try {
        await mkdir(RAW, { recursive: true });
    const work = path.join(TMP, `run-${PHASE}-${SET}`);
    await rm(work, { recursive: true, force: true });
    await cp(FIXTURE_SRC, work, { recursive: true });
    const project = await realpath(path.join(work, 'project'));
    const isoDir = path.join(TMP, `iso-caption-runs-render-${PHASE}-${SET}`);
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir });
    session.isoDir = isoDir;
    // 解析の精度のため倍率 2 で撮る（レイアウトは CSS px のまま・ラスタだけ 2 倍）。
    await session.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    out.pid = session.pid;
    const seek = time => evalOn(session.cdp, commandNoWait('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time }));
    await evalOn(session.cdp, commandNoWait('akari.annotations.open'));
    await waitEval(session.cdp, `Boolean(document.querySelector('.akari-annotations-widget, .akari-annotations'))||document.querySelectorAll('[class*="akari-timeline"]').length>0`, { label: 'timeline', timeoutMs: 120_000 });
    await waitFor('preview webview', async () => { await seek(1); await sleep(3000); return (await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url)); }, 120_000);
    await sleep(2500);
    const v = await view(PORT);
    await waitFor(`${CAPTURES[0].id} plate`, async () => { await seek(CAPTURES[0].t); await sleep(1200); return v.eval(PLATE(CAPTURES[0].id, { x: 0, y: 0 })); }, 120_000);
    await evalOn(session.cdp, shellCall(`s.collapsePanel('left');s.collapsePanel('right')`)).catch(() => {});
    await sleep(3000);
    // 撮影は webview の iframe の領域（ページ座標）で行う（映像枠は compare.mjs が画素から探す）。
    const off = { iframe: await evalOn(session.cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return{left:r.left,top:r.top,width:r.width,height:r.height}})()`) };
    const fr = await v.eval(FRAME);
    out.frame = fr;
    out.calibration = off;
    for (const capture of CAPTURES) {
        out.step = `capture ${capture.name}`;
        // 同じ時刻へ 2 回シークして描画が落ち着くのを待つ（再生はしない）。
        let plate = null;
        try { plate = await waitFor(`${capture.id} plate`, async () => { await seek(capture.t); await sleep(1500); return v.eval(PLATE(capture.id, fr)); }, 30_000); }
        catch (error) { out.missing = [...(out.missing ?? []), { name: capture.name, plates: await v.eval(`[...document.querySelectorAll('.caption-row-plate')].map(e=>({id:e.id,display:getComputedStyle(e).display,text:e.textContent.slice(-20)}))`) }]; }
        await seek(capture.t); await sleep(1500);
        const again = await v.eval(PLATE(capture.id, fr));
        // 映像枠の位置は webview の拡大表示で DOM の座標と画面の座標が一致しないため、webview の領域を丸ごと撮り、
        // 映像の単色（0x27313f）の外接矩形を compare.mjs が画素から探して切り出す。
        const f = off.iframe;
        const { data } = await session.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: f.left, y: f.top, width: f.width, height: f.height, scale: 1 } });
        await writeFile(path.join(RAW, `preview-${capture.name}.png`), Buffer.from(data, 'base64'));
        out.captures.push({ ...capture, dom: again ?? plate, stableBetweenSeeks: JSON.stringify(plate?.runs) === JSON.stringify(again?.runs) && JSON.stringify(plate?.chars) === JSON.stringify(again?.chars) });
        await saveJson(RESULTS, out);
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
console.log(JSON.stringify({ status: out.status, error: out.error, captures: out.captures.length }));
