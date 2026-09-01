#!/usr/bin/env node
// pan-o1-probe.mjs — タスク 2026-08-31-timeline-strip-pan-o1 の補助プローブ（検証専用）。
//
// なぜ要るか: T6 の measure-a.mjs の操作 3（パン）は「全長 view」で計測するが、全長 view では
// setViewStart の clamp 上限が 0 なので viewStart は動かない。起点 main はそれでも renderStrip を
// 走らせていたため MutationObserver が発火して値が出ていた（= 無意味な再描画の実測）。O(1) 化後は
// DOM 変異が 1 件も出ないため measure-a は not-reached を返す。そこで本プローブは
//   Phase A（全長 view・窓は動かない）: パン 40 回の DOM 変異件数と Layout 系メトリクス増分
//   Phase B（1.5x ズーム・全アイテム mount 済みのまま窓が動く）: パン 40 回の work-only / latency /
//           変異件数 / Layout 系増分 / ノード identity
// を測る。launch-shell.sh と cdp-lib.mjs は T6 のものをそのまま使う（無改変）。
import { spawn } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, wheel } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHELL_DIR = process.env.AKARI_SHELL_DIR || path.resolve(ROOT, '..', '..', '..', '..');
const arg = prefix => process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
const N = Number(arg('--n=') || 800);
const LABEL = arg('--label=') || 'after';
const OUTPUT = arg('--output=') || path.join(ROOT, 'results', `pan-o1-probe-${LABEL}-n${N}.json`);
const PORT = Number(arg('--port=') || 22345);
const PAN_EVENTS = Number(arg('--pans=') || 40);
const STRIP = '#akari-annotations-widget .akari-annotations-strip';
const ITEMS = '[data-akari-item-kind]';
const S = JSON.stringify(STRIP);
const I = JSON.stringify(ITEMS);

const errorText = error => String(error?.stack || error?.message || error);
const percentile = (values, p) => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null; };
const summary = values => { const clean = values.filter(Number.isFinite); return clean.length ? { count: clean.length, medianMs: percentile(clean, .5), p95Ms: percentile(clean, .95), maxMs: Math.max(...clean), over16_7: clean.filter(v => v > 16.7).length, over33: clean.filter(v => v > 33).length } : null; };

const result = {
  status: 'running', label: LABEL, requestedN: N, startedAt: new Date().toISOString(),
  environment: { loadAverageAtStart: os.loadavg(), shell: SHELL_DIR }, phases: {}, notes: []
};
const save = async () => { await mkdir(path.dirname(OUTPUT), { recursive: true }); const temp = `${OUTPUT}.tmp-${process.pid}`; await writeFile(temp, `${JSON.stringify(result, null, 2)}\n`); await rename(temp, OUTPUT); };

function runCommand(command, args, { timeoutMs = 30_000, cwd = ROOT } = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('error', error => { clearTimeout(timer); resolve({ ok: false, stdout, stderr, reason: errorText(error) }); });
    child.once('close', code => { clearTimeout(timer); resolve({ ok: code === 0, stdout, stderr, reason: code === 0 ? null : `exit ${code}: ${stderr.slice(-800)}` }); });
  });
}

async function waitEval(cdp, expression, { timeoutMs = 10_000, intervalMs = 250, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) {
    try { const value = await evalOn(cdp, expression); if (value) return value; } catch (error) { last = error; }
    await sleep(intervalMs);
  }
  throw new Error(`${label} not reached: ${errorText(last)}`);
}

