#!/usr/bin/env node
// issue #36 shell L1 探針。
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { CDP, evalOn, listTargets, sleep, waitFor } from './cdp-lib.mjs';

const run = promisify(execFile);
const [, , portArg, workspaceDir, outDir, label, optionsJson] = process.argv;
const port = Number(portArg || 9645);
if (!workspaceDir || !outDir || !label) throw new Error('usage: run-l1.mjs <port> <workspaceDir> <outDir> <label> [optionsJson]');
const options = optionsJson ? JSON.parse(optionsJson) : {};
const seekTime = Number.isFinite(options.seekTime) ? options.seekTime : 2.0;
const editPath = path.join(workspaceDir, 'project/edit.json');
await mkdir(outDir, { recursive: true });

const VIEW_W = 1600, VIEW_H = 1200;

let main, view;
const log = [];
const record = (step, data = {}) => { log.push({ step, ...data }); console.log(`[${step}]`, JSON.stringify(data).slice(0, 600)); };

// ---------- main page ----------
const targets = await listTargets(port);
const mainTarget = targets.find(t => t.type === 'page' && /localhost/u.test(t.url)) ?? targets.find(t => t.type === 'page');
if (!mainTarget) throw new Error('main page target not found');
main = new CDP(mainTarget.webSocketDebuggerUrl);
await main.connect();
await main.send('Page.enable'); await main.send('Runtime.enable');
await main.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
await main.send('Page.bringToFront');
await waitFor('frontend ready', () => evalOn(main, `document.readyState === 'complete'`));
await evalOn(main, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
await sleep(1000);

if (options.theme === 'light') {
  await evalOn(main, `(async () => {
    const bindings=window.theia.container._bindingDictionary;
    const keys=[...bindings._map.keys()];
    const C=keys.find(k=>typeof k==='function' && typeof k.prototype?.executeCommand==='function' && typeof k.prototype?.registerCommand==='function');
    await window.theia.container.get(C).executeCommand('workbench.action.selectTheme');
    return true;
  })()`).catch(() => {});
  await sleep(500);
}

const openPreview = async () => evalOn(main, `(async () => {
  const bindings=window.theia.container._bindingDictionary;
  const keys=[...bindings._map.keys()];
  const C=keys.find(k=>typeof k==='function' && typeof k.prototype?.executeCommand==='function' && typeof k.prototype?.registerCommand==='function');
  if(!C) return 'no-command-registry';
  return await window.theia.container.get(C).executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify('file://' + editPath)} });
})()`);
record('open-preview', { result: await openPreview() });

// ---------- webview target ----------
const webviewTarget = await waitFor('webview target', async () => {
  const list = await listTargets(port);
  return list.find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url)) || null;
}, 60000);
view = new CDP(webviewTarget.webSocketDebuggerUrl);
await view.connect();
const contexts = [];
view.on('Runtime.executionContextCreated', p => contexts.push(p.context));
await view.send('Page.enable'); await view.send('Runtime.enable');

let ctxId;
await waitFor('preview stage in webview', async () => {
  const candidates = [undefined, ...contexts.map(c => c.id)];
  for (const id of candidates) {
    try { if (await evalOn(view, `Boolean(document.getElementById('preview-stage'))`, id)) { ctxId = id; return true; } } catch {}
  }
  return false;
}, 90000);
const vEval = expr => evalOn(view, expr, ctxId);
await waitFor('overlay container mounted', () => vEval(`Boolean(document.querySelector('#overlay-stage [data-overlay-id]'))`), 90000);

// ---------- pause + seek ----------
await vEval(`(() => { const t=document.getElementById('play-toggle'); const v=document.getElementById('preview-video'); if(v && !v.paused) t?.click(); return true; })()`);
await sleep(300);
await vEval(`(() => { const s=document.getElementById('seek'); s.value=${JSON.stringify(String(seekTime))}; s.dispatchEvent(new Event('input',{bubbles:true})); return s.value; })()`);
await sleep(1200);
if (options.selectOverlay) {
  const sel = await vEval(`(() => {
    const c=document.querySelector('#overlay-stage [data-overlay-id]');
    const r=c.getBoundingClientRect();
    return {x:r.left+r.width/2, y:r.top+r.height/2};
  })()`);
  const iframeRectPre = await evalOn(main, `(() => { const f=[...document.querySelectorAll('iframe')].find(e=>/webview\\/index\\.html/.test(e.src)); const r=f.getBoundingClientRect(); return {left:r.left, top:r.top}; })()`);
  const px = iframeRectPre.left + sel.x, py = iframeRectPre.top + sel.y;
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py, button: 'none' });
  await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 });
  await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 });
  await sleep(800);
}
if (options.deselectOverlay) {
  await vEval(`(() => { document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return true; })()`);
  await sleep(600);
}

