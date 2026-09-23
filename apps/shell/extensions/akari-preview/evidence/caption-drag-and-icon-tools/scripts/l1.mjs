#!/usr/bin/env node
// 字幕のドラッグ・選択枠・はみ出し・ミニパネルの L1（ラッパー作成の検証スクリプト）。fixture は gen-fixture.mjs で作る。
// 使い方: node l1.mjs <before|after> [fixture dir] [--port=9473]
// 実機の Electron を自分専用のポート・一時ディレクトリで起動し、CDP の実マウスで操作して実測する。
// before = 変更前ビルドの観測記録（判定はしない）/ after = 受け入れ条件の判定つき。
// 「px」はプレビュー上の表示 px（webview の CSS px。ウィンドウ 1440×900・倍率 1）。
import { readFile, cp, rm, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
const TMP = path.join(os.tmpdir(), 'caption-drag-and-icon-tools-l1');
const FIXTURE_SRC = path.resolve(process.argv.slice(3).find(v => !v.startsWith('--')) ?? path.join(TMP, 'fixture'));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9473);
const RUNS = path.join(TMP, 'runs');
const RESULTS = path.join(ROOT, `results-${PHASE}.json`);
const STRICT = PHASE !== 'before';
const out = { phase: PHASE, status: 'running', checks: [], screenshots: [] };
const ALT = 1;
const SAVE_CASES = [
    { name: '中央吸着', id: 'c-0004', seek: 13, target: { x: 0.5, dxPx: 5, y: 0.7 } },
    { name: '左寄り', id: 'c-0005', seek: 17, target: { x: 0.3, dxPx: 0, y: 0.62 } },
    { name: '右寄り', id: 'c-0006', seek: 21, target: { x: 0.7, dxPx: 0, y: 0.78 } }
];
const OVERFLOW = { id: 'c-0003', seek: 9 };

const assert = (condition, message) => { if (STRICT && !condition) throw new Error(message); };
async function check(name, operation) {
    const record = { name, pass: false };
    out.checks.push(record);
    try { record.detail = await operation(); record.pass = true; }
    catch (error) { record.error = sanitize(error, REPO); }
    finally { await saveJson(RESULTS, out); }
    return record.detail;
}
const captionsOf = async project => { const p = JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8')); return Array.isArray(p) ? p : p.captions; };
const rootOf = async project => JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8'));
const rowOf = async (project, id) => (await captionsOf(project)).find(c => c.id === id);
async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(250); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const shellCall = body => `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const s=window.theia.container.get(k);${body};return true})()`;

// ---- webview（入れ子 iframe の内側）への到達と座標の対応（placed-text-position-polish の l1.mjs と同じ） ----
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
    await v.eval(`(()=>{if(!window.__cditHooked){window.__cditHooked=true;window.addEventListener('pointermove',e=>window.__cditPointer={x:e.clientX,y:e.clientY},true)}return true})()`);
    const frame = await evalOn(session.cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return{left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    const probe = async (x, y) => {
        await v.eval('window.__cditPointer=null');
        await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 3, y: y - 3, button: 'none' }); await sleep(80);
        await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(250);
        return waitFor('pointer', () => v.eval('window.__cditPointer'));
    };
    const a = { x: Math.round(frame.left + frame.width * 0.3), y: Math.round(frame.top + frame.height * 0.3) };
    const b = { x: Math.round(frame.left + frame.width * 0.7), y: Math.round(frame.top + frame.height * 0.6) };
    const la = await probe(a.x, a.y), lb = await probe(b.x, b.y);
    const sx = (b.x - a.x) / (lb.x - la.x), sy = (b.y - a.y) / (lb.y - la.y);
    return { sx, sy, dx: a.x - la.x * sx, dy: a.y - la.y * sy, iframe: frame };
}
const toPage = (off, pt) => ({ x: pt.x * off.sx + off.dx, y: pt.y * off.sy + off.dy });

