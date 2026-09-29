// sar-l1.mjs — preview-audio-sidecar-roots の L1 計測ハーネス（ラッパーの計測用）
// 使い方: node sar-l1.mjs <outJson>
// 環境: SHELL_DIR（<worktree>/apps/shell）, ROOT（隔離ディレクトリの根。ws-a / ws-b / ud / theia / akari-home / 起動ログ）
// 手順: (1) ws-a を開き出力プレビューで再生（1 窓のみ）→ 500 Hz（主動画の埋め込み音声）を出力タップで測る
//       (2) 同じ backend に 2 つ目の窓で ws-b を開く（MRU = ws-b）→ ws-b でも出力プレビューを開く
//       (3) ws-a の窓で出力プレビューを閉じて開き直し、再生して 500 Hz を測る
//       (4) 起動ログから「Preview audio sidecar paths must stay inside an open workspace」を (2) 以降で数える
import { spawn, execFileSync } from 'node:child_process';
import { openSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [outJson] = process.argv.slice(2);
const SHELL_DIR = process.env.SHELL_DIR;
const ELECTRON = join(SHELL_DIR, 'node_modules/electron/dist/electron.exe');
const ROOT = process.env.ROOT;
const wsA = join(ROOT, 'ws-a'), wsB = join(ROOT, 'ws-b');
const userData = join(ROOT, 'ud'), theiaConfig = join(ROOT, 'theia'), akariHome = join(ROOT, 'akari-home');
for (const d of [userData, theiaConfig, akariHome]) mkdirSync(d, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const results = { startedAt: new Date().toISOString(), phases: {} };
const save = () => writeFileSync(outJson, JSON.stringify(results, null, 1));
const uriOf = p => pathToFileURL(p).href.replace(/^file:\/\/\/([A-Za-z]):/, (_, d) => `file:///${d.toLowerCase()}%3A`);
const ERR = 'Preview audio sidecar paths must stay inside an open workspace';

// 出力タップ（AudioDestinationNode の手前に AnalyserNode を挟む）
const HOOK = `(() => {
  if (window.__sar) return;
  const sar = window.__sar = { taps: [] };
  const oc = AudioNode.prototype.connect;
  const tapFor = new WeakMap();
  AudioNode.prototype.connect = function (dest, ...rest) {
    try {
      if (dest && typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode && !(this && this.__sarTap)) {
        const ctx = dest.context;
        let an = tapFor.get(ctx);
        if (!an) { an = ctx.createAnalyser(); an.fftSize = 8192; an.smoothingTimeConstant = 0; an.__sarTap = true; tapFor.set(ctx, an); oc.call(an, dest); sar.taps.push({ ctx, an }); }
        oc.call(this, an);
      }
    } catch (e) {}
    return oc.call(this, dest, ...rest);
  };
  const td = new Float32Array(8192), fd = new Float32Array(4096);
  sar.meter = (bandsHz) => {
    let peak = 0; const bands = {}; for (const hz of bandsHz) bands[hz] = -Infinity;
    for (const { ctx, an } of sar.taps) {
      if (ctx.state === 'closed') continue;
      an.getFloatTimeDomainData(td);
      for (let i = td.length - 512; i < td.length; i++) { const v = Math.abs(td[i]); if (v > peak) peak = v; }
      an.getFloatFrequencyData(fd);
      const binHz = ctx.sampleRate / an.fftSize;
      for (const hz of bandsHz) { const b = Math.round(hz / binHz); let m = -Infinity; for (let k = b - 2; k <= b + 2; k++) if (fd[k] > m) m = fd[k]; if (m > bands[hz]) bands[hz] = m; }
    }
    return { peak, bands };
  };
})();`;

let ws, msgId = 0;
const pending = new Map();
const sessions = new Map();
function send(method, params = {}, sessionId) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((res, rej) => pending.set(id, { res, rej, method }));
}
async function onAttached({ sessionId, targetInfo, waitingForDebugger }, parent) {
  sessions.set(sessionId, { info: targetInfo, contexts: new Map(), parent });
  const type = targetInfo.type;
  const bg = [];
  try {
    if (type === 'iframe') bg.push(send('Page.enable', {}, sessionId).catch(() => {}).then(() => send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK, runImmediately: true }, sessionId).catch(() => {})));
    if (type === 'page' || type === 'iframe') bg.push(send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId).catch(() => {}));
    await Promise.race([Promise.all(bg), sleep(3000)]);
  } finally {
    if (waitingForDebugger) send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
  }
  if (type === 'page' || type === 'iframe') send('Runtime.enable', {}, sessionId).catch(() => {});
}
async function connectBrowser(port) {
  let ver;
  for (let i = 0; i < 480 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(250); } }
  if (!ver) throw new Error('no CDP');
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  ws.addEventListener('message', ev => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(p.method + ' ' + JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Target.attachedToTarget') void onAttached(m.params, m.sessionId);
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
const rootOf = sid => { let s = sid; for (let i = 0; i < 10; i++) { const p = sessions.get(s)?.parent; if (!p || !sessions.has(p)) return s; s = p; } return s; };
async function mainPage(wsName, timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const [sid, s] of sessions) {
      if (s.info.type !== 'page' || /devtools/.test(s.info.url)) continue;
      try {
        const o = JSON.parse(await evalIn(sid, undefined, `JSON.stringify({ c: !!(window.theia && window.theia.container), pre: !!document.querySelector('.theia-preload'), shell: !!document.querySelector('#theia-app-shell'), key: decodeURIComponent(location.hash) + ' ' + document.title })`));
        if (o.c && o.shell && !o.pre && o.key.includes(wsName)) return sid;
      } catch {}
    }
    await sleep(500);
  }
  throw new Error('main page not ready: ' + wsName);
}
async function previewCtx(mainSid, timeoutMs = 180000, notBefore = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const [sid, s] of sessions) {
      if (s.info.type !== 'iframe' || rootOf(sid) !== mainSid) continue;
      for (const [cid] of s.contexts) {
        try {
          const v = await evalIn(sid, cid, `(() => { const b = document.getElementById('play-toggle'); const r = document.querySelector('[data-frame-engine-ready]'); return b && r && r.dataset.frameEngineReady === 'true' && window.akari && window.akari.frameEngineClock && window.__sar ? (window.__sarId || (window.__sarId = Math.random().toString(36).slice(2))) : null; })()`, false);
          if (v && v !== notBefore) return { sid, cid, pageId: v };
        } catch {}
      }
    }
    await sleep(150);
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
async function notifications(mainSid) {
  return evalIn(mainSid, undefined, `[...new Set([...document.querySelectorAll('.theia-notification-list-item, .theia-notification-message')].map(e => e.innerText.trim()).filter(Boolean))].slice(0, 10)`);
}
const IS_PLAYING = `(() => { const d = window.akariFrameEngineAudioDebug && window.akariFrameEngineAudioDebug(); const b = document.getElementById('play-toggle'); return { dbg: d && d.playing, aria: b && b.getAttribute('aria-label'), text: b && b.textContent }; })()`;
async function pauseIfPlaying(ctx) {
  const st = await evalIn(ctx.sid, ctx.cid, IS_PLAYING);
  if (st.dbg || /一時停止|pause/i.test(`${st.aria} ${st.text}`)) await evalIn(ctx.sid, ctx.cid, `document.getElementById('play-toggle').click()`);
  await sleep(400);
}
// 指定位置から再生し、鳴り始めてからの 500 Hz（主動画の埋め込み音声）/ 220・196 Hz（BGM）を平均する
const PLAY_MEASURE = `(async (opts) => {
  const sar = window.__sar; const bands = [196, 220, 500];
  window.akari.frameEngineClock.seek(opts.at, false);
  await new Promise(r => setTimeout(r, 1200));
  const status = document.getElementById('audio-status');
  const texts = new Set();
  document.getElementById('play-toggle').click();
  await new Promise(r => setTimeout(r, opts.settleMs));
  const s = [];
  for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 50)); s.push(sar.meter(bands)); const t = status && !status.hidden ? status.textContent : ''; if (t) texts.add(t); }
  const avg = hz => +(s.reduce((x, y) => x + (Number.isFinite(y.bands[hz]) ? y.bands[hz] : -200), 0) / s.length).toFixed(1);
  const d = window.akariFrameEngineAudioDebug && window.akariFrameEngineAudioDebug();
  return { at: opts.at, b500: avg(500), b220: avg(220), b196: avg(196), peak: +Math.max(...s.map(x => x.peak)).toFixed(4), taps: sar.taps.length,
    audioStatus: [...texts], supply: d && d.supply && { phase: d.supply.phase, failed: d.supply.failed, pendingSidecar: d.supply.pendingSidecar, required: d.supply.required, ready: d.supply.ready } };
})`;
async function playMeasure(ctx, at) {
  await pauseIfPlaying(ctx);
  const r = await evalIn(ctx.sid, ctx.cid, `${PLAY_MEASURE}(${JSON.stringify({ at, settleMs: 1500 })})`);
  await pauseIfPlaying(ctx);
  return r;
}
function logErrors() {
  const out = [];
  for (const f of readdirSync(ROOT).filter(n => /^electron-\d+\.log$/.test(n))) {
    for (const line of readFileSync(join(ROOT, f), 'utf8').split(/\r?\n/)) if (line.includes(ERR) || /speech sidecar|sidecar unavailable/.test(line)) out.push({ file: f, line: line.slice(0, 300) });
  }
  return out;
}

