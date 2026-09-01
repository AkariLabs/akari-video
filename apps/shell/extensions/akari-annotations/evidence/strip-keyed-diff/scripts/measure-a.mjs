#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readdir, rename, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, keyPress, listTargets, realClick, wheel } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// apps/shell は <lab>/../../../..（ローカルの worktree 配置は書かない）
const SHELL_DIR = process.env.AKARI_SHELL_DIR || path.resolve(ROOT, '..', '..', '..', '..');
const outputArg = process.argv.find(value => value.startsWith('--output='))?.slice(9) || path.join(ROOT, 'evidence', 'runs', 'a.json');
const requestedNs = (process.argv.find(value => value.startsWith('--n='))?.slice(4) || '5,50,200,800').split(',').map(Number);
const labelArg = process.argv.find(value => value.startsWith('--label='))?.slice(8) || null;
const STRIP = '#akari-annotations-widget .akari-annotations-strip';
const ALL_ITEMS = '[data-akari-item-kind]';
const result = { status: 'running', label: labelArg, startedAt: new Date().toISOString(), environment: { loadAverageAtStart: os.loadavg() }, subjects: { A: {} }, notes: [] };
let environmentCaptured = false;
const errorText = error => String(error?.stack || error?.message || error);
const nowAbs = () => performance.timeOrigin + performance.now();
const withTimeout = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))]);
const percentile = (values, p) => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null; };
const summary = values => { const clean = values.filter(Number.isFinite); return clean.length ? { count: clean.length, medianMs: percentile(clean, .5), p95Ms: percentile(clean, .95), maxMs: Math.max(...clean), over16_7: clean.filter(v => v > 16.7).length, over33: clean.filter(v => v > 33).length } : null; };
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

async function frontendBundleEnvironment() {
  try {
    const bundle = path.join(SHELL_DIR, 'lib', 'frontend', 'bundle.js');
    const bundleStat = await stat(bundle);
    // 出所を一意にするため、計測したシェル (SHELL_DIR) 側の HEAD と bundle.js の sha256 を記録する。
    const revision = await runCommand('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: SHELL_DIR });
    const sourceMatch = revision.ok ? revision.stdout.trim() || null : null;
    const digest = createHash('sha256');
    await pipeline(createReadStream(bundle), digest);
    return { mtime: bundleStat.mtime.toISOString(), sizeBytes: bundleStat.size, sourceMatch, sha256: digest.digest('hex') };
  } catch {
    return null;
  }
}

async function launch(project, port, iso, log) {
  const launch = await runCommand('/bin/zsh', [path.join(ROOT, 'scripts', 'launch-shell.sh'), project, String(port), iso, log], { timeoutMs: 15_000 });
  if (!launch.ok) throw new Error(`launch-shell failed: ${launch.reason}`);
  const pid = Number(launch.stdout.trim().split(/\s+/).at(-1)); if (!Number.isInteger(pid)) throw new Error(`launch-shell returned no pid: ${launch.stdout}`);
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
    try { return await cdp.send(method); }
    catch (error) { lastError = error; if (attempt < 6) await sleep(5000); }
  }
  throw lastError;
}