const FRAME = `(()=>{const c=[...document.querySelectorAll('#preview-stage canvas, #preview-stage video')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>50).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return c?{x:c.x,y:c.y,w:c.width,h:c.height}:null})()`;
// 文字の実寸（.akari-caption__block か .akari-caption__line の外接矩形 = OH の captionVisualRect と同じ取り方）と行数（Range の行矩形の上端の種類）。
const PLATE = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!p)return null;const cs0=getComputedStyle(p);if(cs0.display==='none'||cs0.visibility==='hidden')return null;const block=p.querySelector('.akari-caption__block');const els=block?[block]:[...p.querySelectorAll('.akari-caption__line')];const rs=(els.length?els:[p]).map(e=>e.getBoundingClientRect());const r={left:Math.min(...rs.map(x=>x.left)),right:Math.max(...rs.map(x=>x.right)),top:Math.min(...rs.map(x=>x.top)),bottom:Math.max(...rs.map(x=>x.bottom))};if(!(r.right-r.left>0))return null;const lineEls=[...p.querySelectorAll('.akari-caption__line')];const tops=new Set();for(const e of (lineEls.length?lineEls:[block||p])){const range=document.createRange();range.selectNodeContents(e);for(const x of range.getClientRects())if(x.width>0&&x.height>0)tops.add(Math.round(x.top))}const g=(lineEls[0]||block||p).getBoundingClientRect();const px=v=>Math.round(v*100)/100;const plate=p.querySelector('.akari-caption__plate');const pr=plate?.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,cx:(r.left+r.right)/2,cy:(r.top+r.bottom)/2,w:r.right-r.left,h:r.bottom-r.top,lines:tops.size,text:(block||p).textContent,selected:p.hasAttribute('data-selected'),plateBox:pr?{left:px(pr.left),right:px(pr.right),width:px(pr.width)}:null,translate:p.style.translate||'',grab:{x:g.left+g.width/2,y:g.top+g.height/2}}})()`;
// 選択中の字幕の周りに見えている枠（outline / border / 破線）を全部数える。つまみ・ミニパネルは除く。
const SELECTION = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));const block=p?.querySelector('.akari-caption__block');const els=block?[block]:[...(p?.querySelectorAll('.akari-caption__line')||[])];const rs=els.map(e=>e.getBoundingClientRect());const ink=rs.length?{left:Math.min(...rs.map(x=>x.left)),right:Math.max(...rs.map(x=>x.right)),top:Math.min(...rs.map(x=>x.top)),bottom:Math.max(...rs.map(x=>x.bottom))}:null;const px=v=>Math.round(v*100)/100;const visible=e=>{let n=e;while(n&&n.nodeType===1){const cs=getComputedStyle(n);if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0)return false;n=n.parentElement}const b=e.getBoundingClientRect();return b.width>0&&b.height>0};const yellow=[];const frames=[];for(const e of document.querySelectorAll('*')){if(!visible(e))continue;const cs=getComputedStyle(e);const ol=cs.outlineStyle!=='none'&&parseFloat(cs.outlineWidth)>0;const bd=['Top','Right','Bottom','Left'].every(s=>cs['border'+s+'Style']!=='none'&&parseFloat(cs['border'+s+'Width'])>0&&!/rgba\\(\\d+, \\d+, \\d+, 0\\)|transparent/.test(cs['border'+s+'Color']));if(ol&&/245, 196, 81/.test(cs.outlineColor))yellow.push({cls:e.className&&String(e.className),id:e.id});if(!ol&&!bd)continue;if(e.closest('.akari-caption-select-tools, .akari-caption-handle, [class*="palette"], [class*="tooltip"]'))continue;const b=e.getBoundingClientRect();if(!ink)continue;const ov=Math.max(0,Math.min(b.right,ink.right)-Math.max(b.left,ink.left))*Math.max(0,Math.min(b.bottom,ink.bottom)-Math.max(b.top,ink.top));const area=(ink.right-ink.left)*(ink.bottom-ink.top);if(area<=0||ov/area<0.8)continue;if(b.width>(ink.right-ink.left)*3&&b.height>(ink.bottom-ink.top)*6)continue;frames.push({tag:e.tagName.toLowerCase(),id:e.id,cls:e.className&&String(e.className).slice(0,80),kind:ol?'outline':'border',style:ol?cs.outlineStyle:cs.borderTopStyle,color:ol?cs.outlineColor:cs.borderTopColor,width:px(ol?parseFloat(cs.outlineWidth):parseFloat(cs.borderTopWidth)),offset:ol?cs.outlineOffset:null,rect:{left:px(b.left),top:px(b.top),width:px(b.width),height:px(b.height)}})}const box=document.getElementById('caption-select-box');const bb=box?.getBoundingClientRect();const tools=document.querySelector('.akari-caption-select-tools');const items=tools?[...tools.querySelectorAll('button, [role="button"], .akari-caption-group-badge')].filter(visible).map(b=>({tag:b.tagName.toLowerCase(),cls:String(b.className).slice(0,80),text:(b.textContent||'').trim(),title:b.getAttribute('title'),aria:b.getAttribute('aria-label'),pressed:b.getAttribute('aria-pressed'),hasSvg:!!b.querySelector('svg')})):[];const toolsText=tools?tools.innerText:'';const emoji=[...(toolsText.match(/[\\p{Extended_Pictographic}\\u2190-\\u21FF\\u2B00-\\u2BFF\\u{1F300}-\\u{1FAFF}]/gu)||[])];return{ink:ink?{left:px(ink.left),top:px(ink.top),width:px(ink.right-ink.left),height:px(ink.bottom-ink.top)}:null,selectBox:bb?{active:visible(box),left:px(bb.left),top:px(bb.top),width:px(bb.width),height:px(bb.height),border:getComputedStyle(box).borderTopStyle+' '+getComputedStyle(box).borderTopWidth+' '+getComputedStyle(box).borderTopColor}:null,frames,yellowOutlines:yellow,tools:{items,text:toolsText,emoji}}})()`;

