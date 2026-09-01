#!/usr/bin/env node
// preview-seek-stuck L1: play/seek liveness on a real Electron shell via raw CDP.
// usage: node run-l1.mjs <port> <projectDir> <outDir> <label>
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const [, , portArg, projectDir, outDir, label] = process.argv;
const port = Number(portArg);
if (!projectDir || !outDir) throw new Error('usage: run-l1.mjs <port> <projectDir> <outDir> <label>');
await mkdir(outDir, { recursive: true });

const records = [];
const record = (step, data = {}) => { records.push({ t: new Date().toISOString(), step, ...data }); console.log(`[${step}]`, JSON.stringify(data)); };

class CDP {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const m = JSON.parse(event.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
        return;
      }
      for (const l of this.listeners.get(m.method) || []) l(m.params);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, l) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(l); }
  close() { try { this.socket.close(); } catch {} }
}

const targets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const evalOn = async (cdp, expression, contextId) => {
  const params = { expression, returnByValue: true, awaitPromise: true };
  if (contextId !== undefined) params.contextId = contextId;
  const r = await cdp.send('Runtime.evaluate', params);
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};
const waitFor = async (desc, fn, timeoutMs = 30000, intervalMs = 300) => {
  const start = Date.now(); let last;
  while (Date.now() - start < timeoutMs) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await sleep(intervalMs);
  }
  throw new Error(`timed out: ${desc}${last ? ' last=' + last : ''}`);
};

// ---- main window ----
const mainTarget = await waitFor('main window target', async () =>
  (await targets()).find(t => t.type === 'page' && /index\.html/.test(t.url)));
const main = new CDP(mainTarget.webSocketDebuggerUrl);
await main.connect();
await main.send('Page.enable');
await main.send('Runtime.enable');
record('main-attached', { url: mainTarget.url });
try {
  await main.send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(1500);
  record('viewport-override', await evalOn(main, '({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })'));
} catch (error) { record('viewport-override-failed', { error: String(error).slice(0, 200) }); }

const click = async (x, y, clickCount = 1) => {
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  for (let c = 1; c <= clickCount; c++) {
    await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: c });
    await sleep(40);
    await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: c });
    if (c < clickCount) await sleep(70);
  }
};

// ---- open edit.json from the 素材 (role buckets) panel ----
const cardExpr = `(() => {
  const root = document.getElementById('akari-role-buckets-widget');
  if (!root) return null;
  const hits = [...root.querySelectorAll('div')].filter(e => {
    const t = (e.textContent || '').trim();
    if (!/edit\\.json$/.test(t)) return false;
    const r = e.getBoundingClientRect();
    return r.width > 80 && r.height > 20;
  });
  const el = hits[hits.length - 1];
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (el.textContent || '').trim().slice(0, 60) };
})()`;
const card = await waitFor('edit.json card in 素材 panel', () => evalOn(main, cardExpr), 60000);
record('edit-card', card);
await click(card.x, card.y, 2);
record('opened-edit-json', {});
await sleep(2500);
const collapse = async id => {
  const r = await evalOn(main, `(() => { const e=document.getElementById(${JSON.stringify('')}+${JSON.stringify(id)});
    if(!e) return null; const q=e.getBoundingClientRect(); if(!(q.width>0)) return null;
    return {x:q.left+q.width/2,y:q.top+q.height/2}; })()`);
  if (r) { await click(r.x, r.y); await sleep(900); }
  return Boolean(r);
};
record('collapse-left', { done: await collapse('shell-tab-akari-role-buckets-widget') });
record('collapse-right', { done: await collapse('shell-tab-akari-partner-onboarding') });
await sleep(1500);

// ---- attach to the output preview webview (outer target -> inner active-frame context) ----
let preview, ctx, topCtx, previewTargetId;
await waitFor('preview webview with #play-toggle', async () => {
  const list = await targets();
  for (const t of list.filter(t => t.type === 'iframe' && /webview\/index\.html/.test(t.url))) {
    let cdp;
    try {
      cdp = new CDP(t.webSocketDebuggerUrl);
      await cdp.connect();
      const contexts = [];
      cdp.on('Runtime.executionContextCreated', p => contexts.push(p.context));
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await sleep(800);
      const tree = await cdp.send('Page.getFrameTree');
      const topFrame = tree.frameTree.frame.id;
      let inner, top;
      for (const c of contexts) {
        try {
          if (c.auxData?.frameId === topFrame) { top = c.id; continue; }
          if (await evalOn(cdp, `Boolean(document.getElementById('play-toggle'))`, c.id)) inner = c.id;
        } catch {}
      }
      if (inner !== undefined && top !== undefined) {
        preview = cdp; ctx = inner; topCtx = top; previewTargetId = t.id; return true;
      }
      cdp.close();
    } catch { try { cdp?.close(); } catch {} }
  }
  return false;
}, 90000, 1500);
record('preview-attached', { previewTargetId });

