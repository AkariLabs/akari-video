// l1.mjs — 2026-09-30-onboarding-demo-rich の L1（シェル開発起動 + 生 CDP・隔離・初期設定なし）
// 使い方: node l1.mjs <mode:before|after> <root(隔離の根・短いパス)> <evidenceDir>
// 環境: SHELL_DIR（<worktree>/apps/shell）, ELECTRON（electron.exe）, FFPROBE, FFMPEG
// 初回ガイドを welcome からお手本・再生・字幕・台本・書き出し・おわりまで進め、各段のスクリーンショットと実測を残す。
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { openSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [mode, ROOT, EVID] = process.argv.slice(2);
const SHELL_DIR = process.env.SHELL_DIR, ELECTRON = process.env.ELECTRON;
const FFPROBE = process.env.FFPROBE, FFMPEG = process.env.FFMPEG;
const home = join(ROOT, 'home'), akariHome = join(home, '.akari'), userData = join(ROOT, 'ud'), theiaConfig = join(ROOT, 'theia');
for (const d of [home, akariHome, userData, theiaConfig, EVID]) mkdirSync(d, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(1).padStart(6), ...a);
const results = { mode, startedAt: new Date().toISOString(), steps: [], shots: [], work: [], play: {}, export: {}, errors: [] };
const save = () => writeFileSync(join(EVID, `l1-${mode}.json`), JSON.stringify(results, null, 1));

// ---- 生 CDP（flatten）----
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
  try {
    if (type === 'page' || type === 'iframe') await Promise.race([send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId).catch(() => {}), sleep(3000)]);
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
async function mainPage(timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const [sid, s] of sessions) {
      if (s.info.type !== 'page' || /devtools/.test(s.info.url)) continue;
      try {
        const o = await evalIn(sid, undefined, `({ c: !!(window.theia && window.theia.container), pre: !!document.querySelector('.theia-preload'), shell: !!document.querySelector('#theia-app-shell') })`);
        if (o.c && o.shell && !o.pre) return sid;
      } catch {}
    }
    await sleep(500);
  }
  throw new Error('main page not ready');
}
let MAIN;
const M = expr => evalIn(MAIN, undefined, expr);
async function previewCtx(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const [sid, s] of sessions) {
      if (s.info.type !== 'iframe' || rootOf(sid) !== MAIN) continue;
      for (const [cid] of s.contexts) {
        try {
          const v = await evalIn(sid, cid, `(() => { const b = document.getElementById('play-toggle'); const r = document.querySelector('[data-frame-engine-ready]'); return !!(b && r && r.dataset.frameEngineReady === 'true' && window.akari && window.akari.frameEngineClock && document.getElementById('seek') && Number(document.getElementById('seek').max) > 30); })()`, false);
          if (v) return { sid, cid };
        } catch {}
      }
    }
    await sleep(300);
  }
  return null;
}
const P = (ctx, expr) => evalIn(ctx.sid, ctx.cid, expr);

