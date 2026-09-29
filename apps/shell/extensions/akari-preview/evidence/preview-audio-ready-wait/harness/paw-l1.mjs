// paw-l1.mjs — preview-audio-ready-wait の L1 計測ハーネス（ラッパーの計測用。証跡として保存）
// 使い方: node paw-l1.mjs <tag> <projectDir> <outJson> [phases]
//   phases: カンマ区切り。既定 a,b,c,d,e,swap,props
// 環境: SHELL_DIR（apps/shell）, PAW_ROOT（隔離ディレクトリの根）
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, openSync, mkdirSync, writeFileSync, readFileSync, statSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [tag, projectDirArg, outJson, phasesArg] = process.argv.slice(2);
const projectDir = resolve(projectDirArg);
const phases = new Set((phasesArg ?? 'a,b,c,d,e,swap,props').split(','));
const SHELL_DIR = process.env.SHELL_DIR /* <worktree>/apps/shell */;
const PAW_ROOT = process.env.PAW_ROOT /* isolated scratch root (user-data-dir, THEIA_CONFIG_DIR, AKARI_HOME, logs) */;
const ELECTRON = join(SHELL_DIR, 'node_modules/electron/dist/electron.exe');
const userData = join(PAW_ROOT, `ud-${tag}`);
const theiaConfig = join(PAW_ROOT, `theia-${tag}`);
const akariHome = join(PAW_ROOT, 'akari-home');
mkdirSync(userData, { recursive: true }); mkdirSync(theiaConfig, { recursive: true }); mkdirSync(akariHome, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const results = { tag, projectDir, startedAt: new Date().toISOString(), phases: {} };
const save = () => writeFileSync(outJson, JSON.stringify(results, null, 1));

// ---- webview に仕込む計測フック（fetch / decodeAudioData / 出力タップ）----
const HOOK = `(() => {
  if (window.__paw) return;
  const paw = window.__paw = { fetches: [], decodes: [], taps: [] };
  const of = window.fetch;
  if (typeof of === 'function') {
    window.fetch = function (input, init) {
      const url = String((input && input.url) || input);
      let range = null;
      try { const h = init && init.headers; range = h ? (typeof h.get === 'function' ? h.get('Range') || h.get('range') : (h.Range || h.range || null)) : null; } catch {}
      const rec = { url, t: performance.now(), range, bytes: null, status: 0 };
      paw.fetches.push(rec);
      return of.apply(this, arguments).then(r => { rec.status = r.status; const cl = Number(r.headers.get('content-length')); rec.bytes = Number.isFinite(cl) ? cl : null; return r; });
    };
  }
  const B = window.BaseAudioContext;
  if (B && B.prototype.decodeAudioData) {
    const od = B.prototype.decodeAudioData;
    B.prototype.decodeAudioData = function (buf, ...rest) {
      const rec = { t: performance.now(), inBytes: buf && buf.byteLength, offline: typeof OfflineAudioContext !== 'undefined' && this instanceof OfflineAudioContext, ms: null, ok: null, duration: null };
      paw.decodes.push(rec);
      const p = od.call(this, buf, ...rest);
      return p.then(v => { rec.ms = performance.now() - rec.t; rec.ok = true; rec.duration = v && v.duration; return v; }, e => { rec.ms = performance.now() - rec.t; rec.ok = false; throw e; });
    };
  }
  const oc = AudioNode.prototype.connect;
  const tapFor = new WeakMap();
  AudioNode.prototype.connect = function (dest, ...rest) {
    try {
      if (dest && typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode && !(this && this.__pawTap)) {
        const ctx = dest.context;
        let an = tapFor.get(ctx);
        if (!an) {
          an = ctx.createAnalyser(); an.fftSize = 8192; an.smoothingTimeConstant = 0; an.__pawTap = true;
          tapFor.set(ctx, an); oc.call(an, dest); paw.taps.push({ ctx, an });
        }
        oc.call(this, an);
      }
    } catch (e) {}
    return oc.call(this, dest, ...rest);
  };
  const td = new Float32Array(8192), fd = new Float32Array(4096);
  paw.meter = (bandsHz = [196, 220, 500, 880]) => {
    let peak = 0; const bands = {}; for (const hz of bandsHz) bands[hz] = -Infinity;
    for (const { ctx, an } of paw.taps) {
      if (ctx.state === 'closed') continue;
      an.getFloatTimeDomainData(td);
      for (let i = td.length - 512; i < td.length; i++) { const v = Math.abs(td[i]); if (v > peak) peak = v; }
      an.getFloatFrequencyData(fd);
      const binHz = ctx.sampleRate / an.fftSize;
      for (const hz of bandsHz) { const b = Math.round(hz / binHz); let m = -Infinity; for (let k = b - 2; k <= b + 2; k++) if (fd[k] > m) m = fd[k]; if (m > bands[hz]) bands[hz] = m; }
    }
    return { peak, bands };
  };
  paw.peakHz = () => {
    let best = null;
    for (const { ctx, an } of paw.taps) { if (ctx.state === 'closed') continue; an.getFloatFrequencyData(fd); const binHz = ctx.sampleRate / an.fftSize; let bi = 1, bd = -Infinity; for (let i = 5; i < fd.length; i++) if (fd[i] > bd) { bd = fd[i]; bi = i; } if (!best || bd > best.db) best = { hz: bi * binHz, db: bd }; }
    return best;
  };
})();`;

// ---- 生 CDP（flatten セッション）----
let ws, msgId = 0;
const pending = new Map();
const sessions = new Map(); // sessionId -> { info, contexts: Map }
let browserCdp = null;
function send(method, params = {}, sessionId) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((res, rej) => pending.set(id, { res, rej, method }));
}
async function onAttached({ sessionId, targetInfo, waitingForDebugger }) {
  const s = { info: targetInfo, contexts: new Map() };
  sessions.set(sessionId, s);
  const type = targetInfo.type;
  const bg = [];
  try {
    if (type === 'iframe') bg.push(send('Page.enable', {}, sessionId).catch(() => {}).then(() => send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK, runImmediately: true }, sessionId).then(r => log('addScript ok', sessionId.slice(0, 6), targetInfo.url.slice(0, 60), JSON.stringify(r), waitingForDebugger), e => log('addScript failed', String(e)))));
    log('attached', type, sessionId.slice(0, 6), targetInfo.url.slice(0, 80), waitingForDebugger);
    if (type === 'page' || type === 'iframe') bg.push(send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId).catch(e => log('setAutoAttach failed', String(e).slice(0, 200))));
    await Promise.race([Promise.all(bg), sleep(3000)]);
  } finally {
    if (waitingForDebugger) send('Runtime.runIfWaitingForDebugger', {}, sessionId).then(() => log('resumed', type, sessionId.slice(0, 6)), e => log('resume failed', type, String(e).slice(0, 160)));
  }
  if (type === 'page' || type === 'iframe') send('Runtime.enable', {}, sessionId).catch(() => {});
}
async function connectBrowser(port) {
  let ver;
  for (let i = 0; i < 240 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(250); } }
  if (!ver) throw new Error('no CDP');
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  ws.addEventListener('message', ev => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(p.method + ' ' + JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Target.attachedToTarget') void onAttached(m.params);
    else if (m.method === 'Target.detachedFromTarget') sessions.delete(m.params.sessionId);
    else if (m.method === 'Runtime.executionContextCreated' && m.sessionId) sessions.get(m.sessionId)?.contexts.set(m.params.context.id, m.params.context);
    else if (m.method === 'Runtime.executionContextDestroyed' && m.sessionId) sessions.get(m.sessionId)?.contexts.delete(m.params.executionContextId);
    else if (m.method === 'Runtime.executionContextsCleared' && m.sessionId) sessions.get(m.sessionId)?.contexts.clear();
  });
  ws.addEventListener('close', () => { for (const p of pending.values()) p.rej(new Error('closed')); pending.clear(); });
  await send('Target.setDiscoverTargets', { discover: true });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'page', exclude: false }, { exclude: true }] });
}
async function evalIn(sessionId, contextId, expression, awaitPromise = true) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true, ...(contextId ? { contextId } : {}) }, sessionId);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}
async function mainPage() {
  for (let i = 0; i < 360; i++) {
    if (i % 40 === 0) log('sessions', [...sessions.values()].map(s => s.info.type + ':' + s.info.url.slice(0, 60)).join(' | '));
    for (const [sid, s] of sessions) {
      if (s.info.type !== 'page' || /devtools/.test(s.info.url)) continue;
      try { const v = await evalIn(sid, undefined, `JSON.stringify({ c: !!(window.theia && window.theia.container), pre: !!document.querySelector('.theia-preload'), shell: !!document.querySelector('#theia-app-shell'), href: location.href.slice(0, 60) })`); if (i % 40 === 0) log('main?', v); const o = JSON.parse(v); if (o.c && o.shell && !o.pre) return sid; } catch (e) { if (i % 40 === 0) log('main eval err', String(e).slice(0, 200)); }
    }
    await sleep(250);
  }
  throw new Error('main page not ready');
}
// #play-toggle と frameEngineReady を持つ内側フレームの実行コンテキスト
async function previewCtx(timeoutMs = 120000, notBefore = null) {
  const deadline = Date.now() + timeoutMs;
  let loops = 0;
  while (Date.now() < deadline) {
    if (loops++ % 50 === 0) log('previewCtx scan', [...sessions.entries()].map(([sid, s]) => `${s.info.type}:${sid.slice(0, 6)}:ctx=${s.contexts.size}`).join(' '));
    for (const [sid, s] of sessions) {
      if (s.info.type !== 'iframe') continue;
      if (loops % 50 === 1) for (const [cid] of s.contexts) { try { const v = await evalIn(sid, cid, `JSON.stringify({ b: !!document.getElementById('play-toggle'), r: document.querySelector('[data-frame-engine-ready]') && document.querySelector('[data-frame-engine-ready]').dataset.frameEngineReady, c: !!(window.akari && window.akari.frameEngineClock) })`, false); log('  ctx', sid.slice(0, 6), cid, v); } catch (e) { log('  ctx err', String(e).slice(0, 150)); } }
      for (const [cid] of s.contexts) {
        try {
          const v = await evalIn(sid, cid, `(() => { const b = document.getElementById('play-toggle'); const r = document.querySelector('[data-frame-engine-ready]'); return b && r && r.dataset.frameEngineReady === 'true' && window.akari && window.akari.frameEngineClock ? (window.__pawPageId || (window.__pawPageId = Math.random().toString(36).slice(2))) : null; })()`, false);
          if (v && v !== notBefore) return { sid, cid, pageId: v };
        } catch {}
      }
    }
    await sleep(100);
  }
  throw new Error('preview ctx not found');
}
async function exec(mainSid, command, arg) {
  return evalIn(mainSid, undefined, `(async () => { const dict = window.theia.container._bindingDictionary; const keys = [...dict._map.keys()];
    const C = keys.find(k => typeof k === 'function' && k.prototype && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
    try { const v = await window.theia.container.get(C).executeCommand(${JSON.stringify(command)}, ${JSON.stringify(arg)}); return { ok: true, v: typeof v === 'string' ? v : typeof v }; } catch (e) { return { ok: false, e: String(e && e.message || e) }; } })()`);
}
async function closePreviewTabs(mainSid) {
  return evalIn(mainSid, undefined, `(async () => { const dict = window.theia.container._bindingDictionary; const keys = [...dict._map.keys()];
    const S = keys.find(k => typeof k === 'function' && k.prototype && typeof k.prototype.revealWidget === 'function' && typeof k.prototype.closeWidget === 'function');
    const shell = window.theia.container.get(S); const ws = shell.widgets.filter(w => /preview/i.test(w.id)); const ids = ws.map(w => w.id);
    for (const w of ws) await shell.closeWidget(w.id); return ids; })()`);
}