async function openTimeline(cdp) {
  await waitEval(cdp, `Boolean(document.readyState==='complete'&&document.getElementById('theia-app-shell'))`, { timeoutMs: 180_000, label: 'workbench ready' });
  await sleep(8000);
  const stripReady = `(() => {const strip=document.querySelector(${S});if(!strip)return null;const count=strip.querySelectorAll(${I}).length;const s=window.__panO1Ready||=({last:-1,same:0});s.same=count===s.last?s.same+1:0;s.last=count;return count>0&&s.same>=4?count:null})()`;
  const findButton = `(() => {const e=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()==='タイムライン'&&node.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`;
  const findMenu = `(() => {const e=[...document.querySelectorAll('#theia-left-content-panel .lm-TabBar-tab')].find(node=>node.textContent.trim()==='メニュー'&&node.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`;
  let lastFailure = 'no attempt';
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1150, deviceScaleFactor: 0, mobile: false });
      await sleep(500);
      // レイアウト復元で既に開いている場合はそのまま使う。
      const open = await evalOn(cdp, `(() => {const strip=document.querySelector(${S});return strip?strip.querySelectorAll(${I}).length:0})()`);
      if (open > 0) {
        await evalOn(cdp, 'delete window.__panO1Ready');
        const stable = await waitEval(cdp, stripReady, { timeoutMs: 60_000, intervalMs: 250, label: 'stable item set (already open)' });
        return { visibleItemCount: stable, attempts: attempt, route: 'already-open' };
      }
      let button = await evalOn(cdp, findButton);
      if (!button) {
        const menu = await waitEval(cdp, findMenu, { timeoutMs: 30_000, label: 'メニュー tab' });
        await realClick(cdp, menu.x, menu.y);
        await sleep(1500);
        button = await waitEval(cdp, findButton, { timeoutMs: 30_000, label: 'タイムライン button' });
      }
      await evalOn(cdp, 'delete window.__panO1Ready');
      await realClick(cdp, button.x, button.y);
      const stable = await waitEval(cdp, stripReady, { timeoutMs: 240_000, intervalMs: 250, label: 'stable item set' });
      return { visibleItemCount: stable, attempts: attempt, route: 'メニュー→タイムライン' };
    } catch (error) { lastFailure = errorText(error); await sleep(3000); }
  }
  const dom = await evalOn(cdp, `({buttons:[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).slice(0,60),tabs:[...document.querySelectorAll('.lm-TabBar-tab')].map(t=>t.textContent.trim()).slice(0,40),strip:Boolean(document.querySelector(${S}))})`).catch(() => null);
  throw new Error(`timeline open failed: ${lastFailure} / dom=${JSON.stringify(dom)}`);
}

