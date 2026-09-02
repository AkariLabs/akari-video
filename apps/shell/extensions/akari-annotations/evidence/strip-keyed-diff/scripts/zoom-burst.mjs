#!/usr/bin/env node
// ピンチズーム連打（burst）計測（task/2026-09-02-preview-perf）。
//
// measure-a.mjs の操作 2 は ctrl+wheel を 1 発ずつ投げて paint を待つため、トラックパッドのピンチで
// wheel が 60–120 Hz で連続して届く実態（同一フレーム内の描画折りたたみ）が数値に出ない。
// このスクリプトは ctrl+wheel を 120 Hz 相当（8 ms 間隔）で 40 発、paint を待たずに投げ、
// burst ごとに次を記録する。
//   - wallMs: 最初の入力から strip の DOM が静穏化（最後の変異から 150 ms）するまでの実時間
//   - settleMs: 最後の入力から最後の変異までの遅れ（入力に対する追随の遅れ）
//   - mutationFrames: strip に変異が起きた rAF フレーム数（≒ renderStrip の実行回数）
//   - mutationRecords: MutationObserver のレコード数（DOM を触った量の近似）
//   - rafIntervalMaxMs / rafOver33: burst 中の rAF 間隔の最大値と 33 ms 超の回数（コマ落ち）
//   - longTasks / longTaskMs: PerformanceObserver('longtask')
//   - Performance.getMetrics の差分（ScriptDuration / LayoutDuration / RecalcStyleDuration）
// 起動・プロジェクトを開く経路は measure-a.mjs と同じ（メニュー → タイムライン）。
//
// Usage (このディレクトリで):
//   node --experimental-websocket scripts/zoom-burst.mjs --n=200,800 --output=results/zoom-burst-before.json --label=before
import { spawn } from 'node:child_process';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, wheel } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHELL_DIR = process.env.AKARI_SHELL_DIR || path.resolve(ROOT, '..', '..', '..', '..');
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const outputArg = arg('output', path.join(ROOT, 'evidence', 'runs', 'zoom-burst.json'));
const requestedNs = arg('n', '200,800').split(',').map(Number);
const labelArg = arg('label', null);
const BURSTS = Number(arg('bursts', '6'));
const EVENTS_PER_BURST = Number(arg('events', '40'));
const INTERVAL_MS = Number(arg('interval', '8'));
const STRIP = '#akari-annotations-widget .akari-annotations-strip';
const ALL_ITEMS = '[data-akari-item-kind]';
const result = { status: 'running', label: labelArg, startedAt: new Date().toISOString(), config: { bursts: BURSTS, eventsPerBurst: EVENTS_PER_BURST, intervalMs: INTERVAL_MS }, environment: { loadAverageAtStart: os.loadavg(), shell: SHELL_DIR }, subjects: {}, notes: [] };
const errorText = error => String(error?.stack || error?.message || error);
const nowAbs = () => performance.timeOrigin + performance.now();
const withTimeout = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))]);
const percentile = (values, p) => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null; };
const median = values => percentile(values, .5);
const atomic = async () => { await mkdir(path.dirname(outputArg), { recursive: true }); const temp = `${outputArg}.tmp-${process.pid}`; await writeFile(temp, `${JSON.stringify(result, null, 2)}\n`); await rename(temp, outputArg); };

async function runCommand(command, args, { timeoutMs = 30_000, cwd = ROOT } = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 3000).unref(); }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); resolve({ ok: false, stdout, stderr, reason: errorText(error) }); });
    child.once('close', code => { clearTimeout(timer); resolve({ ok: code === 0, stdout, stderr, reason: code === 0 ? null : timedOut ? `timeout ${timeoutMs}ms` : `exit ${code}: ${stderr.slice(-2000)}` }); });
  });
}

async function launch(project, port, iso, log) {
  const launched = await runCommand('/bin/zsh', [path.join(ROOT, 'scripts', 'launch-shell.sh'), project, String(port), iso, log], { timeoutMs: 15_000 });
  if (!launched.ok) throw new Error(`launch-shell failed: ${launched.reason}`);
  const pid = Number(launched.stdout.trim().split(/\s+/).at(-1)); if (!Number.isInteger(pid)) throw new Error(`launch-shell returned no pid: ${launched.stdout}`);
  return { pid, stop: () => { try { process.kill(pid, 'SIGTERM'); } catch {} setTimeout(() => { try { process.kill(pid, 'SIGKILL'); } catch {} }, 3000).unref(); } };
}