// ---- 1 回の「再生を押してから」計測 ----
const MEASURE = `(async (opts) => {
  const paw = window.__paw; const clock = window.akari.frameEngineClock;
  const dbg = () => { try { return window.akariFrameEngineAudioDebug(); } catch { return null; } };
  const f0 = paw.fetches.length, d0 = paw.decodes.length;
  const status = document.getElementById('audio-status');
  const btn = document.getElementById('play-toggle');
  const t0 = performance.now();
  if (opts.seekTo != null) { /* seek は呼び手が事前に行う */ }
  const d00 = dbg(); const s0 = d00 && Number.isFinite(d00.renderedTimelineSec) ? d00.renderedTimelineSec : null;
  let moved = null, gateHeld = 0, iter = 0;
  btn.click();
  let first = null; const firstBand = {}; let prep = 0, wait = 0, last = t0, gateMs = 0; const texts = new Set(); const drift = [];
  const deadline = t0 + opts.maxMs;
  while (performance.now() < deadline) {
    await new Promise(r => setTimeout(r, 4));
    const now = performance.now(); const dt = now - last; last = now;
    const text = status && !status.hidden ? (status.textContent || '') : '';
    if (text) texts.add(text.replace(/[0-9.]+/g, 'N'));
    if (text.startsWith('音声を準備中')) prep += dt; else if (text.startsWith('音声を待っています')) wait += dt;
    const m = paw.meter(opts.bands);
    if (first === null && m.peak > 0.004) first = now - t0;
    if ((iter++ % 2) === 0) { const dd = dbg(); if (dd && dd.supply.gate.holding) gateHeld += dt * 2;
      if (moved === null && dd && Number.isFinite(dd.renderedTimelineSec) && s0 !== null && dd.renderedTimelineSec > s0 + 0.1) moved = now - t0; }
    for (const hz of opts.bands) if (firstBand[hz] == null && m.bands[hz] > -85) firstBand[hz] = +(now - t0).toFixed(1);
    if (first !== null && moved !== null && now - t0 > Math.max(first, moved) + opts.afterMs) break;
  }
  // 鳴り始めてからのずれ（driftMs）を少し採る
  for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 100)); const d = dbg(); if (d && Number.isFinite(d.driftMs)) drift.push(d.driftMs); }
  const d = dbg();
  return {
    startSec: s0, firstSoundMs: first === null ? null : +first.toFixed(1), videoMoveMs: moved === null ? null : +moved.toFixed(1), gateHeldMs: Math.round(gateHeld), firstBand, preparingShownMs: Math.round(prep), waitingShownMs: Math.round(wait), statusTexts: [...texts],
    fetches: paw.fetches.slice(f0).map(f => ({ url: f.url.replace(/^http:\\/\\/127\\.0\\.0\\.1:\\d+/, ''), range: f.range, bytes: f.bytes, status: f.status, dt: +(f.t - t0).toFixed(0) })),
    decodes: paw.decodes.slice(d0).map(x => ({ inBytes: x.inBytes, offline: x.offline, ms: x.ms && +x.ms.toFixed(0), ok: x.ok, duration: x.duration, dt: +(x.t - t0).toFixed(0) })),
    driftMs: drift, position: clock && clock.position,
    pageAll: { fetches: paw.fetches.map(f => ({ url: f.url.replace(/^http:\\/\\/127\\.0\\.0\\.1:\\d+/, ''), range: f.range, bytes: f.bytes })), decodes: paw.decodes.map(x => ({ inBytes: x.inBytes, offline: x.offline, ms: x.ms && +x.ms.toFixed(0), ok: x.ok })) },
    debug: d && { phase: d.supply.phase, required: d.supply.required, ready: d.supply.ready, pendingSidecar: d.supply.pendingSidecar, failed: d.supply.failed, gate: d.supply.gate, prefetch: d.prefetch, rate: d.rate, pitchPreserved: d.pitchPreserved, stretcher: d.stretcher, scheduled: d.scheduled, contextState: d.contextState },
  };
})`;
const PAUSE = `(() => { const b = document.getElementById('play-toggle'); const c = window.akari.frameEngineClock; const playing = !!(window.akariFrameEngineAudioDebug && window.akariFrameEngineAudioDebug().playing); if (window.akari.previewPlaying ?? playing) b.click(); return true; })()`;
const IS_PLAYING = `(() => { const b = document.getElementById('play-toggle'); return { aria: b && b.getAttribute('aria-label'), text: b && b.textContent, dbgPlaying: window.akariFrameEngineAudioDebug && window.akariFrameEngineAudioDebug().playing }; })()`;
const BANDS = [196, 220, 500, 880];