let launchSeq = 0;
function killMine() {
  const tag = ROOT.replace(/\//g, '\\');
  const ps = `Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" | Where-Object { $_.CommandLine -like '*preview-audio-sidecar-roots*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore' }); } catch {}
}
function launch(wsDir, extra) {
  const env = { ...process.env, THEIA_CONFIG_DIR: theiaConfig, AKARI_HOME: akariHome };
  delete env.ELECTRON_RUN_AS_NODE;
  const fd = openSync(join(ROOT, `electron-${Date.now()}.log`), 'a');
  const c = spawn(ELECTRON, [SHELL_DIR, wsDir, `--user-data-dir=${userData}`, '--no-sandbox', ...extra], { env, stdio: ['ignore', fd, fd] });
  log('launched', wsDir, 'pid', c.pid, ++launchSeq);
  return c;
}

try {
  const port = 9520 + Math.floor(Math.random() * 20);
  launch(wsA, [`--remote-debugging-port=${port}`]);
  await connectBrowser(port);
  const mainA = await mainPage('ws-a');
  log('window A ready');
  await sleep(3000);
  const editA = uriOf(join(wsA, 'edit.json'));
  const ensA = await exec(mainA, 'akari.preview.ensureVisible', { editUri: editA });
  let ctxA = await previewCtx(mainA);
  await sleep(6000); // サイドカー生成（初回）を待つ
  const aloneErrs = logErrors().filter(e => e.line.includes(ERR)).length;
  const alone = await playMeasure(ctxA, 2);
  results.phases.aloneA = { ensure: ensA, play: alone, errorsSoFar: aloneErrs, notifications: await notifications(mainA) };
  log('aloneA', JSON.stringify(results.phases.aloneA).slice(0, 500)); save();

  launch(wsB, []);
  const mainB = await mainPage('ws-b');
  await sleep(3000);
  const editB = uriOf(join(wsB, 'edit.json'));
  const ensB = await exec(mainB, 'akari.preview.ensureVisible', { editUri: editB });
  const ctxB = await previewCtx(mainB).catch(() => null);
  await sleep(5000);
  const playB = ctxB ? await playMeasure(ctxB, 2) : null;
  results.phases.windowB = { ensure: ensB, play: playB, notifications: await notifications(mainB) };
  log('windowB', JSON.stringify(results.phases.windowB).slice(0, 500)); save();
  const errsBeforeReopen = logErrors().filter(e => e.line.includes(ERR)).length;

  const closed = await closePreviewTabs(mainA);
  await sleep(1500);
  const ensA2 = await exec(mainA, 'akari.preview.ensureVisible', { editUri: editA });
  const ctxA2 = await previewCtx(mainA, 180000, ctxA.pageId);
  await sleep(6000);
  const playA2 = await playMeasure(ctxA2, 2);
  const playA2b = await playMeasure(ctxA2, 50);
  const errs = logErrors();
  results.phases.reopenA = { closed, ensure: ensA2, play: playA2, play50: playA2b, notifications: await notifications(mainA),
    errorCountBeforeReopen: errsBeforeReopen, errorCountTotal: errs.filter(e => e.line.includes(ERR)).length, errorLines: errs.slice(0, 20) };
  log('reopenA', JSON.stringify(results.phases.reopenA).slice(0, 900)); save();
} catch (e) {
  console.error('FAILED', e);
  results.error = String(e && e.stack || e);
} finally {
  save();
  try { await send('Browser.close'); } catch {}
  await sleep(6000);
  killMine();
  save();
  setTimeout(() => process.exit(), 500);
}