async function waitTarget(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) { try { const page = (await withTimeout(listTargets(port), 1500, 'target list')).find(target => target.type === 'page'); if (page) return page; } catch (error) { last = error; } await sleep(250); }
  throw new Error(`shell CDP target unavailable: ${errorText(last)}`);
}

async function waitEval(cdp, expression, { timeoutMs = 10_000, intervalMs = 50, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) {
    try { const value = await withTimeout(evalOn(cdp, expression), Math.min(2000, Math.max(1, deadline - Date.now())), label); if (value) return value; } catch (error) { last = error; }
    if (Date.now() < deadline) await sleep(Math.min(intervalMs, deadline - Date.now()));
  }
  throw new Error(`${label} not reached: ${errorText(last)}`);
}

async function enableCdpDomain(cdp, method) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try { return await cdp.send(method); } catch (error) { lastError = error; if (attempt < 6) await sleep(5000); }
  }
  throw lastError;
}

// measure-a.mjs と同じ経路: ワークベンチ待ち → メニュー → タイムライン → 可視アイテム数の安定。
async function openProject(cdp, timeoutMs) {
  const startedAt = nowAbs(), deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(0, deadline - Date.now());
  const pause = async (ms, label) => { if (remaining() < ms) throw new Error(`${label}: openProject deadline exceeded`); await sleep(ms); };
  const boundedWait = (expression, maxMs, label) => { const budget = Math.min(maxMs, remaining()); if (budget <= 0) throw new Error(`${label}: openProject deadline exceeded`); return waitEval(cdp, expression, { timeoutMs: budget, intervalMs: 250, label }); };
  await boundedWait(`Boolean(document.readyState==='complete'&&document.getElementById('theia-app-shell')&&document.getElementById('akari-home-widget'))`, 90_000, 'Theia workbench ready');
  await pause(8000, 'post-workbench activation guard');
  let lastFailure = 'no route attempt completed';
  for (let attempts = 1; attempts <= 6 && remaining() > 0; attempts++) {
    try {
      await withTimeout(cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1150, deviceScaleFactor: 0, mobile: false }), Math.min(10_000, remaining()), 'device metrics override');
      await pause(500, 'post-emulation wait');
      const menu = await boundedWait(`(() => {const e=[...document.querySelectorAll('#theia-left-content-panel .lm-TabBar-tab')].find(node=>node.textContent.trim()==='メニュー'&&node.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`, 20_000, 'visible メニュー tab');
      await withTimeout(realClick(cdp, menu.x, menu.y), Math.min(5000, remaining()), 'メニュー click');
      await pause(1200, 'post-menu activation wait');
      const timeline = await boundedWait(`(() => {const e=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()==='タイムライン'&&node.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`, 8000, 'visible タイムライン button');
      await evalOn(cdp, 'delete window.__benchAReadyState');
      await withTimeout(realClick(cdp, timeline.x, timeline.y), Math.min(5000, remaining()), 'タイムライン click');
      const stable = await boundedWait(`(() => { const strip=document.querySelector(${JSON.stringify(STRIP)}); if(!strip)return null; const count=strip.querySelectorAll(${JSON.stringify(ALL_ITEMS)}).length; const s=window.__benchAReadyState ||= {last:-1,same:0}; s.same=count===s.last?s.same+1:0;s.last=count;return count>0&&s.same>=4?count:null; })()`, Math.min(remaining(), 60_000), 'visible item set stable');
      return { openMs: nowAbs() - startedAt, visibleItemCount: stable, attempts };
    } catch (error) {
      lastFailure = errorText(error);
      if (attempts < 6 && remaining() >= 3000) await sleep(3000); else break;
    }
  }
  throw new Error(`timeline open failed: ${lastFailure}`);
}

