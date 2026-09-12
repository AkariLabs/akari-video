#!/usr/bin/env node
// L1（CDP・5 手順）— task 2026-09-12-preview-caption-handles（検証スクリプト・ラッパー作成）
//   1. 行を選ぶ → プレートに data-selected とハンドル 5 個（非選択時は 0 個）
//   2. 右下（se）の丸をドラッグ → text_style.scale ≒ 1.35・position / rotate は不変
//   3. 上の丸（rot）をドラッグ → text_style.rotate ≒ -12・scale は不変
//   4. 2 行選択で 1 ドラッグ → 2 cue に同じ scale・captionWrite は 1 回（1 commit）
//   5. display_policy（lines 2 / wrap fold）を足す → プレビューが 2 行で描かれる
// Electron は detached にせず、隔離 HOME / user-data-dir を runs/ 配下へ向け、自分が起動した PID だけを kill する。
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL_DIR = path.join(REPO, 'apps', 'shell');
// apps/shell 側の Electron（postbuild の resign-electron が署名を直した実体）を優先する。
const ELECTRON = [
  path.join(SHELL_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
].find(candidate => existsSync(candidate)) ?? path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.join(ROOT, 'fixture', 'project');
const RUNS = path.join(ROOT, 'runs');
const PROJECT = path.join(RUNS, 'ws');
const EDIT = path.join(PROJECT, 'edit.json');
const CAPTIONS = path.join(PROJECT, 'captions.json');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22411);
const ISO = path.join(RUNS, 'l1');
const LOG = path.join(RUNS, 'l1.log');
const VIEW_W = 1600, VIEW_H = 1100;
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [], cleanup: null };

const sanitizeText = value => {
  let text = String(value);
  text = text.replaceAll(REPO, '<WORKTREE>');
  if (process.env.HOME) text = text.replaceAll(process.env.HOME, '<HOME>');
  return text
    .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"\]]+/gu, '<TMP>')
    .replace(/\/Users\/[^\s)'"\]]+/gu, '<HOME>');
};
const sanitize = value => sanitizeText(value?.stack || value?.message || value);
const save = async () => {
  const temporary = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temporary, `${sanitizeText(JSON.stringify(out, null, 2))}\n`);
  await rename(temporary, RESULTS);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const close = (actual, expected, tolerance) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
const run = (command, args, { cwd = ROOT, timeoutMs = 240_000 } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', closed = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, timeoutMs);
  child.once('error', reject);
  child.once('close', code => {
    closed = true; clearTimeout(timer);
    code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`));
  });
});

async function step(name, operation) {
  const record = { name, pass: false };
  out.steps.push(record);
  try {
    record.detail = await operation();
    record.pass = true;
    await save();
    return record.detail;
  } catch (error) {
    record.error = sanitize(error);
    await save();
    throw error;
  }
}

async function waitEval(cdp, expression, { timeoutMs = 60_000, label = 'condition', contextId } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await evalOn(cdp, expression, contextId); if (value) return value; }
    catch (error) { last = error; }
    await sleep(180);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}

async function settlePreloadOverlay(cdp) {
  const deadline = Date.now() + 120_000;
  let hiddenSince = null;
  while (Date.now() < deadline) {
    const state = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');return{exists:Boolean(el),hidden:Boolean(el?.classList.contains('theia-hidden'))}})()`);
    if (!state.exists) return 'removed';
    if (state.hidden) {
      hiddenSince ??= Date.now();
      if (Date.now() - hiddenSince >= 12_000) {
        const neutralized = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');if(!el||!el.classList.contains('theia-hidden'))return false;el.style.pointerEvents='none';return true})()`);
        if (neutralized) return 'neutralized';
      }
    } else hiddenSince = null;
    await sleep(200);
  }
  throw new Error('theia preload overlay did not settle');
}

const commandWith = (id, request) => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)},${S(request)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;

const EDIT_URI = () => pathToFileURL(EDIT).toString();

// 台本 widget が実際に投げる CustomEvent と同じもの（akari-preview-open-handler の受け口）。
const selectCaptions = (cdp, captionIds) => evalOn(cdp,
  `(()=>{window.dispatchEvent(new CustomEvent('akari.daihon.selectionChanged',{detail:{editUri:${S(EDIT_URI())},captionIds:${S(captionIds)}}}));return true})()`);

async function collapseSidePanels(cdp) {
  const collapsed = await evalOn(cdp, `(()=>{const d=window.theia.container._bindingDictionary;const keys=[...d._map.keys()];const k=keys.find(x=>typeof x==='function'&&typeof x.prototype?.collapsePanel==='function'&&typeof x.prototype?.revealWidget==='function');if(!k)return 'no-shell';const shell=window.theia.container.get(k);const done=[];for(const area of ['left','right','bottom']){try{shell.collapsePanel(area);done.push(area)}catch(e){done.push(area+':'+String(e).slice(0,40))}}return done.join(',')})()`);
  await sleep(1200);
  return collapsed;
}

// ---- webview（OOPIF）への接続 ----
let view, ctxId;
const vEval = expression => evalOn(view, expression, ctxId);
async function attachWebview() {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const targets = (await listTargets(PORT).catch(() => [])).filter(item =>
      item.type === 'iframe' && /webview\/index\.html/u.test(String(item.url)) && item.webSocketDebuggerUrl);
    for (const target of targets) {
      const cdp = new CDP(target.webSocketDebuggerUrl);
      const contexts = [];
      cdp.on('Runtime.executionContextCreated', params => contexts.push(params.context));
      try {
        await cdp.connect();
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await sleep(700);
        cdp.on('Runtime.consoleAPICalled', params => {
          out.webviewConsole = [...(out.webviewConsole ?? []).slice(-40), sanitizeText(
            `${params.type}: ${(params.args ?? []).map(arg => arg.value ?? arg.description ?? arg.type).join(' ')}`)];
        });
        for (const id of [undefined, ...contexts.map(context => context.id)]) {
          const ready = await evalOn(cdp, `Boolean(document.getElementById('caption-plate'))&&Boolean(window.akari&&window.akari.computeOutputFrameRect)`, id).catch(() => false);
          if (ready) { view = cdp; ctxId = id; return true; }
        }
        cdp.close();
      } catch { cdp.close(); }
    }
    await sleep(500);
  }
  throw new Error('preview webview not reachable');
}