async function openProject(cdp, timeoutMs) {
  const startedAt = nowAbs(), deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(0, deadline - Date.now());
  const pause = async (ms, label) => { if (remaining() < ms) throw new Error(`${label}: openProject deadline exceeded`); await sleep(ms); };
  const boundedWait = (expression, maxMs, label) => {
    const budget = Math.min(maxMs, remaining());
    if (budget <= 0) throw new Error(`${label}: openProject deadline exceeded`);
    return waitEval(cdp, expression, { timeoutMs: budget, intervalMs: 250, label });
  };

  await boundedWait(`Boolean(document.readyState==='complete'&&document.getElementById('theia-app-shell')&&document.getElementById('akari-home-widget'))`, 90_000, 'Theia workbench ready');
  await pause(8000, 'post-workbench activation guard');

  let lastFailure = 'no route attempt completed', attempts = 0;
  for (attempts = 1; attempts <= 6 && remaining() > 0; attempts++) {
    try {
      await withTimeout(cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1150, deviceScaleFactor: 0, mobile: false }), Math.min(10_000, remaining()), 'device metrics override');
      await pause(500, 'post-emulation wait');
      const menu = await boundedWait(`(() => {const e=[...document.querySelectorAll('#theia-left-content-panel .lm-TabBar-tab')].find(node=>node.textContent.trim()==='メニュー'&&node.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`, 20_000, 'visible メニュー tab');
      await withTimeout(realClick(cdp, menu.x, menu.y), Math.min(5000, remaining()), 'メニュー click');
      await pause(1200, 'post-menu activation wait');
      const timeline = await boundedWait(`(() => {const e=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()==='タイムライン'&&node.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`, 8000, 'visible タイムライン button');
      await evalOn(cdp, 'delete window.__benchAReadyState');
      await withTimeout(realClick(cdp, timeline.x, timeline.y), Math.min(5000, remaining()), 'タイムライン click');
      const attemptsLeft = 7 - attempts;
      const stableBudget = Math.min(remaining(), Math.max(5000, Math.floor(remaining() / attemptsLeft)));
      const stable = await boundedWait(`(() => { const strip=document.querySelector(${JSON.stringify(STRIP)}); if(!strip)return null; const count=strip.querySelectorAll(${JSON.stringify(ALL_ITEMS)}).length; const s=window.__benchAReadyState ||= {last:-1,same:0}; s.same=count===s.last?s.same+1:0;s.last=count;return count>0&&s.same>=4?count:null; })()`, stableBudget, 'visible item set stable');
      return { openMs: nowAbs() - startedAt, visibleItemCount: stable, attempts, deviceMetrics: { width: 1800, height: 1150, deviceScaleFactor: 0, mobile: false }, route: ['メニュー', 'タイムライン'] };
    } catch (error) {
      lastFailure = errorText(error);
      if (attempts < 6 && remaining() >= 3000) await sleep(3000); else break;
    }
  }
  throw new Error(`timeline open failed after ${Math.min(attempts, 6)} attempt(s): ${lastFailure}`);
}

async function cacheSignature(directory) {
  let files = 0, bytes = 0, latest = 0;
  async function walk(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) await walk(file); else { const value = await stat(file); files++; bytes += value.size; latest = Math.max(latest, value.mtimeMs); } } }
  try { await walk(directory); return { files, bytes, latest }; } catch { return { files: 0, bytes: 0, latest: 0 }; }
}
async function waitCacheQuiet(project, timeoutMs = 300_000) {
  const directory = path.join(project, 'cache', 'timeline'), deadline = Date.now() + timeoutMs; let last = '', same = 0, signature;
  while (Date.now() < deadline) { signature = await cacheSignature(directory); const key = JSON.stringify(signature); same = key === last && signature.files > 0 ? same + 1 : 0; if (same >= 5) return { status: 'completed', signature, elapsedMs: timeoutMs - (deadline - Date.now()) }; last = key; await sleep(1000); }
  return { status: 'not-reached', reason: `cache/timeline did not become non-empty and quiet within ${timeoutMs}ms`, signature };
}

const probeScript = (eventType, op) => `(() => {
  const old=window.__timelineBenchProbe; if(old?.dispose)old.dispose(); const strip=document.querySelector(${JSON.stringify(STRIP)}); if(!strip)return {armed:false,reason:'strip missing'};
  const abs=()=>performance.timeOrigin+performance.now(); const state={op:${JSON.stringify(op)},inputAt:null,mutationAt:null,paintAt:null,mutations:0,done:false};
  let raf1=0,raf2=0; const onInput=()=>{state.inputAt=abs()}; window.addEventListener(${JSON.stringify(eventType)},onInput,true);
  const observer=new MutationObserver(records=>{if(state.inputAt===null)return;state.mutations+=records.length;state.mutationAt??=abs();if(!raf1)raf1=requestAnimationFrame(()=>{raf2=requestAnimationFrame(()=>{state.paintAt=abs();state.done=true;dispose()})})});
  observer.observe(strip,{childList:true,subtree:true,attributes:true,characterData:true});
  const dispose=()=>{observer.disconnect();window.removeEventListener(${JSON.stringify(eventType)},onInput,true);if(raf1)cancelAnimationFrame(raf1);if(raf2)cancelAnimationFrame(raf2)};
  state.dispose=dispose; window.__timelineBenchProbe=state; setTimeout(()=>{if(!state.done){state.done=true;state.reason='no strip mutation within 3000ms';dispose()}},3000); return {armed:true};
})()`;
async function observedInput(cdp, eventType, op, dispatch) {
  const armed = await evalOn(cdp, probeScript(eventType, op)); if (!armed.armed) return { status: 'not-reached', reason: armed.reason };
  await withTimeout(dispatch(), 2000, `${op} input`);
  const state = await waitEval(cdp, `window.__timelineBenchProbe?.done ? ({...window.__timelineBenchProbe,dispose:undefined}) : null`, { timeoutMs: 4000, intervalMs: 10, label: `${op} paint` }).catch(error => ({ reason: errorText(error) }));
  const latencyMs = Number.isFinite(state.paintAt) && Number.isFinite(state.inputAt) ? state.paintAt - state.inputAt : null;
  const workMs = Number.isFinite(state.mutationAt) && Number.isFinite(state.inputAt) ? state.mutationAt - state.inputAt : null;
  return { status: latencyMs === null ? 'not-reached' : 'completed', reason: latencyMs === null ? state.reason || 'input or paint timestamp missing' : null, latencyMs, workMs, mutations: state.mutations, inputAt: state.inputAt, mutationAt: state.mutationAt, paintAt: state.paintAt };
}