const consoleLines = [];
const exceptions = [];
preview.on('Runtime.consoleAPICalled', p => {
  consoleLines.push({ type: p.type, text: (p.args || []).map(a => a.value ?? a.description ?? a.type).join(' ') });
});
preview.on('Runtime.exceptionThrown', p => {
  exceptions.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || JSON.stringify(p));
});
main.on('Runtime.exceptionThrown', p => {
  exceptions.push('[main] ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || ''));
});
const logEntries = [];
try { await preview.send('Log.enable'); preview.on('Log.entryAdded', p => logEntries.push({ level: p.entry?.level, source: p.entry?.source, text: p.entry?.text })); } catch {}
// Parse-check every inline <script> of the preview document (a TS type predicate that leaked into
// the webview string makes the frame-engine bootstrap a SyntaxError -> no clock -> dead transport).
const scriptCheck = await evalOn(preview, `(() => {
  // 実行される script だけを構文検査する。<script type="application/json" data-akari-3d-scene>
  // のようなデータ島は JS ではないので new Function に通すと必ず "Unexpected token ':'" になり、
  // 本物の SyntaxError（= 本件の根因の形）と見分けが付かなくなる。
  const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);
  return [...document.querySelectorAll('script')].map((s, i) => {
    const text = s.textContent || '';
    const type = (s.getAttribute('type') || '').toLowerCase();
    if (!text) return { i, type, external: s.src ? s.src.slice(0, 60) : null, len: 0 };
    if (!JS_TYPES.has(type)) return { i, type, len: text.length, executable: false, parse: 'skipped (not javascript)' };
    let parse = 'ok';
    try { new Function(text); } catch (e) { parse = String(e && e.message).slice(0, 200); }
    return { i, type, len: text.length, executable: true, isBootstrap: /AkariFrameEngine/.test(text), parse };
  }).filter(e => e.len > 0);
})()`, ctx);
record('inline-script-parse-check', { scripts: scriptCheck });

// ---- coordinate mapping: main window <- webview iframe <- active-frame <- element ----
const webviewOffset = async () => {
  const outer = await evalOn(main, `(() => {
    const frames=[...document.querySelectorAll('iframe')].map(f=>{const r=f.getBoundingClientRect();
      return {id:f.id,cls:String(f.className).slice(0,60),src:String(f.src).slice(0,120),x:r.left,y:r.top,w:r.width,h:r.height};});
    return frames;
  })()`);
  const hit = outer.filter(f => f.w > 100 && f.h > 100);
  const inner = await evalOn(preview, `(() => {
    const f=document.getElementById('active-frame')||document.querySelector('iframe');
    if(!f) return null; const r=f.getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height};
  })()`, topCtx);
  return { outer: hit, inner };
};
let offs = await webviewOffset();
record('webview-offsets', offs);
// pick the outer iframe that contains the preview: the widest one in the main content panel
const pickOuter = () => {
  const cands = offs.outer.filter(f => f.w > 200 && f.h > 200);
  return cands.sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
};

const absRect = async selector => {
  const r = await evalOn(preview, `(() => { const e=document.querySelector(${JSON.stringify(selector)});
    if(!e) return null; const r=e.getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height}; })()`, ctx);
  if (!r) return null;
  offs = await webviewOffset();
  const o = pickOuter();
  const i = offs.inner || { x: 0, y: 0 };
  return { left: o.x + i.x + r.left, top: o.y + i.y + r.top, width: r.width, height: r.height };
};

const state = () => evalOn(preview, `(() => {
  const seek = document.getElementById('seek');
  const stage = document.getElementById('preview-stage');
  const play = document.getElementById('play-toggle');
  const labels = [...document.querySelectorAll('span,div')].filter(e=>e.children.length===0 && /^\\d+:\\d\\d \\/ \\d+:\\d\\d$/.test((e.textContent||'').trim()));
  return {
    seekValue: seek ? Number(seek.value) : null,
    seekMax: seek ? Number(seek.max) : null,
    playDisabled: play ? play.disabled : null,
    playLabel: play ? play.getAttribute('aria-label') : null,
    frameEngineActive: stage ? (stage.dataset.frameEngineActive ?? null) : null,
    hasClock: Boolean(window.akari && window.akari.frameEngineClock),
    timeText: labels.length ? labels[0].textContent.trim() : null
  };
})()`, ctx);

await waitFor('preview transport ready', async () => { const s = await state(); return s.seekValue !== null; }, 60000);
await sleep(4000);
const before = await state();
record('state-before-play', before);

// ---- (a) play: does the output time advance? ----
const playAbs = await absRect('#play-toggle');
record('play-button-abs', playAbs || {});
const t0 = await state();
await evalOn(preview, `(() => {
  window.__akariProbe = [];
  const log = e => window.__akariProbe.push({ type: e.type, target: e.target && (e.target.id || e.target.tagName), x: e.clientX, y: e.clientY });
  for (const t of ['pointerdown','mousedown','click']) document.addEventListener(t, log, true);
  const el = document.getElementById('play-toggle');
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const bar = el.parentElement;
  const siblings = bar ? [...bar.children].map(c => { const q = c.getBoundingClientRect();
    return { id: c.id || c.tagName, l: q.left, t: q.top, w: q.width, h: q.height }; }) : [];
  window.__akariProbeTop = { rect: { l: r.left, t: r.top, w: r.width, h: r.height },
    topEl: top && (top.id || top.tagName), isPlay: top === el || el.contains(top),
    bar: bar ? bar.className : null, siblings, vw: window.innerWidth };
  return window.__akariProbeTop;
})()`, ctx).then(v => record('play-hit-test', v));
await click(playAbs.left + playAbs.width / 2, playAbs.top + playAbs.height / 2);
await sleep(400);
record('play-probe-events', { events: await evalOn(preview, 'window.__akariProbe || []', ctx) });
const afterClick = await state();
record('state-after-play-click', afterClick);
const tStart = Date.now();
await sleep(2000);
const t1 = await state();
const elapsedMs = Date.now() - tStart;
const advance = (t1.seekValue ?? 0) - (afterClick.seekValue ?? 0);
record('play-measurement', { elapsedMs, from: afterClick.seekValue, to: t1.seekValue, advance, playLabel: t1.playLabel });
if (t1.playLabel === '一時停止') {
  await click(playAbs.left + playAbs.width / 2, playAbs.top + playAbs.height / 2);
  await sleep(600);
}

// ---- (b) seek clicks at two output times ----
const stageShot = async name => {
  const r = await absRect('#preview-stage');
  const dpr = await evalOn(main, 'window.devicePixelRatio');
  const { data } = await main.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), scale: 1 },
    captureBeyondViewport: false
  });
  const buf = Buffer.from(data, 'base64');
  await writeFile(path.join(outDir, name), buf);
  return { file: name, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), clip: r, dpr };
};
const seekTo = async seconds => {
  const r = await absRect('#seek');
  const max = (await state()).seekMax || 1;
  const ratio = Math.min(1, Math.max(0, seconds / max));
  const thumb = 8;
  const x = r.left + thumb + (r.width - 2 * thumb) * ratio;
  await click(x, r.top + r.height / 2);
  await sleep(2000);
  return { requested: seconds, x, rect: r, max };
};

