#!/usr/bin/env node
// hit-region-pointer-events shell L1 探針（ラッパー作成の検証スクリプト）。
// #36 の run-l1.mjs / cdp-lib.mjs と同じ流儀。素通し(b) と 選択往復(c) を実測する。
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { CDP, evalOn, listTargets, sleep, waitFor } from './cdp-lib.mjs';

const run = promisify(execFile);
const [, , portArg, workspaceDir, outDir, label] = process.argv;
const port = Number(portArg || 9645);
if (!workspaceDir || !outDir || !label) throw new Error('usage: run-shell-l1.mjs <port> <workspaceDir> <outDir> <label>');
const editPath = path.join(workspaceDir, 'project/edit.json');
await mkdir(outDir, { recursive: true });
const VIEW_W = 1600, VIEW_H = 1200;
const log = [];
const record = (step, data = {}) => { log.push({ step, ...data }); console.log(`[${step}]`, JSON.stringify(data).slice(0, 700)); };

const targets = await listTargets(port);
const mainTarget = targets.find(t => t.type === 'page' && /localhost/u.test(t.url)) ?? targets.find(t => t.type === 'page');
if (!mainTarget) throw new Error('main page target not found');
const main = new CDP(mainTarget.webSocketDebuggerUrl);
await main.connect();
await main.send('Page.enable'); await main.send('Runtime.enable');
await main.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
await main.send('Page.bringToFront');
await waitFor('frontend ready', () => evalOn(main, `document.readyState === 'complete'`));
await evalOn(main, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
await sleep(1000);
const openResult = await evalOn(main, `(async () => {
  const bindings=window.theia.container._bindingDictionary;
  const keys=[...bindings._map.keys()];
  const C=keys.find(k=>typeof k==='function' && typeof k.prototype?.executeCommand==='function' && typeof k.prototype?.registerCommand==='function');
  if(!C) return 'no-command-registry';
  return await window.theia.container.get(C).executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify('file://' + editPath)} });
})()`);
record('open-preview', { result: openResult });

const webviewTarget = await waitFor('webview target', async () => {
  const list = await listTargets(port);
  return list.find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url)) || null;
}, 60000);
const view = new CDP(webviewTarget.webSocketDebuggerUrl);
await view.connect();
const contexts = [];
view.on('Runtime.executionContextCreated', p => contexts.push(p.context));
await view.send('Page.enable'); await view.send('Runtime.enable');
let ctxId;
await waitFor('preview stage in webview', async () => {
  for (const id of [undefined, ...contexts.map(c => c.id)]) {
    try { if (await evalOn(view, `Boolean(document.getElementById('preview-stage'))`, id)) { ctxId = id; return true; } } catch {}
  }
  return false;
}, 90000);
const vEval = expr => evalOn(view, expr, ctxId);
await waitFor('overlay container mounted', () => vEval(`Boolean(document.querySelector('#overlay-stage [data-overlay-id]'))`), 90000);

await vEval(`(() => { const t=document.getElementById('play-toggle'); const v=document.getElementById('preview-video'); if(v && !v.paused) t?.click(); return true; })()`);
await sleep(300);
await vEval(`(() => { const s=document.getElementById('seek'); s.value='2'; s.dispatchEvent(new Event('input',{bubbles:true})); return s.value; })()`);
await sleep(1500);

const iframeRect = await evalOn(main, `(() => { const f=[...document.querySelectorAll('iframe')].find(e=>/webview\\/index\\.html/.test(e.src)); const r=f.getBoundingClientRect(); return {left:r.left, top:r.top, width:r.width, height:r.height}; })()`);
record('iframe-rect', iframeRect);

const describeState = `(() => {
  const c = document.querySelector('#overlay-stage [data-overlay-id]');
  const root = c?.firstElementChild ?? null;
  const title = c?.querySelector('.s-issue-36__title') ?? null;
  const sub = c?.querySelector('.s-issue-36__sub') ?? null;
  const pick = e => { if(!e) return null; const r=e.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
  const frames = [...document.querySelectorAll('.akari-interaction-selection-frame')].filter(e => !e.hasAttribute('hidden') && getComputedStyle(e).display !== 'none');
  return {
    clipPathInline: c ? (c.style.clipPath || '') : null,
    clipPathComputed: c ? getComputedStyle(c).clipPath : null,
    containerPointerEvents: c ? c.style.pointerEvents : null,
    rootPointerEvents: root ? root.style.pointerEvents : null,
    titlePointerEvents: title ? title.style.pointerEvents : null,
    subPointerEvents: sub ? sub.style.pointerEvents : null,
    selected: c ? c.getAttribute('data-akari-interaction-selected') : null,
    visibleSelectionFrames: frames.length,
    selectionFrameRect: frames[0] ? pick(frames[0]) : null,
    selectionFrameBorder: frames[0] ? getComputedStyle(frames[0]).border : null,
    rects: { container: pick(c), root: pick(root), title: pick(title), sub: pick(sub), stage: pick(document.getElementById('preview-stage')) }
  };
})()`;

const state0 = await vEval(describeState);
record('state-initial', { clipPathInline: state0.clipPathInline, clipPathComputed: state0.clipPathComputed,
  rootPointerEvents: state0.rootPointerEvents, titlePointerEvents: state0.titlePointerEvents, selected: state0.selected,
  visibleSelectionFrames: state0.visibleSelectionFrames, root: state0.rects.root });