const playState = await vEval(`(() => { const v=document.getElementById('preview-video'); return {paused: v ? v.paused : null, seek: document.getElementById('seek')?.value, time: document.getElementById('time-label')?.textContent}; })()`);
record('play-state', playState);

// ---------- (i) rects ----------
const rects = await vEval(`(() => {
  const pick = el => { if(!el) return null; const r=el.getBoundingClientRect(); return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height}; };
  const cs = el => { if(!el) return null; const s=getComputedStyle(el); return {background:s.backgroundColor, backgroundImage:s.backgroundImage, border:s.border, outline:s.outline, boxShadow:s.boxShadow, transform:s.transform, overflow:s.overflow, width:s.width, height:s.height}; };
  const container = document.querySelector('#overlay-stage [data-overlay-id]');
  const root = container?.firstElementChild ?? null;
  const q = s => document.querySelector(s);
  return {
    devicePixelRatio: window.devicePixelRatio,
    previewPane: pick(q('.preview-pane')),
    previewWrapper: pick(q('#preview-wrapper')),
    zoomLayer: pick(q('#zoom-layer')),
    previewStage: pick(q('#preview-stage')),
    previewLayers: pick(q('#preview-layers')),
    overlayStage: pick(q('#overlay-stage')),
    overlayContainer: pick(container),
    fragmentRoot: pick(root),
    fragmentRootSelector: root ? (root.className ? '.' + String(root.className).split(' ').join('.') : root.tagName) : null,
    frameEngineActive: q('#preview-stage')?.getAttribute('data-frame-engine-active') ?? null,
    zoomValue: q('#zoom-value')?.textContent ?? null,
    styles: {
      previewPane: cs(q('.preview-pane')),
      previewStage: cs(q('#preview-stage')),
      previewLayers: cs(q('#preview-layers')),
      overlayStage: cs(q('#overlay-stage')),
      overlayContainer: cs(container),
      fragmentRoot: cs(root)
    },
    stageChildren: [...(q('#preview-stage')?.children ?? [])].map(e => {
      const r=e.getBoundingClientRect(); const s=getComputedStyle(e);
      return { id:e.id||null, cls:e.className||null, display:s.display, visibility:s.visibility, rect:{left:r.left,top:r.top,width:r.width,height:r.height} };
    }),
    layerChildren: [...(q('#preview-layers')?.children ?? [])].map(e => {
      const r=e.getBoundingClientRect(); const s=getComputedStyle(e);
      return { id:e.id||null, tag:e.tagName, display:s.display, visibility:s.visibility, rect:{left:r.left,top:r.top,width:r.width,height:r.height} };
    }),
    interactionArtifacts: [...document.querySelectorAll('.akari-interaction-selection-frame, [data-akari-interaction-selected], [data-akari-interaction-editing]')].map(e => {
      const r=e.getBoundingClientRect(); const s=getComputedStyle(e);
      return { cls:e.className, hidden:e.hasAttribute('hidden'), display:s.display, border:s.border, outline:s.outline, rect:{left:r.left,top:r.top,width:r.width,height:r.height} };
    }),
    selectBoxes: ['#cut-select-box','#layer-select-box','#caption-select-box','#layer-crop-box'].map(sel => {
      const e=q(sel); if(!e) return {sel, present:false};
      const s=getComputedStyle(e); const r=e.getBoundingClientRect();
      return { sel, present:true, active:e.classList.contains('is-active'), display:s.display, border:s.border, boxShadow:s.boxShadow, rect:{left:r.left,top:r.top,width:r.width,height:r.height} };
    })
  };
})()`);
record('rects', { previewStage: rects.previewStage, previewLayers: rects.previewLayers, overlayContainer: rects.overlayContainer, fragmentRoot: rects.fragmentRoot, frameEngineActive: rects.frameEngineActive });

// ---------- (ii) 24 points elementsFromPoint ----------
const POINT_SPEC = `(() => {
  const container = document.querySelector('#overlay-stage [data-overlay-id]');
  const root = container?.firstElementChild;
  if(!root) return null;
  const r = root.getBoundingClientRect();
  const anchors = [
    ['top-mid',    (r.left+r.right)/2, r.top,     0, -1],
    ['bottom-mid', (r.left+r.right)/2, r.bottom,  0,  1],
    ['left-mid',   r.left, (r.top+r.bottom)/2,   -1,  0],
    ['right-mid',  r.right,(r.top+r.bottom)/2,    1,  0],
    ['tl', r.left,  r.top,    -1, -1],
    ['tr', r.right, r.top,     1, -1],
    ['bl', r.left,  r.bottom, -1,  1],
    ['br', r.right, r.bottom,  1,  1]
  ];
  const offsets = [['in2', -2], ['out2', 2], ['out6', 6]];
  const pts = [];
  for (const [name, ax, ay, dx, dy] of anchors) {
    for (const [oname, d] of offsets) {
      pts.push({ id: name + ':' + oname, x: ax + dx * d, y: ay + dy * d });
    }
  }
  return pts;
})()`;
const points = await vEval(POINT_SPEC);
if (!points) throw new Error('fragment root not found');