// ---- page ⇄ webview の client 座標キャリブレーション ----
let offset = { x: 0, y: 0 }, iframeRect = { left: 0, top: 0, width: VIEW_W, height: VIEW_H };
async function calibrate(cdp) {
  await vEval(`(()=>{window.__cphCal=null;if(!window.__cphCalBound){window.__cphCalBound=true;window.addEventListener('pointermove',e=>{window.__cphCal={x:e.clientX,y:e.clientY}},true)}return true})()`);
  const frame = await evalOn(cdp, `(()=>{const list=[...document.querySelectorAll('iframe')].map(f=>{const r=f.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height}}).filter(r=>r.width>200&&r.height>200);list.sort((a,b)=>b.width*b.height-a.width*a.height);return list[0]||null})()`);
  assert(frame, 'webview iframe rect not found in main page');
  const probe = { x: Math.round(frame.left + frame.width / 2), y: Math.round(frame.top + frame.height / 2) };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: probe.x, y: probe.y, button: 'none' });
  const deadline = Date.now() + 10_000;
  let seen = null;
  while (Date.now() < deadline && !seen) {
    seen = await vEval(`window.__cphCal`).catch(() => null);
    if (!seen) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: probe.x, y: probe.y, button: 'none' }); await sleep(200); }
  }
  assert(seen, 'pointer calibration failed');
  offset = { x: probe.x - seen.x, y: probe.y - seen.y };
  iframeRect = frame;
  return { iframe: frame, probe, webviewClient: seen, offset };
}
const toPage = (clientX, clientY) => ({ x: clientX + offset.x, y: clientY + offset.y });
const clampToIframe = point => ({
  x: Math.min(iframeRect.left + iframeRect.width - 6, Math.max(iframeRect.left + 6, point.x)),
  y: Math.min(iframeRect.top + iframeRect.height - 6, Math.max(iframeRect.top + 6, point.y))
});