const burstProbeScript = `(() => {
  const old=window.__zoomBurstProbe; if(old?.dispose)old.dispose();
  const strip=document.querySelector(${JSON.stringify(STRIP)}); if(!strip)return {armed:false,reason:'strip missing'};
  const abs=()=>performance.timeOrigin+performance.now();
  const state={firstInputAt:null,lastInputAt:null,inputs:0,mutationRecords:0,mutationFrames:0,firstMutationAt:null,lastMutationAt:null,rafIntervals:[],longTasks:0,longTaskMs:0,done:false};
  let frameDirty=false,lastFrameAt=null,rafHandle=0;
  const onInput=()=>{const t=abs();state.inputs++;state.firstInputAt??=t;state.lastInputAt=t;};
  window.addEventListener('wheel',onInput,true);
  const observer=new MutationObserver(records=>{if(state.firstInputAt===null)return;state.mutationRecords+=records.length;frameDirty=true;const t=abs();state.firstMutationAt??=t;state.lastMutationAt=t;});
  observer.observe(strip,{childList:true,subtree:true,attributes:true,characterData:true});
  let po=null; try{po=new PerformanceObserver(list=>{for(const e of list.getEntries()){state.longTasks++;state.longTaskMs+=e.duration;}});po.observe({entryTypes:['longtask']});}catch{}
  const tick=now=>{if(state.done)return;if(state.firstInputAt!==null){if(lastFrameAt!==null)state.rafIntervals.push(now-lastFrameAt);lastFrameAt=now;if(frameDirty){state.mutationFrames++;frameDirty=false;}}rafHandle=requestAnimationFrame(tick);};
  rafHandle=requestAnimationFrame(tick);
  const dispose=()=>{state.done=true;observer.disconnect();window.removeEventListener('wheel',onInput,true);po?.disconnect();cancelAnimationFrame(rafHandle);};
  state.dispose=dispose; window.__zoomBurstProbe=state; return {armed:true};
})()`;