const clickAt = async (x, y) => {
  const px = iframeRect.left + x, py = iframeRect.top + y;
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py, button: 'none' });
  await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 });
  await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 });
  await sleep(700);
};
const hitStack = async (x, y) => vEval(`(() => document.elementsFromPoint(${x}, ${y}).slice(0,5).map(e => (e.tagName + (e.id ? '#'+e.id : '') + (typeof e.className==='string' && e.className ? '.'+e.className.trim().split(/\\s+/).join('.') : '') + (e.hasAttribute && e.hasAttribute('data-overlay-id') ? '[data-overlay-id]' : ''))))()`);

// ---- (b) 素通し: 断片ルートが描いている「文字が無い」場所をクリックする ----
const r = state0.rects.root;
const blank = { x: r.left + r.width * 0.80, y: r.top + r.height * 0.85 };
const blankStack = await hitStack(blank.x, blank.y);
await clickAt(blank.x, blank.y);
const stateBlank = await vEval(describeState);
record('b-passthrough', { point: blank, hitStack: blankStack, selected: stateBlank.selected, visibleSelectionFrames: stateBlank.visibleSelectionFrames });

// ---- (c) 選択往復: 断片が描いている文字をクリック → Esc ----
const t = state0.rects.title;
const titlePoint = { x: (t.left + t.right) / 2, y: (t.top + t.bottom) / 2 };
const titleStack = await hitStack(titlePoint.x, titlePoint.y);
await clickAt(titlePoint.x, titlePoint.y);
const stateSelected = await vEval(describeState);
record('c-selected', { point: titlePoint, hitStack: titleStack, selected: stateSelected.selected,
  visibleSelectionFrames: stateSelected.visibleSelectionFrames, selectionFrameRect: stateSelected.selectionFrameRect,
  selectionFrameBorder: stateSelected.selectionFrameBorder });

await vEval(`(() => { document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return true; })()`);
await sleep(600);
const stateDeselected = await vEval(describeState);
record('c-deselected', { selected: stateDeselected.selected, visibleSelectionFrames: stateDeselected.visibleSelectionFrames });

// ---- 描画無傷: 断片ルート 2px 内側 8 点 + ステージ外 pasteboard ----
const shot = await main.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
const pngPath = path.join(outDir, `${label}-window.png`);
await writeFile(pngPath, Buffer.from(shot.data, 'base64'));
const rawPath = path.join(outDir, `${label}-window.rgb`);
await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', pngPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', rawPath]);
const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', pngPath]);
const [shotW, shotH] = probe.stdout.trim().split(',').map(Number);
const raw = await readFile(rawPath);
const px = (x, y) => { const xi = Math.round(x), yi = Math.round(y); if (xi < 0 || yi < 0 || xi >= shotW || yi >= shotH) return null; const o = (yi * shotW + xi) * 3; return [raw[o], raw[o+1], raw[o+2]]; };
const toWin = (x, y) => [iframeRect.left + x, iframeRect.top + y];
const delta = (a, b) => (a && b) ? Math.max(Math.abs(a[0]-b[0]), Math.abs(a[1]-b[1]), Math.abs(a[2]-b[2])) : null;
const anchors = [
  ['top-mid', (r.left+r.right)/2, r.top+2, (r.left+r.right)/2, r.top+8],
  ['bottom-mid', (r.left+r.right)/2, r.bottom-2, (r.left+r.right)/2, r.bottom-8],
  ['left-mid', r.left+2, (r.top+r.bottom)/2, r.left+8, (r.top+r.bottom)/2],
  ['right-mid', r.right-2, (r.top+r.bottom)/2, r.right-8, (r.top+r.bottom)/2],
  ['tl', r.left+2, r.top+2, r.left+8, r.top+8],
  ['tr', r.right-2, r.top+2, r.right-8, r.top+8],
  ['bl', r.left+2, r.bottom-2, r.left+8, r.bottom-8],
  ['br', r.right-2, r.bottom-2, r.right-8, r.bottom-8]
];
const inside = anchors.map(([id, x, y, rx, ry]) => { const rgb = px(...toWin(x, y)); const ref = px(...toWin(rx, ry)); return { id, rgb, ref, delta: delta(rgb, ref) }; });
const st = state0.rects.stage;
const outside = {
  top: px(...toWin((st.left+st.right)/2, st.top-2)), bottom: px(...toWin((st.left+st.right)/2, st.bottom+2)),
  left: px(...toWin(st.left-2, (st.top+st.bottom)/2)), right: px(...toWin(st.right+2, (st.top+st.bottom)/2))
};
record('pixels', { insideMaxDelta: Math.max(...inside.map(p => p.delta ?? 0)), inside, stageOutside2px: outside });

const verdict = {
  clipPathInline: state0.clipPathInline,
  clipPathComputed: state0.clipPathComputed,
  passthroughOk: stateBlank.selected !== 'true' && stateBlank.visibleSelectionFrames === 0
    && !blankStack.some(s => s.includes('[data-overlay-id]') || s.includes('s-issue-36')),
  selectRoundtripOk: state0.selected !== 'true' && stateSelected.selected === 'true'
    && stateSelected.visibleSelectionFrames === 1 && stateDeselected.selected !== 'true'
    && stateDeselected.visibleSelectionFrames === 0,
  insideMaxDelta: Math.max(...inside.map(p => p.delta ?? 0))
};
record('verdict', verdict);
await writeFile(path.join(outDir, `${label}-shell.json`),
  JSON.stringify({ label, verdict, state0, stateBlank, stateSelected, stateDeselected,
    points: { blank, blankStack, titlePoint, titleStack }, pixels: { inside, stageOutside2px: outside },
    viewport: { width: VIEW_W, height: VIEW_H, screenshot: [shotW, shotH] }, log }, null, 2) + '\n');
main.close(); view.close();
process.exit(verdict.passthroughOk && verdict.selectRoundtripOk ? 0 : 2);