async function pauseIfPlaying(ctx) {
  // play-toggle を押して止める（停止中なら押さない）
  const st = await evalIn(ctx.sid, ctx.cid, IS_PLAYING);
  if (/一時停止|pause/i.test(`${st.aria} ${st.text}`) || st.dbgPlaying) await evalIn(ctx.sid, ctx.cid, `document.getElementById('play-toggle').click()`);
  await sleep(300);
}
async function measure(ctx, label, extra = {}) {
  await pauseIfPlaying(ctx);
  const r = await evalIn(ctx.sid, ctx.cid, `${MEASURE}(${JSON.stringify({ maxMs: extra.maxMs ?? 15000, afterMs: extra.afterMs ?? 1500, bands: BANDS })})`);
  const cls = classify(r);
  const pageCls = classify(r.pageAll);
  r.pageClassified = pageCls; delete r.pageAll;
  log(label, JSON.stringify({ firstSoundMs: r.firstSoundMs, videoMoveMs: r.videoMoveMs, gateHeldMs: r.gateHeldMs, firstBand: r.firstBand, prep: r.preparingShownMs, wait: r.waitingShownMs, texts: r.statusTexts, fetches: r.fetches.length, fetchBytes: cls.fetchBytes, decodes: r.decodes.length, decodeBytes: cls.decodeBytes, byFile: cls.byFile, page: pageCls, driftMean: mean(r.driftMs), failedDecodes: r.decodes.filter(x => x.ok === false).length }));
  return { ...r, classified: cls };
}
const mean = a => a && a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null;
let fileSizes = new Map();
function refreshSizes() {
  fileSizes = new Map();
  const walk = rel => { for (const name of ['audio/bgm-a.mp3', 'audio/bgm-b.m4a', 'narration/n-1.wav', 'narration/n-2.m4a', 'narration/n-3.wav', 'narration/n-4.m4a', 'narration/n-5.wav', 'narration/n-6.m4a', 'sfx/ding.wav', 'sfx/whoosh.mp3', 'sfx/pop.m4a', 'main.mp4']) { try { fileSizes.set(statSync(join(projectDir, name)).size, name); } catch {} } };
  walk();
}
function classify(r) {
  const byFile = {};
  let fetchBytes = 0, decodeBytes = 0;
  for (const f of r.fetches) { if (Number.isFinite(f.bytes)) fetchBytes += f.bytes; const name = f.range ? `range:${f.url.split('/').pop().slice(-12)}` : (fileSizes.get(f.bytes) ?? `other:${f.url.split('.').pop()}`); byFile[name] ??= { fetch: 0, decode: 0 }; byFile[name].fetch += 1; }
  let decodeMs = 0, decodeFailed = 0;
  for (const d of r.decodes) { if (Number.isFinite(d.inBytes)) decodeBytes += d.inBytes; if (Number.isFinite(d.ms)) decodeMs += d.ms; if (d.ok === false) decodeFailed += 1; const name = fileSizes.get(d.inBytes) ?? `other-decode`; byFile[name] ??= { fetch: 0, decode: 0 }; byFile[name].decode += 1; }
  // range 窓は URL ごとに集計を畳む
  const folded = {};
  for (const [k, v] of Object.entries(byFile)) { const key = k.startsWith('range:') ? 'pcm-window' : k; folded[key] ??= { fetch: 0, decode: 0 }; folded[key].fetch += v.fetch; folded[key].decode += v.decode; }
  return { fetches: r.fetches.length, fetchBytes, decodes: r.decodes.length, decodeBytes, decodeMs: Math.round(decodeMs), decodeFailed, byFile: folded };
}