async function performanceMetrics(cdp) { const response = await cdp.send('Performance.getMetrics'); return Object.fromEntries(response.metrics.map(metric => [metric.name, metric.value])); }
function metricDelta(before, after) { const names = ['LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'LayoutCount']; return Object.fromEntries(names.map(name => [name, Number.isFinite(before[name]) && Number.isFinite(after[name]) ? after[name] - before[name] : null])); }

async function burst(cdp, rect, deltaY) {
  const armed = await evalOn(cdp, burstProbeScript); if (!armed.armed) return { status: 'not-reached', reason: armed.reason };
  const before = await performanceMetrics(cdp);
  const dispatchStartedAt = nowAbs();
  for (let i = 0; i < EVENTS_PER_BURST; i++) {
    await withTimeout(wheel(cdp, rect.x, rect.y, 0, deltaY, { ctrlKey: true }), 5000, 'wheel dispatch');
    if (INTERVAL_MS > 0) await sleep(INTERVAL_MS);
  }
  const dispatchMs = nowAbs() - dispatchStartedAt;
  // 静穏化: 最後の入力・最後の変異から 150 ms 何も起きなければ終了（上限 5 s）。
  const quiet = await waitEval(cdp, `(() => {const p=window.__zoomBurstProbe;if(!p||p.firstInputAt===null)return null;const now=performance.timeOrigin+performance.now();const lastAct=Math.max(p.lastInputAt??0,p.lastMutationAt??0);return now-lastAct>150?({...p,dispose:undefined}):null;})()`, { timeoutMs: 5000, intervalMs: 25, label: 'burst quiet' }).catch(error => ({ reason: errorText(error) }));
  const after = await performanceMetrics(cdp);
  await evalOn(cdp, 'window.__zoomBurstProbe?.dispose?.()');
  if (!Number.isFinite(quiet?.firstInputAt)) return { status: 'not-reached', reason: quiet?.reason || 'no wheel input observed', dispatchMs };
  const intervals = quiet.rafIntervals || [];
  return {
    status: 'completed', deltaY, inputs: quiet.inputs, dispatchMs,
    wallMs: Number.isFinite(quiet.lastMutationAt) ? quiet.lastMutationAt - quiet.firstInputAt : null,
    settleMs: Number.isFinite(quiet.lastMutationAt) ? quiet.lastMutationAt - quiet.lastInputAt : null,
    firstMutationDelayMs: Number.isFinite(quiet.firstMutationAt) ? quiet.firstMutationAt - quiet.firstInputAt : null,
    mutationFrames: quiet.mutationFrames, mutationRecords: quiet.mutationRecords,
    rafIntervalMaxMs: intervals.length ? Math.max(...intervals) : null, rafIntervalP95Ms: percentile(intervals, .95), rafOver33: intervals.filter(v => v > 33).length, rafSamples: intervals.length,
    longTasks: quiet.longTasks, longTaskMs: quiet.longTaskMs,
    performance: metricDelta(before, after), loadAverage: os.loadavg()
  };
}

function summarize(bursts) {
  const completed = bursts.filter(b => b.status === 'completed');
  const med = key => median(completed.map(b => b[key]));
  const perf = key => median(completed.map(b => b.performance?.[key]));
  return completed.length ? {
    completed: completed.length, wallMs: med('wallMs'), settleMs: med('settleMs'), mutationFrames: med('mutationFrames'), mutationRecords: med('mutationRecords'),
    rafIntervalMaxMs: med('rafIntervalMaxMs'), rafOver33: med('rafOver33'), longTasks: med('longTasks'), longTaskMs: med('longTaskMs'),
    scriptSeconds: perf('ScriptDuration'), layoutSeconds: perf('LayoutDuration'), styleSeconds: perf('RecalcStyleDuration'),
    wallMsMax: Math.max(...completed.map(b => b.wallMs ?? 0)), longTaskMsMax: Math.max(...completed.map(b => b.longTaskMs ?? 0))
  } : null;
}

async function oneSubject(n, index) {
  const project = path.join(ROOT, 'fixtures', `n${n}`);
  await rm(path.join(project, 'cache', 'timeline'), { recursive: true, force: true });
  const port = 21500 + index, iso = path.join(os.tmpdir(), 'akari-timeline-bench', `a-n${n}-run9`), log = path.join(ROOT, 'evidence', `console-zoom-burst-n${n}.log`);
  const record = { n, isolationDir: iso, status: 'running', open: null, bursts: [], summary: null };
  let launched, cdp;
  try {
    launched = await launch(project, port, iso, log); const target = await waitTarget(port); cdp = new CDP(target.webSocketDebuggerUrl);
    await withTimeout(cdp.connect(), 5000, 'CDP connect'); await enableCdpDomain(cdp, 'Page.enable'); await enableCdpDomain(cdp, 'Runtime.enable'); await enableCdpDomain(cdp, 'Performance.enable');
    record.open = await openProject(cdp, 300_000);
    await sleep(3000);
    if (!result.environment.userAgent) { try { const version = await cdp.send('Browser.getVersion'); result.environment.userAgent = version.userAgent; } catch {} }
    const rect = await evalOn(cdp, `(() => {const r=document.querySelector(${JSON.stringify(STRIP)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+Math.min(40,r.height/2)}})()`);
    for (let b = 0; b < BURSTS; b++) {
      // 偶数 burst はズームイン（deltaY<0）、奇数 burst はズームアウト。100% から始めて往復する。
      record.bursts.push({ burst: b + 1, ...(await burst(cdp, rect, b % 2 === 0 ? -100 : 100)) });
      await atomic();
      await sleep(500);
    }
    record.summary = summarize(record.bursts);
    record.status = record.summary ? 'completed' : 'not-reached';
  } catch (error) { record.status = 'not-reached'; record.reason = errorText(error); }
  finally { try { cdp?.close(); } catch {} launched?.stop(); }
  return record;
}

await atomic();
for (const [index, n] of requestedNs.entries()) {
  result.subjects[n] = await oneSubject(n, index);
  await atomic();
  const s = result.subjects[n].summary;
  process.stdout.write(`${JSON.stringify({ n, status: result.subjects[n].status, reason: result.subjects[n].reason ?? null, summary: s })}\n`);
}
result.status = 'completed'; result.finishedAt = new Date().toISOString(); await atomic();
process.stdout.write(`${JSON.stringify({ status: result.status, output: outputArg })}\n`);