async function openAll(session, project, seekTo) {
    await evalOn(session.cdp, command('akari.annotations.open'));
    await waitEval(session.cdp, `Boolean(document.querySelector('.akari-annotations-widget, .akari-annotations'))||document.querySelectorAll('[class*="akari-timeline"]').length>0`, { label: 'timeline', timeoutMs: 120_000 });
    await waitFor('preview webview', async () => {
        await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time: seekTo }));
        await sleep(3000);
        return (await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
    }, 120_000);
    await sleep(2500);
    const v = await view(PORT);
    await waitFor('c-0001 plate', async () => { await seek(session, project, seekTo); await sleep(1200); return v.eval(PLATE('c-0001')); }, 120_000);
    return v;
}
const seek = (session, project, time) => evalOn(session.cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time }));
async function seekTo(session, v, project, time, id) {
    return waitFor(`${id} plate at ${time}`, async () => { await seek(session, project, time); await sleep(1200); return v.eval(PLATE(id)); }, 60_000);
}
async function shot(session, off, name) {
    await sleep(500);
    const file = `${PHASE}-${name}.png`;
    const f = off.iframe;
    const { data } = await session.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: f.left, y: f.top, width: f.width, height: f.height, scale: 1 } });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(ROOT, file), Buffer.from(data, 'base64'));
    out.screenshots.push(file);
}
// プレートの位置と幅が 3 回続けて変わらなくなるまで待って返す（保存後の再描画・再読込の途中を掴まない）。
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
// 掴む点 = 1 行目の文字の中心（2 行の字幕の外接矩形の中心は行間に落ちて下の映像を掴むことがある）。その点が字幕に当たることを確かめる。
async function grabPoint(v, p) {
    const hit = await v.eval(`(()=>{const h=document.elementFromPoint(${p.grab.x},${p.grab.y});return Boolean(h&&h.closest('.caption-row-plate'))})()`);
    if (!hit) throw new Error(`grab point ${S(p.grab)} does not hit the caption`);
    return p.grab;
}
async function clickLocal(session, off, pt, opts = {}) { const p = toPage(off, pt); await realClick(session.cdp, p.x, p.y, opts); }
async function deselect(session, off, v) {
    const free = await v.eval(`(()=>{const f=${FRAME};for(const[x,y]of[[.92,.08],[.08,.1],[.6,.12],[.92,.3],[.3,.12]]){const p={x:f.x+f.w*x,y:f.y+f.h*y};const h=document.elementFromPoint(p.x,p.y);if(h&&!h.closest('.caption-row-plate, #caption-select-box'))return p}return null})()`);
    if (free) { await clickLocal(session, off, free); await sleep(600); }
}
const rel = (p, fr) => ({ cxOffPx: round(p.cx - (fr.x + fr.w / 2)), left: round(p.left - fr.x), top: round(p.top - fr.y), right: round(p.right - fr.x), bottom: round(p.bottom - fr.y), w: round(p.w), h: round(p.h), lines: p.lines });

// ---- 押したまま途中で測るドラッグ（steps 刻みで動かし、各中継点で止まって測る） ----
async function mouse(cdp, type, pt, modifiers = 0, extra = {}) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: type === 'mouseMoved' ? (extra.buttons ? 'left' : 'none') : 'left', buttons: extra.buttons ?? 0, clickCount: extra.clickCount ?? (type === 'mouseMoved' ? 0 : 1), modifiers });
}
/** from / waypoints は webview ローカル座標。各 waypoint = { x, y, modifiers?, probe?: label }。onProbe(label) の戻り値を集める。 */
async function probeDrag(session, off, from, waypoints, onProbe, { release = true, steps = 10 } = {}) {
    const cdp = session.cdp;
    const start = toPage(off, from);
    await mouse(cdp, 'mouseMoved', start); await sleep(150);
    await mouse(cdp, 'mousePressed', start, 0, { buttons: 1 }); await sleep(150);
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
    if (release) await mouse(cdp, 'mouseReleased', toPage(off, last), last.modifiers ?? 0, { buttons: 0 });
    return probes;
}
async function waitSaved(project, id, beforeStyle, timeoutMs = 10_000) {
    return waitFor('saved', async () => { const r = await rowOf(project, id); return S(r?.text_style) !== S(beforeStyle) && r; }, timeoutMs).catch(() => rowOf(project, id));
}