// ---- アプリ起動 / 終了 ----
let child = null, port = 0;
async function launch() {
  for (let attempt = 1; ; attempt++) {
    try { return await launchOnce(); }
    catch (e) {
      log('launch attempt', attempt, 'failed:', String(e).slice(0, 120));
      try { ws.close(); } catch {}
      try { child.kill(); } catch {}
      killTag();
      await sleep(3000);
      if (attempt >= 3) throw e;
    }
  }
}
function killTag() {
  const ps = `Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" | Where-Object { $_.CommandLine -like '*ud-${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore' }); } catch {}
}
async function launchOnce() {
  port = 9400 + Math.floor(Math.random() * 80);
  const env = { ...process.env, THEIA_CONFIG_DIR: theiaConfig, AKARI_HOME: akariHome };
  delete env.ELECTRON_RUN_AS_NODE;
  const t0 = Date.now();
  const logFile = join(PAW_ROOT, `electron-${tag}-live-${Date.now()}.log`);
  const fd = openSync(logFile, 'a');
  child = spawn(ELECTRON, [SHELL_DIR, projectDir, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, '--no-sandbox'], { env, stdio: ['ignore', fd, fd] });
  const lines = [];
  child.pawLines = lines;
  log('launched pid', child.pid, 'port', port);
  sessions.clear();
  await sleep(Number(process.env.PAW_CONNECT_DELAY_MS ?? 0));
  await connectBrowser(port);
  const main = await mainPage();
  log('main ready in', Date.now() - t0, 'ms');
  await sleep(2500);
  return main;
}
async function shutdown() {
  try { await send('Browser.close'); } catch {}
  const exited = await Promise.race([new Promise(r => child.once('exit', () => r(true))), sleep(15000).then(() => false)]);
  if (!exited) { try { child.kill(); } catch {} }
  try { ws.close(); } catch {}
  writeFileSync(join(PAW_ROOT, `electron-${tag}-${Date.now()}.log`), child.pawLines.join(''));
  await sleep(1500);
}
const editUri = pathToFileURL(join(projectDir, 'edit.json')).href.replace(/^file:\/\/\/([A-Za-z]):/, (_, d) => `file:///${d.toLowerCase()}%3A`);
async function openPreview(mainSid, notBefore) {
  const t0 = Date.now();
  const r = await exec(mainSid, 'akari.preview.ensureVisible', { editUri });
  log('ensureVisible', JSON.stringify(r));
  const ctx = await previewCtx(180000, notBefore);
  const openMs = Date.now() - t0;
  log('preview ready', openMs, 'ms', ctx.pageId);
  for (const [sid, s] of sessions) { if (s.info.type !== 'iframe') continue; for (const [cid, c] of s.contexts) { const v = await evalIn(sid, cid, `JSON.stringify({ href: location.href.slice(0, 80), paw: !!window.__paw, play: !!document.getElementById('play-toggle'), top: window === window.top, parentPaw: (() => { try { return !!window.parent.__paw; } catch { return 'x'; } })() })`, false).catch(e => String(e).slice(0, 100)); log('ctx', sid.slice(0, 6), cid, c.auxData && c.auxData.type, c.name, v); } }
  return { ctx, openMs };
}
async function seekTo(ctx, sec) {
  await evalIn(ctx.sid, ctx.cid, `window.akari.frameEngineClock.seek(${sec}, false)`);
  await sleep(600);
}

try {
  refreshSizes();
  let main = await launch();
  let { ctx, openMs } = await openPreview(main);
  if (phases.has('a')) {
    // 開いた直後に再生（初回）
    results.phases.a = { openMs, ...(await measure(ctx, '(a) first open', { maxMs: 20000 })) };
    save();
    await sleep(2500);
  }
  if (phases.has('b')) {
    await pauseIfPlaying(ctx);
    await sleep(800);
    results.phases.b_resume = await measure(ctx, '(b) pause->play');
    await pauseIfPlaying(ctx);
    await seekTo(ctx, 90);
    results.phases.b_seek = await measure(ctx, '(b) seek 90->play');
    await pauseIfPlaying(ctx);
    save();
  }
  if (phases.has('c')) {
    await seekTo(ctx, 20);
    const before = await evalIn(ctx.sid, ctx.cid, `({ updates: Number(document.querySelector('[data-frame-engine-ready]').dataset.frameEngineModelUpdates || 0), f: window.__paw.fetches.length, d: window.__paw.decodes.length })`);
    // 尺が変わる編集: cut-3 を 100s -> 90s に縮める
    const editPath = join(projectDir, 'edit.json');
    const doc = JSON.parse(readFileSync(editPath, 'utf8'));
    const cut3 = doc.tracks[0].items.find(i => i.id === 'cut-3');
    cut3.duration = cut3.duration === 3000 ? 2700 : 3000; cut3.source.out = cut3.duration === 2700 ? 190 : 200;
    writeFileSync(editPath, JSON.stringify(doc, null, 2));
    const t0 = Date.now();
    let after = before;
    while (Date.now() - t0 < 30000) { await sleep(100); after = await evalIn(ctx.sid, ctx.cid, `({ updates: Number(document.querySelector('[data-frame-engine-ready]').dataset.frameEngineModelUpdates || 0) })`).catch(() => before); if (after.updates > before.updates) break; }
    log('(c) model updates', before.updates, '->', after.updates, 'in', Date.now() - t0, 'ms');
    await sleep(300);
    const m = await measure(ctx, '(c) after duration edit');
    const since = await evalIn(ctx.sid, ctx.cid, `(() => ({ fetches: window.__paw.fetches.slice(${before.f}).map(f => ({ url: f.url.replace(/^http:\\/\\/127\\.0\\.0\\.1:\\d+/, ''), range: f.range, bytes: f.bytes })), decodes: window.__paw.decodes.slice(${before.d}).map(x => ({ inBytes: x.inBytes, offline: x.offline, ms: x.ms })) }))()`);
    const sinceCls = classify(since);
    log('(c) since edit', JSON.stringify(sinceCls));
    results.phases.c = { modelUpdateMs: Date.now() - t0, updates: [before.updates, after.updates], ...m, sinceEdit: { ...since, classified: sinceCls } };
    await pauseIfPlaying(ctx);
    save();
  }
  if (phases.has('d')) {
    // (d1) 全面再描画（refreshMedia = forceRebuild → setHTML）
    const t0 = Date.now();
    await exec(main, 'akari.preview.refreshMedia', { editUri });
    ctx = await previewCtx(180000, ctx.pageId);
    const reloadMs = Date.now() - t0;
    log('(d1) reloaded in', reloadMs);
    results.phases.d_rerender = { reloadMs, ...(await measure(ctx, '(d1) after full re-render')) };
    await pauseIfPlaying(ctx);
    save();
    // (d2) タブを閉じて開き直す
    const closed = await closePreviewTabs(main);
    log('(d2) closed', JSON.stringify(closed));
    await sleep(1500);
    const o = await openPreview(main, ctx.pageId);
    ctx = o.ctx;
    results.phases.d_reopen = { openMs: o.openMs, closed, ...(await measure(ctx, '(d2) after reopen')) };
    await pauseIfPlaying(ctx);
    save();
  }
  if (phases.has('e')) {
    await shutdown();
    main = await launch();
    const o = await openPreview(main);
    ctx = o.ctx;
    results.phases.e = { openMs: o.openMs, ...(await measure(ctx, '(e) after app restart')) };
    await pauseIfPlaying(ctx);
    save();
  }
  if (phases.has('props')) {
    const props = {};
    // ダッキング: 220Hz（bgm-a）の帯域 dB を ナレーション無し(8s) と n-2 区間(17s) で比べる
    const band = async (sec) => { await pauseIfPlaying(ctx); await seekTo(ctx, sec); await evalIn(ctx.sid, ctx.cid, `document.getElementById('play-toggle').click()`); await sleep(1500);
      const v = await evalIn(ctx.sid, ctx.cid, `(async () => { const s = []; for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 50)); s.push(window.__paw.meter([196,220,500,880]).bands); } const avg = hz => +(s.reduce((x, y) => x + y[hz], 0) / s.length).toFixed(1); const d = window.akariFrameEngineAudioDebug(); return { b220: avg(220), b196: avg(196), b500: avg(500), drift: d.driftMs, rate: d.rate, pitchPreserved: d.pitchPreserved, stretcher: d.stretcher, peak: window.__paw.peakHz() }; })()`);
      return v; };
    props.duck_noNarration_8s = await band(8);
    props.duck_narration_17s = await band(17);
    // ミュート: audio-1（bgm-a）の track を消音 → 220Hz が消える
    await pauseIfPlaying(ctx);
    const trackIdx = 1;
    props.mute = { before: await band(8) };
    await evalIn(ctx.sid, ctx.cid, `window.akari.frameEngineSetMutedTracks({ cuts: [], audio: [${trackIdx}], allCuts: false, allAudio: false })`);
    await sleep(800);
    props.mute.after = await evalIn(ctx.sid, ctx.cid, `(async () => { const s = []; for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 50)); s.push(window.__paw.meter([196,220,500,880]).bands); } return { b220: +(s.reduce((x, y) => x + y[220], 0) / s.length).toFixed(1), b196: +(s.reduce((x, y) => x + y[196], 0) / s.length).toFixed(1) }; })()`);
    await evalIn(ctx.sid, ctx.cid, `window.akari.frameEngineSetMutedTracks({ cuts: [], audio: [], allCuts: false, allAudio: false })`);
    await sleep(800);
    props.mute.restored = await evalIn(ctx.sid, ctx.cid, `(async () => { const s = []; for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 50)); s.push(window.__paw.meter([196,220,500,880]).bands); } return { b220: +(s.reduce((x, y) => x + y[220], 0) / s.length).toFixed(1) }; })()`);
    // 再生速度 0.5 / 2.0: 位置の進みと音程（ピーク周波数）
    for (const r of [0.5, 2]) {
      await pauseIfPlaying(ctx); await seekTo(ctx, 8);
      await evalIn(ctx.sid, ctx.cid, `window.akari.frameEngineClock.setRate(${r})`);
      await evalIn(ctx.sid, ctx.cid, `document.getElementById('play-toggle').click()`);
      await sleep(1500);
      props[`rate_${r}`] = await evalIn(ctx.sid, ctx.cid, `(async () => { const d0 = window.akariFrameEngineAudioDebug(); const p0 = d0.audioPositionSec; const t0 = performance.now(); await new Promise(r => setTimeout(r, 2000)); const d1 = window.akariFrameEngineAudioDebug(); const el = (performance.now() - t0) / 1000; const s = []; for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 50)); s.push(window.__paw.meter([196,220,500,880]).bands); } return { advancePerSec: +((d1.audioPositionSec - p0) / el).toFixed(2), rate: d1.rate, pitchPreserved: d1.pitchPreserved, stretcher: d1.stretcher, b220: +(s.reduce((x, y) => x + y[220], 0) / s.length).toFixed(1), b500: +(s.reduce((x, y) => x + y[500], 0) / s.length).toFixed(1), drift: d1.driftMs }; })()`);
      await pauseIfPlaying(ctx);
      await evalIn(ctx.sid, ctx.cid, `window.akari.frameEngineClock.setRate(1)`);
    }
    // ずれ: 1x で 5 秒再生中の driftMs
    await pauseIfPlaying(ctx); await seekTo(ctx, 30);
    await evalIn(ctx.sid, ctx.cid, `document.getElementById('play-toggle').click()`);
    await sleep(1500);
    props.drift = await evalIn(ctx.sid, ctx.cid, `(async () => { const s = []; for (let i = 0; i < 25; i++) { await new Promise(r => setTimeout(r, 200)); const d = window.akariFrameEngineAudioDebug(); if (Number.isFinite(d.driftMs)) s.push(d.driftMs); } const abs = s.map(Math.abs); return { n: s.length, mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(1), maxAbs: +Math.max(...abs).toFixed(1) }; })()`);
    await pauseIfPlaying(ctx);
    log('props', JSON.stringify(props));
    results.phases.props = props;
    save();
  }
  if (phases.has('swap')) {
    // 同名差し替え: bgm-a.mp3 を 880Hz の音へ差し替え → 全面再描画 → 再生で 880Hz が鳴り 220Hz が鳴らない
    const src = join(PAW_ROOT, 'fixture-src', 'swap', 'bgm-a-880.mp3');
    copyFileSync(src, join(projectDir, 'audio', 'bgm-a.mp3'));
    refreshSizes();
    await exec(main, 'akari.preview.refreshMedia', { editUri });
    ctx = await previewCtx(180000, ctx.pageId);
    await seekTo(ctx, 8);
    const m = await measure(ctx, '(swap) after same-name replace', { afterMs: 2500 });
    const bands = await evalIn(ctx.sid, ctx.cid, `(async () => { const s = []; for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 50)); s.push(window.__paw.meter([196,220,500,880]).bands); } return { b220: +(s.reduce((x, y) => x + y[220], 0) / s.length).toFixed(1), b880: +(s.reduce((x, y) => x + y[880], 0) / s.length).toFixed(1) }; })()`);
    log('(swap) bands', JSON.stringify(bands));
    results.phases.swap = { ...m, bands };
    await pauseIfPlaying(ctx);
    save();
  }
  await shutdown();
} catch (e) {
  console.error('FAILED', e);
  results.error = String(e && e.stack || e);
  save();
  try { await shutdown(); } catch {}
  process.exitCode = 1;
} finally {
  save();
  setTimeout(() => process.exit(), 1000);
}