// page 座標 → webview client 座標のズレはレイアウト変化で動く。狙った client 点に
// 実際のマウスが載るまで offset を実測で詰め、届いていること自体も確かめる。
async function alignPointer(main, desired) {
  let last = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await vEval(`(()=>{window.__cphCal=null;return true})()`).catch(() => {});
    const page = clampToIframe(toPage(desired.x, desired.y));
    await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: page.x, y: page.y, button: 'none' });
    const deadline = Date.now() + 2000;
    let seen = null;
    while (Date.now() < deadline && !seen) {
      seen = await vEval(`window.__cphCal`).catch(() => null);
      if (!seen) await sleep(120);
    }
    if (!seen) { last = null; continue; }
    last = seen;
    const dx = desired.x - seen.x, dy = desired.y - seen.y;
    if (Math.abs(dx) < 0.75 && Math.abs(dy) < 0.75) return page;
    offset = { x: offset.x + dx, y: offset.y + dy };
  }
  // 中心へ 1 発打って「そもそも webview に届くか」を切り分ける。
  await vEval(`(()=>{window.__cphCal=null;return true})()`).catch(() => {});
  const center = { x: Math.round(iframeRect.left + iframeRect.width / 2), y: Math.round(iframeRect.top + iframeRect.height / 2) };
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y, button: 'none' });
  await sleep(700);
  const centerSeen = await vEval(`window.__cphCal`).catch(() => null);
  const page = clampToIframe(toPage(desired.x, desired.y));
  const diag = await evalOn(main, `(()=>{const el=document.elementFromPoint(${page.x}, ${page.y});const path=[];let n=el;while(n&&path.length<5){path.push((n.tagName||'')+'.'+(typeof n.className==='string'?n.className:'')+(n.id?('#'+n.id):''));n=n.parentElement}
const frames=[...document.querySelectorAll('iframe')].map(f=>{const r=f.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height}});
return{hit:path.join(' < '),frames,inner:{w:window.innerWidth,h:window.innerHeight}}})()`).catch(() => null);
  throw new Error(`マウスが webview の狙った点に載らない（desired=${JSON.stringify(desired)} seen=${JSON.stringify(last)} offset=${JSON.stringify(offset)} page=${JSON.stringify(page)} diag=${JSON.stringify(diag)} centerProbe=${JSON.stringify({ center, centerSeen })}）`);
}

// ---- webview 観測 ----
const PLATE_PROBE = `(()=>{const plate=document.getElementById('caption-plate');if(!plate)return null;
const inner=plate.querySelector('.akari-caption__plate');const outlineTarget=inner??plate;const s=getComputedStyle(outlineTarget);
const handles=[...plate.querySelectorAll('.akari-caption-handle')];
const lines=[...plate.querySelectorAll('.akari-caption__line')];
const rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2}};
const host=handles[0]?handles[0].parentElement:outlineTarget;
return{selected:plate.hasAttribute('data-selected'),altAll:plate.hasAttribute('data-alt-all'),
text:(lines.length>0?lines.map(l=>l.textContent||'').join(''):(plate.textContent||'')).replace(/\\s+/g,' ').trim().slice(0,60),
styled:plate.classList.contains('akari-caption-host--styled'),
outlineStyle:s.outlineStyle,outlineColor:s.outlineColor,
handleCount:handles.length,handleKinds:handles.map(h=>h.dataset.h),
handles:Object.fromEntries(handles.map(h=>[h.dataset.h,rect(h)])),
handleStyles:Object.fromEntries(handles.map(h=>{const cs=getComputedStyle(h);return[h.dataset.h,{background:cs.backgroundColor,borderColor:cs.borderTopColor,borderRadius:cs.borderRadius,width:cs.width,height:cs.height}]})),
host:rect(host),hostTransform:getComputedStyle(host).transform,hostOrigin:getComputedStyle(host).transformOrigin,
cssScale:plate.style.getPropertyValue('--caption-scale'),cssRotate:plate.style.getPropertyValue('--caption-rotate'),
lineCount:lines.length,lineTexts:lines.map(l=>(l.textContent||'').trim()),
selectBoxActive:Boolean(document.getElementById('caption-select-box')?.classList.contains('is-active'))}})()`;

const probe = () => vEval(PLATE_PROBE);


const readCaptions = async () => JSON.parse(await readFile(CAPTIONS, 'utf8'));
const cueStyle = (root, id) => root.captions.find(caption => caption.id === id)?.text_style ?? null;
async function waitCaptionsWhere(predicate, { label = 'captions.json change', timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { last = await readCaptions(); if (predicate(last)) return last; } catch { /* mid-write */ }
    await sleep(200);
  }
  throw new Error(`${label} not reached: ${JSON.stringify(last?.captions?.map(c => ({ id: c.id, text_style: c.text_style })))}`);
}

// captionWrite の呼び出し回数（= commit 回数）を webview 側で数える。
const installWriteCounter = () => vEval(`(()=>{if(window.__cphWrites)return true;window.__cphWrites=[];const engine=window.akari.engine;const original=engine.captionWrite.bind(engine);engine.captionWrite=(id,patch)=>{window.__cphWrites.push({id,patch:JSON.parse(JSON.stringify(patch))});return original(id,patch)};return true})()`);
const resetWriteCounter = () => vEval(`(()=>{window.__cphWrites=[];return true})()`);
const readWrites = () => vEval(`window.__cphWrites??[]`);

