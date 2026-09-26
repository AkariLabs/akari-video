#!/usr/bin/env node
// 実機の字幕編集を合成プロジェクトで測る。呼び出し側が重い処理枠を持つ。
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shellDir = path.resolve(arg('shell', path.join(repo, 'apps/shell')));
const label = arg('label', 'after');
const outDir = path.resolve(arg('out', path.join(repo, 'evidence/c1-caption-edit-bugs', label)));
const only = (arg('only', '') || '').split(',').filter(Boolean);
const port = 9577;
const httpPort = 49021;
const electron = path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';

const scratch = await realpath(await mkdtemp('/tmp/2026-09-26-libcanvas-c1-caption-edit-bugs-l1-'));
const project = path.join(scratch, 'project');
const editPath = path.join(project, 'edit.json');
const captionsPath = path.join(project, 'captions.json');
const editUri = pathToFileURL(editPath).href;
const clean = v => String(v).replaceAll(repo, '<repo>').replaceAll(scratch, '<scratch>').replace(/\/Users\/[^\s"')]+/g, '<local>')
  .replace(/\/(private\/)?(tmp|var)\/[^\s"')]+/g, '<tmp>');
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });

// ---- fixture -----------------------------------------------------------------------------
// 1920×1080 / 30fps。下地の動画 + 図形 2 つ + 写真 1 枚 + 文字（字幕）1 つ。box-kf は位置のキーフレーム付き。
const EDIT = {
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  sources: [{ id: 'base', path: 'assets/base.mp4' }, { id: 'photo', path: 'assets/photo.png' }],
  tracks: [
    { id: 'v-main', lane: 'visual', name: '本編', items: [{ id: 'cut-1', at: 0, duration: 300, source: { kind: 'media', src: 'base', in: 0, out: 10 } }] },
    { id: 'v-photo', lane: 'visual', name: 'photo', items: [{ id: 'photo-a', at: 0, duration: 300, transform: { x: 450, y: -180, scale: 0.6 },
      source: { kind: 'media', src: 'photo', in: 0, out: 10 } }] },
    { id: 'v-box-a', lane: 'visual', name: 'box-a', items: [{ id: 'box-a', at: 0, duration: 300, transform: { x: 300, y: 200 },
      source: { kind: 'shape', shape: 'rect', params: { width: 300, height: 200, fill: '#3b82f6', stroke: '#111827', strokeWidth: 6 } } }] },
    { id: 'v-box-b', lane: 'visual', name: 'box-b', items: [{ id: 'box-b', at: 0, duration: 300, transform: { x: 300, y: 620 },
      source: { kind: 'shape', shape: 'rect', params: { width: 240, height: 160, fill: '#ef4444' } } }] },
    { id: 'v-box-kf', lane: 'visual', name: 'box-kf', items: [{ id: 'box-kf', at: 0, duration: 300, transform: { x: 800, y: 780 },
      keyframes: [{ t: 0, transform: { x: 700 } }, { t: 300, transform: { x: 1300 } }],
      source: { kind: 'shape', shape: 'rect', params: { width: 200, height: 120, fill: '#10b981' } } }] },
    { id: 'v-round', lane: 'visual', name: 'round-a', items: [{ id: 'round-a', at: 0, duration: 300, transform: { x: 980, y: 540 },
      source: { kind: 'shape', shape: 'rounded-rect', params: { width: 300, height: 200, fill: '#f59e0b', cornerRadius: 10 } } }] },
    { id: 'v-bubble', lane: 'visual', name: 'bubble-a', items: [{ id: 'bubble-a', at: 0, duration: 300, transform: { x: 1440, y: 540 },
      source: { kind: 'shape', shape: 'bubble', params: { width: 360, height: 220, tailAngle: 180, tailLength: 30, tailWidth: 20 } } }] },
    { id: 'v-text', lane: 'visual', name: 'text', items: [{ id: 'captions', name: '字幕', at: 0, duration: 300, source: { kind: 'captions', path: 'captions.json' }, items: [] }] }
  ]
};
const CAPTIONS = { captions: [
  { id: 'c-0001', start: 0, end: 3, time_domain: 'output', text: '左右のつまみで折り返し幅を調整するための長い字幕の文章', text_style: { wrap_width_pct: 36 }, speaker: null, sourceRef: null, edited: true },
  { id: 'c-0002', start: 3, end: 6, time_domain: 'output', text: '一行目の字幕\n二行目の字幕', speaker: null, sourceRef: null, edited: true },
  { id: 'c-0003', start: 6, end: 7.5, time_domain: 'output', text: '三十度の字幕を狭めて複数の行に折り返すための文章', text_style: { rotate: 30, wrap_width_pct: 36, text_anchor: 'tl', position: { x: 0.18, y: 0.48 } }, speaker: null, sourceRef: null, edited: true },
  { id: 'c-0004', start: 7.5, end: 8.8, time_domain: 'output', text: '大きさを変えた字幕の折り返し幅を左右から狭めて行数の変化を確かめる', text_style: { scale: 1.6, wrap_width_pct: 36, text_anchor: 'tl', position: { x: 0.18, y: 0.55 } }, speaker: null, sourceRef: null, edited: true },
  { id: 'c-0005', start: 8.8, end: 10, time_domain: 'output', text: '装飾の一行目\n装飾の二行目', style_preset: 'subtitle-news', runs: [{ from: 0, to: 2, role: 'emphasis', style: { color: '#ff5a5f' } }], speaker: null, sourceRef: null, edited: true }
] };

async function makeFixture() {
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await mkdir(path.join(project, '.akari'), { recursive: true });
  let r = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=0xe7e5e4:s=1920x1080:d=10:r=30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', path.join(project, 'assets', 'base.mp4')]);
  if (r.status !== 0) throw new Error(`ffmpeg base: ${r.stderr}`);
  r = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1', '-frames:v', '1',
    path.join(project, 'assets', 'photo.png')]);
  if (r.status !== 0) throw new Error(`ffmpeg photo: ${r.stderr}`);
  await writeFile(editPath, `${JSON.stringify(EDIT, null, 2)}\n`);
  await writeFile(captionsPath, `${JSON.stringify(CAPTIONS, null, 2)}\n`);
  await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
  for (const a of [['init', '-q'], ['config', 'user.email', 'l1@localhost'], ['config', 'user.name', 'l1'], ['add', '-A'], ['commit', '-q', '-m', 'fixture']]) {
    const g = run('/usr/bin/git', a, { cwd: project });
    if (g.status !== 0) throw new Error(`git ${a[0]}: ${g.stderr}`);
  }
}