async function performanceMetrics(cdp) { const response = await cdp.send('Performance.getMetrics'); return Object.fromEntries(response.metrics.map(metric => [metric.name, metric.value])); }
function metricDelta(before, after) { const names = ['LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'LayoutCount']; return Object.fromEntries(names.map(name => [name, Number.isFinite(before[name]) && Number.isFinite(after[name]) ? after[name] - before[name] : null])); }
async function wheelOperation(cdp, op) {
  const rect = await evalOn(cdp, `(() => {const r=document.querySelector(${JSON.stringify(STRIP)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+Math.min(40,r.height/2)}})()`);
  const values = [], workValues = [], attempts = [], before = await performanceMetrics(cdp); const deltas = op === 'zoom' ? [...Array(20).fill(-100), ...Array(20).fill(100)] : [...Array(20).fill(60), ...Array(20).fill(-60)];
  for (const delta of deltas) { const entry = await observedInput(cdp, 'wheel', op, () => wheel(cdp, rect.x, rect.y, op === 'pan' ? delta : 0, op === 'zoom' ? delta : 0, { ctrlKey: op === 'zoom' })); attempts.push(entry); if (Number.isFinite(entry.latencyMs)) values.push(entry.latencyMs); if (Number.isFinite(entry.workMs)) workValues.push(entry.workMs); await sleep(20); }
  const after = await performanceMetrics(cdp), measured = summary(values), work = summary(workValues);
  return { status: measured ? 'completed' : 'not-reached', reason: measured ? null : attempts.find(value => value.reason)?.reason || 'no mutations observed', samplesMs: values, summary: measured, work: { samplesMs: workValues, ...work }, attempts, performance: metricDelta(before, after), decisionMs: measured?.medianMs ?? null, loadAverage: os.loadavg() };
}

function editWritePoll(file) {
  let baseline; try { const value = statSync(file, { bigint: true }); baseline = `${value.mtimeNs}:${value.size}`; } catch { baseline = 'missing'; }
  const state = { at: null, reason: null }; const timer = setInterval(() => { try { const value = statSync(file, { bigint: true }); if (`${value.mtimeNs}:${value.size}` !== baseline) { state.at = nowAbs(); clearInterval(timer); } } catch (error) { state.reason = errorText(error); } }, 1);
  return { state, stop: () => clearInterval(timer) };
}

async function dragTarget(cdp, preferredKind) {
  return waitEval(cdp, `(() => {
    const strip=document.querySelector(${JSON.stringify(STRIP)}); const scroll=strip?.parentElement;
    if(!strip||!scroll)return null; const sc=scroll.getBoundingClientRect(); const sr=strip.getBoundingClientRect();
    const candidates=[...strip.querySelectorAll(${JSON.stringify(ALL_ITEMS)})].map(element=>({element,r:element.getBoundingClientRect(),kind:element.dataset.akariItemKind,id:element.dataset.akariItemId})).filter(value=>value.r.top>=sc.top&&value.r.bottom<=sc.bottom&&value.r.left>=sc.left&&value.r.right<=sc.right&&value.r.width>=4&&value.r.height>=10);
    const scored=candidates.map(value=>{const right=candidates.filter(other=>other!==value&&other.r.top<value.r.bottom&&other.r.bottom>value.r.top&&other.r.left>=value.r.right).sort((a,b)=>a.r.left-b.r.left)[0];return{...value,rightGap:(right?right.r.left:sr.right)-value.r.right}});
    const preferred=scored.filter(value=>value.kind===${JSON.stringify(preferredKind)}); const pool=preferred.length?preferred:scored.filter(value=>value.kind==='audio');
    const chosen=pool.sort((a,b)=>b.rightGap-a.rightGap)[0]; if(!chosen)return null;
    return{kind:chosen.kind,id:chosen.id,x:chosen.r.left+Math.min(chosen.r.width/2,25),y:chosen.r.top+chosen.r.height/2,width:chosen.r.width,height:chosen.r.height,rightGap:chosen.rightGap,scrollRect:{top:sc.top,bottom:sc.bottom}};
  })()`, { timeoutMs: 5000, intervalMs: 100, label: `visible ${preferredKind} drag target` });
}

async function scrollDragTargetIntoView(cdp, fallbackIndex) {
  return evalOn(cdp, `(() => {
    const strip=document.querySelector(${JSON.stringify(STRIP)}); const scroll=strip?.parentElement;
    if(!strip||!scroll)return null;
    const sc=scroll.getBoundingClientRect(); const viewportHeight=scroll.clientHeight; const max=Math.max(0,scroll.scrollHeight-viewportHeight);
    const intervals=[...strip.querySelectorAll(${JSON.stringify(ALL_ITEMS)})].map(element=>element.getBoundingClientRect()).filter(r=>r.left>=sc.left&&r.right<=sc.right&&r.width>=4&&r.height>=10&&r.height<=viewportHeight).map(r=>{
      const top=r.top-sc.top-scroll.clientTop+scroll.scrollTop; const bottom=top+r.height;
      return{start:Math.max(0,bottom-viewportHeight),end:Math.min(max,top)};
    }).filter(value=>value.start<=value.end);
    if(intervals.length){
      const events=intervals.flatMap(value=>[{position:value.start,delta:1},{position:value.end,delta:-1}]).sort((a,b)=>a.position-b.position||b.delta-a.delta);
      let count=0,bestCount=-1,bestScrollTop=0;
      for(const event of events){count+=event.delta;if(event.delta>0&&count>bestCount){bestCount=count;bestScrollTop=event.position}}
      scroll.scrollTop=bestScrollTop;
      return{strategy:'most-visible',scrollTop:scroll.scrollTop,candidateCount:intervals.length,visibleCount:bestCount};
    }
    const fallbacks=[0,max/2,max]; const requested=fallbacks[${Number.isFinite(fallbackIndex) ? fallbackIndex : 0}%fallbacks.length];
    scroll.scrollTop=requested;
    return{strategy:'fallback',scrollTop:scroll.scrollTop,candidateCount:0,fallbackIndex:${Number.isFinite(fallbackIndex) ? fallbackIndex : 0}%fallbacks.length};
  })()`);
}

async function dragOperation(cdp, editFile) {
  const moveValues = [], upValues = [], moveWorkValues = [], upWorkValues = [], writeValues = [], attempts = [], beforeMetrics = await performanceMetrics(cdp);
  let consecutiveCutRejects = 0;
  for (let run = 0; run < 10; run++) {
    const preferredKind = consecutiveCutRejects >= 3 ? 'audio' : 'cut';
    const record = { run, preferredKind, moves: [], pointerup: null, writeMs: null, committed: false, rejectReason: null };
    let x = 1, y = 1;
    try {
      record.scroll = await scrollDragTargetIntoView(cdp, run); await sleep(100);
      const rect = await dragTarget(cdp, preferredKind); record.target = rect; x = rect.x; y = rect.y;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      for (let move = 0; move < 5; move++) { x += 20; const observed = await observedInput(cdp, 'pointermove', 'drag-move', () => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 })); record.moves.push(observed); if (Number.isFinite(observed.latencyMs)) moveValues.push(observed.latencyMs); if (Number.isFinite(observed.workMs)) moveWorkValues.push(observed.workMs); }
      const poll = editWritePoll(editFile); const observed = await observedInput(cdp, 'pointerup', 'drag-up', () => cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left' }));
      record.pointerup = observed; if (Number.isFinite(observed.latencyMs)) upValues.push(observed.latencyMs); if (Number.isFinite(observed.workMs)) upWorkValues.push(observed.workMs);
      await sleep(150);
      record.rejectReason = await evalOn(cdp, `(() => {const text=document.getElementById('akari-annotations-widget')?.innerText||'';return text.includes('移動できません')?'移動できません（レーンが異なるか、同じ段の中で区間が重なります）。':null})()`);
      if (record.rejectReason) {
        poll.stop(); record.committed = false; record.writeReason = 'commit rejected by timeline widget';
      } else {
        const deadline = Date.now() + 20_000; while (poll.state.at === null && Date.now() < deadline) await sleep(5); poll.stop();
        if (Number.isFinite(poll.state.at) && Number.isFinite(observed.inputAt)) { record.writeMs = poll.state.at - observed.inputAt; writeValues.push(record.writeMs); record.committed = true; }
        else { record.committed = false; record.writeReason = poll.state.reason || 'edit.json did not change within 20s'; }
      }
      if (rect.kind === 'cut') consecutiveCutRejects = record.rejectReason ? consecutiveCutRejects + 1 : 0;
    } catch (error) { record.reason = errorText(error); try { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1, button: 'left' }); } catch {} }
    attempts.push(record); await sleep(100);
  }
  const afterMetrics = await performanceMetrics(cdp), moves = summary(moveValues), pointerup = summary(upValues), write = summary(writeValues);
  const committedCount = attempts.filter(attempt => attempt.committed).length;
  const editWrite = write ? { status: 'completed', samplesMs: writeValues, ...write } : { status: 'not-reached', reason: 'no drag attempt committed; edit.json write was not observable', samplesMs: [] };
  return { status: moves && pointerup ? 'completed' : 'not-reached', reason: moves && pointerup ? null : attempts.find(value => value.reason)?.reason || 'drag observation incomplete', move: { samplesMs: moveValues, ...moves }, pointerup: { samplesMs: upValues, ...pointerup }, work: { move: { samplesMs: moveWorkValues, ...summary(moveWorkValues) }, pointerup: { samplesMs: upWorkValues, ...summary(upWorkValues) } }, editWrite, committedCount, rejectedCount: attempts.filter(attempt => attempt.rejectReason).length, decisionMs: pointerup?.medianMs ?? null, attempts, performance: metricDelta(beforeMetrics, afterMetrics), loadAverage: os.loadavg() };
}

