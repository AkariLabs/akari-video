#!/usr/bin/env node
// caption-plate-drag-clamp L1 プローブ（検証スクリプト・ラッパー作成）。
// 形は evidence/chip-reachability（launch-shell.sh / cdp-lib.mjs の写し）を踏襲し、
// 本番ビルドの Electron + 生 CDP で観測する（テストフレームワークは使わない）。
// ドラッグ・クリックは CDP Input.dispatchMouseEvent の page 座標で、webview（OOPIF）を跨いで届かせる。
// Usage: node run-l1.mjs <cdp-port> <projectRoot> <outDir> [label]
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, listTargets, screenshot, sleep, waitFor, realDragMod, realClick } from '../../caption-plate-drag-clamp/scripts/cdp-lib.mjs';

const [, , portArg, projectArg, outDir, label = 'after'] = process.argv;
const port = Number(portArg || 9437);
const projectRoot = await realpath(projectArg);
if (!projectRoot || !outDir) throw new Error('usage: run-l1.mjs <port> <projectRoot> <outDir> [label]');
const editPath = path.join(projectRoot, 'edit.json');
const captionsPath = path.join(projectRoot, 'captions.json');
await mkdir(outDir, { recursive: true });

const VIEW_W = 1600, VIEW_H = 1100;
const CUE2_TIME = 3.0;