const pointInfo = await vEval(`(() => {
  const pts = ${JSON.stringify(points)};
  const describe = el => {
    const s = getComputedStyle(el);
    return {
      tag: el.tagName, id: el.id || null, cls: typeof el.className === 'string' ? el.className : null,
      overlayId: el.getAttribute ? el.getAttribute('data-overlay-id') : null,
      border: s.border, borderTop: s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor,
      outline: s.outline, outlineOffset: s.outlineOffset, boxShadow: s.boxShadow,
      background: s.backgroundColor, backgroundImage: s.backgroundImage === 'none' ? 'none' : s.backgroundImage.slice(0, 120),
      visibility: s.visibility, display: s.display, zIndex: s.zIndex
    };
  };
  return pts.map(p => ({ ...p, elements: document.elementsFromPoint(p.x, p.y).slice(0, 6).map(describe) }));
})()`);

// ---------- screenshot ----------
const iframeRect = await evalOn(main, `(() => {
  const f=[...document.querySelectorAll('iframe')].find(e=>/webview\\/index\\.html/.test(e.src));
  if(!f) return null; const r=f.getBoundingClientRect();
  return {left:r.left, top:r.top, width:r.width, height:r.height, src:'<redacted>'};
})()`);
if (!iframeRect) throw new Error('webview iframe not found in main document');
record('iframe-rect', iframeRect);

const shot = await main.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
const pngPath = path.join(outDir, `${label}-window.png`);
await writeFile(pngPath, Buffer.from(shot.data, 'base64'));
const rawPath = path.join(outDir, `${label}-window.rgb`);
await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', pngPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', rawPath]);
const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', pngPath]);
const [shotW, shotH] = probe.stdout.trim().split(',').map(Number);
const raw = await readFile(rawPath);
record('screenshot', { pngPath: '<out>/' + path.basename(pngPath), shotW, shotH, viewport: [VIEW_W, VIEW_H] });

const px = (x, y) => {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= shotW || yi >= shotH) return null;
  const o = (yi * shotW + xi) * 3;
  return [raw[o], raw[o + 1], raw[o + 2]];
};
const toWin = (x, y) => [iframeRect.left + x, iframeRect.top + y];
const delta = (a, b) => (a && b) ? Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) : null;

// pasteboard reference: preview-pane padding area (2px inside the pane's left edge, vertically centered)
const pane = rects.previewPane;
const pasteboard = px(...toWin(pane.left + 4, (pane.top + pane.bottom) / 2));
// stage-outside reference: 2px outside #preview-stage on each side
const st = rects.previewStage;
const stageOutside = {
  top: px(...toWin((st.left + st.right) / 2, st.top - 2)),
  bottom: px(...toWin((st.left + st.right) / 2, st.bottom + 2)),
  left: px(...toWin(st.left - 2, (st.top + st.bottom) / 2)),
  right: px(...toWin(st.right + 2, (st.top + st.bottom) / 2))
};

const root = rects.fragmentRoot;
// (iii) 24 points RGB + reference (8px inside on the same scan axis)
const pointPixels = pointInfo.map(p => {
  const [wx, wy] = toWin(p.x, p.y);
  const rgb = px(wx, wy);
  const name = p.id.split(':')[0];
  let ref;
  if (name === 'top-mid' || name === 'bottom-mid') ref = px(...toWin(p.x, name === 'top-mid' ? root.top + 8 : root.bottom - 8));
  else if (name === 'left-mid' || name === 'right-mid') ref = px(...toWin(name === 'left-mid' ? root.left + 8 : root.right - 8, p.y));
  else {
    const cx = name[1] === 'l' ? root.left + 8 : root.right - 8;
    const cy = name[0] === 't' ? root.top + 8 : root.bottom - 8;
    ref = px(...toWin(cx, cy));
  }
  return { id: p.id, webview: [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100], rgb, fragmentRef: ref, deltaToFragment: delta(rgb, ref), deltaToPasteboard: delta(rgb, pasteboard) };
});

