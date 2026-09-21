#!/usr/bin/env node
// L1 driver for preview-capture-frame (コマ保存). Raw CDP, modelled on
// ../preview-transport-polish-v1/run-l1.mjs (CDP helper + double-iframe piercing reused).
//
//   node run-l1.mjs <cdpPort> <workspaceDir> <outDir>
//
// Requires an apps/shell Electron already running with --remote-debugging-port on the
// fixture workspace (see run-l1.sh). The workspace must contain edit.json (LUT + captions).
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [, , portArg, wsArg, outArg] = process.argv;
const CDP_PORT = Number(portArg || 9431);
const WS = wsArg;
const OUT_DIR = outArg;
const FFMPEG = process.env.FFMPEG;
// fixture source is a flat 0xC07040 clip; decoded first frame (ffmpeg rgb24) = 192,111,63
const SOURCE = [192, 111, 63];
const log = [];
function record(step, data) { log.push({ t: new Date().toISOString(), step, ...data }); console.log(`[${step}]`, JSON.stringify(data)); }
class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(e));
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.listeners.get(msg.method) || []) h(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return res.json();
}

function withEvalTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`eval timeout (20s): ${label.slice(0, 140)}`)), 20000))
  ]);
}

async function evalIn(cdp, contextId, expression) {
  const params = { expression, returnByValue: true, awaitPromise: true };
  if (contextId != null) params.contextId = contextId;
  const r = await withEvalTimeout(cdp.send('Runtime.evaluate', params), expression);
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function realClick(cdp, x, y, opts = {}) {
  const clicks = opts.clickCount || 1;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  for (let count = 1; count <= clicks; count++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count });
    if (count < clicks) await sleep(60);
  }
}

async function realDrag(cdp, x0, y0, x1, y1, steps = 10) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
  await sleep(30);
  for (let i = 1; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = y0 + ((y1 - y0) * i) / steps;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' });
    await sleep(16);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 });
  await sleep(120);
}

async function screenshot(cdp, filePath, clip) {
  const params = { format: 'png' };
  if (clip) params.clip = clip;
  const { data } = await cdp.send('Page.captureScreenshot', params);
  await writeFile(filePath, Buffer.from(data, 'base64'));
  return filePath;
}

async function findOuterWebviewTarget(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await listTargets();
    const t = targets.find(x => x.type === 'iframe' && /webview\/index\.html/.test(x.url));
    if (t) return t;
    await sleep(1000);
  }
  return null;
}


function decodePng(file) {
  const probe = execFileSync(FFMPEG.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'json', file]).toString();
  const { width, height } = JSON.parse(probe).streams[0];
  const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 512 * 1024 * 1024 });
  return { width, height, px: (x, y) => { const i = (y * width + x) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; } };
}