// ---- edit.json の書き込みの数え方（15ms 毎に中身を見て、変わった回数を数える）---------------------
// edit.json と captions.json（文字の値はこちらへ書かれる）の両方を数える
const lastTexts = new Map();
let writes = [];
let watcher;
function startWatch() {
  for (const f of [editPath, captionsPath]) lastTexts.set(f, readFileSync(f, 'utf8'));
  watcher = setInterval(() => {
    for (const f of [editPath, captionsPath]) {
      let t; try { t = readFileSync(f, 'utf8'); } catch { continue; }
      if (t && t !== lastTexts.get(f)) {
        lastTexts.set(f, t);
        let boxA = null; try { if (f === editPath) boxA = findItem(JSON.parse(t), 'box-a')?.transform ?? null; } catch {}
        writes.push({ at: Date.now(), file: path.basename(f), boxA });
      }
    }
  }, 15);
}
const writeMark = () => writes.length;
const writesSince = mark => writes.length - mark;

// ---- CDP ---------------------------------------------------------------------------------
class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((res, rej) => { this.socket.addEventListener('open', res, { once: true }); this.socket.addEventListener('error', rej, { once: true }); });
    this.socket.addEventListener('message', event => {
      const m = JSON.parse(event.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      else if (m.method) for (const l of this.listeners.get(m.method) ?? []) l(m.params, m.sessionId);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`CDP ${method} timed out`)); }, 30000);
      this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(method, fn) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn]); }
  close() { this.socket?.close(); }
}
async function evaluate(cdp, expression, contextId, sessionId) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...(contextId === undefined ? {} : { contextId }) }, sessionId);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
  return r.result.value;
}
async function waitForJson(url, pred, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await (await fetch(url)).json(); if (pred(v)) return v; } catch {} await sleep(300); }
  throw new Error(`timeout ${url}`);
}
const contexts = new Map();
const consoleErrors = [];
function track(cdp) {
  cdp.on('Runtime.executionContextCreated', (p, s) => { if (!p?.context?.auxData?.isDefault) return; contexts.set(s, [...(contexts.get(s) ?? []), p.context.id]); });
  cdp.on('Runtime.executionContextsCleared', (_p, s) => contexts.delete(s));
  cdp.on('Runtime.exceptionThrown', p => consoleErrors.push(String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? '').slice(0, 400)));
  cdp.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') consoleErrors.push(p.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 400)); });
}
let main, browser, view, child;
async function findPreview(ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const all = await browser.send('Target.getTargets').catch(() => undefined);
    for (const info of all?.targetInfos ?? []) {
      if (!['iframe', 'page', 'webview'].includes(info.type) || !String(info.url ?? '').includes('webview')) continue;
      try {
        const { sessionId } = await browser.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
        contexts.delete(sessionId);
        await browser.send('Page.enable', {}, sessionId).catch(() => {}); await browser.send('Runtime.enable', {}, sessionId).catch(() => {});
        await sleep(300);
        for (const contextId of contexts.get(sessionId) ?? []) {
          try { if (await evaluate(browser, `Boolean(document.getElementById('preview-layers') && document.getElementById('seek'))`, contextId, sessionId)) return { sessionId, contextId }; } catch {}
        }
      } catch {}
    }
    await sleep(500);
  }
  return undefined;
}
const pv = async expr => { try { return await evaluate(browser, expr, view.contextId, view.sessionId); } catch (error) { if (!/Cannot find context|Session with given id not found/.test(String(error))) throw error; view = await findPreview(20000); if (!view) throw error; return evaluate(browser, expr, view.contextId, view.sessionId); } };
const mw = expr => evaluate(main, expr);
async function command(id, value) {
  return mw(`(async () => { try {
    const d = window.theia?.container?._bindingDictionary; const keys = d?._map ? [...d._map.keys()] : [];
    const C = keys.find(k => typeof k === 'function' && k.prototype && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
    if (!C) return { ok: false, error: 'no registry' };
    const v = await window.theia.container.get(C).executeCommand(${JSON.stringify(id)}, ${JSON.stringify(value)});
    let plain = null; try { plain = v === undefined ? null : JSON.parse(JSON.stringify(v)); } catch { plain = typeof v; }
    return { ok: true, value: plain };
  } catch (e) { return { ok: false, error: e?.message ?? String(e) }; } })()`);
}
async function seek(seconds) {
  for (let i = 0; i < 4; i++) {
    await command('akari.preview.seekOutput', { editUri, time: seconds });
    await sleep(700);
    const actual = await pv(`Number(document.getElementById('seek')?.value)`).catch(() => NaN);
    if (Math.abs(actual - seconds) < 0.04) { await sleep(400); return actual; }
  }
  return pv(`Number(document.getElementById('seek')?.value)`);
}
// 本体ページ上の webview（プレビュー）の左上
async function outerOffset() {
  return mw(`(() => { const f = [...document.querySelectorAll('iframe')].filter(f => /webview/.test(f.src || '')).map(f => f.getBoundingClientRect()).filter(r => r.width > 100 && r.height > 100).sort((a, b) => b.width * b.height - a.width * a.height)[0]; return f ? { x: f.x, y: f.y, w: f.width, h: f.height } : null; })()`);
}
let outer;
// プレビューの中の item の矩形（webview の座標）。図形は svg、写真はレイヤー
async function itemRects(ids) {
  return pv(`(() => { const out = {}; const stage = document.getElementById('preview-layers').getBoundingClientRect();
    for (const id of ${JSON.stringify(ids)}) {
      const node = document.querySelector('[data-overlay-id=' + JSON.stringify(id) + ']') ?? document.querySelector('[data-item-id=' + JSON.stringify(id) + ']') ?? document.querySelector('[data-akari-layer-id=' + JSON.stringify(id) + ']');
      const cap = !node && id === 'captions' ? [...document.querySelectorAll('body *')].find(e => e.children.length === 0 && (e.textContent || '').includes('ライブの連動') && e.getBoundingClientRect().width > 0) : null;
      const shape = cap ?? node?.querySelector('svg') ?? node;
      if (!shape) { out[id] = null; continue; }
      const b = shape.getBoundingClientRect();
      out[id] = { left: +b.left.toFixed(1), top: +b.top.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1), cx: +(b.left + b.width / 2).toFixed(1), cy: +(b.top + b.height / 2).toFixed(1),
        transform: ((node ?? cap).style?.transform || '').slice(0, 120), opacity: getComputedStyle(node ?? cap).opacity,
        filter: getComputedStyle(node ?? cap).filter.slice(0, 120), fontSize: getComputedStyle(cap ?? shape).fontSize };
    }
    const frame = document.querySelector('.akari-interaction-selection-frame');
    const fr = frame && getComputedStyle(frame).display !== 'none' ? frame.getBoundingClientRect() : null;
    return { stage: { x: stage.x, y: stage.y, width: stage.width, height: stage.height }, items: out,
      frame: fr ? { left: +fr.left.toFixed(1), top: +fr.top.toFixed(1), width: +fr.width.toFixed(1), height: +fr.height.toFixed(1) } : null }; })()`);
}
async function mouse(type, x, y, buttons, extra = {}) {
  await main.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left',
    buttons: buttons ?? (type === 'mousePressed' ? 1 : 0), clickCount: type === 'mouseMoved' ? 0 : 1, ...extra });
}
const vp = p => ({ x: outer.x + p.x, y: outer.y + p.y }); // webview → 本体ページ
async function clickAt(pt) { await mouse('mouseMoved', pt.x, pt.y); await mouse('mousePressed', pt.x, pt.y); await sleep(60); await mouse('mouseReleased', pt.x, pt.y); await sleep(700); }
async function key(keyName, code, keyCode, modifiers = 0, commands) {
  await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers,
    ...(commands ? { commands } : {}) });
  await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
}
async function shot(name, clip) {
  const { data } = await main.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  const file = `${label}-${name}.png`;
  await writeFile(path.join(outDir, file), Buffer.from(data, 'base64'));
  return file;
}
// 本体ページの矩形: プレビュー + インスペクターが入るように、ウィンドウ全体を撮る（縮小なし）
const windowShot = name => shot(name);