// ---- 状態・スクショ ----
const stateFile = join(akariHome, 'onboarding-v1.json');
const readState = () => { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return null; } };
async function waitState(pred, timeoutMs = 60000, label = '') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const s = readState(); if (s && pred(s)) return s; await sleep(200); }
  throw new Error(`waitState timeout ${label}: ${JSON.stringify(readState())}`);
}
let shotN = 0;
async function shot(name, sid = MAIN) {
  const r = await send('Page.captureScreenshot', { format: 'png' }, sid);
  const file = `${mode}-${String(++shotN).padStart(2, '0')}-${name}.png`;
  writeFileSync(join(EVID, file), Buffer.from(r.data, 'base64'));
  results.shots.push(file); save();
  log('shot', file);
  return file;
}
async function shotClip(name) {
  const r0 = await M(`(() => { const e = document.querySelector('[data-akari-onboarding-target="output"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
  if (!r0) return null;
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...r0, scale: 2 } }, MAIN);
  const file = `${mode}-${String(++shotN).padStart(2, '0')}-${name}.png`;
  writeFileSync(join(EVID, file), Buffer.from(r.data, 'base64'));
  results.shots.push(file); save();
  return file;
}
const coach = () => M(`(() => { const r = document.getElementById('akari-onboarding-v1'); const c = r && r.querySelector('.ao-coach'); return { step: r && r.getAttribute('data-akari-onboarding-step'), title: c && c.querySelector('h3') && c.querySelector('h3').textContent, body: c && c.querySelector('.ao-body') && c.querySelector('.ao-body').innerText, buttons: c ? [...c.querySelectorAll('button')].map(b => b.dataset.ao || b.textContent) : [] }; })()`);
const click = sel => M(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
async function clickWait(sel, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await click(sel).catch(() => false)) return true; await sleep(250); }
  throw new Error('not found: ' + sel);
}
function recordStep(label) { const s = readState(); results.steps.push({ at: +((Date.now() - T0) / 1000).toFixed(1), label, step: s && s.step, sub: s && s.sub }); save(); }
// 案内の「次へ」系を押す（next → help-next → fallback-next の順）
async function advanceGeneric() {
  for (const sel of ['.ao-coach [data-ao="next"]', '.ao-coach [data-ao="help-next"]', '.ao-coach [data-ao="fallback-next"]']) if (await click(sel).catch(() => false)) return sel;
  return null;
}

// ---- 起動 ----
function killMine() {
  const ps = `Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" | Where-Object { $_.CommandLine -like '*akari-wt*onboarding-demo-rich*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore' }); } catch {}
}
const env = { ...process.env, HOME: home, USERPROFILE: home, AKARI_HOME: akariHome, THEIA_CONFIG_DIR: theiaConfig,
  AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/offline', AKARI_EXPORT_ALLOW_DESKTOP: '0' };
delete env.ELECTRON_RUN_AS_NODE;
const port = 9600 + Math.floor(Math.random() * 50);
const fd = openSync(join(ROOT, `electron-${mode}.log`), 'a');
const child = spawn(ELECTRON, [SHELL_DIR, `--user-data-dir=${userData}`, '--no-sandbox', `--remote-debugging-port=${port}`, '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'], { cwd: SHELL_DIR, env, stdio: ['ignore', fd, fd] });
log('launched pid', child.pid, 'port', port);

try {
  await connectBrowser(port);
  MAIN = await mainPage();
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, MAIN).catch(() => {});
  if (process.env.WIN_W) {
    try {
      const tid = sessions.get(MAIN).info.targetId;
      const { windowId } = await send('Browser.getWindowForTarget', { targetId: tid });
      await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await send('Browser.setWindowBounds', { windowId, bounds: { left: 20, top: 10, width: Number(process.env.WIN_W), height: Number(process.env.WIN_H) } });
      results.window = { width: Number(process.env.WIN_W), height: Number(process.env.WIN_H) };
    } catch (e) { results.errors.push('window ' + String(e)); }
  }
  // welcome
  await (async () => { const d = Date.now() + 90000; while (Date.now() < d) { const c = await coach().catch(() => ({})); if (c.step === 'welcome') return; await sleep(300); } throw new Error('welcome not shown'); })();
  await sleep(1200); recordStep('welcome'); await shot('welcome');
  await clickWait('[data-ao="next"]'); await waitState(s => s.step === 'first', 20000, 'first'); await sleep(900); recordStep('first'); await shot('first');
  await clickWait('[data-ao="yes"]'); await waitState(s => s.step === 'invite', 20000, 'invite'); await sleep(900); recordStep('invite'); await shot('invite');
  await clickWait('[data-ao="start"]');
  const tour = await waitState(s => s.step.startsWith('tour'), 120000, 'tour0');
  results.projectUri = tour.projectUri; save();
  const project = fileURLToPath(tour.projectUri);
  log('project', project);
  // 再読み込み後の main page を取り直す
  await sleep(2500);
  MAIN = await mainPage();
  const readEdit = () => { try { return JSON.parse(readFileSync(join(project, 'edit.json'), 'utf8')); } catch { return null; } };
  const summarize = edit => edit ? { tracks: (edit.tracks || []).map(t => ({ id: t.id, lane: t.lane, name: t.name, items: (t.items || []).map(i => ({ id: i.id, at: i.at, duration: i.duration, kind: i.source && i.source.kind, path: i.source && (i.source.path || i.source.src) })) })), audio: edit.audio ? Object.keys(edit.audio) : null } : null;
  if (process.env.STOP_AT_TOUR) {
    const t1 = Date.now(); results.tourProbe = [];
    while (Date.now() - t1 < 25000) { const e = readEdit(); const st = readState(); results.tourProbe.push({ t: Date.now() - t1, step: st && st.step + ':' + st.sub, tracks: e ? (e.tracks || []).map(x => x.id + ':' + (x.items || []).length).join(',') : 'ERR' }); save(); if (st && st.step === 'tour0' && st.sub === 1) await advanceGeneric().catch(() => null); if (st && st.step === 'tour1') await advanceGeneric().catch(() => null); await sleep(500); }
    throw new Error('STOP_AT_TOUR');
  }
  // tour0..tour3（自動進行 + 次へ）
  let lastKey = '';
  for (let guard = 0; guard < 200; guard++) {
    const s = readState();
    if (s && s.step === 'drag') break;
    const key = s ? `${s.step}:${s.sub}` : '';
    if (key !== lastKey) { lastKey = key; await sleep(1500); recordStep(key); await shot(key.replace(':', '-')).catch(() => {}); if (s && s.step === 'tour1') { results.tourEdit = summarize(readEdit()); results.tourEditRaw = readEdit(); save(); } }
    await advanceGeneric().catch(() => null);
    await sleep(900);
  }
  // 完成例（ツアー）の edit.json を記録
  // drag → 取り込みリンク
  await waitState(s => s.step === 'drag', 60000, 'drag'); await sleep(1500); recordStep('drag'); await shot('drag');
  results.afterTourReset = summarize(readEdit()); results.afterTourResetFiles = existsSync(project) ? readdirSync(project) : []; save();
  await clickWait('.ao-coach [data-ao="import"]');
  await waitState(s => s.step === 'matpreview', 60000, 'matpreview'); await sleep(1500); recordStep('matpreview-0'); await shot('matpreview-0');
  await clickWait('[data-akari-onboarding-target="sample-card"]');
  await waitState(s => s.step === 'matpreview' && s.sub === 1, 20000, 'matpreview-1').catch(async () => { await sleep(10500); await advanceGeneric(); });
  await sleep(1500); await shot('matpreview-1');
  await clickWait('.ao-coach [data-ao="next"]');
  await waitState(s => s.step === 'ask', 20000, 'ask'); await sleep(1500); recordStep('ask-0'); await shot('ask-0');
  await clickWait('.ao-coach [data-ao="answer"][data-answer="none"]');
  await waitState(s => s.step === 'ask' && s.sub === 1, 20000, 'ask-1'); await sleep(1200); await shot('ask-1');
  await clickWait('.ao-coach [data-ao="replay"]');
  await waitState(s => s.step === 'prompt', 20000, 'prompt'); await sleep(6500); recordStep('prompt-0'); await shot('prompt-typed');
  results.promptTyped = await M(`(document.querySelector('.ao-typed') || {}).textContent || ''`); save();
  await clickWait('.ao-coach [data-ao="insert"]');
  await waitState(s => s.step === 'prompt' && s.sub === 1, 20000, 'prompt-1'); await sleep(1200);
  results.promptInput = await M(`(document.querySelector('[data-akari-onboarding-target="replay-input"]') || {}).value || ''`); save();
  log('prompt input:', results.promptInput);
  await shot('prompt-input');
  await clickWait('.ao-coach [data-ao="send"]');
  await waitState(s => s.step === 'work', 20000, 'work');
  // work: 1 秒ごとに edit.json / captions.json とログの live を採り、2.5 秒ごとに撮る
  const workStart = Date.now();
  let lastShot = 0;
  while (Date.now() - workStart < 90000) {
    const s = readState();
    const edit = readEdit();
    const items = edit ? (edit.tracks || []).flatMap(t => (t.items || []).map(i => ({ track: t.id, kind: i.source && i.source.kind }))) : [];
    let captions = 0; try { captions = JSON.parse(readFileSync(join(project, 'captions.json'), 'utf8')).captions.length; } catch {}
    const live = await M(`(document.querySelector('.ao-live') || {}).textContent || ''`).catch(() => '');
    const logTail = await M(`(() => { const e = document.querySelector('.ao-chat-log'); return e ? e.textContent.split('\\n').slice(-2).join(' / ') : ''; })()`).catch(() => '');
    const trackHeaders = await M(`[...document.querySelectorAll('.akari-track-header-name')].map(e => e.textContent.trim()).join(' / ')`).catch(() => '');
    const timelineItems = await M(`(() => { const w = [...document.querySelectorAll('.theia-widget, .lm-Widget')].find(e => /timeline/i.test(e.id || '') && e.offsetWidth > 0); return w ? w.innerText.replace(/\s+/g, ' ').slice(0, 240) : ''; })()`).catch(() => null);
    results.work.push({ t: +((Date.now() - workStart) / 1000).toFixed(1), step: s && s.step, html: items.filter(i => i.kind === 'html').length,
      audio: items.filter(i => /audio|bgm/.test(String(i.kind)) || /bgm|audio|music/i.test(String(i.track))).length, captionsItem: items.filter(i => i.kind === 'captions').length,
      media: items.filter(i => i.kind === 'media').length, kinds: items.map(i => `${i.track}:${i.kind}`).join(','), captions, live, logTail, trackHeaders,
      editAudio: edit && edit.audio ? Object.keys(edit.audio).join(',') : '' });
    save();
    if (s && s.step !== 'work') break;
    if (Date.now() - lastShot > 2500) { lastShot = Date.now(); await shot(`work-${Math.round((Date.now() - workStart) / 1000)}s`).catch(() => {}); }
    await sleep(1000);
  }
  results.workSeconds = +((Date.now() - workStart) / 1000).toFixed(1);
  results.finalEdit = summarize(readEdit()); save();
  await waitState(s => s.step === 'play', 30000, 'play');
  await sleep(2000); recordStep('play-0'); await shot('play-0');
  results.playCoach0 = await coach(); save();
  // 出力プレビューの iframe を掴み、音の測定器を差し込む
  const ctx = await previewCtx(90000);
  if (!ctx) throw new Error('preview ctx not found');
  await P(ctx, `(() => {
    window.__odr = { samples: [], lastT: 0, ticks: 0 };
    const clock = window.akari.frameEngineClock;
    const orig = AnalyserNode.prototype.getFloatTimeDomainData;
    if (!AnalyserNode.prototype.__odrPatched) {
      AnalyserNode.prototype.__odrPatched = true;
      AnalyserNode.prototype.getFloatTimeDomainData = function (arr) {
        orig.call(this, arr);
        try {
          let sum = 0, peak = 0; for (let i = 0; i < arr.length; i++) { const v = arr[i]; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
          const t = clock && Number.isFinite(clock.currentTime) ? clock.currentTime : (Number(document.getElementById('seek').value) || 0);
          window.__odr.samples.push({ t, rms: Math.sqrt(sum / arr.length), peak, n: arr.length, now: performance.now() });
        } catch {}
      };
    }
    return true; })()`);
  const clockTime = () => P(ctx, `(() => { const c = window.akari.frameEngineClock; const s = document.getElementById('seek'); return { clock: c && c.currentTime, seek: s && Number(s.value), playing: !!(window.akariFrameEngineAudioDebug && window.akariFrameEngineAudioDebug().playing) }; })()`);
  results.play.clockProbe = await clockTime(); save();
  // 図解の区間（edit.json の html item）
  const fin = readEdit();
  const fps = (fin && fin.output && fin.output.fps) || 30;
  const figs = fin ? (fin.tracks || []).flatMap(t => (t.items || []).filter(i => i.source && i.source.kind === 'html').map(i => ({ id: i.id, path: i.source.path, start: i.at / fps, end: (i.at + i.duration) / fps }))) : [];
  results.play.figures = figs; save();
  const shotTimes = figs.length ? figs.map(f => ({ label: f.id, t: Math.min(f.end - 0.4, f.start + 1.2) })) : [{ label: 'mid-8.6', t: 8.6 }, { label: 'mid-23', t: 23 }];
  // 再生（▶）— iframe 内の #play-toggle
  await P(ctx, `document.getElementById('play-toggle').click()`);
  await waitState(s => s.step === 'play' && s.sub === 1, 20000, 'play-1').catch(e => results.errors.push(String(e)));
  const playStart = Date.now();
  const measures = [];
  let si = 0;
  while (Date.now() - playStart < 60000) {
    const c = await clockTime().catch(() => ({}));
    const t = Number.isFinite(c.clock) ? c.clock : c.seek;
    if (si < shotTimes.length && t >= shotTimes[si].t) {
      const f = await shot(`playing-${shotTimes[si].label}-${t.toFixed(1)}s`);
      const zoom = await shotClip(`zoom-${shotTimes[si].label}-${t.toFixed(1)}s`).catch(e => String(e));
      const geom = await P(ctx, `(() => {
        const stage = document.querySelector('[data-frame-engine-ready]') || document.body; const sr = stage.getBoundingClientRect();
        const rel = r => ({ x0: +((r.left - sr.left) / sr.width).toFixed(3), x1: +((r.right - sr.left) / sr.width).toFixed(3), y0: +((r.top - sr.top) / sr.height).toFixed(3), y1: +((r.bottom - sr.top) / sr.height).toFixed(3) });
        const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.width < sr.width * 0.9; };
        const union = els => { let a = null; for (const e of els) { const r = e.getBoundingClientRect(); a = a ? { left: Math.min(a.left, r.left), top: Math.min(a.top, r.top), right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; } return a; };
        const figs = [...document.querySelectorAll('[data-overlay-id^="figure-"], [data-item-id^="figure-"]')].map(o => { const inner = [...o.querySelectorAll('*')].filter(vis); const u = union(inner); return { id: o.getAttribute('data-overlay-id') || o.getAttribute('data-item-id'), opacity: getComputedStyle(o).opacity, box: u && rel(u), text: (o.innerText || '').replace(/\\s+/g, ' ').slice(0, 80) }; });
        const texts = [...stage.querySelectorAll('*')].filter(e => !e.closest('[data-overlay-id^="figure-"]') && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && vis(e) && !/STYLE|SCRIPT/.test(e.tagName)).map(e => ({ text: e.textContent.trim().slice(0, 30), ...rel(e.getBoundingClientRect()) })).filter(t => t.y0 >= -0.05 && t.y1 <= 1.05 && t.x0 >= -0.05 && t.x1 <= 1.05);
        return { stage: { w: sr.width, h: sr.height }, figures: figs, texts };
      })()`).catch(e => ({ error: String(e) }));
      measures.push({ label: shotTimes[si].label, t, shot: f, geom });
      results.play.atFigures = measures; save();
      si++;
    }
    if (Number.isFinite(t) && t >= 37.3) break;
    await sleep(60);
  }
  results.play.wallSeconds = +((Date.now() - playStart) / 1000).toFixed(1);
  const audio = await P(ctx, `(() => { const s = window.__odr.samples; return s.map(x => [+x.t.toFixed(3), +x.rms.toFixed(5), +x.peak.toFixed(4)]); })()`);
  // 区間ごとの dBFS（同じ時刻の L/R 2 つの tap は平均）
  const db = v => v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -120;
  const win = (a, b) => { const xs = audio.filter(([t, r]) => t >= a && t < b && r > 0).map(x => x[1]); if (!xs.length) return null; const rms = Math.sqrt(xs.reduce((p, v) => p + v * v, 0) / xs.length); return { n: xs.length, rmsDb: db(rms) }; };
  const speech = [[3.0, 7.0], [8.0, 10.5], [11.5, 14.3], [15.5, 21.5], [22.7, 24.9], [29.6, 32.4], [33.3, 35.5]];
  const gaps = [[1.45, 2.25], [25.2, 26.9]];
  results.play.audio = { samples: audio.length, speech: speech.map(([a, b]) => ({ a, b, ...win(a, b) })), gaps: gaps.map(([a, b]) => ({ a, b, ...win(a, b) })), tail: win(35.8, 37.4) };
  writeFileSync(join(EVID, `l1-${mode}-audio-samples.json`), JSON.stringify(audio));
  save();
  log('audio', JSON.stringify(results.play.audio));
  await sleep(1500);
  await shot('play-1');
  // 以降: caption / daihon / export / done
  lastKey = '';
  const exportStart = { t: null };
  for (let guard = 0; guard < 600; guard++) {
    const s = readState();
    if (!s) { await sleep(500); continue; }
    if (s.step === 'done') break;
    const key = `${s.step}:${s.sub}`;
    if (key !== lastKey) {
      lastKey = key; await sleep(1200); recordStep(key); await shot(key.replace(':', '-')).catch(() => {});
      if (s.step === 'caption' && s.sub === 0) { await sleep(10500); }
    }
    if (s.step === 'export' && s.sub === 3) { if (!exportStart.t) exportStart.t = Date.now(); await sleep(1000); continue; }
    if (s.step === 'export' && s.sub < 3) {
      const target = ['menu-button', 'export-button', 'export-submit'][s.sub];
      await sleep(800);
      const ok = await click(`[data-akari-onboarding-target="${target}"]`).catch(() => false);
      if (!ok) await advanceGeneric().catch(() => null);
      await sleep(1500);
      continue;
    }
    await advanceGeneric().catch(() => null);
    await sleep(900);
  }
  results.export.uiSeconds = exportStart.t ? +((Date.now() - exportStart.t) / 1000).toFixed(1) : null;
  await sleep(2500); recordStep('done'); await shot('done');
  // 書き出した mp4
  const exportsDir = join(project, 'exports');
  const mp4 = existsSync(exportsDir) ? readdirSync(exportsDir).filter(n => n.toLowerCase().endsWith('.mp4')).map(n => join(exportsDir, n)) : [];
  results.export.files = mp4.map(p => ({ path: p, bytes: statSync(p).size }));
  if (mp4[0]) {
    const probe = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels', '-of', 'json', mp4[0]]).toString());
    results.export.ffprobe = probe;
    const frames = [];
    for (const { label, t } of shotTimes) {
      const out = join(EVID, `${mode}-export-frame-${label}-${t.toFixed(1)}s.png`);
      execFileSync(FFMPEG, ['-v', 'error', '-y', '-ss', String(t), '-i', mp4[0], '-frames:v', '1', out]);
      frames.push(out);
    }
    results.export.frames = frames;
    const level = (a, b) => { const r = spawnSync(FFMPEG, ['-hide_banner', '-ss', String(a), '-t', String(b - a), '-i', mp4[0], '-vn', '-af', 'volumedetect', '-f', 'null', 'NUL'], { encoding: 'utf8' }); const e = r.stderr || ''; const m = e.match(/mean_volume: ([-0-9.]+) dB/); const p = e.match(/max_volume: ([-0-9.]+) dB/); return { mean: m && Number(m[1]), max: p && Number(p[1]) }; };
    results.export.levels = { speech: speech.map(([a, b]) => ({ a, b, ...level(a, b) })), gaps: gaps.map(([a, b]) => ({ a, b, ...level(a, b) })) };
  }
  save();
} catch (e) {
  console.error('FAILED', e);
  results.error = String(e && e.stack || e);
  try { await shot('error'); } catch {}
} finally {
  save();
  try { await send('Browser.close'); } catch {}
  await sleep(6000);
  killMine();
  save();
  log('end');
  setTimeout(() => process.exit(), 500);
}