function analyze(file, captionRectOut) {
  const img = decodePng(file);
  const { width: W, height: H } = img;
  const center = img.px(Math.floor(W / 2), Math.floor(H / 2));
  const diff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  // caption box in image px (from output-space rect), with an 8px margin for glyph AA / stroke
  const sx = W / captionRectOut.outW, sy = H / captionRectOut.outH;
  const cap = { x0: Math.floor(captionRectOut.x * sx) - 8, y0: Math.floor(captionRectOut.y * sy) - 8,
    x1: Math.ceil((captionRectOut.x + captionRectOut.w) * sx) + 8, y1: Math.ceil((captionRectOut.y + captionRectOut.h) * sy) + 8 };
  let bluish = 0, yellow = 0, capturePx = 0, outsideDeviating = 0, outsideTotal = 0, firstDeviating = null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = img.px(x, y);
    if (p[2] > p[0] + 30) bluish++; // selection frames / chips are blue; source, LUT result, caption and stroke are not
    const inCap = x >= cap.x0 && x < cap.x1 && y >= cap.y0 && y < cap.y1;
    if (inCap) { capturePx++; if (p[0] > 200 && p[1] > 200 && p[2] < 90) yellow++; }
    else { outsideTotal++; if (diff(p, center) > 12) { outsideDeviating++; if (!firstDeviating) firstDeviating = { x, y, p }; } }
  }
  return { file: path.basename(file), width: W, height: H, center, sourceColor: SOURCE,
    centerDiffersFromSource: diff(center, SOURCE) > 6, centerMaxChannelDiffFromSource: diff(center, SOURCE),
    captionBoxPx: cap, captionBoxPixels: capturePx, yellowPixelsInCaptionBox: yellow,
    bluishPixels: bluish, outsideCaptionPixels: outsideTotal, outsideCaptionDeviatingFromCenter: outsideDeviating, firstDeviating };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const results = {};
  const targets0 = await listTargets();
  const mainTarget = targets0.find(t => t.type === 'page');
  const main = new CDP(mainTarget.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Page.enable'); await main.send('Runtime.enable');
  const evalMain = expr => evalIn(main, undefined, expr);
  // Grow the (unmaximized, 1120x668) first-boot window to the screen so the stage can reach output size.
  results.window = await evalMain(`(async () => { window.moveTo(0, 0); window.resizeTo(screen.availWidth, screen.availHeight);
    await new Promise(r => setTimeout(r, 1500)); return { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, screen: [screen.availWidth, screen.availHeight] }; })()`);
  record('window', results.window);

  // open edit.json from the project panel card
  const findCard = () => evalMain(`(() => {
    let leafEl = null;
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length === 0 && /(^|· )edit\\.json$/.test((el.textContent || '').trim()) && el.getBoundingClientRect().width > 0) { leafEl = el; break; }
    }
    if (!leafEl) return { found: false };
    let a = leafEl, chosen = null;
    for (let i = 0; i < 8 && a; i += 1) { const b = a.getBoundingClientRect(); if (b.width >= 60 && b.height >= 36 && b.height <= 260) { chosen = a; break; } a = a.parentElement; }
    if (!chosen) chosen = leafEl.parentElement || leafEl;
    const r = chosen.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  let card = { found: false };
  for (let i = 0; i < 400 && !card.found; i += 1) { card = await findCard(); if (!card.found) await sleep(1000); }
  if (!card.found) throw new Error('edit.json card not found');
  let outerTarget = null;
  for (let attempt = 0; attempt < 4 && !outerTarget; attempt += 1) {
    await realClick(main, card.x, card.y);
    await sleep(3000);
    outerTarget = await findOuterWebviewTarget(attempt === 3 ? 90000 : 30000);
    if (!outerTarget) card = await findCard();
  }
  if (!outerTarget) throw new Error('outer webview target not found');
  const outer = new CDP(outerTarget.webSocketDebuggerUrl);
  await outer.connect();
  const contexts = [];
  outer.on('Runtime.executionContextCreated', p => contexts.push(p.context));
  await outer.send('Page.enable'); await outer.send('Runtime.enable');
  await sleep(1200);
  const frameTree = await outer.send('Page.getFrameTree');
  const topFrameId = frameTree.frameTree.frame.id;
  const activeCtx = contexts.find(c => c.auxData?.frameId !== topFrameId);
  if (!activeCtx) throw new Error('inner context not found');
  const evalActive = expr => evalIn(outer, activeCtx.id, expr);
  for (let i = 0; i < 60; i += 1) {
    if (await evalActive(`(() => { const s = document.getElementById('preview-stage'); return !!s && s.getBoundingClientRect().width > 10; })()`)) break;
    await sleep(500);
  }
  await sleep(5000);

  // inner-frame -> main-window coordinates (for real clicks and to locate the webview)
  const toMain = async (sel) => {
    const inner = await evalActive(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
      const r = e.getBoundingClientRect(); const f = window.frameElement.getBoundingClientRect();
      return { x: f.x + r.x + r.width / 2, y: f.y + r.y + r.height / 2, w: r.width, h: r.height }; })()`);
    if (!inner) return null;
    const o = await evalMain(`(() => { const f = Array.from(document.querySelectorAll('iframe.webview')).map(f => f.getBoundingClientRect()).filter(r => r.width > 200).sort((a,b)=>b.width*b.height-a.width*a.height)[0]; return { x: f.x, y: f.y }; })()`);
    return { x: o.x + inner.x, y: o.y + inner.y, w: inner.w, h: inner.h };
  };

  const state = () => evalActive(`(() => {
    const stage = document.getElementById('preview-stage');
    const r = stage.getBoundingClientRect();
    const zl = document.getElementById('zoom-layer');
    const btn = document.getElementById('akari-gen-capture-frame');
    const cap = document.getElementById('caption-plate');
    const lines = Array.from(document.querySelectorAll('#caption-plate .akari-caption__line')).map(e => e.getBoundingClientRect()).filter(b => b.width > 0);
    const cr = lines.length ? lines.reduce((a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }; })
      : (cap ? cap.getBoundingClientRect() : null);
    const out = window.__akariPreview?.summary?.output || null;
    const play = document.getElementById('play-toggle');
    const handles = Array.from(document.querySelectorAll('[data-akari-interaction], [data-akari-interaction-selected="true"], [data-selected]')).filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && getComputedStyle(e).visibility !== 'hidden'; }).length;
    const transport = document.querySelector('.transport');
    return {
      htmlClass: document.documentElement.className,
      stageRect: { x: r.x, y: r.y, w: r.width, h: r.height },
      zoomLayerTransform: zl ? getComputedStyle(zl).transform : null,
      zoomPressed: Array.from(document.querySelectorAll('.zoom-preset')).filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.zoom),
      output: out,
      captionText: cap ? (cap.querySelector('.akari-caption__line') || cap).textContent : null,
      captionSelected: cap ? cap.hasAttribute('data-selected') : null,
      captionRectInStage: cr ? { x: cr.x - r.x, y: cr.y - r.y, w: cr.width, h: cr.height } : null,
      button: btn ? { title: btn.title, aria: btn.getAttribute('aria-label'), disabled: btn.disabled, parentClass: btn.parentElement.className,
        w: btn.getBoundingClientRect().width, h: btn.getBoundingClientRect().height, hasSvg: !!btn.querySelector('svg'), text: btn.textContent.trim() } : null,
      playLabel: play ? play.getAttribute('aria-label') : null,
      visibleInteractionHandles: handles,
      genVisible: Array.from(document.querySelectorAll('[id^="akari-gen-"]')).filter(e => e.id !== 'akari-gen-capture-frame' && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none').map(e => e.id + ':' + (e.textContent || '').trim().slice(0, 30)),
      captionSelectionChrome: Array.from(document.querySelectorAll('*')).filter(e => e.children.length === 0 && /この字幕だけ動く|はみ出し防止/.test(e.textContent || '') && e.getBoundingClientRect().width > 0).length,
      transportVisibility: transport ? getComputedStyle(transport).visibility : null,
      dpr: devicePixelRatio
    };
  })()`);

  // flicker probe: count animation frames while the capture class is on <html>
  await evalActive(`(() => {
    window.__pcf = { spans: [] };
    let on = null, frames = 0;
    const loop = () => { if (on) frames++; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    new MutationObserver(() => {
      const c = document.documentElement.classList.contains('akari-gen-capturing');
      if (c && !on) { on = performance.now(); frames = 0;
        const cap = document.getElementById('caption-plate');
        const chain = []; for (let e = cap; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); chain.push((e.id || e.tagName) + ':' + cs.visibility + '/' + cs.display + '/' + cs.opacity); }
        window.__pcf.captionAtCapture = window.__pcf.captionAtCapture || [];
        const rec = { text: cap ? (cap.querySelector('.akari-caption__line') || cap).textContent.length : null, lineVis: Array.from(document.querySelectorAll('#caption-plate .akari-caption__line')).map(l => getComputedStyle(l).visibility),
          lineDeep: Array.from(document.querySelectorAll('#caption-plate, #caption-plate *')).map(e => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return (e.className || e.tagName).toString().slice(0, 30) + ' op=' + cs.opacity + ' anim=' + cs.animationName + ' tr=' + cs.transform.slice(0, 30) + ' clip=' + cs.clipPath + ' color=' + cs.color + ' r=' + Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.width) + 'x' + Math.round(r.height); }).slice(0, 8),
          canvasZ: (() => { const c = document.getElementById('frame-engine-preview'); return c ? getComputedStyle(c).zIndex + '/' + getComputedStyle(document.getElementById('preview-layers')).zIndex : null; })(), chain, fit: document.documentElement.classList.contains('akari-gen-capture-fit') }; window.__pcf.captionAtCapture.push(rec);
        requestAnimationFrame(() => { rec.nextFrame = Array.from(document.querySelectorAll('#caption-plate *')).map(e => getComputedStyle(e).opacity + '/' + getComputedStyle(e).animationName).slice(0, 6); }); }
      else if (!c && on) { window.__pcf.spans.push({ ms: performance.now() - on, frames, fit: false }); on = null; }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return true;
  })()`);

  const toastTexts = () => evalMain(`Array.from(document.querySelectorAll('.theia-notification-message, .theia-notification-list-item')).map(e => e.textContent.trim()).filter(Boolean)`);
  const listCaptures = async () => { try { return (await readdir(path.join(WS, 'assets/captures'))).sort(); } catch { return []; } };

  const shoot = async (label) => {
    const before = await state();
    const beforeFiles = await listCaptures();
    const btn = await toMain('#akari-gen-capture-frame');
    const t0 = Date.now();
    await evalActive(`(() => { const l = window.__pcf.spans.length; window.__pcf.mark = l; return true; })()`);
    await realClick(main, btn.x, btn.y);
    let files = beforeFiles, toast = [];
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      files = await listCaptures();
      toast = await toastTexts();
      if (files.length > beforeFiles.length && toast.some(t => /コマを保存/.test(t))) break;
    }
    const elapsedMs = Date.now() - t0;
    await sleep(600);
    const after = await state();
    const added = files.filter(f => !beforeFiles.includes(f));
    const spans = await evalActive('window.__pcf.spans.slice()');
    const shot = await screenshot(main, path.join(OUT_DIR, `${label}-window.png`));
    const entry = { label, before, after, added, toast, elapsedMs, lastCaptureSpan: spans[spans.length - 1] || null, windowScreenshot: path.basename(shot) };
    record(label, { added, toast, elapsedMs, span: entry.lastCaptureSpan, restoredZoom: before.zoomLayerTransform === after.zoomLayerTransform, htmlClassAfter: after.htmlClass });
    return entry;
  };

  const initial = await state();
  results.initial = initial;
  record('initial', initial);

  // 1) select the clip on the timeline strip (selection handles in the preview), capture at 200 % zoom
  const clip = await evalMain(`(() => { const e = document.querySelector('.akari-annotations-strip-clip'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + Math.min(20, r.width / 2), y: r.y + r.height / 2 }; })()`);
  if (clip) { await realClick(main, clip.x, clip.y); await sleep(1000); }
  results.maximized = await state();
  record('after-timeline-select', { clip, handles: results.maximized.visibleInteractionHandles, stage: results.maximized.stageRect });
  const unzoomed = results.maximized;
  await evalActive(`(() => { document.getElementById('zoom-toggle').click(); const b = document.querySelector('.zoom-preset[data-zoom="2"]'); b.click(); document.getElementById('zoom-toggle').click(); return true; })()`);
  await sleep(1200);
  const shot1 = await shoot('01-zoom200-selected-paused');
  // 2) same time again -> "-2"
  const shot2 = await shoot('02-same-time-again');
  // 3) back to 100 %, play, capture while playing
  await evalActive(`(() => { document.getElementById('zoom-toggle').click(); document.querySelector('.zoom-preset[data-zoom="1"]').click(); document.getElementById('zoom-toggle').click(); return true; })()`);
  await sleep(800);
  // 3b) select the caption (click its line) and capture: the selection outline must not be captured
  const capLine = await toMain('#caption-plate .akari-caption__line');
  if (capLine) { await realClick(main, capLine.x, capLine.y); await sleep(800); }
  const shot4 = await shoot('04-caption-selected');
  await evalActive(`document.getElementById('play-toggle').click(), true`);
  await sleep(1500);
  const playingBefore = (await state()).playLabel;
  const shot3 = await shoot('03-while-playing');
  await sleep(700);
  const playingAfter = (await state()).playLabel;
  await evalActive(`document.getElementById('play-toggle').click(), true`);
  results.shots = [shot1, shot2, shot4, shot3];
  results.playing = { labelBeforeCapture: playingBefore, labelAfterCapture: playingAfter };

  // project panel: does the png show up?
  await sleep(2500);
  results.projectPanel = await evalMain(`Array.from(document.querySelectorAll('*')).filter(e => e.children.length === 0 && /frame-\\d\\dm\\d\\ds\\d{3}/.test(e.textContent || '') && e.getBoundingClientRect().width > 0).map(e => e.textContent.trim()).slice(0, 10)`);
  await screenshot(main, path.join(OUT_DIR, '05-project-panel.png'));

  // pixel analysis of every saved png
  const out = initial.output;
  results.analysis = [];
  for (const shot of results.shots) {
    for (const f of shot.added) {
      const cr = shot.before.captionRectInStage; const sr = shot.before.stageRect;
      // captionRect is measured in the pre-capture layout; normalise to output space via stage size
      const rectOut = { x: cr.x / sr.w * out.width, y: cr.y / sr.h * out.height, w: cr.w / sr.w * out.width, h: cr.h / sr.h * out.height, outW: out.width, outH: out.height };
      if (shot.label.startsWith('01') || shot.label.startsWith('02')) {
        // at 200 % the stage is clipped; the caption box is taken from the 100 % layout instead
        const ir = unzoomed.captionRectInStage, is = unzoomed.stageRect;
        Object.assign(rectOut, { x: ir.x / is.w * out.width, y: ir.y / is.h * out.height, w: ir.w / is.w * out.width, h: ir.h / is.h * out.height });
      }
      const a = analyze(path.join(WS, 'assets/captures', f), rectOut);
      await copyFile(path.join(WS, 'assets/captures', f), path.join(OUT_DIR, `${shot.label}--${f}`));
      results.analysis.push({ shot: shot.label, ...a });
      record('analysis', a);
    }
  }
  results.captionAtCapture = await evalActive('window.__pcf.captionAtCapture');
  results.metaJsonInCaptures = (await listCaptures()).includes('meta.json');
  await writeFile(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
  await writeFile(path.join(OUT_DIR, 'log.json'), JSON.stringify(log, null, 2));
  main.close(); outer.close();
}

main().catch(async e => { console.error('FAILED', e); try { await writeFile(path.join(OUT_DIR, 'log.json'), JSON.stringify(log, null, 2)); } catch {} process.exit(1); });
