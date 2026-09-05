#!/usr/bin/env node
// L1 driver for the preview stage / transport polish round.
// Dependency-free raw CDP (Node built-in fetch + WebSocket), modelled on
// ../preview-transport-zoom/run-transport-zoom-e2e.mjs (double-iframe piercing
// technique reused verbatim).
//
//   node run-l1.mjs <cdpPort> <label> <fixtureKey> <openTarget> <outDir>
//
//     label      before | after
//     fixtureKey 16x9 | 9x16 | look | raw
//     openTarget tree row label to double-click (edit.json / base-black.mp4)
//
// Requires an already-running apps/shell Electron with --remote-debugging-port
// opened on the fixture workspace.

import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const [, , cdpPortArg, labelArg, fixtureArg, openTargetArg, outDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg || 9333);
const LABEL = labelArg || 'before';
const FIXTURE = fixtureArg || '16x9';
const OPEN_TARGET = openTargetArg || 'edit.json';
const OUT_DIR = outDirArg || '/tmp/akari-ptp/out';

const WINDOW_W = 1440;
const WINDOW_H = 900;

const log = [];
function record(step, data) {
  const entry = { t: new Date().toISOString(), step, ...data };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}

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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const results = { label: LABEL, fixture: FIXTURE, window: { width: WINDOW_W, height: WINDOW_H } };

  const targets0 = await listTargets();
  const mainTarget = targets0.find(t => t.type === 'page');
  if (!mainTarget) throw new Error('main page target not found');
  const main = new CDP(mainTarget.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Page.enable');
  await main.send('Runtime.enable');
  await main.send('DOM.enable');

  // Fixed 1440x900 viewport for every run so BEFORE/AFTER pixels are comparable.
  // Electron does not implement Browser.setWindowBounds, so the frontend page is
  // pinned with Emulation.setDeviceMetricsOverride instead (layout px identical;
  // the webview OOPIF is laid out inside the emulated page).
  await main.send('Emulation.setDeviceMetricsOverride', {
    width: WINDOW_W, height: WINDOW_H, deviceScaleFactor: 1, mobile: false
  });
  await sleep(1500);
  const evalMain = (expr) => evalIn(main, undefined, expr);
  results.windowActual = await evalMain('({ w: window.innerWidth, h: window.innerHeight, dpr: devicePixelRatio })');
  record('window', results.windowActual);

  // ---- open the target from the AKARI project panel (card grid, not a Theia tree) ----
  await sleep(3000);
  const leaf = OPEN_TARGET.split('/').pop();
  const needle = leaf === 'edit.json' ? 'edit\\.json' : leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 8);
  const findCard = () => evalMain(`(() => {
    const re = new RegExp(${JSON.stringify(needle)});
    let leafEl = null;
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length === 0 && re.test(el.textContent || '')
        && el.getBoundingClientRect().width > 0) { leafEl = el; break; }
    }
    if (!leafEl) return { found: false };
    let a = leafEl, chosen = null;
    for (let i = 0; i < 8 && a; i += 1) {
      const b = a.getBoundingClientRect();
      if (b.width >= 60 && b.height >= 36 && b.height <= 260) { chosen = a; break; }
      a = a.parentElement;
    }
    if (!chosen) chosen = leafEl.parentElement || leafEl;
    const r = chosen.getBoundingClientRect();
    a = chosen;
    return { found: true, text: a.textContent.trim().slice(0, 60),
      x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })()`);
  const previewTabOpen = () => evalMain(`Array.from(document.querySelectorAll(
    '.lm-TabBar-tabLabel, .p-TabBar-tabLabel')).some(e => /出力プレビュー|${leaf.replace(/\./g, '\\\\.')}/.test(e.textContent))`);
  // a cold first boot of the shell takes ~140 s to reach 'ready'
  let card = { found: false };
  for (let i = 0; i < 400 && !card.found; i += 1) { card = await findCard(); if (!card.found) await sleep(1000); }
  if (!card.found) throw new Error(`project-panel card for "${leaf}" not found`);
  let outerTarget = null;
  for (let attempt = 0; attempt < 4 && !outerTarget; attempt += 1) {
    await realClick(main, card.x, card.y, { clickCount: leaf === 'edit.json' ? 1 : 2 });
    await sleep(3000);
    record('opened-attempt', { leaf, attempt, card, tab: await previewTabOpen() });
    outerTarget = await findOuterWebviewTarget(attempt === 3 ? 90000 : 30000);
    if (!outerTarget) card = await findCard();
  }
  record('opened', { leaf, card });

  // ---- reach the inner webview context ----
  if (!outerTarget) throw new Error('outer webview CDP target not found');
  const outer = new CDP(outerTarget.webSocketDebuggerUrl);
  await outer.connect();
  const contexts = [];
  outer.on('Runtime.executionContextCreated', (p) => contexts.push(p.context));
  await outer.send('Page.enable');
  await outer.send('Runtime.enable');
  await sleep(1200);
  const frameTree = await outer.send('Page.getFrameTree');
  const topFrameId = frameTree.frameTree.frame.id;
  const activeCtx = contexts.find(c => c.auxData?.frameId !== topFrameId);
  if (!activeCtx) throw new Error('inner active-frame execution context not found');
  const evalActive = (expr) => evalIn(outer, activeCtx.id, expr);

  // wait until the stage has a real size
  for (let i = 0; i < 60; i += 1) {
    const ok = await evalActive(`(() => {
      const s = document.getElementById('preview-stage');
      return !!s && s.getBoundingClientRect().width > 10;
    })()`);
    if (ok) break;
    await sleep(500);
  }
  await sleep(3500); // let the frame engine / overlays settle

  // where does the webview iframe sit inside the main window? (for 2x crops)
  const iframeOffset = await evalMain(`(() => {
    const frames = Array.from(document.querySelectorAll('iframe'));
    const visible = frames.map(f => ({ f, r: f.getBoundingClientRect() }))
      .filter(x => x.r.width > 200 && x.r.height > 200)
      .sort((a, b) => (b.r.width * b.r.height) - (a.r.width * a.r.height))[0];
    if (!visible) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: visible.r.left, y: visible.r.top, w: visible.r.width, h: visible.r.height };
  })()`);
  results.iframeOffset = iframeOffset;

  const RECT = `r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height })`;

  // =====================================================================
  // A. stage / pane / drawing surface geometry
  // =====================================================================
  const geometry = await evalActive(`(() => {
    const rect = ${RECT};
    const pane = document.querySelector('.preview-pane');
    const wrapper = document.getElementById('preview-wrapper');
    const zoomLayer = document.getElementById('zoom-layer');
    const stage = document.getElementById('preview-stage');
    const canvas = document.getElementById('frame-engine-canvas');
    const video = document.getElementById('preview-video');
    const cs = getComputedStyle(pane);
    const pad = {
      top: parseFloat(cs.paddingTop), right: parseFloat(cs.paddingRight),
      bottom: parseFloat(cs.paddingBottom), left: parseFloat(cs.paddingLeft)
    };
    const pr = pane.getBoundingClientRect();
    const border = {
      top: parseFloat(cs.borderTopWidth), right: parseFloat(cs.borderRightWidth),
      bottom: parseFloat(cs.borderBottomWidth), left: parseFloat(cs.borderLeftWidth)
    };
    const content = {
      left: pr.left + border.left + pad.left, top: pr.top + border.top + pad.top,
      right: pr.right - border.right - pad.right, bottom: pr.bottom - border.bottom - pad.bottom
    };
    content.width = content.right - content.left;
    content.height = content.bottom - content.top;
    const paddingBox = {
      left: pr.left + border.left, top: pr.top + border.top,
      right: pr.right - border.right, bottom: pr.bottom - border.bottom
    };
    paddingBox.width = paddingBox.right - paddingBox.left;
    paddingBox.height = paddingBox.bottom - paddingBox.top;
    const surfaceEl = (canvas && canvas.getBoundingClientRect().width > 1) ? canvas : video;
    return {
      panePadding: pad, paneBorder: border,
      paneRect: rect(pr), paneContent: content, panePaddingBox: paddingBox,
      paneClient: { width: pane.clientWidth, height: pane.clientHeight },
      wrapperRect: rect(wrapper.getBoundingClientRect()),
      zoomLayerRect: rect(zoomLayer.getBoundingClientRect()),
      stageRect: rect(stage.getBoundingClientRect()),
      stageOffset: { width: stage.offsetWidth, height: stage.offsetHeight },
      surfaceId: surfaceEl ? surfaceEl.id : null,
      surfaceRect: surfaceEl ? rect(surfaceEl.getBoundingClientRect()) : null,
      frameEngineActive: document.getElementById('preview-stage').dataset.frameEngineActive === 'true',
      summaryOutput: (window.__akariPreview && window.__akariPreview.summary
        && window.__akariPreview.summary.output) || null,
      declaredIndicators: (window.__akariPreview && window.__akariPreview.summary
        && window.__akariPreview.summary.indicators) || null
    };
  })()`);
  results.geometry = geometry;

  {
    const g = geometry;
    const outAspect = g.summaryOutput && g.summaryOutput.width && g.summaryOutput.height
      ? g.summaryOutput.width / g.summaryOutput.height : null;
    const paneAspect = g.paneContent.width / g.paneContent.height;
    const constrained = outAspect != null && paneAspect > outAspect ? 'height' : 'width';
    const fit = {
      constrainedAxis: constrained,
      stageTopMinusContentTop: g.stageRect.top - g.paneContent.top,
      stageBottomMinusContentBottom: g.stageRect.bottom - g.paneContent.bottom,
      stageLeftMinusContentLeft: g.stageRect.left - g.paneContent.left,
      stageRightMinusContentRight: g.stageRect.right - g.paneContent.right,
      surfaceMinusStage: g.surfaceRect ? {
        left: g.surfaceRect.left - g.stageRect.left,
        top: g.surfaceRect.top - g.stageRect.top,
        right: g.surfaceRect.right - g.stageRect.right,
        bottom: g.surfaceRect.bottom - g.stageRect.bottom
      } : null
    };
    fit.constrainedTouchesWithin1px = constrained === 'height'
      ? Math.abs(fit.stageTopMinusContentTop) <= 1 && Math.abs(fit.stageBottomMinusContentBottom) <= 1
      : Math.abs(fit.stageLeftMinusContentLeft) <= 1 && Math.abs(fit.stageRightMinusContentRight) <= 1;
    fit.surfaceMatchesStageWithin1px = fit.surfaceMinusStage
      ? Object.values(fit.surfaceMinusStage).every(v => Math.abs(v) <= 1) : false;
    results.fit = fit;
    record('fit', fit);
  }

  // =====================================================================
  // B. transport metrics + computed styles
  // =====================================================================
  const transport = await evalActive(`(() => {
    const rect = ${RECT};
    const t = document.querySelector('.transport');
    const seekRow = document.querySelector('.transport-seek');
    const controls = document.querySelector('.transport-controls');
    const waveRow = document.querySelector('.transport-waveform');
    const seek = document.getElementById('seek');
    const stage = document.getElementById('preview-stage');
    const ts = getComputedStyle(t);
    const seekRect = seek.getBoundingClientRect();
    // the visual track sits vertically centred inside the input's box
    const seekCs = getComputedStyle(seek);
    return {
      transportRect: rect(t.getBoundingClientRect()),
      transportHeight: t.getBoundingClientRect().height,
      transportPadding: ts.padding,
      transportGap: ts.gap,
      transportBorderTop: ts.borderTopWidth + ' ' + ts.borderTopStyle + ' ' + ts.borderTopColor,
      transportBackground: ts.backgroundColor,
      seekRowRect: rect(seekRow.getBoundingClientRect()),
      seekRect: rect(seekRect),
      seekHeight: seekRect.height,
      seekAppearance: seekCs.appearance || seekCs.webkitAppearance,
      controlsRect: rect(controls.getBoundingClientRect()),
      controlsHeight: controls.getBoundingClientRect().height,
      waveformHidden: waveRow.hidden,
      waveformRect: rect(waveRow.getBoundingClientRect()),
      stageBottom: stage.getBoundingClientRect().bottom,
      paneBottom: document.querySelector('.preview-pane').getBoundingClientRect().bottom
    };
  })()`);
  results.transport = transport;

  // seek track geometry: the rendered range track is a pseudo element, so read
  // its height from getComputedStyle(el, '::-webkit-slider-runnable-track') and
  // place it vertically centred inside the input's content box.
  const seekTrack = await evalActive(`(() => {
    const seek = document.getElementById('seek');
    const r = seek.getBoundingClientRect();
    const cs = getComputedStyle(seek);
    const tcs = getComputedStyle(seek, '::-webkit-slider-runnable-track');
    const thumb = getComputedStyle(seek, '::-webkit-slider-thumb');
    const authoredTrackHeight = (() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules; try { rules = Array.from(sheet.cssRules); } catch { continue; }
        for (const rule of rules) {
          if (rule.selectorText && /-webkit-slider-runnable-track/.test(rule.selectorText)
            && !/:hover/.test(rule.selectorText) && rule.style && rule.style.height) {
            return parseFloat(rule.style.height);
          }
        }
      }
      return null;
    })();
    const trackHeight = authoredTrackHeight != null ? authoredTrackHeight : parseFloat(tcs.height);
    const contentTop = r.top + parseFloat(cs.borderTopWidth || '0') + parseFloat(cs.paddingTop || '0');
    const contentHeight = r.height - parseFloat(cs.borderTopWidth || '0') - parseFloat(cs.borderBottomWidth || '0')
      - parseFloat(cs.paddingTop || '0') - parseFloat(cs.paddingBottom || '0');
    return {
      inputTop: r.top, inputHeight: r.height,
      authoredTrackHeight, trackHeight, trackBackground: tcs.backgroundImage !== 'none' ? tcs.backgroundImage : tcs.backgroundColor,
      trackBorderRadius: tcs.borderRadius,
      thumb: { width: thumb.width, height: thumb.height, background: thumb.backgroundColor,
        borderRadius: thumb.borderRadius, boxShadow: thumb.boxShadow, appearance: thumb.appearance },
      trackTop: Number.isFinite(trackHeight)
        ? contentTop + Math.max(0, (contentHeight - trackHeight) / 2) : r.top
    };
  })()`);
  results.seekTrack = seekTrack;

  // gap: stage bottom -> top of the seek control box (and of the visual track)
  results.gap = {
    stageBottomToSeekInputTop: transport.seekRect.top - transport.stageBottom,
    stageBottomToSeekTrackTop: seekTrack.trackTop - transport.stageBottom,
    stageBottomToSeekRowTop: transport.seekRowRect.top - transport.stageBottom,
    stageBottomToTransportTop: transport.transportRect.top - transport.stageBottom,
    paneBottomToTransportTop: transport.transportRect.top - transport.paneBottom
  };
  record('transport', { height: transport.transportHeight, gap: results.gap });

  // ---- screenshot 01/02: whole window with the transport visible ----
  const shotName = FIXTURE === '16x9' ? '01-transport-16x9'
    : FIXTURE === '9x16' ? '02-transport-9x16'
      : FIXTURE === 'look' ? '05-indicator-badge' : `00-${FIXTURE}`;
  results.screenshots = {};
  results.screenshots[shotName] = await screenshot(main, path.join(OUT_DIR, `${LABEL}-${shotName}.png`));
  // 2x crop of the transport region
  {
    const clip = {
      x: iframeOffset.x + transport.transportRect.left,
      y: iframeOffset.y + transport.transportRect.top - 8,
      width: Math.min(transport.transportRect.width, WINDOW_W - iframeOffset.x),
      height: transport.transportRect.height + 12,
      scale: 2
    };
    results.screenshots[`${shotName}-crop2x`] =
      await screenshot(main, path.join(OUT_DIR, `${LABEL}-${shotName}-crop2x.png`), clip);
    results.transportCropClip = clip;
  }

  // =====================================================================
  // C. computed styles after a real mouse grab of the seek thumb
  // =====================================================================
  {
    const sx = transport.seekRect.left + transport.seekRect.width * 0.5;
    const sy = transport.seekRect.top + transport.seekRect.height / 2;
    await outer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx, y: sy, button: 'none' });
    await outer.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
    await sleep(400);
    const seekShot = FIXTURE === '16x9' ? '04-seek-grabbed' : `04-seek-grabbed-${FIXTURE}`;
    results.screenshots[seekShot] =
      await screenshot(main, path.join(OUT_DIR, `${LABEL}-${seekShot}.png`));
    {
      const clip = {
        x: iframeOffset.x + transport.seekRowRect.left,
        y: iframeOffset.y + transport.seekRowRect.top - 10,
        width: Math.min(transport.seekRowRect.width, WINDOW_W - iframeOffset.x),
        height: transport.seekRowRect.height + 20,
        scale: 2
      };
      results.screenshots[`${seekShot}-crop2x`] =
        await screenshot(main, path.join(OUT_DIR, `${LABEL}-${seekShot}-crop2x.png`), clip);
    }
    results.seekGrabbedStyles = await evalActive(`(() => {
      const seek = document.getElementById('seek');
      const cs = getComputedStyle(seek);
      return {
        isActiveElement: document.activeElement === seek,
        matchesFocus: seek.matches(':focus'),
        matchesFocusVisible: (() => { try { return seek.matches(':focus-visible'); } catch { return null; } })(),
        appearance: cs.appearance || cs.webkitAppearance,
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        outlineColor: cs.outlineColor,
        boxShadow: cs.boxShadow,
        height: cs.height
      };
    })()`);
    await outer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx, y: sy, button: 'left', clickCount: 1 });
    await sleep(200);
    record('seek-grabbed', results.seekGrabbedStyles);
  }

  // press the waveform toggle so we can read a pressed icon-button and the wave row
  results.styles = await (async () => {
    const btn = await evalActive(`(() => {
      const b = document.getElementById('waveform-toggle');
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, pressed: b.getAttribute('aria-pressed') };
    })()`);
    await realClick(outer, btn.x, btn.y);
    await sleep(900);
    const pressed = await evalActive(`(() => {
      const rect = ${RECT};
      const b = document.getElementById('waveform-toggle');
      const cs = getComputedStyle(b);
      const wave = document.querySelector('.transport-waveform');
      const wcs = getComputedStyle(wave);
      return {
        pressedAttr: b.getAttribute('aria-pressed'),
        pressedBorderStyle: cs.borderTopStyle,
        pressedBoxShadow: cs.boxShadow,
        pressedBackground: cs.backgroundColor,
        pressedColor: cs.color,
        waveformHidden: wave.hidden,
        waveformRect: rect(wave.getBoundingClientRect()),
        waveformBackground: wcs.backgroundColor,
        transportHeightWithWaveform: document.querySelector('.transport').getBoundingClientRect().height
      };
    })()`);
    // move the pointer off the button so :hover does not mask [aria-pressed]
    await realClick(outer, btn.x, btn.y);
    await sleep(300);
    await realClick(outer, btn.x, btn.y);          // pressed again
    await sleep(300);
    await outer.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: btn.x, y: btn.y + 200, button: 'none' });
    await sleep(400);
    const pressedNoHover = await evalActive(`(() => {
      const b = document.getElementById('waveform-toggle');
      const cs = getComputedStyle(b);
      return { pressedAttr: b.getAttribute('aria-pressed'), hovered: b.matches(':hover'),
        backgroundColor: cs.backgroundColor, color: cs.color, boxShadow: cs.boxShadow,
        borderTopStyle: cs.borderTopStyle };
    })()`);
    await realClick(outer, btn.x, btn.y);          // back to unpressed
    await sleep(600);
    const rest = await evalActive(`(() => {
      const g = id => { const e = document.getElementById(id); if (!e) return null; const cs = getComputedStyle(e); return {
        borderTopStyle: cs.borderTopStyle, borderTopWidth: cs.borderTopWidth,
        backgroundColor: cs.backgroundColor, boxShadow: cs.boxShadow, color: cs.color,
        width: cs.width, height: cs.height, borderRadius: cs.borderRadius }; };
      const q = sel => { const e = document.querySelector(sel); if (!e) return null; const cs = getComputedStyle(e); return {
        borderTopStyle: cs.borderTopStyle, borderTopWidth: cs.borderTopWidth,
        backgroundColor: cs.backgroundColor, boxShadow: cs.boxShadow, color: cs.color,
        width: cs.width, height: cs.height, borderRadius: cs.borderRadius }; };
      const rootStyle = getComputedStyle(document.documentElement);
      const tcs = getComputedStyle(document.querySelector('.transport'));
      const seekCs = getComputedStyle(document.getElementById('seek'));
      const timeCs = getComputedStyle(document.getElementById('time-label'));
      return {
        tokens: {
          accent: rootStyle.getPropertyValue('--akari-accent').trim(),
          transportBg: rootStyle.getPropertyValue('--akari-transport-bg').trim(),
          transportFg: rootStyle.getPropertyValue('--akari-transport-fg').trim(),
          seekTrack: rootStyle.getPropertyValue('--akari-seek-track').trim(),
          pasteboard: rootStyle.getPropertyValue('--akari-preview-pasteboard').trim()
        },
        bodyClass: document.body.className,
        transportBackground: tcs.backgroundColor,
        transportBorderTop: tcs.borderTopWidth + ' ' + tcs.borderTopStyle,
        transportPadding: tcs.padding,
        transportGap: tcs.gap,
        seek: {
          appearance: seekCs.appearance || seekCs.webkitAppearance,
          outlineStyle: seekCs.outlineStyle, boxShadow: seekCs.boxShadow,
          height: seekCs.height, seekProgress: document.getElementById('seek').style.getPropertyValue('--seek-progress')
        },
        timeLabel: { fontSize: timeCs.fontSize, color: timeCs.color, fontVariantNumeric: timeCs.fontVariantNumeric },
        playToggle: g('play-toggle'),
        waveformToggle: g('waveform-toggle'),
        zoomToggle: g('zoom-toggle'),
        zoomPreset: q('.zoom-preset'),
        ratePreset: q('.rate-preset'),
        zoomPopup: q('.zoom-popup')
      };
    })()`);
    return { pressed, pressedNoHover, ...rest };
  })();
  record('styles', { transportBackground: results.styles.transportBackground, tokens: results.styles.tokens });

  // =====================================================================
  // D. minimap sweep (16x9 / 9x16 only)
  // =====================================================================
  if (FIXTURE === '16x9' || FIXTURE === '9x16') {
    const setZoomViaSlider = (z) => evalActive(`(() => {
      const s = document.getElementById('zoom-slider');
      const logMin = Math.log2(0.25), logMax = Math.log2(8);
      s.value = String((Math.log2(${z}) - logMin) / (logMax - logMin));
      s.dispatchEvent(new Event('input', { bubbles: true }));
      return s.value;
    })()`);
    const readMinimap = () => evalActive(`(() => {
      const rect = ${RECT};
      const pane = document.querySelector('.preview-pane');
      const stage = document.getElementById('preview-stage');
      const mini = document.getElementById('zoom-minimap');
      const vp = document.getElementById('zoom-minimap-viewport');
      const cs = getComputedStyle(pane);
      const pr = pane.getBoundingClientRect();
      const pad = { t: parseFloat(cs.paddingTop), r: parseFloat(cs.paddingRight),
        b: parseFloat(cs.paddingBottom), l: parseFloat(cs.paddingLeft) };
      const clip = { left: pr.left, top: pr.top, right: pr.right, bottom: pr.bottom };
      const content = { left: pr.left + pad.l, top: pr.top + pad.t,
        right: pr.right - pad.r, bottom: pr.bottom - pad.b };
      const sr = stage.getBoundingClientRect();
      const inter = (box) => {
        const l = Math.max(box.left, sr.left), t = Math.max(box.top, sr.top);
        const r = Math.min(box.right, sr.right), b = Math.min(box.bottom, sr.bottom);
        return {
          left: (Math.max(l, sr.left) - sr.left) / sr.width,
          top: (Math.max(t, sr.top) - sr.top) / sr.height,
          width: Math.max(0, r - l) / sr.width,
          height: Math.max(0, b - t) / sr.height
        };
      };
      const mr = mini.getBoundingClientRect();
      const mcs = getComputedStyle(mini);
      const inner = {
        width: mr.width - parseFloat(mcs.borderLeftWidth) - parseFloat(mcs.borderRightWidth),
        height: mr.height - parseFloat(mcs.borderTopWidth) - parseFloat(mcs.borderBottomWidth)
      };
      const vr = vp.getBoundingClientRect();
      return {
        hidden: mini.hidden,
        minimapRect: rect(mr),
        minimapBorder: { top: mcs.borderTopWidth, left: mcs.borderLeftWidth },
        minimapInner: inner,
        minimapBoxAspect: mr.width / mr.height,
        minimapInnerAspect: inner.width / inner.height,
        viewportRect: rect(vr),
        // fraction of the *drawn* minimap box that the white frame occupies
        actualViewport: {
          left: (vr.left - mr.left) / mr.width,
          top: (vr.top - mr.top) / mr.height,
          width: vr.width / mr.width,
          height: vr.height / mr.height
        },
        expectedPaddingBox: inter(clip),
        expectedContentBox: inter(content),
        stageRect: rect(sr),
        paneRect: rect(pr),
        zoomLayerTransform: getComputedStyle(document.getElementById('zoom-layer')).transform,
        summaryOutput: (window.__akariPreview && window.__akariPreview.summary
          && window.__akariPreview.summary.output) || null
      };
    })()`);

    const paneCenter = await evalActive(`(() => {
      const r = document.querySelector('.preview-pane').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);

    const samples = [];
    for (const z of [1.5, 2, 4]) {
      for (const pos of ['center', 'top-left', 'bottom-right']) {
        await setZoomViaSlider(1); // reset pan
        await sleep(250);
        await setZoomViaSlider(z);
        await sleep(400);
        if (pos === 'top-left') {
          await realDrag(outer, paneCenter.x - 250, paneCenter.y - 200, paneCenter.x + 1200, paneCenter.y + 1200);
        } else if (pos === 'bottom-right') {
          await realDrag(outer, paneCenter.x + 250, paneCenter.y + 200, paneCenter.x - 1200, paneCenter.y - 1200);
        }
        await sleep(400);
        const m = await readMinimap();
        const outAspect = m.summaryOutput ? m.summaryOutput.width / m.summaryOutput.height : null;
        const deltas = (exp) => ({
          left: (m.actualViewport.left - exp.left) * 100,
          top: (m.actualViewport.top - exp.top) * 100,
          width: (m.actualViewport.width - exp.width) * 100,
          height: (m.actualViewport.height - exp.height) * 100
        });
        const dPad = deltas(m.expectedPaddingBox);
        const dCon = deltas(m.expectedContentBox);
        samples.push({
          zoom: z, pan: pos, outputAspect: outAspect,
          hidden: m.hidden,
          minimapBox: { width: m.minimapRect.width, height: m.minimapRect.height },
          minimapBoxAspect: m.minimapBoxAspect,
          boxAspectErrorPct: outAspect ? (m.minimapBoxAspect / outAspect - 1) * 100 : null,
          actualViewport: m.actualViewport,
          expectedPaddingBox: m.expectedPaddingBox,
          expectedContentBox: m.expectedContentBox,
          deltaPctVsPaddingBox: dPad,
          deltaPctVsContentBox: dCon,
          worstDeltaPctVsPaddingBox: Math.max(...Object.values(dPad).map(Math.abs)),
          worstDeltaPctVsContentBox: Math.max(...Object.values(dCon).map(Math.abs)),
          zoomLayerTransform: m.zoomLayerTransform
        });
        record('minimap-sample', {
          zoom: z, pan: pos, boxAspectErrorPct: samples[samples.length - 1].boxAspectErrorPct,
          worstPad: samples[samples.length - 1].worstDeltaPctVsPaddingBox,
          worstCon: samples[samples.length - 1].worstDeltaPctVsContentBox
        });
        if (z === 2 && pos === 'center' && FIXTURE === '9x16') {
          results.screenshots['03-zoom-200-minimap-9x16'] =
            await screenshot(main, path.join(OUT_DIR, `${LABEL}-03-zoom-200-minimap-9x16.png`));
        }
      }
    }
    results.minimap = samples;
    // hidden below the zoom threshold
    await setZoomViaSlider(1);
    await sleep(400);
    results.minimapHiddenAt100 = await evalActive(`document.getElementById('zoom-minimap').hidden`);
  }

  // =====================================================================
  // E. unsupported-feature indicator
  // =====================================================================
  {
    const before = await evalActive(`(() => {
      const rect = ${RECT};
      const b = document.getElementById('indicator-toggle');
      const p = document.getElementById('indicator-popup');
      const wrapper = document.getElementById('preview-wrapper');
      const stage = document.getElementById('preview-stage');
      return {
        exists: !!b,
        hidden: b ? b.hidden : null,
        visible: b ? b.checkVisibility() : null,
        rect: b ? rect(b.getBoundingClientRect()) : null,
        parentId: b && b.parentElement ? (b.parentElement.id || b.parentElement.className) : null,
        text: b ? b.textContent.trim() : null,
        ariaLabel: b ? b.getAttribute('aria-label') : null,
        ariaExpanded: b ? b.getAttribute('aria-expanded') : null,
        popupHidden: p ? p.hidden : null,
        popupParentId: p && p.parentElement ? (p.parentElement.id || p.parentElement.className) : null,
        wrapperRect: rect(wrapper.getBoundingClientRect()),
        stageRect: rect(stage.getBoundingClientRect())
      };
    })()`);
    let afterClick = null;
    let afterHover = null;
    if (before.visible) {
      const bx = before.rect.left + before.rect.width / 2;
      const by = before.rect.top + before.rect.height / 2;
      // the product opens the popup on mouseenter and toggles it on click
      await outer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bx, y: by, button: 'none' });
      await sleep(500);
      afterHover = await evalActive(`(() => {
        const p = document.getElementById('indicator-popup');
        const b = document.getElementById('indicator-toggle');
        return { popupHidden: p.hidden, popupVisible: p.checkVisibility(),
          popupText: p.textContent.trim(), ariaExpanded: b.getAttribute('aria-expanded') };
      })()`);
      if (FIXTURE === 'look') {
        results.screenshots['05-indicator-badge-open'] =
          await screenshot(main, path.join(OUT_DIR, `${LABEL}-05-indicator-badge-open.png`));
        results.screenshots['05-indicator-badge-crop2x'] = await screenshot(
          main, path.join(OUT_DIR, `${LABEL}-05-indicator-badge-crop2x.png`),
          { x: iframeOffset.x + before.wrapperRect.left + before.wrapperRect.width - 260,
            y: iframeOffset.y + before.wrapperRect.top, width: 260, height: 150, scale: 2 });
      }
      await realClick(outer, bx, by);
      await sleep(500);
      afterClick = await evalActive(`(() => {
        const rect = ${RECT};
        const p = document.getElementById('indicator-popup');
        const b = document.getElementById('indicator-toggle');
        return { popupHidden: p.hidden, popupVisible: p.checkVisibility(),
          popupRect: rect(p.getBoundingClientRect()), popupText: p.textContent.trim(),
          ariaExpanded: b.getAttribute('aria-expanded') };
      })()`);
    }
    results.indicator = { before, afterHover, afterClick };
    record('indicator', { hidden: before.hidden, visible: before.visible, text: before.text });
  }

  results.log = log;
  const outFile = path.join(OUT_DIR, `${LABEL}-${FIXTURE}.json`);
  await writeFile(outFile, JSON.stringify(results, null, 2));
  console.log('WROTE', outFile);
  main.close();
  outer.close();
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('L1 DRIVER FAILED:', err.stack || err.message);
  process.exit(1);
});