const metrics = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
const metricDelta = (before, after) => Object.fromEntries(['LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'LayoutCount']
  .map(name => [name, Number.isFinite(before[name]) && Number.isFinite(after[name]) ? after[name] - before[name] : null]));

// window の capture wheel リスナで入力時刻を、strip 配下の MutationObserver で最初の変異時刻を取る。
// measure-a.mjs の probeScript と同じ定義（work = 入力→最初の DOM 変異、latency = 入力→変異後 2rAF）。
const ARM = `(() => {
  const strip=document.querySelector(${S}); if(!strip) return {armed:false,reason:'strip missing'};
  if (window.__panO1?.dispose) window.__panO1.dispose();
  const abs=()=>performance.timeOrigin+performance.now();
  const state={events:[],current:null,totalMutations:0};
  const onWheel=e=>{state.current={inputAt:abs(),mutationAt:null,paintAt:null,mutations:0,
    onStrip:strip.contains(e.target),ctrlKey:e.ctrlKey,deltaX:e.deltaX,deltaY:e.deltaY,
    target:e.target instanceof Element?e.target.tagName+'.'+String(e.target.className||'').slice(0,40):String(e.target)};
    state.events.push(state.current)};
  window.addEventListener('wheel',onWheel,true);
  const observer=new MutationObserver(records=>{
    const cur=state.current; if(!cur) return;
    cur.mutations+=records.length; state.totalMutations+=records.length;
    if(cur.mutationAt===null){cur.mutationAt=abs();
      requestAnimationFrame(()=>requestAnimationFrame(()=>{cur.paintAt=abs()}))}
  });
  observer.observe(strip,{childList:true,subtree:true,attributes:true,characterData:true});
  state.dispose=()=>{observer.disconnect();window.removeEventListener('wheel',onWheel,true)};
  window.__panO1=state; return {armed:true};
})()`;
const COLLECT = `(() => {const s=window.__panO1; if(!s) return null; s.dispose();
  return {totalMutations:s.totalMutations,events:s.events.map(e=>({inputAt:e.inputAt,mutationAt:e.mutationAt,paintAt:e.paintAt,mutations:e.mutations,onStrip:e.onStrip,ctrlKey:e.ctrlKey,deltaX:e.deltaX,deltaY:e.deltaY,target:e.target}))}})()`;

const viewProbe = sampleId => `(() => {
  const strip=document.querySelector(${S}); if(!strip) return null;
  const items=[...strip.querySelectorAll(${I})];
  const id=${JSON.stringify(sampleId)} ?? items.find(e=>e.dataset.akariItemId)?.dataset.akariItemId ?? null;
  const el=id?strip.querySelector('[data-akari-item-id="'+id+'"]'):null;
  const r=el?el.getBoundingClientRect():null;
  const attrs=[...new Set([...strip.querySelectorAll('*')].flatMap(e=>[...e.attributes].map(a=>a.name)).filter(n=>n.startsWith('data-akari-')))].sort();
  return {itemCount:items.length, stripWidth:strip.clientWidth, sampleId:id,
    sampleLeft:r?r.left:null, sampleWidth:r?r.width:null, akariAttributes:attrs, akariAttributeCount:attrs.length};
})()`;
const TAG = `(() => {const strip=document.querySelector(${S});const items=[...strip.querySelectorAll(${I})];items.forEach(e=>{e.__panO1Tag=1});return items.length})()`;
const CHECK_TAGS = `(() => {const strip=document.querySelector(${S});const items=[...strip.querySelectorAll(${I})];
  return {count:items.length, retained:items.filter(e=>e.__panO1Tag===1).length}})()`;

async function panBatch(cdp, point, count) {
  await evalOn(cdp, ARM);
  const before = await metrics(cdp);
  const deltas = [...Array(Math.ceil(count / 2)).fill(60), ...Array(Math.floor(count / 2)).fill(-60)];
  for (const delta of deltas) { await wheel(cdp, point.x, point.y, delta, 0); await sleep(60); }
  await sleep(400);
  const after = await metrics(cdp);
  const collected = await evalOn(cdp, COLLECT);
  const events = collected?.events ?? [];
  const workValues = events.map(e => Number.isFinite(e.mutationAt) ? e.mutationAt - e.inputAt : null).filter(Number.isFinite);
  const latencyValues = events.map(e => Number.isFinite(e.paintAt) ? e.paintAt - e.inputAt : null).filter(Number.isFinite);
  const perf = metricDelta(before, after);
  return {
    events: events.length, panEventsRequested: count,
    eventsOnStrip: events.filter(e => e.onStrip).length,
    eventTargets: [...new Set(events.map(e => e.target))],
    eventsWithMutation: events.filter(e => e.mutations > 0).length,
    totalMutations: collected?.totalMutations ?? 0,
    mutationsPerEvent: events.length ? (collected?.totalMutations ?? 0) / events.length : null,
    work: { samplesMs: workValues, ...summary(workValues) },
    latency: { samplesMs: latencyValues, ...summary(latencyValues) },
    performance: perf,
    performancePerEvent: Object.fromEntries(Object.entries(perf).map(([k, v]) => [k, Number.isFinite(v) && events.length ? v / events.length : null])),
    loadAverage: os.loadavg()
  };
}

async function main() {
  const project = path.join(ROOT, 'fixtures', `n${N}`);
  const iso = path.join(ROOT, 'evidence', 'runs', `pan-o1-${LABEL}-n${N}`);
  const log = path.join(ROOT, 'evidence', `console-pan-o1-${LABEL}-n${N}.log`);
  await save();
  const launched = await runCommand('/bin/zsh', [path.join(ROOT, 'scripts', 'launch-shell.sh'), project, String(PORT), iso, log], { timeoutMs: 20_000 });
  if (!launched.ok) throw new Error(`launch failed: ${launched.reason}`);
  const pid = Number(launched.stdout.trim().split(/\s+/).at(-1));
  let cdp;
  try {
    const deadline = Date.now() + 120_000; let target;
    while (Date.now() < deadline && !target) { try { target = (await listTargets(PORT)).find(t => t.type === 'page'); } catch { } if (!target) await sleep(500); }
    if (!target) throw new Error('CDP target unavailable');
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    for (const domain of ['Page.enable', 'Runtime.enable', 'Performance.enable']) {
      for (let attempt = 1; attempt <= 6; attempt++) { try { await cdp.send(domain); break; } catch (error) { if (attempt === 6) throw error; await sleep(5000); } }
    }
    result.open = await openTimeline(cdp);
    await save();
    // 帯は縦に長く（初期縦スクロールで上端が viewport 外に出る）、strip の rect から y を取ると
    // タブバーへ当たる。可視領域 = stripScroll（strip の親）の rect と交差させて点を決める。
    const point = await evalOn(cdp, `(() => {const strip=document.querySelector(${S});const scroll=strip.parentElement;
      const r=strip.getBoundingClientRect();const sc=scroll.getBoundingClientRect();
      const top=Math.max(r.top,sc.top), bottom=Math.min(r.bottom,sc.bottom);
      return{x:r.left+r.width/2,y:top+Math.min(40,(bottom-top)/2)}})()`);
    result.point = { ...point, ...await evalOn(cdp, `(() => {const e=document.elementFromPoint(${point.x},${point.y});const r=document.querySelector(${S}).getBoundingClientRect();return{hit:e?e.tagName+'.'+String(e.className||'').slice(0,60):null,inStrip:e?document.querySelector(${S}).contains(e):false,stripRect:{left:r.left,top:r.top,width:r.width,height:r.height},innerWidth:window.innerWidth,innerHeight:window.innerHeight}})()`) };

    // Phase A: 全長 view（窓は clamp で動かない）。期待値 = DOM 変異 0・Layout 0。
    result.phases.fullLengthPan = { viewBefore: await evalOn(cdp, viewProbe(null)) };
    result.phases.fullLengthPan.sampleId = result.phases.fullLengthPan.viewBefore?.sampleId ?? null;
    await evalOn(cdp, TAG);
    Object.assign(result.phases.fullLengthPan, await panBatch(cdp, point, PAN_EVENTS));
    result.phases.fullLengthPan.identity = await evalOn(cdp, CHECK_TAGS);
    result.phases.fullLengthPan.viewAfter = await evalOn(cdp, viewProbe(result.phases.fullLengthPan.sampleId));
    await save();

    // Phase B: 1.5x ズーム（mount 窓 = 可視 ±50% なので全アイテム mount のまま）で実際に窓が動くパン。
    await wheel(cdp, point.x, point.y, 0, -100, { ctrlKey: true });
    await sleep(1500);
    const zoomed = await evalOn(cdp, viewProbe(result.phases.fullLengthPan.sampleId));
    result.phases.zoomedPan = { zoomStep: { deltaY: -100, ctrlKey: true }, viewBefore: zoomed };
    await evalOn(cdp, TAG);
    Object.assign(result.phases.zoomedPan, await panBatch(cdp, point, PAN_EVENTS));
    result.phases.zoomedPan.identity = await evalOn(cdp, CHECK_TAGS);
    result.phases.zoomedPan.viewAfter = await evalOn(cdp, viewProbe(result.phases.fullLengthPan.sampleId));
    result.status = 'completed';
  } catch (error) {
    result.status = 'not-reached'; result.reason = errorText(error);
  } finally {
    result.finishedAt = new Date().toISOString();
    result.environment.loadAverageAtEnd = os.loadavg();
    try { cdp?.close(); } catch { }
    if (Number.isInteger(pid)) { try { process.kill(pid, 'SIGTERM'); } catch { } await sleep(2000); try { process.kill(pid, 'SIGKILL'); } catch { } }
    await save();
  }
  console.log(`${result.status} -> ${OUTPUT}`);
}

await main();