async function playbackOperation(cdp, contexts) {
  const beforeMetrics = await performanceMetrics(cdp);
  const armed = await evalOn(cdp, `(() => {const p={startedAt:performance.timeOrigin+performance.now(),done:false,intervals:[],last:null,longTaskCount:0,longTaskTotalMs:0,playheadChanges:0};let o=null,m=null;try{o=new PerformanceObserver(l=>{for(const e of l.getEntries()){p.longTaskCount++;p.longTaskTotalMs+=e.duration}});o.observe({entryTypes:['longtask']})}catch{};const widget=document.getElementById('akari-annotations-widget');const playhead=widget?[...widget.querySelectorAll('div')].find(e=>e.style.position==='absolute'&&e.style.width==='2px'&&e.style.pointerEvents==='none'&&e.querySelector('svg')):null;if(widget){m=new MutationObserver(rs=>{for(const r of rs)if(r.type==='attributes'&&r.attributeName==='style'&&r.target===playhead)p.playheadChanges++});m.observe(widget,{subtree:true,attributes:true,attributeFilter:['style']})};const tick=n=>{if(p.done)return;if(p.last!==null)p.intervals.push(n-p.last);p.last=n;requestAnimationFrame(tick)};requestAnimationFrame(tick);setTimeout(()=>{p.done=true;p.finishedAt=performance.timeOrigin+performance.now();o?.disconnect();m?.disconnect()},10000);window.__timelinePlaybackProbe=p;return true})()`);
  if (!armed) return { status: 'not-reached', reason: 'could not arm playback probe', loadAverage: os.loadavg() };
  let control = null;
  const mainControl = await evalOn(cdp, `(() => {const b=[...document.querySelectorAll('button,[role=button]')].find(e=>/再生|play/i.test([e.textContent,e.title,e.getAttribute('aria-label')].join(' ')));if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,where:'main'}})()`);
  if (mainControl) control = mainControl;
  if (!control) {
    const frames = await evalOn(cdp, `Array.from(document.querySelectorAll('iframe')).map(f=>{const r=f.getBoundingClientRect();return{src:f.src,x:r.left,y:r.top}})`);
    for (const contextId of contexts) {
      try {
        const inner = await evalOn(cdp, `(() => {if(!document.getElementById('overlay-stage'))return null;const b=[...document.querySelectorAll('button,[role=button]')].find(e=>/再生|play/i.test([e.textContent,e.title,e.getAttribute('aria-label')].join(' ')));if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`, contextId);
        if (inner) { const outer = frames.find(frame => frame.src.includes('webview.localhost')); if (outer) control = { x: outer.x + inner.x, y: outer.y + inner.y, where: 'webview', contextId }; break; }
      } catch { /* stale execution context */ }
    }
  }
  if (control) await realClick(cdp, control.x, control.y);
  else {
    const stripPoint = await evalOn(cdp, `(() => {const r=document.querySelector(${JSON.stringify(STRIP)})?.getBoundingClientRect();return r?{x:r.left+r.width/2,y:r.top+Math.min(20,r.height/2)}:null})()`);
    if (!stripPoint) return { status: 'not-reached', reason: 'timeline strip and preview playback control were not found; operation 5 intentionally skipped', loadAverage: os.loadavg() };
    await realClick(cdp, stripPoint.x, stripPoint.y);
    await keyPress(cdp, { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    control = { where: 'timeline Space shortcut' };
  }
  const playback = await waitEval(cdp, `window.__timelinePlaybackProbe?.done ? window.__timelinePlaybackProbe : null`, { timeoutMs: 12_000, intervalMs: 100, label: 'A playback sample' });
  const afterMetrics = await performanceMetrics(cdp), intervals = summary(playback.intervals || []), playbackConfirmed = playback.playheadChanges > 1;
  return { status: intervals && playbackConfirmed ? 'completed' : 'not-reached', reason: intervals ? playbackConfirmed ? null : 'Space/control input did not produce repeated playhead style mutations; preview playback was not confirmed' : 'no rAF intervals recorded', control, playbackConfirmed, playheadChanges: playback.playheadChanges, interval: { samplesMs: playback.intervals, ...intervals }, medianMs: playbackConfirmed ? intervals?.medianMs ?? null : null, p95Ms: playbackConfirmed ? intervals?.p95Ms ?? null : null, decisionMs: playbackConfirmed ? intervals?.medianMs ?? null : null, longTasks: { count: playback.longTaskCount, totalMs: playback.longTaskTotalMs }, performance: metricDelta(beforeMetrics, afterMetrics), loadAverage: os.loadavg() };
}

async function oneRun(requestedN, actualN, runIndex) {
  const project = path.join(ROOT, 'fixtures', `n${actualN}`), editFile = path.join(project, 'edit.json');
  await rm(path.join(project, 'cache', 'timeline'), { recursive: true, force: true });
  const port = 21000 + requestedNs.indexOf(requestedN) * 100 + runIndex, iso = path.join(os.tmpdir(), 'akari-timeline-bench', `a-n${requestedN}-run${runIndex}`), log = path.join(ROOT, 'evidence', `console-a-n${requestedN}-run${runIndex}.log`);
  const record = { run: runIndex, requestedN, actualN, isolationDir: iso, status: 'running', coldOpen: null, warmOpen: null, cache: null, operations: {}, loadAverage: { atStart: os.loadavg(), atEnd: null } }; let launched, cdp;
  try {
    launched = await launch(project, port, iso, log); const target = await waitTarget(port); cdp = new CDP(target.webSocketDebuggerUrl);
    const contexts = new Set(); cdp.on('Runtime.executionContextCreated', event => contexts.add(event.context.id)); cdp.on('Runtime.executionContextDestroyed', event => contexts.delete(event.executionContextId));
    await withTimeout(cdp.connect(), 5000, 'CDP connect'); await enableCdpDomain(cdp, 'Page.enable'); await enableCdpDomain(cdp, 'Runtime.enable'); await enableCdpDomain(cdp, 'Performance.enable');
    record.coldOpen = await openProject(cdp, 300_000); record.cache = await waitCacheQuiet(project, 300_000);
    if (requestedN === 800 && record.cache.status !== 'completed') { record.status = 'not-reached'; record.cacheTimedOut = true; record.reason = record.cache.reason; return record; }
    await cdp.send('Page.reload', { ignoreCache: false }); record.warmOpen = await openProject(cdp, 120_000);
    const initial = await evalOn(cdp, `(() => {const strip=document.querySelector(${JSON.stringify(STRIP)});const all=[...strip.querySelectorAll(${JSON.stringify(ALL_ITEMS)})];const byKind={};for(const e of all)byKind[e.dataset.akariItemKind]=(byKind[e.dataset.akariItemKind]||0)+1;let gpuRenderer=null;try{const gl=document.createElement('canvas').getContext('webgl');const ext=gl?.getExtension('WEBGL_debug_renderer_info');gpuRenderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER)||null}catch{};return{domNodes:strip.querySelectorAll('*').length,itemElements:all.length,itemKindCounts:byKind,treeItemElements:byKind.item||0,usedJSHeapSize:performance.memory?.usedJSHeapSize??null,dpr:devicePixelRatio,userAgent:navigator.userAgent,gpuRenderer}})()`);
    record.operations['1'] = { status: 'completed', loadMs: record.warmOpen.openMs, coldOpenMs: record.coldOpen.openMs, ...initial, visibleCullingObserved: initial.itemElements < actualN };
    if (!environmentCaptured) { let version = null; try { version = await cdp.send('Browser.getVersion'); } catch {} result.environment = { ...result.environment, ...initial, browserVersion: version, shell: SHELL_DIR, selector: STRIP, frontendBundle: await frontendBundleEnvironment() }; environmentCaptured = true; await atomic(); }
    record.operations['2'] = await wheelOperation(cdp, 'zoom'); record.operations['3'] = await wheelOperation(cdp, 'pan'); record.operations['4'] = await dragOperation(cdp, editFile); record.operations['5'] = await playbackOperation(cdp, [...contexts]); record.status = 'completed';
  } catch (error) { record.status = 'not-reached'; record.reason = errorText(error); record.cacheTimedOut = requestedN === 800 && /timed out|not reached|stable|cache/i.test(record.reason); for (const op of ['1', '2', '3', '4', '5']) record.operations[op] ||= { status: 'not-reached', reason: record.reason, ...(op === '1' ? {} : { loadAverage: os.loadavg() }) }; }
  finally { record.loadAverage.atEnd = os.loadavg(); try { cdp?.close(); } catch {} launched?.stop(); }
  return record;
}

function aggregate(runs, op) {
  const entries = runs.map(run => run.operations[op]).filter(Boolean), completed = entries.filter(entry => entry.status === 'completed');
  if (op === '1') { const loads = summary(completed.map(value => value.loadMs)); return { status: loads ? 'completed' : 'not-reached', reason: loads ? null : entries.find(v => v.reason)?.reason || 'open not measured', runs: entries, load: loads, medianMs: loads?.medianMs ?? null, p95Ms: loads?.p95Ms ?? null, domNodes: summary(completed.map(v => v.domNodes)), usedJSHeapSize: summary(completed.map(v => v.usedJSHeapSize)), itemKindCounts: completed.at(-1)?.itemKindCounts || null }; }
  if (op === '4') { const move = summary(completed.flatMap(v => v.move?.samplesMs || [])), pointerup = summary(completed.flatMap(v => v.pointerup?.samplesMs || [])), editWriteStats = summary(completed.flatMap(v => v.editWrite?.status === 'completed' ? v.editWrite.samplesMs || [] : [])); const runMoveMedians = summary(completed.map(v => v.move?.medianMs)), runUpMedians = summary(completed.map(v => v.pointerup?.medianMs)), runUpP95s = summary(completed.map(v => v.pointerup?.p95Ms)); const workMove = summary(completed.flatMap(v => v.work?.move?.samplesMs || [])), workPointerup = summary(completed.flatMap(v => v.work?.pointerup?.samplesMs || [])), workMoveRunMedians = summary(completed.map(v => v.work?.move?.medianMs)), workUpRunMedians = summary(completed.map(v => v.work?.pointerup?.medianMs)); const editWrite = editWriteStats ? { status: 'completed', ...editWriteStats } : { status: 'not-reached', reason: 'no committed drag attempt across completed runs' }; return { status: move && pointerup ? 'completed' : 'not-reached', reason: move && pointerup ? null : entries.find(v => v.reason)?.reason || 'drag not measured', runs: entries, move, pointerup, work: { move: workMove ? { ...workMove, threeRunMedians: workMoveRunMedians } : null, pointerup: workPointerup ? { ...workPointerup, threeRunMedians: workUpRunMedians } : null }, workDecisionMs: workUpRunMedians?.medianMs ?? null, editWrite, committedCount: completed.reduce((total, value) => total + (value.committedCount || 0), 0), rejectedCount: completed.reduce((total, value) => total + (value.rejectedCount || 0), 0), threeRun: { moveMedians: runMoveMedians, pointerupMedians: runUpMedians, pointerupP95s: runUpP95s }, medianMs: runUpMedians?.medianMs ?? null, p95Ms: runUpP95s?.medianMs ?? null, decisionMs: runUpMedians?.medianMs ?? null }; }
  if (op === '5') { const intervals = summary(completed.flatMap(v => v.interval?.samplesMs || [])), runMedians = summary(completed.map(v => v.interval?.medianMs)), runP95s = summary(completed.map(v => v.interval?.p95Ms)); return { status: intervals ? 'completed' : 'not-reached', reason: intervals ? null : entries.find(v => v.reason)?.reason || 'playback not reached', runs: entries, interval: intervals, threeRun: { medians: runMedians, p95s: runP95s }, medianMs: runMedians?.medianMs ?? null, p95Ms: runP95s?.medianMs ?? null, decisionMs: runMedians?.medianMs ?? null, longTaskTotal: summary(completed.map(v => v.longTasks?.totalMs)) }; }
  const samples = summary(completed.flatMap(v => v.samplesMs || [])), runMedians = summary(completed.map(v => v.summary?.medianMs)), runP95s = summary(completed.map(v => v.summary?.p95Ms)), work = summary(completed.flatMap(v => v.work?.samplesMs || [])), workRunMedians = summary(completed.map(v => v.work?.medianMs)); return { status: samples ? 'completed' : 'not-reached', reason: samples ? null : entries.find(v => v.reason)?.reason || 'no paint samples', runs: entries, ...samples, work: work ? { ...work, threeRunMedians: workRunMedians } : null, workDecisionMs: workRunMedians?.medianMs ?? null, sampleMedianMs: samples?.medianMs ?? null, sampleP95Ms: samples?.p95Ms ?? null, threeRun: { medians: runMedians, p95s: runP95s }, medianMs: runMedians?.medianMs ?? null, p95Ms: runP95s?.medianMs ?? null, decisionMs: runMedians?.medianMs ?? null };
}

await atomic();
for (const requestedN of requestedNs) {
  let actualN = requestedN; let combo = result.subjects.A[requestedN] = { status: 'running', requestedN, actualN, note: null, runs: [], operations: {} }; await atomic();
  let first = await oneRun(requestedN, actualN, 1);
  if (first.cacheTimedOut && requestedN === 800) { actualN = 400; combo.actualN = 400; combo.note = 'N=800 の cache/timeline 生成が 5 分以内に完了しなかったため、契約どおり N=400 へフォールバックした。'; result.notes.push(combo.note); combo.runs = []; first = await oneRun(requestedN, actualN, 1); }
  combo.runs.push(first); await atomic();
  for (let run = 2; run <= 3; run++) { combo.runs.push(await oneRun(requestedN, actualN, run)); await atomic(); }
  for (const op of ['1', '2', '3', '4', '5']) combo.operations[op] = aggregate(combo.runs, op);
  combo.status = combo.runs.some(run => run.status === 'completed') ? 'completed' : 'not-reached'; combo.reason = combo.status === 'completed' ? null : combo.runs[0]?.reason || 'all runs failed'; await atomic();
}
result.status = 'completed'; result.finishedAt = new Date().toISOString(); await atomic(); process.stdout.write(`${JSON.stringify({ status: result.status, output: outputArg })}\n`);