const seekA = await seekTo(1.0);
await sleep(1500);
const stateA = await state();
const shotA = await stageShot(`${label}-seek-a.png`);
record('seek-a', { ...seekA, state: stateA, shot: { file: shotA.file, sha256: shotA.sha256, bytes: shotA.bytes } });

const seekB = await seekTo(4.5);
await sleep(1500);
const stateB = await state();
const shotB = await stageShot(`${label}-seek-b.png`);
record('seek-b', { ...seekB, state: stateB, shot: { file: shotB.file, sha256: shotB.sha256, bytes: shotB.bytes } });

record('console-summary', {
  count: consoleLines.length,
  errors: consoleLines.filter(l => l.type === 'error'),
  warnings: consoleLines.filter(l => l.type === 'warning').map(l => l.text).slice(0, 20)
});
record('exceptions', { count: exceptions.length, items: exceptions.slice(0, 10) });
record('log-entries', { count: logEntries.length, items: logEntries.filter(e => e.level === 'error' || /Syntax|Uncaught/.test(e.text || '')).slice(0, 10) });

const verdict = {
  label,
  frameEngineActive: before.frameEngineActive,
  hasClock: before.hasClock,
  seekMax: before.seekMax,
  playAdvanceSeconds: Number(advance.toFixed(3)),
  playPass: advance >= 1.5,
  seekTimeA: stateA.seekValue, seekTimeB: stateB.seekValue,
  seekShaA: shotA.sha256, seekShaB: shotB.sha256,
  seekShotsDiffer: shotA.sha256 !== shotB.sha256,
  seekPass: shotA.sha256 !== shotB.sha256 && Math.abs((stateB.seekValue ?? 0) - (stateA.seekValue ?? 0)) > 0.5,
  consoleErrors: consoleLines.filter(l => l.type === 'error').length,
  unhandledExceptions: exceptions.length,
  // 実行される script のうち構文が壊れているもの（本件の根因はここが非空になる形だった）
  executableScriptParseErrors: scriptCheck
    .filter(e => e.executable && e.parse !== 'ok')
    .map(e => ({ i: e.i, isBootstrap: e.isBootstrap, parse: e.parse })),
  nonJsScriptsSkipped: scriptCheck.filter(e => e.executable === false).length
};
record('VERDICT', verdict);
await writeFile(path.join(outDir, `${label}-l1.json`), JSON.stringify({ verdict, records, consoleLines, exceptions, logEntries }, null, 2));
preview.close(); main.close();
console.log('L1_VERDICT ' + JSON.stringify(verdict));
process.exit(0);