const diagOf = drag => JSON.stringify({
  midCssScale: drag.mid?.cssScale, midCssRotate: drag.mid?.cssRotate,
  afterCssScale: drag.after?.cssScale, afterCssRotate: drag.after?.cssRotate,
  writes: drag.writes, hitAtStart: drag.hitAtStart, hitDetail: drag.hitDetail, events: (drag.events ?? []).slice(0, 10),
  startPage: drag.startPage, endPage: drag.endPage, center: drag.center, start: drag.start, target: drag.target,
  effectiveFactor: drag.effectiveFactor, effectiveAngle: drag.effectiveAngle
});

// 端点が webview の矩形から出るとドラッグが確定しない。中心からの方向 u を保ったまま、
// 矩形の内側（余白 14px）に収まる最大の距離まで reach を詰める。
function clampReach(center, ux, uy, reach) {
  const limit = { left: iframeRect.left + 14, right: iframeRect.left + iframeRect.width - 14,
    top: iframeRect.top + 14, bottom: iframeRect.top + iframeRect.height - 14 };
  const centerPage = toPage(center.x, center.y);
  let allowed = reach;
  if (ux > 0) allowed = Math.min(allowed, (limit.right - centerPage.x) / ux);
  if (ux < 0) allowed = Math.min(allowed, (limit.left - centerPage.x) / ux);
  if (uy > 0) allowed = Math.min(allowed, (limit.bottom - centerPage.y) / uy);
  if (uy < 0) allowed = Math.min(allowed, (limit.top - centerPage.y) / uy);
  return Math.max(0, Math.min(reach, allowed));
}

async function dragHandle(main, kind, targetOf, { steps = 14 } = {}) {
  const before = await probe();
  assert(before && before.handleCount === 5, `ハンドルが 5 個ない: ${JSON.stringify(before?.handleKinds)}`);
  const handle = before.handles[kind];
  assert(handle, `ハンドル ${kind} が無い`);
  const center = { x: before.host.cx, y: before.host.cy };
  const start = { x: handle.cx, y: handle.cy };
  const target = targetOf(center, start);
  const hitDetail = await vEval(`(()=>{const plate=document.getElementById('caption-plate');const h=plate.querySelector('.akari-caption-handle[data-h=${'"'}${kind}${'"'}]');if(!h)return{missing:true};const r=h.getBoundingClientRect();const cs=getComputedStyle(h);const box=h.parentElement;const bs=getComputedStyle(box);const ps=getComputedStyle(plate);
const stack=document.elementsFromPoint(r.left+r.width/2, r.top+r.height/2).slice(0,8).map(e=>(e.tagName||'')+(e.id?('#'+e.id):'')+'.'+(typeof e.className==='string'?e.className:'')+'|pe='+getComputedStyle(e).pointerEvents);const at=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
const path=[];let n=at;while(n&&path.length<5){path.push((n.tagName||'')+(n.id?('#'+n.id):'')+'.'+(typeof n.className==='string'?n.className:''));n=n.parentElement}
const br=box.getBoundingClientRect();const stage=document.getElementById('preview-stage');const sr=stage.getBoundingClientRect();return{rect:{left:r.left,top:r.top,w:r.width,h:r.height},pe:cs.pointerEvents,boxPe:bs.pointerEvents,platePe:ps.pointerEvents,stagePe:getComputedStyle(stage).pointerEvents,stageRect:{left:sr.left,top:sr.top,w:sr.width,h:sr.height},boxRect:{left:br.left,top:br.top,w:br.width,h:br.height},plateDisplay:ps.display,stack,hit:path.join(' < ')}})()`).catch(() => null);
  const hitAtStart = await vEval(`(()=>{const el=document.elementFromPoint(${start.x}, ${start.y});if(!el)return null;const path=[];let n=el;while(n&&path.length<4){path.push((n.tagName||'')+'.'+(n.className||'')+(n.dataset&&n.dataset.h?('[data-h='+n.dataset.h+']'):''));n=n.parentElement}return path.join(' < ')})()`).catch(() => null);
  await vEval(`(()=>{window.__cphEvents=[];if(!window.__cphEventsBound){window.__cphEventsBound=true;for(const type of ['pointerdown','pointermove','pointerup']){window.addEventListener(type,e=>{if(window.__cphEvents&&window.__cphEvents.length<60)window.__cphEvents.push(type+'@'+Math.round(e.clientX)+','+Math.round(e.clientY)+':'+((e.target&&(e.target.className||e.target.tagName))||'?'))},true)}}return true})()`).catch(() => {});
  const startPage = await alignPointer(main, start);
  const endPage = clampToIframe(toPage(target.x, target.y));
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startPage.x, y: startPage.y, button: 'none' });
  await sleep(90);
  await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPage.x, y: startPage.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(90);
  for (let index = 1; index <= steps; index += 1) {
    await main.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', button: 'left', buttons: 1,
      x: startPage.x + (endPage.x - startPage.x) * index / steps,
      y: startPage.y + (endPage.y - startPage.y) * index / steps
    });
    await sleep(25);
  }
  const mid = await probe();
  await sleep(80);
  await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: endPage.x, y: endPage.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(700);
  const after = await probe().catch(() => null);
  const writes = await readWrites().catch(() => null);
  const events = await vEval('window.__cphEvents??[]').catch(() => null);
  const endClient = { x: endPage.x - offset.x, y: endPage.y - offset.y };
  const radius = Math.hypot(start.x - center.x, start.y - center.y) || 1;
  const effectiveFactor = Math.hypot(endClient.x - center.x, endClient.y - center.y) / radius;
  const effectiveAngle = (Math.atan2(endClient.y - center.y, endClient.x - center.x)
    - Math.atan2(start.y - center.y, start.x - center.x)) * 180 / Math.PI;
  return { before, mid, after, writes, events, hitAtStart, hitDetail, center, start, target, startPage, endPage, endClient, effectiveFactor, effectiveAngle };
}