const readEditText = () => readFile(editPath, 'utf8');
const headText = () => run('/usr/bin/git', ['show', 'HEAD:edit.json'], { cwd: project }).stdout;
const findItem = (edit, id) => { const walk = items => { for (const it of items ?? []) { if (it.id === id) return it; const c = walk(it.items); if (c) return c; } }; for (const t of edit.tracks) { const f = walk(t.items); if (f) return f; } };
const INSPECTOR = `document.querySelector('[data-akari-ui="panel:inspector"]')`;
async function undoOnce() {
  const before = await readEditText();
  await mw(`(() => { const e = document.activeElement; if (e && e !== document.body) e.blur(); return true; })()`);
  await key('z', 'KeyZ', 90, 4, ['undo']);
  for (let i = 0; i < 30 && (await readEditText()) === before; i++) await sleep(200);
  await sleep(800);
}

async function resetToHead() {
  let touched = false;
  for (const name of ['edit.json', 'captions.json']) {
    const f = path.join(project, name);
    const head = run('/usr/bin/git', ['show', `HEAD:${name}`], { cwd: project }).stdout;
    if ((await readFile(f, 'utf8')) !== head) { await writeFile(f, head); touched = true; }
  }
  if (touched) await sleep(2500);
}
const readCaptionsText = () => readFile(captionsPath, 'utf8');
const mark = () => writes.length;
const changes = since => writes.slice(since).map(({file}) => file);
const jsonDiff = (before, after) => {
  const output=[];
  const visit=(a,b,key)=>{
    if(JSON.stringify(a)===JSON.stringify(b))return;
    if(a&&b&&typeof a==='object'&&typeof b==='object'){
      for(const name of new Set([...Object.keys(a),...Object.keys(b)]))visit(a[name],b[name],key?key+'.'+name:name);
    }else output.push({field:key,before:a??null,after:b??null});
  };
  visit(JSON.parse(before),JSON.parse(after),'');return output;
};
const fixedEdgeGeometry = (beforeCorners, afterCorners, side) => {
  const indexes=side==='e'?[0,3]:[1,2],a=beforeCorners[indexes[0]],b=beforeCorners[indexes[1]];
  const first=afterCorners[indexes[0]],length=Math.hypot(b.x-a.x,b.y-a.y);
  const distances=indexes.map(i=>{
    const point=afterCorners[i];return Math.abs((b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x))/length;
  });
  return {fixedCornerDelta:{x:first.x-a.x,y:first.y-a.y},fixedCornerDistance:Math.hypot(first.x-a.x,first.y-a.y),
    lineDistances:distances,maxLineDistance:Math.max(...distances)};
};
const rect = r => r ? { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height, cx:(r.left+r.right)/2, cy:(r.top+r.bottom)/2 } : null;
const captionState = () => pv(`(() => {
  const host = [...document.querySelectorAll('.caption-row-plate')].find(e => e.getClientRects().length && e.querySelector('.akari-caption__plate'));
  if (!host) return { error:'caption absent', seek:document.getElementById('seek')?.value };
  const plate=host.querySelector('.akari-caption__plate'), lines=[...host.querySelectorAll('.akari-caption__line')], block=host.querySelector('.akari-caption__block')||lines[0];
  const box=document.getElementById('caption-select-box');
  const r=e=>{if(!e)return null;const a=e.getBoundingClientRect();return {left:a.left,top:a.top,right:a.right,bottom:a.bottom,width:a.width,height:a.height,cx:(a.left+a.right)/2,cy:(a.top+a.bottom)/2}};
  const corners=(a,c,scale,angle)=>{const rad=angle*Math.PI/180, co=Math.cos(rad),si=Math.sin(rad);return [[a.left,a.top],[a.right,a.top],[a.right,a.bottom],[a.left,a.bottom]].map(([x,y])=>({x:c.x+scale*((x-c.x)*co-(y-c.y)*si),y:c.y+scale*((x-c.x)*si+(y-c.y)*co)}))};
  const oldRotate=plate.style.rotate,oldScale=plate.style.scale;plate.style.rotate='none';plate.style.scale='none';
  const plainPlate=r(plate),plainParts=(host.querySelector('.akari-caption__block')?[block]:lines).map(r);
  const plain=plainParts.length?{left:Math.min(...plainParts.map(a=>a.left)),right:Math.max(...plainParts.map(a=>a.right)),top:Math.min(...plainParts.map(a=>a.top)),bottom:Math.max(...plainParts.map(a=>a.bottom))}:r(block);
  plate.style.rotate=oldRotate;plate.style.scale=oldScale;
  const rotate=parseFloat(getComputedStyle(host).getPropertyValue('--caption-rotate'))||0,scale=parseFloat(getComputedStyle(host).getPropertyValue('--caption-scale'))||1;
  const captionCorners=plain?corners(plain,{x:plainPlate.cx,y:plainPlate.cy},scale,rotate):null;
  const boxAngle=parseFloat(box.style.getPropertyValue('--caption-box-rotate'))||0;
  const boxOld=box.style.transform;box.style.transform='none';const boxPlain=r(box);box.style.transform=boxOld;
  const boxCorners=boxPlain?corners(boxPlain,{x:boxPlain.cx,y:boxPlain.cy},1,boxAngle):null;
  const visualLines=e=>{if(!e)return 0;const s=getComputedStyle(e),h=e.offsetHeight-(parseFloat(s.paddingTop)||0)-(parseFloat(s.paddingBottom)||0),lh=parseFloat(s.lineHeight);return Number.isFinite(lh)&&lh>0?Math.max(1,Math.round(h/lh)):Math.max(1,(e.innerText||'').split('\\n').length)};
  const hs={};for(const h of host.querySelectorAll('[data-h]')) hs[h.getAttribute('data-h')]=r(h);
  return {seek:Number(document.getElementById('seek')?.value),host:r(host),plate:r(plate),block:r(block),box:r(box),captionCorners,boxCorners,handles:hs,selected:host.hasAttribute('data-selected'),editing:host.classList.contains('akari-caption-host--editing'),text:lines.map(e=>e.textContent).join('\\n'),html:block?.innerHTML?.slice(0,400),lines:host.classList.contains('akari-caption-host--editing')?visualLines(block):lines.reduce((sum,line)=>sum+visualLines(line),0),hardLines:block?.innerText?.split('\\n').length,runCount:host.querySelectorAll('.akari-caption__run').length,style:{rotate:getComputedStyle(host).getPropertyValue('--caption-rotate'),wrap:getComputedStyle(host).getPropertyValue('--caption-wrap-width'),left:getComputedStyle(host).getPropertyValue('--caption-left'),top:getComputedStyle(host).getPropertyValue('--caption-top')},active:document.activeElement?.getAttribute('data-akari-caption-editing')};
})()`);
async function selectCaptionAtCurrentTime() {
  const s=await captionState(); if(s.error) throw new Error(s.error);
  const p=vp({x:s.block.cx,y:s.block.cy}); await clickAt(p); return captionState();
}
async function doubleClickCaption() {
  const s=await captionState();const p=vp({x:s.block.cx,y:s.block.cy});
  await main.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',buttons:1,clickCount:2});
  await main.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',buttons:0,clickCount:2});
  await sleep(450);return captionState();
}
async function scenario(name, fn) {
  if (only.length && !only.includes(name)) return;
  try { results[name]=await fn(); } catch(e) {results[name]={error:clean(e?.stack??e).slice(0,1200)};}
  await resetToHead();
}
const results={};
const inspectorWrap = () => mw(`document.querySelector('[data-akari-ui="field:inspector-caption-wrap-width"] input')?.value ?? null`);
async function dragCaptionGrip(side, delta, name) {
  const before=await captionState(),beforeFiles={edit:await readEditText(),captions:await readCaptionsText()};
  const h=before.handles[side],p=vp({x:h.cx,y:h.cy}),m=mark(),samples=[];
  await mouse('mouseMoved',p.x,p.y);await mouse('mousePressed',p.x,p.y);await sleep(80);
  for(let i=1;i<=8;i++){
    const x=p.x+delta.x*i/8,y=p.y+delta.y*i/8;
    await mouse('mouseMoved',x,y,1);await sleep(140);
    const s=await captionState();samples.push({step:i,lines:s.lines,plate:s.plate,corner:s.captionCorners?.[0]});
  }
  await mouse('mouseMoved',p.x+delta.x,p.y+delta.y,1);await sleep(250);
  const during=await captionState(),shotName=await shot(name+'-during');
  await mouse('mouseMoved',p.x+delta.x,p.y+delta.y,1);await sleep(120);
  await mouse('mouseReleased',p.x+delta.x,p.y+delta.y);await sleep(1200);
  const after=await captionState(),writeEvents=changes(m);
  const fileDiff={edit:jsonDiff(beforeFiles.edit,await readEditText()),captions:jsonDiff(beforeFiles.captions,await readCaptionsText())};
  await undoOnce();const undone={edit:(await readEditText())===beforeFiles.edit,captions:(await readCaptionsText())===beforeFiles.captions};
  return {before,during,after,samples,shot:shotName,writeEvents,fileDiff,undone,
    geometry:{during:fixedEdgeGeometry(before.captionCorners,during.captionCorners,side),
      after:fixedEdgeGeometry(before.captionCorners,after.captionCorners,side)}};
}
async function scenarios() {
  await scenario('width', async()=>{
    await seek(1);const selected=await selectCaptionAtCurrentTime();const inspectorBefore=await inspectorWrap();
    const before=await captionState();const beforeFiles={edit:await readEditText(),captions:await readCaptionsText()};const m=mark();
    const h=before.handles.e;const p=vp({x:h.cx,y:h.cy});
    await mouse('mouseMoved',p.x,p.y);await mouse('mousePressed',p.x,p.y);await sleep(80);
    for(let i=1;i<=5;i++){await mouse('mouseMoved',p.x+18*i,p.y,1);await sleep(80)}
    const during=await captionState();const duringShot=await shot('width-during');
    await mouse('mouseReleased',p.x+90,p.y);await sleep(1800);
    const after=await captionState();const inspectorAfter=await inspectorWrap();const afterShot=await shot('width-after');
    const rightFiles={edit:await readEditText(),captions:await readCaptionsText()};
    const written={edit:rightFiles.edit!==beforeFiles.edit,captions:rightFiles.captions!==beforeFiles.captions};
    const fileDiff={edit:jsonDiff(beforeFiles.edit,rightFiles.edit),captions:jsonDiff(beforeFiles.captions,rightFiles.captions)};
    const writeEvents=changes(m);
    await undoOnce();const undone={edit:(await readEditText())===beforeFiles.edit,captions:(await readCaptionsText())===beforeFiles.captions};
    await seek(1);await selectCaptionAtCurrentTime();const leftBefore=await captionState();const leftMark=mark();
    const w=leftBefore.handles.w;const wp=vp({x:w.cx,y:w.cy});
    await mouse('mouseMoved',wp.x,wp.y);await mouse('mousePressed',wp.x,wp.y);await sleep(80);
    for(let i=1;i<=5;i++){await mouse('mouseMoved',wp.x+9*i,wp.y,1);await sleep(80)}
    const leftDuring=await captionState();const leftShot=await shot('width-left-during');
    await mouse('mouseReleased',wp.x+45,wp.y);await sleep(1500);const leftAfter=await captionState();
    const leftWrites=changes(leftMark);
    const leftFileDiff={edit:jsonDiff(beforeFiles.edit,await readEditText()),captions:jsonDiff(beforeFiles.captions,await readCaptionsText())};
    await undoOnce();
    const leftUndo={edit:(await readEditText())===beforeFiles.edit,captions:(await readCaptionsText())===beforeFiles.captions};
    return {selected,before,during,after,inspectorBefore,inspectorAfter,duringShot,afterShot,writeEvents,written,fileDiff,undone,
      geometry:fixedEdgeGeometry(before.captionCorners,after.captionCorners,'e'),
      left:{before:leftBefore,during:leftDuring,after:leftAfter,shot:leftShot,writeEvents:leftWrites,fileDiff:leftFileDiff,undone:leftUndo,
        geometry:fixedEdgeGeometry(leftBefore.captionCorners,leftAfter.captionCorners,'w')}};
  });
  await scenario('keys', async()=>{
    await seek(4);const selected=await selectCaptionAtCurrentTime();const edit=await doubleClickCaption();
    const start=await captionState();const m=mark();
    await key('ArrowLeft','ArrowLeft',37);await sleep(250);const afterLeft=await captionState();
    await key('ArrowRight','ArrowRight',39);await sleep(450);
    const editing=await captionState();const editingShot=await shot('keys-editing');
    await key('Escape','Escape',27);await sleep(250);
    const noEdit=await captionState();await key('ArrowRight','ArrowRight',39);await sleep(450);
    const outside=await captionState();
    return {selected,edit,start,afterLeft,editing,noEdit,outside,editingShot,writeEvents:changes(m)};
  });
  await scenario('newline',async()=>{
    await seek(4);const selected=await selectCaptionAtCurrentTime();const first=await doubleClickCaption();const m=mark();
    await key('Enter','Enter',13,8);await sleep(180);
    if ((await captionState()).editing) await main.send('Input.insertText',{text:'\n'});
    const afterShiftEnter=await captionState();
    await main.send('Input.insertText',{text:'追加の行'});await sleep(180);const typed=await captionState();
    await key('Enter','Enter',13);await sleep(700);
    const committed=await captionState();const second=await doubleClickCaption();const shotName=await shot('newline-reopen');
    await key('Escape','Escape',27);await sleep(250);
    await clickAt({x:outer.x+20,y:outer.y+20});const deselected=await captionState();
    return {selected,first,afterShiftEnter,typed,committed,second,deselected,shot:shotName,writeEvents:changes(m),fileText:JSON.parse(await readCaptionsText()).captions[1].text};
  });
  await scenario('reopen-wrap',async()=>{
    await seek(1);await selectCaptionAtCurrentTime();const before=await captionState();
    const editing=await doubleClickCaption();const shotName=await shot('reopen-wrap');
    await key('Escape','Escape',27);await sleep(250);
    const committed=await captionState();
    await clickAt({x:outer.x+20,y:outer.y+20});const deselected=await captionState();
    return {before,editing,committed,deselected,shot:shotName};
  });
  await scenario('soft-wrap-edit',async()=>{
    await seek(1);await selectCaptionAtCurrentTime();const before=await captionState();
    const beforeText=JSON.parse(await readCaptionsText()).captions[0].text;
    const editing=await doubleClickCaption(),m=mark();
    await main.send('Input.insertText',{text:'追'});await sleep(250);const typed=await captionState();
    await key('Enter','Enter',13);await sleep(700);const committed=await captionState();
    const fileText=JSON.parse(await readCaptionsText()).captions[0].text;
    await clickAt({x:outer.x+20,y:outer.y+20});const deselected=await captionState();
    return {before,editing,typed,committed,deselected,beforeText,fileText,writeEvents:changes(m),shot:await shot('soft-wrap-edit')};
  });
  await scenario('styled-newline',async()=>{
    await seek(9.2);await selectCaptionAtCurrentTime();const before=await captionState();
    const first=await doubleClickCaption();await key('Escape','Escape',27);await sleep(250);
    const committed=await captionState();const second=await doubleClickCaption();const shotName=await shot('styled-newline-reopen');
    await key('Escape','Escape',27);await sleep(250);await clickAt({x:outer.x+20,y:outer.y+20});
    const deselected=await captionState(),cue=JSON.parse(await readCaptionsText()).captions[4];
    return {before,first,committed,second,deselected,stylePreset:cue.style_preset,runs:cue.runs,text:cue.text,shot:shotName};
  });
  await scenario('rotated',async()=>{
    await seek(7);const selected=await selectCaptionAtCurrentTime();const shotName=await shot('rotated');
    const before=await captionState(),h=before.handles.e,p=vp({x:h.cx,y:h.cy}),m=mark();
    await mouse('mouseMoved',p.x,p.y);await mouse('mousePressed',p.x,p.y);await sleep(80);
    for(let i=1;i<=4;i++){await mouse('mouseMoved',p.x+8*i*Math.cos(Math.PI/6),p.y+8*i*Math.sin(Math.PI/6),1);await sleep(70)}
    const during=await captionState();await mouse('mouseReleased',p.x+32*Math.cos(Math.PI/6),p.y+16);await sleep(1100);
    const after=await captionState(),writeEvents=changes(m);await undoOnce();
    return {selected,before,during,after,writeEvents,shot:shotName};
  });
  await scenario('scaled-right-narrow',async()=>{
    await seek(8.2);await selectCaptionAtCurrentTime();return dragCaptionGrip('e',{x:-80,y:0},'scaled-right-narrow');
  });
  await scenario('scaled-left-narrow',async()=>{
    await seek(8.2);await selectCaptionAtCurrentTime();return dragCaptionGrip('w',{x:80,y:0},'scaled-left-narrow');
  });
  await scenario('rotated-narrow',async()=>{
    await seek(7);await selectCaptionAtCurrentTime();return dragCaptionGrip('e',
      {x:-70*Math.cos(Math.PI/6),y:-70*Math.sin(Math.PI/6)},'rotated-narrow');
  });
  await scenario('rotated-left-narrow',async()=>{
    await seek(7);await selectCaptionAtCurrentTime();return dragCaptionGrip('w',
      {x:70*Math.cos(Math.PI/6),y:70*Math.sin(Math.PI/6)},'rotated-left-narrow');
  });
  await scenario('regression',async()=>{
    await seek(1);
    await key('Escape','Escape',27);await sleep(200);
    const initial=await itemRects(['box-b','photo-a']);
    const photo=initial.items['photo-a'];
    const photoHit=await pv(`(() => {const e=document.querySelector('[data-overlay-id="photo-a"], [data-item-id="photo-a"], [data-akari-layer-id="photo-a"]');if(!e)return null;const r=e.getBoundingClientRect();for(const fy of [.5,.35,.65])for(const fx of [.5,.25,.75]){const x=r.left+r.width*fx,y=r.top+r.height*fy;const h=document.elementFromPoint(x,y)?.closest('[data-overlay-id], [data-item-id], [data-akari-layer-id]');if(['data-overlay-id','data-item-id','data-akari-layer-id'].some(k=>h?.getAttribute(k)==='photo-a'))return {x,y,owner:'photo-a'}}return {x:r.left+r.width/2,y:r.top+r.height/2,owner:null}})()`);
    let photoInspector=null;
    for(let attempt=0;attempt<3&&!photoInspector?.includes('photo.png');attempt++){
      await clickAt(vp(photoHit||{x:photo.cx,y:photo.cy}));
      for(let i=0;i<15;i++){
        photoInspector=await mw(`document.querySelector('[data-akari-ui="panel:inspector"] .akari-inspector-selection-header')?.textContent?.trim() ?? null`);
        if(photoInspector?.includes('photo.png'))break;
        await sleep(200);
      }
      if(!photoInspector?.includes('photo.png')){await key('Escape','Escape',27);await sleep(150)}
    }
    const photoSelected=await pv(`document.querySelector('[data-overlay-id="photo-a"], [data-item-id="photo-a"], [data-akari-layer-id="photo-a"]')?.getAttribute('data-akari-interaction-selected') ?? null`);
    const photoTimelineSelected=await mw(`document.querySelector('.akari-annotations-selected')?.getAttribute('data-akari-ui') ?? null`);
    const box=initial.items['box-b'];await clickAt(vp({x:box.cx,y:box.cy}));
    const handle=await pv(`(() => { const e=[...document.querySelectorAll('.akari-interaction-handle.is-se')].find(n=>n.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2} })()`);
    let resize=null;
    if(handle){const before=(await itemRects(['box-b'])).items['box-b'];const m=mark();const p=vp(handle);
      await mouse('mouseMoved',p.x,p.y);await mouse('mousePressed',p.x,p.y);await sleep(80);
      for(let i=1;i<=4;i++){await mouse('mouseMoved',p.x+6*i,p.y+5*i,1);await sleep(60)}
      await mouse('mouseReleased',p.x+24,p.y+20);await sleep(1000);
      const after=(await itemRects(['box-b'])).items['box-b'];const writeEvents=changes(m);
      await undoOnce();resize={before,after,writeEvents,undo:(await readEditText())===headText()};
    }
    const shotName=await shot('regression');
    return {initial,photoHit,photoSelected,photoTimelineSelected,photoInspector,resize,shot:shotName};
  });
  await scenario('caption-live',async()=>{
    const rows=[];
    for(const [name,label] of [['caption-size','大きさ'],['caption-line-height','行間'],['caption-letter-spacing','字間']]){
      await seek(4);await selectCaptionAtCurrentTime();
      const selector='[data-akari-ui="field:inspector-'+name+'"]';
      const found=await mw(`(() => {const root=document.querySelector(${JSON.stringify(selector)});const input=root?.querySelector('input[type=range]')||[...document.querySelectorAll('input[type=range]')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label+' スライダー')});if(!input)return null;input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,value:input.value,min:input.min,max:input.max};})()`);
      if(!found){rows.push({name,error:'range absent'});continue}
      const style=()=>pv(`(() => {const h=[...document.querySelectorAll('.caption-row-plate')].find(e=>e.getClientRects().length);const e=h?.querySelector('.akari-caption__line');if(!e)return null;const s=getComputedStyle(e),r=e.getBoundingClientRect();return {fontSize:s.fontSize,lineHeight:s.lineHeight,letterSpacing:s.letterSpacing,width:r.width,height:r.height}})()`);
      const before=await style();const m=mark();const frac=(Number(found.value)-Number(found.min))/((Number(found.max)-Number(found.min))||1);
      const x=found.x+8+(found.w-16)*frac,y=found.y+found.h/2,target=found.x+found.w-10;
      await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y);await sleep(80);
      await mouse('mouseMoved',x+(target-x)*0.6,y,1);await sleep(350);
      const during=await style();const shotName=await shot('live-'+name);
      await mouse('mouseReleased',x+(target-x)*0.6,y);await sleep(900);
      const after=await style();const writeEvents=changes(m);
      await undoOnce();const undo=(await readCaptionsText())===run('/usr/bin/git',['show','HEAD:captions.json'],{cwd:project}).stdout;
      rows.push({name,before,during,after,shot:shotName,writeEvents,undo});await resetToHead();
    }
    return {rows};
  });
}
// ---- 起動 ----
const report = { label, port };
try {
  await mkdir(outDir, { recursive: true });
  await makeFixture();
  const osrFrame = path.join(outDir, `${label}-osr.png`);
  if (!process.argv.includes('--skip-osr') && !existsSync(osrFrame)) {
    const osrPath = path.join(scratch, 'osr.mp4');
    const osrRun = run(process.execPath, [path.join(repo, 'packages/osr-export/bin/akari-osr-export.mjs'),
      project, '--out', osrPath, '--duration', '1', '--frames', '30', '--width', '1920', '--height', '1080'],
      { timeout: 180000, env: { ...process.env, AKARI_EXPORT_ALLOW_DESKTOP: '0', TMPDIR: scratch } });
    report.osr = { status: osrRun.status, error: osrRun.status === 0 ? null : clean(osrRun.stderr).slice(-900) };
    if (osrRun.status === 0) {
      const extract = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.8', '-i', osrPath,
        '-frames:v', '1', osrFrame]);
      report.osr.frame = extract.status === 0 ? path.basename(osrFrame) : null;
    }
  }
  if (!process.argv.includes('--skip-osr') && existsSync(osrFrame)) report.osr = { status: 0, frame: path.basename(osrFrame),
    sha256: createHash('sha256').update(await readFile(osrFrame)).digest('hex') };
  if (!process.argv.includes('--osr-only')) {
  const profile = path.join(scratch, 'profile'), config = path.join(scratch, 'config'), home = path.join(scratch, 'akari-home');
  await Promise.all([mkdir(profile), mkdir(config), mkdir(home)]);
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`, '--hostname=127.0.0.1', `--port=${httpPort}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], { cwd: shellDir, env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: home }, stdio: 'ignore', detached: true });
  report.pid = child.pid;
  const isShell = v => v.type === 'page' && v.url && !v.url.startsWith('devtools:');
  const target = (await waitForJson(`http://127.0.0.1:${port}/json/list`, v => v.find(isShell))).find(isShell);
  main = new CDP(target.webSocketDebuggerUrl); await main.connect(); track(main); await main.send('Runtime.enable'); await main.send('Page.enable');
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, v => v.webSocketDebuggerUrl);
  browser = new CDP(version.webSocketDebuggerUrl); await browser.connect(); track(browser);
  await browser.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
  try { const { windowId } = await browser.send('Browser.getWindowForTarget', { targetId: target.id });
    await browser.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: 1680, height: 1000, windowState: 'normal' } }); } catch {}
  await sleep(10000);
  const clickOpenOnly = () => mw(`(() => { const b = [...document.querySelectorAll('button')].find(x => ['開くだけ', '後で'].includes(x.textContent?.trim())); if (b) b.click(); return !!b; })()`);
  const softCommand = (id, value, ms = 4000) => Promise.race([
    command(id, value).catch(e => ({ ok: false, error: String(e?.message ?? e) })),
    sleep(ms).then(() => ({ ok: false, error: 'pending' }))]);
  for (let i = 0; i < 60; i++) {
    await clickOpenOnly().catch(() => {});
    report.timelineOpen = await softCommand('akari.annotations.open');
    if (report.timelineOpen.ok) break;
    await sleep(2000);
  }
  await sleep(5000);
  const end = Date.now() + 180000;
  while (!view && Date.now() < end) {
    await clickOpenOnly().catch(() => {});
    const r = await softCommand('akari.preview.ensureVisible', { editUri });
    if (!r.ok && r.error !== 'pending') { await sleep(3000); continue; }
    await sleep(4000);
    view = await findPreview(15000);
  }
  if (!view) throw new Error('preview not found');
  for (let i = 0; i < 60; i++) { if (await pv(`Number(document.getElementById('seek')?.max || 0) >= 9`).catch(() => false)) break; await sleep(500); }
  report.inspectorOpen = await command('akari.inspector.open');
  await sleep(1500);
  await clickOpenOnly();
  for (let i=0;i<90;i++) { outer=await outerOffset(); if (outer && outer.h>250 && outer.w>350) break; await sleep(1000); }
  await seek(1);
  outer = await outerOffset();
  report.outer = outer;
  report.iframes = await mw(`([...document.querySelectorAll('iframe')].map(e=>({src:e.src.slice(0,100),rect:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}})))`);
  report.windowShot = await windowShot('window');
  startWatch();
  await scenarios();
  }
} catch (e) { report.error = clean(e?.stack ?? e); }
finally {
  clearInterval(watcher);
  main?.close(); browser?.close();
  if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} await sleep(2000); try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  // 別のプロセスグループへ抜けたバックエンド（この実行の一時ディレクトリを引数に持つものだけ）も止める
  for (const line of run('/bin/ps', ['-axo', 'pid=,command=']).stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (m && m[2].includes(scratch)) { try { process.kill(Number(m[1]), 'SIGKILL'); } catch {} }
  }
}
report.results = results;
report.allConsoleErrors = [...new Set(consoleErrors.map(clean))].slice(-25);
await writeFile(path.join(outDir, `${label}.json`), `${clean(JSON.stringify(report, null, 2))}\n`);
await rm(scratch, { recursive: true, force: true });
console.log(clean(JSON.stringify(report, null, 1)).slice(0, 12000));