const results = { status: 'running', label, startedAt: new Date().toISOString(), steps: [], checks: [], failures: [], notes: [] };
const note = text => { results.notes.push(text); console.log(`[note] ${text}`); };
const record = (step, data = {}) => { results.steps.push({ step, ...data }); console.log(`[${step}]`, JSON.stringify(data).slice(0, 700)); };
const check = (ok, message, detail = {}) => {
    results.checks.push({ ok, message, ...detail });
    if (!ok) results.failures.push({ message, ...detail });
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${message}`);
    return ok;
};
const save = async () => writeFile(path.join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
const readCaptions = async () => JSON.parse(await readFile(captionsPath, 'utf8'));
const readCaptionsText = () => readFile(captionsPath, 'utf8');
const node2 = value => JSON.stringify(value, undefined, 2);
const waitCaptionsChange = async before => waitFor('captions.json change', async () => {
    const now = await readCaptionsText();
    return now === before ? null : now;
}, 25_000, 200);

// ---------- connect ----------
const targets = await waitFor('CDP page', async () => { const targets = await listTargets(port); return targets.some(t => t.type === 'page') ? targets : null; },180_000);
const mainTarget = targets.find(t => t.type === 'page' && /localhost/u.test(t.url)) ?? targets.find(t => t.type === 'page');
if (!mainTarget) throw new Error('main page target not found');
const main = new CDP(mainTarget.webSocketDebuggerUrl);
await main.connect();
await main.send('Page.enable'); await main.send('Runtime.enable');
await main.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
await main.send('Page.bringToFront');
await waitFor('frontend ready', () => evalOn(main, `document.readyState === 'complete' && Boolean(window.theia?.container)`), 180_000);
await evalOn(main, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
await sleep(1200);

const commandRegistryExpr = `(() => {
  const bindings=window.theia.container._bindingDictionary;
  const keys=[...bindings._map.keys()];
  return keys.find(k=>typeof k==='function' && typeof k.prototype?.executeCommand==='function' && typeof k.prototype?.registerCommand==='function');
})()`;
const runCommand = (id, argExpr) => evalOn(main, `(async () => {
  const C=${commandRegistryExpr};
  if(!C) return 'no-command-registry';
  return await window.theia.container.get(C).executeCommand(${JSON.stringify(id)}, ${argExpr});
})()`);
const seekCommand = time => runCommand('akari.preview.seekOutput',
    `{ editUri: ${JSON.stringify('file://' + editPath)}, time: ${time} }`);

let view; let ctxId; let vEval;
async function attachWebview() {
    const webviewTarget = await waitFor('webview target', async () => {
        const list = await listTargets(port);
        return list.find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url)) || null;
    }, 120_000);
    view = new CDP(webviewTarget.webSocketDebuggerUrl);
    await view.connect();
    const contexts = [];
    view.on('Runtime.executionContextCreated', p => contexts.push(p.context));
    await view.send('Runtime.enable');
    ctxId = undefined;
    await waitFor('preview stage in webview', async () => {
        for (const id of [undefined, ...contexts.map(c => c.id)]) {
            try { if (await evalOn(view, `Boolean(document.getElementById('preview-stage'))`, id)) { ctxId = id; return true; } } catch { /* other context */ }
        }
        return false;
    }, 150_000);
    vEval = expr => evalOn(view, expr, ctxId);
    await waitFor('caption model loaded', () => vEval(`Boolean(window.akari && window.akari.computeOutputFrameRect) && Boolean(document.getElementById('caption-plate'))`), 120_000);
    await vEval(`(() => { const t=document.getElementById('play-toggle'); const v=document.getElementById('preview-video'); if (v && !v.paused) t?.click(); if (window.__cpdcPlayStop) return true; window.__cpdcPlayStop = true; return true; })()`);
}

// 左右のサイドパネルを畳んでプレビューを広げる。フレームの外側に余白が無いと
// 「クランプ解除でフレーム外へ出す」操作も選択枠のコントロールも webview の外に出てしまう。
async function collapseSidePanels() {
    const collapsed = await evalOn(main, `(() => {
      const bindings=window.theia.container._bindingDictionary;
      const keys=[...bindings._map.keys()];
      const shellKey=keys.find(k=>typeof k==='function' && typeof k.prototype?.collapsePanel==='function' && typeof k.prototype?.revealWidget==='function');
      if (!shellKey) return 'no-shell';
      const shell=window.theia.container.get(shellKey);
      const done=[];
      for (const area of ['left','right','bottom']) { try { shell.collapsePanel(area); done.push(area); } catch (e) { done.push(area + ':' + String(e).slice(0,40)); } }
      return done.join(',');
    })()`);
    await sleep(1500);
    record('collapse-side-panels', { collapsed });
}

await waitFor('seek handler ready', async () => { await seekCommand(CUE2_TIME); return true; }, 180_000, 1500);
await attachWebview();
await collapseSidePanels();


await seekCommand(3);
await sleep(5000);
const state = await vEval(`(() => ({
 frameEngine: document.getElementById('preview-stage').dataset.frameEngineActive,
 ready: document.querySelector('[data-frame-engine-ready]')?.dataset.frameEngineReady,
 plates: [...document.querySelectorAll('#caption-plate, .caption-row-plate')].map(p => { const c=p.cloneNode(true); c.querySelectorAll('style').forEach(s=>s.remove()); return {id:p.id,text:c.textContent.trim()}; })
}))()`);
record('overlap-at-3s', state);
await screenshot(main,path.join(outDir,label+'-preview.png'));
if (label.startsWith('after')) {
    const before = await readCaptions();
    const frame = await evalOn(main, `(() => {const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).find(r=>r.width>200&&r.height>200);return {left:r.left,top:r.top,width:r.width,height:r.height};})()`);
    await vEval(`window.addEventListener('pointermove',e=>window.__cofPointer={x:e.clientX,y:e.clientY},true)`);
    const probe={x:frame.left+frame.width/2,y:frame.top+frame.height/2};
    await main.send('Input.dispatchMouseEvent',{type:'mouseMoved',...probe,button:'none'});
    const local=await waitFor('pointer coordinates',()=>vEval(`window.__cofPointer`),15000);
    const offset={x:probe.x-local.x,y:probe.y-local.y};
    const center=async key=>vEval(`(() => {const p=[...document.querySelectorAll('.caption-row-plate')].find(p=>p.dataset.captionKey.startsWith(${JSON.stringify(key)}));const r=p.querySelector('.akari-caption__line').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    const top=await center('c-0004');
    const start={x:top.x+offset.x,y:top.y+offset.y};
    await realDragMod(main,[start,{x:start.x+95,y:start.y+65}],{stepDelayMs:60});
    await waitFor('placed position saved',async()=>{const now=await readCaptions();return now.captions.find(c=>c.id==='c-0004').text_style.position;},30000);
    const dragged=await readCaptions();
    check(JSON.stringify(before.captions.slice(0,3))===JSON.stringify(dragged.captions.slice(0,3)), 'drag changes only placed row');
    record('placed-position',dragged.captions.find(c=>c.id==='c-0004').text_style);
    await sleep(1500);
    await screenshot(main,path.join(outDir,label+'-drag.png'));
    await waitFor('inline editor',async()=>{
        if(await vEval(`Boolean(document.querySelector('[contenteditable="true"]'))`)) return true;
        const bottom=await center('c-0002');
        const currentFrame=await evalOn(main,`(() => {const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).find(r=>r.width>200&&r.height>200);return {left:r.left,top:r.top};})()`);
        await realClick(main,bottom.x+currentFrame.left,bottom.y+currentFrame.top,{clickCount:2});
        return false;
    },30000,1500);
    await vEval(`(() => {const el=document.querySelector('[contenteditable="true"]');const r=document.createRange();r.selectNodeContents(el);const s=window.getSelection();s.removeAllRanges();s.addRange(r);})()`);
    await main.send('Input.insertText',{text:'二行目の字幕を編集'});
    await main.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await main.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await waitFor('inline text saved',async()=>{const now=await readCaptions();return now.captions[1].text==='二行目の字幕を編集';},30000);
    const edited=await readCaptions();
    check(JSON.stringify(edited.captions[3])===JSON.stringify(dragged.captions[3]),'lower text edit preserves placed row');
    record('lower-edited',{id:edited.captions[1].id,text:edited.captions[1].text});
    await sleep(1500);
    await screenshot(main,path.join(outDir,label+'-edit.png'));
    await writeFile(path.join(outDir,'captions-after-interactions.json'),JSON.stringify(edited,null,2)+'\n');
}
results.status=results.failures.length?'failed':'observed';
await save();
view.close(); main.close();