// scan lines just outside each edge of the fragment root
const scan = (kind) => {
  const out = [];
  if (kind === 'top' || kind === 'bottom') {
    const y = kind === 'top' ? root.top - 2 : root.bottom + 2;
    const refY = kind === 'top' ? root.top + 8 : root.bottom - 8;
    for (let x = Math.ceil(root.left); x <= Math.floor(root.right); x++) {
      const rgb = px(...toWin(x, y));
      const ref = px(...toWin(x, refY));
      out.push({ x, rgb, dFrag: delta(rgb, ref), dPaste: delta(rgb, pasteboard) });
    }
  } else {
    const x = kind === 'left' ? root.left - 2 : root.right + 2;
    const refX = kind === 'left' ? root.left + 8 : root.right - 8;
    for (let y = Math.ceil(root.top); y <= Math.floor(root.bottom); y++) {
      const rgb = px(...toWin(x, y));
      const ref = px(...toWin(refX, y));
      out.push({ y, rgb, dFrag: delta(rgb, ref), dPaste: delta(rgb, pasteboard) });
    }
  }
  return out;
};
const TH = 8;
const scanSummary = {};
for (const kind of ['top', 'bottom', 'left', 'right']) {
  const line = scan(kind);
  // "断片が描いていない色" = 断片背景でもなく pasteboard でもない画素
  let best = 0, cur = 0, runs = [], startIdx = null;
  const foreign = line.map(s => (s.dFrag !== null && s.dFrag > TH && s.dPaste !== null && s.dPaste > TH));
  for (let i = 0; i < foreign.length; i++) {
    if (foreign[i]) { if (cur === 0) startIdx = i; cur++; if (cur > best) best = cur; }
    else { if (cur >= 10) runs.push({ from: line[startIdx].x ?? line[startIdx].y, len: cur, sample: line[startIdx].rgb }); cur = 0; }
  }
  if (cur >= 10) runs.push({ from: line[startIdx].x ?? line[startIdx].y, len: cur, sample: line[startIdx].rgb });
  scanSummary[kind] = {
    length: line.length,
    foreignPixels: foreign.filter(Boolean).length,
    longestForeignRun: best,
    runs: runs.slice(0, 8),
    maxDeltaToFragment: Math.max(...line.map(s => s.dFrag ?? 0)),
    samples: [0, Math.floor(line.length / 4), Math.floor(line.length / 2), Math.floor(line.length * 3 / 4), line.length - 1].map(i => line[i])
  };
}

// 断片ルート 2px 内側の 8 点（受け入れ条件の主判定）
const insideCheck = pointPixels.filter(p => p.id.endsWith(':in2'));
const verdict = {
  frameDetected: Object.values(scanSummary).some(s => s.longestForeignRun >= 10),
  insideMaxDelta: Math.max(...insideCheck.map(p => p.deltaToFragment ?? 0)),
  stageOutsideIsPasteboard: Object.fromEntries(Object.entries(stageOutside).map(([k, v]) => [k, delta(v, pasteboard)]))
};

const payload = {
  label, seekTime, options, generatedBy: 'issue-36 L1 probe',
  viewport: { width: VIEW_W, height: VIEW_H, screenshot: [shotW, shotH] },
  iframeRect, rects, playState, pasteboard, stageOutside,
  geometry: {
    stageVsLayers: {
      dLeft: +(rects.previewLayers.left - rects.previewStage.left).toFixed(4),
      dTop: +(rects.previewLayers.top - rects.previewStage.top).toFixed(4),
      dRight: +(rects.previewStage.right - rects.previewLayers.right).toFixed(4),
      dBottom: +(rects.previewStage.bottom - rects.previewLayers.bottom).toFixed(4),
      dWidth: +(rects.previewStage.width - rects.previewLayers.width).toFixed(4),
      dHeight: +(rects.previewStage.height - rects.previewLayers.height).toFixed(4)
    },
    layersVsFragment: {
      dLeft: +(rects.fragmentRoot.left - rects.previewLayers.left).toFixed(4),
      dTop: +(rects.fragmentRoot.top - rects.previewLayers.top).toFixed(4),
      dRight: +(rects.previewLayers.right - rects.fragmentRoot.right).toFixed(4),
      dBottom: +(rects.previewLayers.bottom - rects.fragmentRoot.bottom).toFixed(4)
    }
  },
  points: pointPixels, pointElements: pointInfo, scanSummary, verdict, log
};
await writeFile(path.join(outDir, `${label}-measure.json`), JSON.stringify(payload, null, 2) + '\n');
console.log('VERDICT', JSON.stringify(verdict, null, 2));
main.close(); view.close();