// ---- AFTER だけ: ミニパネルのアイコン・説明・書き込み・コマンド ----
// 各アイコンの見た目の文字（説明を除く）と、絵文字・記号文字（矢印・幾何記号・ピクトグラフ）。
const TOOL_ICONS = `[...document.querySelectorAll('#caption-select-box [data-caption-tool]')].filter(b=>!b.hidden&&getComputedStyle(b).display!=='none').map(b=>{const c=b.cloneNode(true);c.querySelectorAll('.akari-caption-tool-tip').forEach(t=>t.remove());const iconText=(c.textContent||'').trim();return{tool:b.dataset.captionTool,iconText,hasSvg:!!b.querySelector('svg'),on:b.classList.contains('on'),pressed:b.getAttribute('aria-pressed'),tip:(b.querySelector('.akari-caption-tool-tip')?.textContent||'').trim(),symbols:[...(iconText.match(/[\\p{Extended_Pictographic}\\u2190-\\u21FF\\u2300-\\u23FF\\u25A0-\\u27BF\\u2B00-\\u2BFF]/gu)||[])]}})`;
const TOOL_RECT = name => `(()=>{const b=document.querySelector('#caption-select-box [data-caption-tool=${JSON.stringify(name)}]');if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`;
const SEL_RECT = selector => `(()=>{const b=document.querySelector(${S(selector)});if(!b)return null;const cs=getComputedStyle(b);if(b.hidden||cs.display==='none')return null;const r=b.getBoundingClientRect();return r.width>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`;
// pointerover を起点に、説明（.akari-caption-tool-tip）が見える（display/visibility/opacity≥0.9/幅>0）までの時間を 2ms 刻みで測る。
const TIP_ARM = name => `(()=>{const b=document.querySelector('#caption-select-box [data-caption-tool=${JSON.stringify(name)}]');const tip=b.querySelector('.akari-caption-tool-tip');const s=window.__cditTip={name:${JSON.stringify(name)},t0:null,t1:null,text:null};const vis=()=>{const cs=getComputedStyle(tip);const r=tip.getBoundingClientRect();return cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity)>=0.9&&r.width>0};b.addEventListener('pointerover',()=>{if(s.t0!==null)return;s.t0=performance.now();const poll=()=>{if(vis()){s.t1=performance.now();s.text=tip.textContent;return}if(performance.now()-s.t0<2000)setTimeout(poll,2)};poll()},{once:true});return vis()})()`;
const HOST_CMD_LOG = `(()=>{if(window.__cditCmds)return true;const d=window.theia.container._bindingDictionary;const K=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.getActiveHandler==='function'&&typeof k.prototype?.executeCommand==='function');const r=window.theia.container.get(K);window.__cditCmds=[];r.onWillExecuteCommand(e=>window.__cditCmds.push({id:e.commandId,args:JSON.stringify(e.args||[]).slice(0,200)}));return true})()`;
async function hoverLocal(session, off, pt) { const p = toPage(off, pt); await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' }); }
async function clickTool(session, off, v, selector) {
    const pt = await waitFor(`${selector} visible`, () => v.eval(SEL_RECT(selector)), 10_000);
    // 押す点に別の要素（パレット・説明など）が重なっていないかを確かめる。
    const hit = await v.eval(`(()=>{const h=document.elementFromPoint(${pt.x},${pt.y});const want=document.querySelector(${S(selector)});return{ok:!!(h&&want&&(h===want||want.contains(h))),hit:h?h.outerHTML.slice(0,100):null}})()`);
    if (!hit.ok) throw new Error(`${selector} is covered at ${S(pt)} by ${hit.hit}`);
    await clickLocal(session, off, pt);
    await sleep(400);
}
async function waitRow(project, id, predicate, label) {
    return waitFor(label, async () => { const r = await rowOf(project, id); return predicate(r?.text_style ?? {}) && r; }, 15_000);
}
// 書き込みがプレビューに戻って、アイコンの ON / OFF の見た目が期待どおりになるまで待つ（高負荷時は再読込が遅れる）。
const waitIcon = (v, tool, on) => waitFor(`${tool} icon ${on ? 'on' : 'off'}`, async () => (await v.eval(TOOL_ICONS)).find(i => i.tool === tool)?.on === on, 30_000);
async function afterToolChecks(session, off, v) {
    const project = fixture;
    const ID = 'c-0002';
    const cmds = async () => evalOn(session.cdp, 'window.__cditCmds||[]');
    await evalOn(session.cdp, HOST_CMD_LOG);
    await v.eval(`(()=>{if(window.__cditClicks)return true;window.__cditClicks=[];document.addEventListener('click',e=>window.__cditClicks.push((e.target.closest('[data-caption-tool],[data-palette-more],[data-palette-tab],[data-color]')||e.target).outerHTML.slice(0,50)),true);return true})()`);
    await check('ミニパネル: 各アイコンの説明がマウスを乗せて 100ms 以内に出る', async () => {
        const icons = await v.eval(TOOL_ICONS);
        const m = {};
        const fr = await v.eval(FRAME);
        for (const icon of icons) {
            await hoverLocal(session, off, { x: fr.x + fr.w * 0.9, y: fr.y + fr.h * 0.15 }); await sleep(250);
            const pt = await v.eval(TOOL_RECT(icon.tool));
            const visibleBefore = await v.eval(TIP_ARM(icon.tool));
            await hoverLocal(session, off, pt);
            const s = await waitFor(`${icon.tool} tip`, async () => { const x = await v.eval('window.__cditTip'); return x?.t1 != null && x; }, 5_000).catch(async () => v.eval('window.__cditTip'));
            m[icon.tool] = { ms: s?.t1 != null ? round(s.t1 - s.t0, 1) : null, text: s?.text ?? null, visibleBefore };
            assert(!visibleBefore && m[icon.tool].ms !== null && m[icon.tool].ms <= 100, `${icon.tool}: ${S(m[icon.tool])}`);
        }
        return m;
    });
    await hoverLocal(session, off, await v.eval(TOOL_RECT('snap')));
    await shot(session, off, '08-tooltip-snap');
    await check('ミニパネル: 既定の状態（吸着 ON・はみ出し防止 OFF・全字幕モード OFF）', async () => {
        const icons = Object.fromEntries((await v.eval(TOOL_ICONS)).map(i => [i.tool, i]));
        const m = { snap: icons.snap?.on, clamp: icons.clamp?.on, group: icons.group?.on, tips: { snap: icons.snap?.tip, clamp: icons.clamp?.tip, group: icons.group?.tip } };
        assert(m.snap === true && m.clamp === false && m.group === false, S(m));
        return m;
    });
    await check('ミニパネル: B（太字）で text_style.font_weight が 900 ⇄ 解除', async () => {
        await clickTool(session, off, v, '#caption-select-box [data-caption-tool="bold"]');
        const on = await waitRow(project, ID, s => s.font_weight === 900, 'bold on');
        const iconOn = await waitIcon(v, 'bold', true).catch(() => false);
        await clickTool(session, off, v, '#caption-select-box [data-caption-tool="bold"]');
        const off2 = await waitRow(project, ID, s => s.font_weight === undefined, 'bold off');
        return { on: on.text_style, iconOn, off: off2.text_style ?? null };
    });
    await check('ミニパネル: 色（文字 / 縁取り / 座布団の 3 タブ）で captions.json が書き換わる', async () => {
        await clickTool(session, off, v, '#caption-select-box [data-caption-tool="color"]');
        await waitFor('palette', () => v.eval(SEL_RECT('#caption-select-box [data-caption-palette]')), 5_000);
        const m = { swatches: await v.eval(`document.querySelectorAll('#caption-select-box [data-palette-colors] [data-color]').length`) };
        const picks = { text: ['#ff8b2c', s => s.color === '#ff8b2c'], stroke: ['#283447', s => s.stroke?.color === '#283447'], background: ['#4da3ff', s => s.background?.color === '#4da3ff' && (s.background?.opacity ?? 1) > 0] };
        for (const [tab, [color, ok]] of Object.entries(picks)) {
            if (!(await v.eval(SEL_RECT('#caption-select-box [data-caption-palette]')))) await clickTool(session, off, v, '#caption-select-box [data-caption-tool="color"]');
            await clickTool(session, off, v, `#caption-select-box [data-palette-tab="${tab}"]`);
            await clickTool(session, off, v, `#caption-select-box [data-palette-colors] [data-color="${color}"]`);
            const row = await waitRow(project, ID, ok, `${tab} color`);
            m[tab] = row.text_style;
            await sleep(600);
        }
        m.recent = await v.eval(`[...document.querySelectorAll('#caption-select-box [data-palette-recent] [data-color]')].map(b=>b.dataset.color)`);
        assert(m.swatches === 14, `swatches ${m.swatches}`);
        assert(m.recent.length === 3, `recent ${S(m.recent)}`);
        return m;
    });
    await shot(session, off, '09-palette');
    await check('ミニパネル: 「他の色…」で host のインスペクターのコマンドが実行される', async () => {
        if (!(await v.eval(SEL_RECT('#caption-select-box [data-caption-palette]')))) await clickTool(session, off, v, '#caption-select-box [data-caption-tool="color"]');
        await clickTool(session, off, v, '#caption-select-box [data-palette-tab="stroke"]');
        const n = (await cmds()).length;
        await clickTool(session, off, v, '#caption-select-box [data-palette-more]');
        const log = await waitFor('inspector command', async () => { const l = (await cmds()).slice(n).filter(c => /^akari\.inspector\./.test(c.id)); return l.length && l; }, 10_000).catch(async error => { throw new Error(`${error.message}; host log ${S((await cmds()).slice(-8))}; webview clicks ${S(await v.eval('window.__cditClicks||null'))}`); });
        return { log };
    });
    await check('ミニパネル: 座布団で background.opacity が 0 ⇄ 直前の値', async () => {
        const selectAgain = async () => {
            if (await v.eval(SEL_RECT('#caption-select-box [data-caption-tool="cushion"]'))) return;
            const p = await stablePlate(v, ID); await clickLocal(session, off, await grabPoint(v, p)); await sleep(800);
        };
        await selectAgain();
        await waitIcon(v, 'cushion', true);
        const before = (await rowOf(project, ID)).text_style?.background;
        await clickTool(session, off, v, '#caption-select-box [data-caption-tool="cushion"]');
        const offRow = await waitRow(project, ID, s => s.background?.opacity === 0, 'cushion off');
        await selectAgain();
        await waitIcon(v, 'cushion', false);
        await clickTool(session, off, v, '#caption-select-box [data-caption-tool="cushion"]');
        const onRow = await waitRow(project, ID, s => (s.background?.opacity ?? 0) > 0, 'cushion on');
        const m = { before, off: offRow.text_style.background, on: onRow.text_style.background };
        // 「直前の値」= 外す前の実効の不透明度（opacity が無く色だけある座布団は 1、座布団が無ければ 0.75）。
        assert(m.on.opacity === (before?.opacity ?? (before?.color ? 1 : 0.75)), S(m));
        return m;
    });
    await check('ミニパネル: 「インスペクターを開く」で host のコマンドが実行される', async () => {
        if (!(await v.eval(SEL_RECT('#caption-select-box [data-caption-tool="inspector"]')))) { const p = await stablePlate(v, ID); await clickLocal(session, off, await grabPoint(v, p)); await sleep(800); }
        const n = (await cmds()).length;
        await clickTool(session, off, v, '#caption-select-box [data-caption-tool="inspector"]');
        const log = await waitFor('inspector command', async () => { const l = (await cmds()).slice(n).filter(c => /^akari\.inspector\./.test(c.id)); return l.length && l; }, 10_000).catch(async error => { throw new Error(`${error.message}; host log ${S((await cmds()).slice(-8))}; webview clicks ${S(await v.eval('window.__cditClicks||null'))}`); });
        return { log };
    });
    await check('ミニパネル: 全字幕モードの切り替えで選択枠が破線 ⇄ 実線', async () => {
        if (!(await v.eval(SEL_RECT('#caption-select-box [data-caption-tool="group"]')))) { const p = await stablePlate(v, ID); await clickLocal(session, off, await grabPoint(v, p)); await sleep(800); }
        const border = () => v.eval(`getComputedStyle(document.getElementById('caption-select-box')).borderTopStyle`);
        const b0 = await border();
        await clickTool(session, off, v, '#caption-select-box [data-caption-tool="group"]');
        const b1 = await border();
        const tip1 = (await v.eval(TOOL_ICONS)).find(i => i.tool === 'group')?.tip;
        await clickTool(session, off, v, '#caption-select-box [data-caption-tool="group"]');
        const b2 = await border();
        const m = { initial: b0, groupOn: b1, groupOff: b2, tipWhenOn: tip1 };
        assert(b0 === 'solid' && b1 === 'dashed' && b2 === 'solid', S(m));
        return m;
    });
    await check('行の箱: 既定は出さない・切り替えると折り返しの幅を破線で示す', async () => {
        if (!(await v.eval(SEL_RECT('#caption-select-box')))) { const p = await stablePlate(v, ID); await clickLocal(session, off, await grabPoint(v, p)); await sleep(800); }
        const box = `(()=>{const e=document.getElementById('caption-row-box');if(!e)return null;const cs=getComputedStyle(e);const r=e.getBoundingClientRect();return{visible:cs.display!=='none'&&r.width>0,border:cs.borderTopStyle+' '+cs.borderTopColor,label:e.textContent.trim(),width:Math.round(r.width*100)/100}})()`;
        const b0 = await v.eval(box);
        await clickTool(session, off, v, '#caption-row-box-toggle');
        await sleep(400);
        const b1 = await v.eval(box);
        const fr = await v.eval(FRAME);
        await shot(session, off, '10-row-box');
        await clickTool(session, off, v, '#caption-row-box-toggle');
        const b2 = await v.eval(box);
        const m = { default: b0, on: b1, off: b2, frameW: fr.w, onWidthRatio: b1 ? round(b1.width / fr.w, 4) : null };
        assert(b0 && !b0.visible && b1?.visible && /dashed/.test(b1.border) && !b2.visible, S(m));
        // 話した言葉の字幕の折り返しの幅 = 画面の 92%（行の max-width）。
        assert(Math.abs(m.onWidthRatio - 0.92) <= 0.01, `row box width ratio ${m.onWidthRatio}`);
        return m;
    });
    // 置いた文字も同じ吸着（中央から 6px → 中央 / 20px → 20px）。
    await check('吸着（置いた文字）: 中央から 6px で吸着・20px で離して 20px のまま保存', async () => {
        await seekTo(session, v, fixture, 29, 'c-0101');
        const fr = await v.eval(FRAME);
        const p = await stablePlate(v, 'c-0101');
        const before = await rowOf(fixture, 'c-0101');
        const c0 = p.cx - (fr.x + fr.w / 2);
        const grab = await grabPoint(v, p);
        const probes = await probeDrag(session, off, grab, [{ x: grab.x - c0 + 6, y: grab.y, probe: '+6' }, { x: grab.x - c0 + 20, y: grab.y, probe: '+20' }], async () => rel(await v.eval(PLATE('c-0101')), fr));
        const row = await waitSaved(fixture, 'c-0101', before.text_style);
        await sleep(800);
        await deselect(session, off, v);
        const settled = rel(await stablePlate(v, 'c-0101'), fr);
        const m = { startOffsetPx: round(c0), probes, saved: row.text_style, settled };
        assert(Math.abs(probes['+6'].cxOffPx) <= 1 && Math.abs(probes['+20'].cxOffPx - 20) <= 1 && Math.abs(settled.cxOffPx - 20) <= 1, S(m));
        return m;
    });
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
        if (/akari-preview|caption|字幕/.test(text)) out.consoleWarnings.push(sanitize(text.slice(0, 300), REPO));
    });
    try {
        const v = await openAll(session, fixture, 1);
        await evalOn(session.cdp, shellCall(`s.collapsePanel('left')`)).catch(() => {});
        await sleep(3000);
        const off = await calibrate(session, v);
        out.calibration = off;
        out.frame = await v.eval(FRAME);

        // ===== 選択枠 =====
        await check('選択枠: 字幕を選ぶと見える枠の本数・幅・黄色の outline', async () => {
            await seekTo(session, v, fixture, 1, 'c-0001');
            const fr = await v.eval(FRAME);
            const p = await stablePlate(v, 'c-0001');
            await clickLocal(session, off, await grabPoint(v, p));
            await sleep(800);
            const sel = await v.eval(SELECTION('c-0001'));
            const m = { frameW: round(fr.w), ink: sel.ink, selectBox: sel.selectBox, frames: sel.frames, frameCount: sel.frames.length, yellowOutlines: sel.yellowOutlines.length, yellowDetail: sel.yellowOutlines, plateBox: p.plateBox };
            if (sel.selectBox) m.selectBoxMinusInkPx = round(sel.selectBox.width - sel.ink.width);
            m.selectBoxWidthRatio = sel.selectBox ? round(sel.selectBox.width / fr.w, 4) : null;
            assert(m.frameCount === 1, `frames ${m.frameCount}`);
            assert(m.yellowOutlines === 0, `yellow ${m.yellowOutlines}`);
            assert(sel.selectBox?.active && Math.abs(m.selectBoxMinusInkPx) <= 6, `select box vs ink ${m.selectBoxMinusInkPx}`);
            assert(m.selectBoxWidthRatio < 0.6, `ratio ${m.selectBoxWidthRatio}`);
            return m;
        });
        await shot(session, off, '01-selected');

        // ===== 吸着 =====
        await check('吸着: 中央から 6 / 10 / 14 / 20px（押したまま測る）→ 20px で離して保存', async () => {
            const fr = await v.eval(FRAME);
            const p = await stablePlate(v, 'c-0001');
            const before = await rowOf(fixture, 'c-0001');
            const c0 = p.cx - (fr.x + fr.w / 2);
            const grab = await grabPoint(v, p);
            const at = dx => ({ x: grab.x - c0 + dx, y: grab.y });
            const probe = async () => rel(await v.eval(PLATE('c-0001')), fr);
            const probes = await probeDrag(session, off, grab, [
                { ...at(6), probe: '+6' }, { ...at(10), probe: '+10' }, { ...at(14), probe: '+14' }, { ...at(20), probe: '+20' }
            ], probe);
            const row = await waitSaved(fixture, 'c-0001', before.text_style);
            await sleep(800);
            await deselect(session, off, v);
            const settled = rel(await stablePlate(v, 'c-0001'), fr);
            const m = { startOffsetPx: round(c0), probes, saved: row.text_style, settled };
            assert(Math.abs(probes['+6'].cxOffPx) <= 1, `+6 not snapped ${probes['+6'].cxOffPx}`);
            assert(Math.abs(probes['+10'].cxOffPx) <= 1, `+10 released ${probes['+10'].cxOffPx}`);
            assert(Math.abs(probes['+14'].cxOffPx - 14) <= 1, `+14 still snapped ${probes['+14'].cxOffPx}`);
            assert(Math.abs(probes['+20'].cxOffPx - 20) <= 1, `+20 ${probes['+20'].cxOffPx}`);
            assert(Math.abs(settled.cxOffPx - 20) <= 1, `saved/rendered at ${settled.cxOffPx} (want 20)`);
            return m;
        });
        await shot(session, off, '02-snap-20px');
        await check('吸着: 20px の位置から中央へ 6px まで寄せる → 中央に吸着して保存', async () => {
            const fr = await v.eval(FRAME);
            const p = await stablePlate(v, 'c-0001');
            const before = await rowOf(fixture, 'c-0001');
            const c0 = p.cx - (fr.x + fr.w / 2);
            const grab = await grabPoint(v, p);
            const probes = await probeDrag(session, off, grab, [{ x: grab.x - c0 + 6, y: grab.y, probe: '+6' }], async () => rel(await v.eval(PLATE('c-0001')), fr));
            const row = await waitSaved(fixture, 'c-0001', before.text_style);
            await sleep(800);
            await deselect(session, off, v);
            const settled = rel(await stablePlate(v, 'c-0001'), fr);
            assert(Math.abs(probes['+6'].cxOffPx) <= 1, `+6 not snapped ${probes['+6'].cxOffPx}`);
            assert(Math.abs(settled.cxOffPx) <= 1, `settled ${settled.cxOffPx}`);
            return { startOffsetPx: round(c0), probes, saved: row.text_style, settled };
        });
        await check('吸着: Alt を押したまま中央から 6px → 吸着しない', async () => {
            const fr = await v.eval(FRAME);
            const p = await stablePlate(v, 'c-0001');
            const before = await rowOf(fixture, 'c-0001');
            const c0 = p.cx - (fr.x + fr.w / 2);
            const grab = await grabPoint(v, p);
            // 押し下げは Alt なし（全字幕モードにしない）→ 動かす間だけ Alt。
            const probes = await probeDrag(session, off, grab, [{ x: grab.x - c0 + 20, y: grab.y }, { x: grab.x - c0 + 6, y: grab.y, modifiers: ALT, probe: 'alt+6' }], async () => rel(await v.eval(PLATE('c-0001')), fr));
            const row = await waitSaved(fixture, 'c-0001', before.text_style);
            await sleep(800);
            await deselect(session, off, v);
            const settled = rel(await stablePlate(v, 'c-0001'), fr);
            const root = await rootOf(fixture);
            assert(Math.abs(probes['alt+6'].cxOffPx - 6) <= 1, `alt+6 at ${probes['alt+6'].cxOffPx}`);
            assert(Math.abs(settled.cxOffPx - 6) <= 1, `settled ${settled.cxOffPx}`);
            return { startOffsetPx: round(c0), probes, saved: row.text_style, settled, defaultTextStyle: root.default_text_style };
        });

        // ===== 保存 = 表示（3 ケース）=====
        out.saveCases = [];
        for (const sc of SAVE_CASES) {
            await check(`保存: ${sc.name}（${sc.id}）— 離す瞬間と保存後の描画`, async () => {
                await seekTo(session, v, fixture, sc.seek, sc.id);
                const fr = await v.eval(FRAME);
                const p = await stablePlate(v, sc.id);
                const before = await rowOf(fixture, sc.id);
                const grab = await grabPoint(v, p);
                const target = { x: fr.x + fr.w * sc.target.x + sc.target.dxPx, y: fr.y + fr.h * sc.target.y };
                const probes = await probeDrag(session, off, grab, [{ x: (grab.x + target.x) / 2, y: (grab.y + target.y) / 2 }, { ...target, probe: 'hold' }], async () => rel(await v.eval(PLATE(sc.id)), fr));
                const row = await waitSaved(fixture, sc.id, before.text_style);
                await sleep(800);
                await deselect(session, off, v);
                const settled = rel(await stablePlate(v, sc.id), fr);
                const hold = probes.hold;
                const diff = { left: round(settled.left - hold.left), top: round(settled.top - hold.top), w: round(settled.w - hold.w), lines: settled.lines - hold.lines };
                const m = { id: sc.id, initial: rel(p, fr), hold, saved: row.text_style, settled, diff };
                out.saveCases.push(m);
                assert(Math.abs(diff.left) <= 1 && Math.abs(diff.top) <= 1 && diff.lines === 0, `settled differs ${S(diff)}`);
                if (sc.name === '中央吸着') assert(Math.abs(hold.cxOffPx) <= 1, `center case not snapped ${hold.cxOffPx}`);
                return m;
            });
        }
        await shot(session, off, '03-right-case');

        // ===== はみ出し =====
        await check('はみ出し: 既定のまま字幕の半分を画面の左の外へ → 保存', async () => {
            await seekTo(session, v, fixture, OVERFLOW.seek, OVERFLOW.id);
            const fr = await v.eval(FRAME);
            const p = await stablePlate(v, OVERFLOW.id);
            const before = await rowOf(fixture, OVERFLOW.id);
            const grab = await grabPoint(v, p);
            const target = { x: fr.x + 1, y: fr.y + fr.h * 0.55 };  // 文字の中心を画面の左端（+1px。0% の吸着対象から外す）へ
            const probes = await probeDrag(session, off, grab, [{ x: (grab.x + target.x) / 2, y: (grab.y + target.y) / 2 }, { ...target, probe: 'hold' }], async () => rel(await v.eval(PLATE(OVERFLOW.id)), fr));
            const row = await waitSaved(fixture, OVERFLOW.id, before.text_style);
            await sleep(800);
            await deselect(session, off, v);
            const settled = rel(await stablePlate(v, OVERFLOW.id), fr);
            const m = { hold: probes.hold, saved: row.text_style, settled, outsideRatio: round(Math.max(0, -settled.left) / settled.w, 3) };
            out.overflow = m;
            assert(m.outsideRatio >= 0.4, `outside ratio ${m.outsideRatio}`);
            assert(Math.abs(settled.left - probes.hold.left) <= 1 && Math.abs(settled.top - probes.hold.top) <= 1, `settled ${S(settled)} vs hold ${S(probes.hold)}`);
            return m;
        });
        await shot(session, off, '04-overflow');

        // ===== ミニパネル =====
        await check('ミニパネル: 選んだ字幕の上に浮く道具の中身', async () => {
            await seekTo(session, v, fixture, 5, 'c-0002');
            const p = await stablePlate(v, 'c-0002');
            await clickLocal(session, off, await grabPoint(v, p));
            await sleep(800);
            const sel = await v.eval(SELECTION('c-0002'));
            const m = { tools: sel.tools, selectBox: sel.selectBox };
            if (STRICT) {
                m.icons = await v.eval(TOOL_ICONS);
                assert(m.icons.length >= 7, `tools ${m.icons.length}`);
                for (const icon of m.icons) {
                    assert(icon.symbols.length === 0, `${icon.tool}: symbol ${icon.symbols}`);
                    assert(icon.tool === 'bold' ? icon.iconText === 'B' : icon.hasSvg, `${icon.tool}: icon ${S(icon)}`);
                }
                assert(sel.tools.emoji.length === 0, `emoji ${sel.tools.emoji}`);
            }
            return m;
        });
        await shot(session, off, '05-tools');
        if (STRICT) await afterToolChecks(session, off, v);
        await deselect(session, off, v);
        out.renderedBeforeReload = {};
        const fr = await v.eval(FRAME);
        for (const [id, t] of [['c-0001', 1], [OVERFLOW.id, OVERFLOW.seek], ...SAVE_CASES.map(c => [c.id, c.seek])]) {
            await seekTo(session, v, fixture, t, id);
            out.renderedBeforeReload[id] = rel(await stablePlate(v, id), fr);
        }
        v.cdp.close();
    } finally { await stop(session); }

    // ===== 再読込後 =====
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: fixture, port: PORT, isoDir: path.join(RUNS, `${PHASE}-2`) });
    out.pids.push(session.pid);
    try {
        const v = await openAll(session, fixture, 1);
        await evalOn(session.cdp, shellCall(`s.collapsePanel('left')`)).catch(() => {});
        await sleep(3000);
        const off = await calibrate(session, v);
        const fr = await v.eval(FRAME);
        out.frameAfterReload = fr;
        await check('再読込: 離した瞬間（hold）と再読込後の描画 — 3 ケース + はみ出し', async () => {
            const m = {};
            for (const sc of SAVE_CASES) {
                await seekTo(session, v, fixture, sc.seek, sc.id);
                const r = rel(await stablePlate(v, sc.id), fr);
                const hold = out.saveCases.find(c => c.id === sc.id)?.hold;
                m[sc.name] = { reloaded: r, hold, diff: hold ? { left: round(r.left - hold.left), top: round(r.top - hold.top), w: round(r.w - hold.w), lines: r.lines - hold.lines } : null };
                assert(m[sc.name].diff && Math.abs(m[sc.name].diff.left) <= 1 && Math.abs(m[sc.name].diff.top) <= 1 && m[sc.name].diff.lines === 0, `${sc.name}: ${S(m[sc.name].diff)}`);
            }
            await seekTo(session, v, fixture, OVERFLOW.seek, OVERFLOW.id);
            const r = rel(await stablePlate(v, OVERFLOW.id), fr);
            const hold = out.overflow?.hold;
            m['はみ出し'] = { reloaded: r, hold, diff: hold ? { left: round(r.left - hold.left), top: round(r.top - hold.top), w: round(r.w - hold.w), lines: r.lines - hold.lines } : null };
            assert(m['はみ出し'].diff && Math.abs(m['はみ出し'].diff.left) <= 1 && Math.abs(m['はみ出し'].diff.top) <= 1, `overflow: ${S(m['はみ出し'].diff)}`);
            await seekTo(session, v, fixture, 1, 'c-0001');
            m['c-0001'] = { reloaded: rel(await stablePlate(v, 'c-0001'), fr), beforeReload: out.renderedBeforeReload?.['c-0001'] };
            return m;
        });
        await seekTo(session, v, fixture, OVERFLOW.seek, OVERFLOW.id);
        await shot(session, off, '06-reload-overflow');
        v.cdp.close();
    } finally { await stop(session); }
    out.status = STRICT ? (out.checks.every(c => c.pass) ? 'pass' : 'fail') : 'recorded';
} catch (error) {
    out.status = 'fail'; out.error = sanitize(error, REPO);
} finally { await saveJson(RESULTS, out); }
console.log(out.status);