// pointerup が OOPIF に入らないことがある。書き込みが来なければ webview 内で終端だけ補完する。
async function ensureUp(drag) {
  const local = { x: drag.endPage.x - offset.x, y: drag.endPage.y - offset.y };
  await vEval(`(()=>{for(const id of [1,0,2,3]){window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:id,isPrimary:true,button:0,buttons:0,clientX:${local.x},clientY:${local.y}}))}return true})()`).catch(() => {});
}

async function shot(cdp, number, label) {
  const name = `${String(number).padStart(2, '0')}-${label}.png`;
  await screenshot(cdp, path.join(ROOT, name));
  out.screenshots.push(name);
  await save();
}

let spawnedChild;
async function launch() {
  await rm(ISO, { recursive: true, force: true });
  await rm(PROJECT, { recursive: true, force: true });
  await mkdir(RUNS, { recursive: true });
  await cp(FIXTURE, PROJECT, { recursive: true });
  await mkdir(ISO, { recursive: true });
  const akariHome = path.join(ISO, 'akari-home');
  await mkdir(akariHome, { recursive: true });
  await writeFile(LOG, '');
  const child = spawn(ELECTRON, [
    SHELL_DIR, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${ISO}`, '--no-sandbox',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'
  ], {
    cwd: REPO,
    env: { ...process.env, AKARI_HOME: akariHome, THEIA_CONFIG_DIR: ISO },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  spawnedChild = child;
  const append = chunk => void writeFile(LOG, sanitizeText(chunk), { flag: 'a' }).catch(() => {});
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  let target;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && !target) {
    try { target = (await listTargets(PORT)).find(item => item.type === 'page'); } catch { /* not up yet */ }
    if (!target) await sleep(300);
  }
  assert(target, 'CDP page target did not appear');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // 実ウィンドウを広げる。setDeviceMetricsOverride だけだと OOPIF（webview）への
  // マウス配送が実ウィンドウの矩形で判定され、エミュレート座標とズレて届かない。
  try {
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', {
      windowId, bounds: { left: 0, top: 0, width: VIEW_W, height: VIEW_H, windowState: 'normal' }
    });
  } catch (error) { out.windowBoundsError = sanitize(error); }
  await cdp.send('Page.bringToFront');
  await sleep(800);
  out.viewport = await evalOn(cdp, `({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })`).catch(() => null);
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'Theia workbench', timeoutMs: 180_000 });
  return { child, cdp };
}

async function stop(session) {
  try { view?.close(); } catch { /* already closed */ }
  session?.cdp?.close();
  const pid = (session?.child ?? spawnedChild)?.pid;
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
    await sleep(2500);
    try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    await sleep(900);
  }
  const count = shellCommand => new Promise(resolve => {
    const child = spawn('/bin/sh', ['-c', shellCommand]);
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.once('close', () => resolve(Number(stdout.trim())));
  });
  const survivors = await count(`ps -eo pid,ppid,args | grep -F ${JSON.stringify(ISO)} | grep -v grep | wc -l`);
  const backendSurvivors = await count(`ps -eo pid,ppid,args | grep -F ${JSON.stringify(path.join(SHELL_DIR, 'lib/backend/main.js'))} | grep -v grep | wc -l`);
  try { await writeFile(LOG, sanitizeText(await readFile(LOG, 'utf8'))); } catch { /* no log */ }
  out.cleanup = { killedPid: pid ?? null, survivingProcesses: survivors, survivingBackendMain: backendSurvivors };
  await save();
  return survivors;
}

async function seekTo(cdp, time, expectedText) {
  const deadline = Date.now() + 120_000;
  let last;
  while (Date.now() < deadline) {
    await evalOn(cdp, commandWith('akari.preview.ensureVisible', { editUri: EDIT_URI() })).catch(() => {});
    await evalOn(cdp, commandWith('akari.preview.seekOutput', { editUri: EDIT_URI(), time })).catch(() => {});
    await sleep(600);
    if (!view) { try { await attachWebview(); } catch { /* retry */ } }
    last = await probe().catch(() => null);
    if (last && last.text.includes(expectedText)) return last;
  }
  throw new Error(`caption "${expectedText}" not shown at t=${time}: ${JSON.stringify(last)}`);
}

let session;
try {
  out.fixture = JSON.parse((await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')], { timeoutMs: 240_000 })).stdout.trim());
  await save();

  session = await launch();
  const { cdp } = session;
  out.preloadOverlay = await settlePreloadOverlay(cdp);
  out.collapsedPanels = await collapseSidePanels(cdp);
  await evalOn(cdp, commandWith('akari.preview.ensureVisible', { editUri: EDIT_URI() })).catch(() => {});
  await sleep(1500);
  await attachWebview();
  out.calibration = await calibrate(cdp);
  await installWriteCounter();
  await save();

  // ---- 手順 1: 選択でハンドル 5 個・非選択で 0 個 ----
  await step('1. 行を選ぶとプレートに data-selected と 5 個のハンドル（nw/ne/sw/se/rot）が出る。非選択では 0 個', async () => {
    const unselected = await seekTo(cdp, 2.0, 'きょうは');
    assert(unselected.handleCount === 0, `非選択でハンドルがある: ${unselected.handleCount}`);
    assert(unselected.selected === false, '非選択なのに data-selected が付いている');
    await selectCaptions(cdp, ['c-0001']);
    const selected = await waitEval(view, `(()=>{const v=${PLATE_PROBE};return v&&v.selected&&v.handleCount===5?v:null})()`,
      { label: 'ハンドル 5 個', timeoutMs: 30_000, contextId: ctxId });
    assert(['nw', 'ne', 'sw', 'se', 'rot'].every(kind => selected.handleKinds.includes(kind)),
      `ハンドルの種類が足りない: ${JSON.stringify(selected.handleKinds)}`);
    return { unselected: { handleCount: unselected.handleCount, selected: unselected.selected, text: unselected.text },
      selected: { handleCount: selected.handleCount, kinds: selected.handleKinds, styles: selected.handleStyles,
        outlineStyle: selected.outlineStyle, outlineColor: selected.outlineColor, host: selected.host, handles: selected.handles } };
  });
  await shot(cdp, 1, 'selected-shows-five-handles');

  // ---- 手順 2: 上の丸で rotate ≒ -12（scale / position は書かれない） ----
  await step('2. 上（rot）の丸をドラッグすると text_style.rotate ≒ -12 だけが書かれる（scale / position は書かれない）', async () => {
    await resetWriteCounter();
    // 角度だけが効くので、回した向きの「遠い点」まで動かして角度分解能を稼ぐ。
    const radians = -12 * Math.PI / 180;
    const drag = await dragHandle(cdp, 'rot', (center, start) => {
      const dx = start.x - center.x, dy = start.y - center.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = (dx * Math.cos(radians) - dy * Math.sin(radians)) / length;
      const uy = (dx * Math.sin(radians) + dy * Math.cos(radians)) / length;
      const reach = clampReach(center, ux, uy, 200);
      return { x: center.x + ux * reach, y: center.y + uy * reach };
    });
    let root;
    try { root = await waitCaptionsWhere(value => Number.isFinite(cueStyle(value, 'c-0001')?.rotate), { label: 'c-0001 に rotate', timeoutMs: 20_000 }); }
    catch {
      await ensureUp(drag);
      try { root = await waitCaptionsWhere(value => Number.isFinite(cueStyle(value, 'c-0001')?.rotate), { label: 'c-0001 に rotate（補完 pointerup 後）', timeoutMs: 25_000 }); }
      catch (error) { throw new Error(`${error.message} / diag=${diagOf(drag)}`); }
    }
    const style = cueStyle(root, 'c-0001');
    assert(close(drag.effectiveAngle, -12, 1.0), `ドラッグ端点の角度が -12 度でない: ${drag.effectiveAngle}`);
    assert(close(style.rotate, -12, 1.5), `rotate が -12 近傍でない: ${style.rotate}`);
    assert(style.scale === undefined, `scale まで書かれた: ${style.scale}`);
    assert(style.position === undefined && style.text_anchor === undefined, `position まで書かれた: ${JSON.stringify(style)}`);
    const writes = await readWrites();
    return { midCssRotate: drag.mid?.cssRotate ?? null, writes, style, effectiveAngle: drag.effectiveAngle, drag: { center: drag.center, start: drag.start, target: drag.target, endClient: drag.endClient } };
  });
  await shot(cdp, 2, 'rotate-handle-writes-rotate');

  // ---- 手順 3: 右下の丸で scale ≒ 1.35（position / rotate は不変） ----
  await step('3. 右下（se）の丸をドラッグすると text_style.scale ≒ 1.35 だけが書かれ、直前の rotate -12 は保たれる', async () => {
    await resetWriteCounter();
    const drag = await dragHandle(cdp, 'se', (center, start) => {
      const dx = start.x - center.x, dy = start.y - center.y;
      const length = Math.hypot(dx, dy) || 1;
      const reach = clampReach(center, dx / length, dy / length, length * 1.35);
      return { x: center.x + dx / length * reach, y: center.y + dy / length * reach };
    });
    let root;
    try { root = await waitCaptionsWhere(value => Number.isFinite(cueStyle(value, 'c-0001')?.scale), { label: 'c-0001 に scale', timeoutMs: 20_000 }); }
    catch {
      await ensureUp(drag);
      try { root = await waitCaptionsWhere(value => Number.isFinite(cueStyle(value, 'c-0001')?.scale), { label: 'c-0001 に scale（補完 pointerup 後）', timeoutMs: 25_000 }); }
      catch (error) { throw new Error(`${error.message} / diag=${diagOf(drag)}`); }
    }
    const style = cueStyle(root, 'c-0001');
    assert(close(drag.effectiveFactor, 1.35, 0.03), `ドラッグ端点が画面内に収まらず 1.35 倍になっていない: ${drag.effectiveFactor}`);
    assert(close(style.scale, 1.35, 0.06), `scale が 1.35 近傍でない: ${style.scale}`);
    assert(close(style.rotate, -12, 1.5), `rotate が変わった: ${style.rotate}`);
    assert(style.position === undefined && style.text_anchor === undefined, `position まで書かれた: ${JSON.stringify(style)}`);
    assert(cueStyle(root, 'c-0002') === null || cueStyle(root, 'c-0002') === undefined, 'c-0002 まで書き換わった');
    const writes = await readWrites();
    return { midCssScale: drag.mid?.cssScale ?? null, writes, style, effectiveFactor: drag.effectiveFactor, drag: { center: drag.center, start: drag.start, target: drag.target, endClient: drag.endClient } };
  });
  await shot(cdp, 3, 'corner-drag-writes-scale');

  // ---- 手順 4: 2 行選択 → 1 ドラッグ = 1 commit・2 cue に同じ値 ----
  await step('4. 2 行（c-0001 / c-0002）を選んで 1 回ドラッグすると、captionWrite 1 回で 2 cue に同じ scale が入る', async () => {
    await seekTo(cdp, 4.2, 'あしたの');
    await selectCaptions(cdp, ['c-0001', 'c-0002']);
    await waitEval(view, `(()=>{const v=${PLATE_PROBE};return v&&v.selected&&v.handleCount===5?v:null})()`,
      { label: 'c-0002 表示中にハンドル 5 個', timeoutMs: 30_000, contextId: ctxId });
    await resetWriteCounter();
    const drag = await dragHandle(cdp, 'se', (center, start) => {
      const dx = start.x - center.x, dy = start.y - center.y;
      const length = Math.hypot(dx, dy) || 1;
      const reach = clampReach(center, dx / length, dy / length, length * 1.6);
      return { x: center.x + dx / length * reach, y: center.y + dy / length * reach };
    });
    let root;
    try { root = await waitCaptionsWhere(value => Number.isFinite(cueStyle(value, 'c-0002')?.scale), { label: 'c-0002 に scale', timeoutMs: 20_000 }); }
    catch {
      await ensureUp(drag);
      try { root = await waitCaptionsWhere(value => Number.isFinite(cueStyle(value, 'c-0002')?.scale), { label: 'c-0002 に scale（補完 pointerup 後）', timeoutMs: 25_000 }); }
      catch (error) { throw new Error(`${error.message} / diag=${diagOf(drag)}`); }
    }
    const first = cueStyle(root, 'c-0001'), second = cueStyle(root, 'c-0002'), third = cueStyle(root, 'c-0003');
    assert(Number.isFinite(first?.scale) && first.scale === second.scale, `2 cue の scale が違う: ${first?.scale} / ${second?.scale}`);
    assert(close(second.scale, drag.effectiveFactor, 0.05),
      `書かれた scale がドラッグ倍率と違う: ${second.scale} / ${drag.effectiveFactor}`);
    assert(close(first.rotate, -12, 1.5), `c-0001 の rotate が失われた: ${first?.rotate}`);
    assert(second.rotate === undefined, `c-0002 に rotate まで書かれた: ${second.rotate}`);
    assert(third === null || third === undefined, `c-0003 まで書き換わった: ${JSON.stringify(third)}`);
    const writes = await readWrites();
    assert(writes.length === 1, `captionWrite が 1 回でない: ${writes.length}`);
    return { writes, c1: first, c2: second, c3: third, effectiveFactor: drag.effectiveFactor };
  });
  await shot(cdp, 4, 'two-rows-one-commit-same-scale');

  // ---- 手順 5: display_policy（lines 2 / wrap fold）で 2 行に描かれる ----
  await step('5. display_policy（lines 2 / wrap fold）を足すと resolved 字幕が 2 行（.akari-caption__line が 2 個）で描かれる（c-0003 で観測）', async () => {
    const root = await readCaptions();
    root.display_policy = {
      mode: 'single_line_sequential',
      algorithm: 'a4-ja-two-fragment-v1',
      unit_metric: 'ascii-half-other-one-v1',
      max_line_units: 6,
      minimum_fragment_duration_seconds: 0.3,
      locale: 'ja',
      lines: 2,
      wrap: 'fold'
    };
    await writeFile(CAPTIONS, `${JSON.stringify(root, null, 2)}\n`);
    // 外部（このスクリプト）の書き込みはアプリの直接通知経路に乗らないので、
    // アプリ自身の書き込み（ハンドルを少しドラッグ）で字幕の読み直しを促す。
    await seekTo(cdp, 2.0, 'きょうは');
    await selectCaptions(cdp, ['c-0001']);
    await waitEval(view, `(()=>{const v=${PLATE_PROBE};return v&&v.selected&&v.handleCount===5?v:null})()`,
      { label: '再読込を促す前にハンドル 5 個', timeoutMs: 30_000, contextId: ctxId });
    await dragHandle(cdp, 'se', (center, start) => {
      const dx = start.x - center.x, dy = start.y - center.y;
      const length = Math.hypot(dx, dy) || 1;
      const reach = clampReach(center, dx / length, dy / length, length * 1.1);
      return { x: center.x + dx / length * reach, y: center.y + dy / length * reach };
    });
    // 観測は拡大 / 回転を書いていない c-0003（みじかい行です）で行う（折り返しだけを見る）。
    await selectCaptions(cdp, []);
    const deadline = Date.now() + 120_000;
    let last;
    while (Date.now() < deadline) {
      await evalOn(cdp, commandWith('akari.preview.seekOutput', { editUri: EDIT_URI(), time: 6.0 })).catch(() => {});
      await sleep(700);
      last = await probe().catch(() => null);
      if (last && last.lineCount >= 2 && last.text.includes('みじかい')) break;
    }
    assert(last && last.lineCount >= 2 && last.text.includes('みじかい'), `c-0003 が 2 行で描かれない: ${JSON.stringify(last)}`);
    return { lineCount: last.lineCount, lineTexts: last.lineTexts, styled: last.styled, hostTransform: last.hostTransform, hostOrigin: last.hostOrigin };
  });
  await shot(cdp, 5, 'display-lines-two-rows');

  out.finalCaptions = await readCaptions();
  out.status = 'pass';
  await save();
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
  try {
    if (session?.cdp) {
      const name = '99-failure.png';
      await screenshot(session.cdp, path.join(ROOT, name));
      if (!out.screenshots.includes(name)) out.screenshots.push(name);
    }
  } catch { /* screenshot best effort */ }
  await save();
  process.exitCode = 1;
} finally {
  const survivors = await stop(session);
  if (survivors !== 0) {
    out.status = out.status === 'pass' ? 'fail' : out.status;
    out.cleanupError = `surviving processes: ${survivors}`;
    await save();
    process.exitCode = 1;
  }
}
