#!/usr/bin/env node
// L1 = CDP 実機の通し操作 + ノード identity の証明。
// measure-a.mjs と同じ launch-shell.sh / cdp-lib.mjs を使い、計測ではなく「壊れていないこと」を観測する。
import { spawn } from 'node:child_process';
import { mkdir, rename, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot, wheel, keyPress } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const N = Number(process.argv.find(v => v.startsWith('--n='))?.slice(4) || 200);
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) || 21900);
const OUT = process.argv.find(v => v.startsWith('--output='))?.slice(9) || path.join(ROOT, 'results', `l1-walkthrough-n${N}.json`);
const SHOTS = path.join(ROOT, 'evidence', 'l1-shots');
const STRIP = '#akari-annotations-widget .akari-annotations-strip';
const ITEMS = '[data-akari-item-kind]';

const err = e => String(e?.stack || e?.message || e);
const out = { status: 'running', n: N, startedAt: new Date().toISOString(), loadAverageAtStart: os.loadavg(), shell: process.env.AKARI_SHELL_DIR || null, steps: [], identity: null, notes: [] };
const save = async () => { await mkdir(path.dirname(OUT), { recursive: true }); const t = `${OUT}.tmp-${process.pid}`; await writeFile(t, `${JSON.stringify(out, null, 2)}\n`); await rename(t, OUT); };
const withTimeout = (p, ms, l) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`${l} timed out after ${ms}ms`)), ms))]);

async function step(name, fn) {
  const started = Date.now();
  const record = { step: name, status: 'running' };
  out.steps.push(record);
  try {
    const detail = await fn(record);
    record.status = 'ok';
    if (detail !== undefined) record.detail = detail;
  } catch (e) {
    record.status = 'failed';
    record.reason = err(e);
  }
  record.elapsedMs = Date.now() - started;
  await save();
  console.log(`[${record.status}] ${name}${record.reason ? ` — ${record.reason.split('\n')[0]}` : ''}`);
  return record;
}

async function run(cmd, args, { timeoutMs = 30_000, cwd = ROOT } = {}) {
  return new Promise(resolve => {
    const c = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let so = '', se = '';
    c.stdout.on('data', d => { so += d; }); c.stderr.on('data', d => { se += d; });
    const t = setTimeout(() => c.kill('SIGKILL'), timeoutMs);
    c.once('close', code => { clearTimeout(t); resolve({ ok: code === 0, stdout: so, stderr: se }); });
    c.once('error', e => { clearTimeout(t); resolve({ ok: false, stdout: so, stderr: String(e) }); });
  });
}

async function waitEval(cdp, expression, { timeoutMs = 10_000, intervalMs = 100, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) {
    try { const v = await withTimeout(evalOn(cdp, expression), 3000, label); if (v) return v; } catch (e) { last = e; }
    await sleep(intervalMs);
  }
  throw new Error(`${label} not reached: ${err(last)}`);
}

async function openTimeline(cdp) {
  await waitEval(cdp, `Boolean(document.readyState==='complete'&&document.getElementById('theia-app-shell')&&document.getElementById('akari-home-widget'))`, { timeoutMs: 120_000, intervalMs: 250, label: 'workbench ready' });
  await sleep(8000);
  let last = 'no attempt';
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1150, deviceScaleFactor: 0, mobile: false });
      await sleep(500);
      const menu = await waitEval(cdp, `(() => {const e=[...document.querySelectorAll('#theia-left-content-panel .lm-TabBar-tab')].find(n=>n.textContent.trim()==='メニュー'&&n.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`, { timeoutMs: 20_000, intervalMs: 250, label: 'メニュー tab' });
      await realClick(cdp, menu.x, menu.y); await sleep(1200);
      const tl = await waitEval(cdp, `(() => {const e=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='タイムライン'&&n.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`, { timeoutMs: 8000, intervalMs: 250, label: 'タイムライン button' });
      await evalOn(cdp, 'delete window.__l1Ready');
      await realClick(cdp, tl.x, tl.y);
      const count = await waitEval(cdp, `(() => { const s=document.querySelector(${JSON.stringify(STRIP)}); if(!s)return null; const c=s.querySelectorAll(${JSON.stringify(ITEMS)}).length; const st=window.__l1Ready||=({last:-1,same:0}); st.same=c===st.last?st.same+1:0; st.last=c; return c>0&&st.same>=4?c:null; })()`, { timeoutMs: 90_000, intervalMs: 250, label: 'strip stable' });
      return { attempts: attempt, mountedItems: count };
    } catch (e) { last = err(e); await sleep(3000); }
  }
  throw new Error(`timeline open failed: ${last}`);
}

// 帯の幾何とスクロール、選択、mount 数の一括スナップショット
const snapshotExpr = `(() => {
  const strip=document.querySelector(${JSON.stringify(STRIP)});
  const scroll=strip?.parentElement;
  const items=[...(strip?.querySelectorAll(${JSON.stringify(ITEMS)})||[])];
  return {
    mounted: items.length,
    byKind: items.reduce((a,e)=>{a[e.dataset.akariItemKind]=(a[e.dataset.akariItemKind]||0)+1;return a},{}),
    selected: [...(strip?.querySelectorAll('.akari-annotations-selected')||[])].map(e=>e.dataset.akariItemKind+':'+e.dataset.akariItemId),
    scrollTop: scroll?.scrollTop ?? null,
    scrollLeft: scroll?.scrollLeft ?? null,
    imgs: strip?.querySelectorAll('img').length ?? 0,
    canvases: strip?.querySelectorAll('canvas').length ?? 0,
    stripChildren: strip?.children.length ?? 0
  };
})()`;

const key = `(e => e.dataset.akariItemKind + '|' + (e.dataset.akariItemId ?? ''))`;

// 計器を張る（タグ付け + MutationObserver）。何度呼んでもその時点から数え直す。
// DOM の「移動」（insertBefore による並べ替え）は MutationObserver 上は removed + added に
// 見えるため、追加ノードが既にタグ付き（= 同一ノードの移動）か新規生成かを区別して数える。
const armExpr = `(() => {
  const strip=document.querySelector(${JSON.stringify(STRIP)});
  const k=${key};
  try { window.__l1state?.obs?.disconnect(); } catch (e) {}
  const st={seq:0,tags:new Map(),added:0,removed:0,addedMoved:0,addedFresh:0,addedKeys:[],removedKeys:[],otherAdded:0,otherRemoved:0,imgSeq:0,armedAt:Date.now()};
  for (const e of strip.querySelectorAll(${JSON.stringify(ITEMS)})) { e.__l1=++st.seq; st.tags.set(k(e), e.__l1); }
  for (const e of strip.querySelectorAll('img,canvas')) { if(!e.__l1img) e.__l1img=++st.imgSeq; else st.imgSeq++; }
  st.initialKeys=[...st.tags.keys()];
  const obs=new MutationObserver(recs=>{ for (const rec of recs) {
    for (const n of rec.addedNodes) { if(n.nodeType!==1) continue; if(n.matches?.(${JSON.stringify(ITEMS)})) { st.added++; st.addedKeys.push(k(n)); if (n.__l1!==undefined) st.addedMoved++; else st.addedFresh++; } else { st.otherAdded++; } }
    for (const n of rec.removedNodes) { if(n.nodeType!==1) continue; if(n.matches?.(${JSON.stringify(ITEMS)})) { st.removed++; st.removedKeys.push(k(n)); } else { st.otherRemoved++; } }
  }});
  obs.observe(strip,{childList:true,subtree:true});
  st.obs=obs; window.__l1state=st;
  return {tagged:st.seq, taggedMedia:st.imgSeq};
})()`;

// 計器を張ってからの identity 判定。arm 時点で mount されていた鍵のうち、
// いま mount されているものが同じ DOM ノードか（= 作り直されていないか）を数える。
const identityExpr = `(() => {
  const strip=document.querySelector(${JSON.stringify(STRIP)});
  const k=${key}; const st=window.__l1state;
  const removedSet=new Set(st.removedKeys);
  let survived=0, brokenIdentity=[], enteredRange=0;
  const mediaNow=[...strip.querySelectorAll('img,canvas')];
  let mediaKept=0, mediaFresh=0;
  for (const e of mediaNow) { if (e.__l1img) mediaKept++; else mediaFresh++; }
  const stillMounted=new Set();
  for (const e of strip.querySelectorAll(${JSON.stringify(ITEMS)})) {
    const kk=k(e); stillMounted.add(kk); const tag=st.tags.get(kk);
    if (tag===undefined) { enteredRange++; continue; }
    if (e.__l1===tag) { survived++; }
    else { brokenIdentity.push(kk); }
  }
  const unmounted=st.initialKeys.filter(kk=>!stillMounted.has(kk));
  return {
    initialMounted: st.initialKeys.length,
    stillMountedFromInitial: st.initialKeys.length-unmounted.length,
    survivedWithSameNode: survived,
    recreatedNodeCount: brokenIdentity.length,
    recreatedSample: brokenIdentity.slice(0,10),
    unmountedSinceArm: unmounted.length,
    enteredRangeSinceArm: enteredRange,
    mutationAddedItemNodes: st.added,
    mutationRemovedItemNodes: st.removed,
    mutationAddedThatWereExistingNodes: st.addedMoved,
    mutationAddedThatWereNewNodes: st.addedFresh,
    distinctAddedKeys: new Set(st.addedKeys).size,
    distinctRemovedKeys: new Set(st.removedKeys).size,
    mediaNodesNow: mediaNow.length, mediaNodesReused: mediaKept, mediaNodesRecreated: mediaFresh
  };
})()`;

// ドラッグ・トリム・右クリック・マーキーの対象が実際に見える位置まで帯を縦スクロールする
// （measure-a.mjs の scrollDragTargetIntoView と同じ規約。ただしこの fixture のカット行は
// 帯のスクロール表示域 300px より高い 816px のため「行全体が収まる scrollTop」は存在しない。
// 全収まりを条件にすると候補 0 になるので、カット帯の上端へ寄せて交差で掴む）。
// 1 回の代入では合わない（スクロールで行の縦レイアウトが動くため）。カット帯の上端と
// 表示域上端の差ぶんだけ寄せる step を、候補が拾えるまで数回繰り返す。
const scrollTowardCutsExpr = `(() => {
  const strip=document.querySelector(${JSON.stringify(STRIP)}); const scroll=strip?.parentElement;
  if(!strip||!scroll)return null;
  const sc=scroll.getBoundingClientRect(); const max=Math.max(0,scroll.scrollHeight-scroll.clientHeight);
  const cuts=[...strip.querySelectorAll('[data-akari-item-kind="cut"]')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>=4);
  if(!cuts.length) return {applied:false,reason:'no-cut-mounted',scrollTop:scroll.scrollTop,max};
  const top=Math.min(...cuts.map(r=>r.top));
  const delta=top-sc.top-8;
  const before=scroll.scrollTop;
  scroll.scrollTop=Math.max(0,Math.min(max,before+Math.max(-900,Math.min(900,delta))));
  return {applied:true,before,after:scroll.scrollTop,delta:Math.round(delta),max,cutTop:Math.round(top),containerTop:Math.round(sc.top),viewportHeight:scroll.clientHeight,tallestCut:Math.round(Math.max(...cuts.map(r=>r.height))),widestCut:Math.round(Math.max(...cuts.map(r=>r.width)))};
})()`;

// 表示域と交差しているカットクリップを「掴める点」付きで返す（行全体の収まりは要求しない）。
const cutCandidatesExpr = (minWidth = 20) => `(() => {
  const strip=document.querySelector(${JSON.stringify(STRIP)}); const scroll=strip.parentElement; const sc=scroll.getBoundingClientRect();
  return [...strip.querySelectorAll('[data-akari-item-kind="cut"]')].map(e=>({e,r:e.getBoundingClientRect()}))
    .map(o=>{const top=Math.max(o.r.top,sc.top), bottom=Math.min(o.r.bottom,sc.bottom);
      return {id:o.e.dataset.akariItemId,left:o.r.left,right:o.r.right,w:o.r.width,visibleHeight:bottom-top,y:(top+bottom)/2};})
    .filter(o=>o.w>=${minWidth}&&o.visibleHeight>=12&&o.left>=sc.left&&o.right<=sc.right)
    .map(o=>({id:o.id,x:o.left+o.w/2,y:o.y,w:o.w,left:o.left,right:o.right,visibleHeight:o.visibleHeight}));
})()`;

// edit.json が実際に書き換わったかを待って確かめる（負荷が高いと反映が遅れるため polling）
async function waitEditWrite(project, baselineBytes, { timeoutMs = 10_000 } = {}) {
  const file = path.join(project, 'edit.json');
  const deadline = Date.now() + timeoutMs;
  let text = null;
  while (Date.now() < deadline) {
    try { text = await readFile(file, 'utf8'); } catch { text = null; }
    if (text !== null && text.length !== baselineBytes) return { changed: true, bytes: text.length, waitedMs: timeoutMs - (deadline - Date.now()) };
    await sleep(200);
  }
  return { changed: false, bytes: text?.length ?? null, waitedMs: timeoutMs };
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const project = path.join(ROOT, 'fixtures', `n${N}`);
  const iso = path.join(ROOT, 'evidence', 'runs', `l1-n${N}`);
  const log = path.join(ROOT, 'evidence', `console-l1-n${N}.log`);
  const launched = await run('/bin/zsh', [path.join(ROOT, 'scripts', 'launch-shell.sh'), project, String(PORT), iso, log], { timeoutMs: 20_000 });
  if (!launched.ok) throw new Error(`launch-shell failed: ${launched.stderr}`);
  const pid = Number(launched.stdout.trim().split(/\s+/).at(-1));
  out.electronPid = pid;
  const stop = () => { try { process.kill(pid, 'SIGTERM'); } catch {} };

  let cdp;
  try {
    const deadline = Date.now() + 90_000; let page;
    while (Date.now() < deadline && !page) { try { page = (await listTargets(PORT)).find(t => t.type === 'page'); } catch {} if (!page) await sleep(300); }
    if (!page) throw new Error('no CDP page target');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await withTimeout(cdp.connect(), 10_000, 'CDP connect');
    for (const d of ['Page.enable', 'Runtime.enable']) { for (let i = 1; i <= 6; i++) { try { await cdp.send(d); break; } catch (e) { if (i === 6) throw e; await sleep(3000); } } }

    await step('00 タイムラインを開く', async r => { r.open = await openTimeline(cdp); return await evalOn(cdp, snapshotExpr); });
    await screenshot(cdp, path.join(SHOTS, '00-open.png'));

    const centre = await evalOn(cdp, `(() => {const s=document.querySelector(${JSON.stringify(STRIP)});const r=s.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+Math.min(r.height/2,200),left:r.left,top:r.top,w:r.width,h:r.height}})()`);
    out.stripRect = centre;

    // --- ノード identity の計器を仕掛ける（タグ付け + MutationObserver）---
    // 計器は「直前に arm した時点」からの増分だけを数える。ズームの再構築が
    // パンの identity 判定へ混ざらないよう、パン直前に必ず arm し直す。
    await step('01 identity 計器を仕掛ける', async () => await evalOn(cdp, armExpr));

    // --- 02 ズーム ---
    await step('02 ズーム（ctrl+wheel 上下 各 5 回）', async r => {
      for (let i = 0; i < 5; i++) { await wheel(cdp, centre.x, centre.y, 0, -100, { ctrlKey: true }); await sleep(120); }
      r.zoomedIn = await evalOn(cdp, snapshotExpr);
      for (let i = 0; i < 5; i++) { await wheel(cdp, centre.x, centre.y, 0, 100, { ctrlKey: true }); await sleep(120); }
      await sleep(500);
      r.identityAcrossZoom = await evalOn(cdp, identityExpr);
      return await evalOn(cdp, snapshotExpr);
    });
    await screenshot(cdp, path.join(SHOTS, '02-zoom.png'));

    // --- 03 パン 20 回（identity 証明の本体）---
    await step('03 パン 20 回', async r => {
      r.armed = await evalOn(cdp, armExpr); // 計器をパン専用に張り直す
      const before = await evalOn(cdp, snapshotExpr);
      for (let i = 0; i < 20; i++) { await wheel(cdp, centre.x, centre.y, 40, 0); await sleep(120); }
      await sleep(600);
      const after = await evalOn(cdp, snapshotExpr);
      r.before = before; r.after = after;
      return { panSteps: 20 };
    });
    await screenshot(cdp, path.join(SHOTS, '03-pan20.png'));

    await step('04 ノード identity を判定（パン 20 回ぶんだけ）', async () => {
      out.identity = await evalOn(cdp, identityExpr);
      return out.identity;
    });

    // 以降の操作系は「見えているクリップ」を掴む必要がある。パンで view が動いたぶんを
    // 戻し、候補が最も多く見える縦スクロール位置へ寄せてから 05〜08 を実行する。
    await step('04b 操作対象を視野へ戻す（パン戻し + ズームイン + 縦スクロール）', async r => {
      for (let i = 0; i < 20; i++) { await wheel(cdp, centre.x, centre.y, -40, 0); await sleep(80); }
      await sleep(400);
      // 既定 view ではクリップ幅が 12px しかなく掴めない。ズームインして実操作できる幅にする
      for (let i = 0; i < 6; i++) { await wheel(cdp, centre.x, centre.y, 0, -100, { ctrlKey: true }); await sleep(150); }
      await sleep(500);
      // カット帯が表示域へ入るまで縦スクロールを繰り返す（1 回の代入では届かない）
      r.scrollSteps = [];
      for (let i = 0; i < 10; i++) {
        const cands = await evalOn(cdp, cutCandidatesExpr(12));
        if (cands?.length) { r.scroll = { converged: true, iterations: i, candidates: cands.length }; break; }
        const s = await evalOn(cdp, scrollTowardCutsExpr);
        r.scrollSteps.push(s);
        if (!s?.applied) break;
        await sleep(350);
      }
      r.scroll ||= { converged: false, iterations: r.scrollSteps.length };
      await sleep(300);
      const snap = await evalOn(cdp, snapshotExpr);
      r.visibleCuts = (await evalOn(cdp, cutCandidatesExpr(12)))?.length ?? 0;
      // なぜ候補が拾えないのかを幾何で残す（帯・スクロール容器・クリップの実測矩形）
      r.geometry = await evalOn(cdp, `(() => {
        const strip=document.querySelector(${JSON.stringify(STRIP)}); const p=strip.parentElement;
        const rr=e=>{const r=e.getBoundingClientRect();return{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}};
        const cuts=[...strip.querySelectorAll('[data-akari-item-kind="cut"]')];
        const win={innerWidth:innerWidth,innerHeight:innerHeight};
        const inWin=cuts.filter(e=>{const r=e.getBoundingClientRect();return r.width>=4&&r.height>=8&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}).length;
        return {win, strip:rr(strip), parent:{tag:p.tagName,cls:p.className,rect:rr(p),clientHeight:p.clientHeight,scrollHeight:p.scrollHeight,scrollTop:p.scrollTop,overflowY:getComputedStyle(p).overflowY},
          cutCount:cuts.length, cutsFullyInsideWindow:inWin, sampleCuts:cuts.slice(0,6).map(rr), widestCuts:cuts.map(rr).sort((a,b)=>b.w-a.w).slice(0,3)};
      })()`);
      return { scroll: r.scroll, visibleCuts: r.visibleCuts, mounted: snap.mounted, geometry: r.geometry };
    });
    await screenshot(cdp, path.join(SHOTS, '04b-restored.png'));

    // --- 05 ドラッグ移動 ---
    await step('05 ドラッグ移動（クリップ中央から +60px）', async r => {
      const c = await evalOn(cdp, cutCandidatesExpr(12));
      r.candidates = c?.length ?? 0;
      // 右隣との隙間が最も広いクリップを選ぶ（隣へ重ねる移動は拒否されるため・measure-a と同じ規約）
      const sorted = [...(c || [])].sort((a, b) => a.left - b.left);
      const withGap = sorted.map((o, i) => ({ ...o, rightGap: i + 1 < sorted.length ? sorted[i + 1].left - o.right : 400 }));
      const t = withGap.sort((a, b) => b.rightGap - a.rightGap)[0] ?? null;
      if (!t) throw new Error('no visible cut clip to drag');
      r.target = t;
      // 連番トラックでは同じ位置へ戻る移動は差分ゼロ（書き込み無し）。隣のクリップを跨ぐ距離を動かす
      const neighbour = sorted.find(o => o.left > t.right) ?? sorted.find(o => o.right < t.left);
      r.dragBy = neighbour && neighbour.left > t.right ? Math.round(neighbour.right - t.left + 8)
        : neighbour ? -Math.round(t.right - neighbour.left + 8)
        : 60;
      const editBytes = (await readFile(path.join(project, 'edit.json'), 'utf8')).length;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x, y: t.y, button: 'none' }); await sleep(40);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: t.x, y: t.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(60);
      for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x + (r.dragBy * i) / 6, y: t.y, button: 'left', buttons: 1 }); await sleep(40); }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: t.x + r.dragBy, y: t.y, button: 'left' });
      r.editWrite = await waitEditWrite(project, editBytes);
      const snap = await evalOn(cdp, snapshotExpr);
      return { editWrite: r.editWrite, mounted: snap.mounted, selected: snap.selected };
    });
    await screenshot(cdp, path.join(SHOTS, '05-drag.png'));

    // --- 06 トリム（右端 EDGE_ZONE_PX=6 以内から掴む）---
    await step('06 トリム（右端を -30px）', async r => {
      const c = await evalOn(cdp, cutCandidatesExpr(24));
      const pick = c?.length ? c[Math.floor(c.length / 2)] : null;
      const t = pick ? { id: pick.id, x: pick.right - 3, y: pick.y, w: pick.w } : null;
      r.candidates = c?.length ?? 0;
      if (!t) throw new Error('no visible cut clip wide enough to trim');
      r.target = t;
      const editBytes = (await readFile(path.join(project, 'edit.json'), 'utf8')).length;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x, y: t.y, button: 'none' }); await sleep(40);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: t.x, y: t.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(60);
      for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x - i * 5, y: t.y, button: 'left', buttons: 1 }); await sleep(40); }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: t.x - 30, y: t.y, button: 'left' });
      r.editWrite = await waitEditWrite(project, editBytes);
      const snap = await evalOn(cdp, snapshotExpr);
      return { editWrite: r.editWrite, mounted: snap.mounted, selected: snap.selected };
    });
    await screenshot(cdp, path.join(SHOTS, '06-trim.png'));

    // --- 07 右クリックメニュー ---
    await step('07 右クリックメニュー', async r => {
      const c = await evalOn(cdp, cutCandidatesExpr(12));
      const t = c?.length ? c[0] : null;
      r.candidates = c?.length ?? 0;
      if (!t) throw new Error('no clip for contextmenu');
      r.target = t;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x, y: t.y, button: 'none' }); await sleep(40);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: t.x, y: t.y, button: 'right', buttons: 2, clickCount: 1 }); await sleep(40);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: t.x, y: t.y, button: 'right', buttons: 0, clickCount: 1 });
      // 帯の右クリックメニューは Theia の lm-Menu ではなく widget 自前の popup
      // （akari-timeline-context-menu.ts: [data-akari-context-menu] / [data-akari-context-item]）
      const menu = await waitEval(cdp, `(() => {const m=[...document.querySelectorAll('[data-akari-context-menu],.lm-Menu,.p-Menu,[role="menu"]')].filter(e=>e.getBoundingClientRect().width>0);
        return m.length?{count:m.length,items:[...m[0].querySelectorAll('[data-akari-context-item],.lm-Menu-itemLabel,[role="menuitem"]')].map(e=>e.textContent.trim()).filter(Boolean).slice(0,12)}:null})()`, { timeoutMs: 8000, intervalMs: 150, label: 'context menu' });
      await screenshot(cdp, path.join(SHOTS, '07-contextmenu.png'));
      await keyPress(cdp, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await sleep(400);
      return menu;
    });

    // --- 08 マーキー（クリップ間の隙間から矩形ドラッグ）+ shift+click の複数選択 ---
    await step('08 マーキー選択（矩形ドラッグ）', async r => {
      const c = await evalOn(cdp, cutCandidatesExpr(12));
      const t = (c || []).slice(0, 3);
      r.candidates = c?.length ?? 0;
      if (t.length < 2) throw new Error(`need >=2 visible clips, got ${t.length}`);
      r.targets = t;
      // マーキーは「アイテムでない点」から始める必要がある（onStripPointerDown の除外条件）
      const plan = await evalOn(cdp, `(() => {
        const strip=document.querySelector(${JSON.stringify(STRIP)}); const sc=strip.parentElement.getBoundingClientRect();
        const c=${JSON.stringify(t)};
        const desc=e=>e?{tag:e.tagName,cls:(e.className||'').toString().slice(0,50),inStrip:strip.contains(e),pe:getComputedStyle(e).pointerEvents}:null;
        // 帯の空き点を走査する。最前面が帯の子孫でなければマーキーは始まらない（handler は strip にある）
        const ys=[c[0].y-40,c[0].y,c[0].y+40];
        const xs=[];
        for(let i=0;i+1<c.length;i++) xs.push((c[i].right+c[i+1].left)/2);
        xs.push(c[0].left-10);
        let found=null; const tried=[];
        for(const y of ys) for(const x of xs){
          if(x<sc.left+2||x>sc.right-2||y<sc.top+2||y>sc.bottom-2) continue;
          const hit=document.elementFromPoint(x,y);
          const ok=Boolean(hit&&strip.contains(hit)&&!hit.closest('[data-akari-item-kind], .akari-beat-marker, .akari-track-header-row, .akari-annotations-pin'));
          tried.push({x:Math.round(x),y:Math.round(y),ok,hit:desc(hit)});
          if(ok&&!found) found={x,y};
        }
        const topAtGap=document.elementFromPoint(xs[0],c[0].y);
        return found?{startX:found.x,startY:found.y,endX:Math.min(sc.right-4,c[c.length-1].right-2),endY:found.y,empty:true,tried:tried.slice(0,8)}
                    :{empty:false,tried:tried.slice(0,8),topAtGap:desc(topAtGap),topChain:[topAtGap,topAtGap?.parentElement,topAtGap?.parentElement?.parentElement].map(desc)};
      })()`);
      r.plan = plan;
      let marquee = null;
      if (plan?.empty) {
        // どの要素が pointerdown を受け取り、マーキー矩形が出たかを記録する
        await evalOn(cdp, `(() => {
          const strip=document.querySelector(${JSON.stringify(STRIP)});
          const st={events:[],marqueeShown:false};
          const rec=e=>{const t=e.target;st.events.push({type:e.type,tag:t?.tagName,cls:(t?.className||'').toString().slice(0,60),inStrip:strip.contains(t),isItem:Boolean(t?.closest?.('[data-akari-item-kind]'))});};
          for (const t of ['pointerdown','pointerup']) window.addEventListener(t, rec, true);
          const mq=[...strip.parentElement.parentElement.querySelectorAll('div')].find(e=>e.style.position==='absolute'&&e.style.border&&e.style.display!==undefined);
          st.check=()=>{};
          window.__l1marquee=st; return true;
        })()`);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: plan.startX, y: plan.startY, button: 'none' }); await sleep(40);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: plan.startX, y: plan.startY, button: 'left', buttons: 1, clickCount: 1 }); await sleep(60);
        const steps = 8;
        for (let i = 1; i <= steps; i++) {
          const x = plan.startX + ((plan.endX - plan.startX) * i) / steps;
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: plan.startY + 6, button: 'left', buttons: 1 }); await sleep(50);
        }
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: plan.endX, y: plan.startY + 6, button: 'left' });
        await sleep(800);
        const snap = await evalOn(cdp, snapshotExpr);
        const trace = await evalOn(cdp, `(() => {const st=window.__l1marquee; return st?{events:st.events.slice(0,6)}:null})()`);
        marquee = { selected: snap.selected, selectedCount: snap.selected.length, pointerTrace: trace };
        await screenshot(cdp, path.join(SHOTS, '08-marquee.png'));
      }
      // 追加確認: shift+click の複数選択（マーキーとは別経路）
      await realClick(cdp, t[0].x, t[0].y); await sleep(400);
      for (const p of t.slice(1)) { await realClick(cdp, p.x, p.y, { modifiers: 8 }); await sleep(400); } // 8 = Shift
      await sleep(500);
      const snap2 = await evalOn(cdp, snapshotExpr);
      await screenshot(cdp, path.join(SHOTS, '08b-shift-click.png'));
      return { marquee, shiftClick: { clicked: t.length, selected: snap2.selected, selectedCount: snap2.selected.length } };
    });

    // --- 09 素材 D&D（HTML5 DragEvent を DataTransfer 付きで合成）---
    await step('09 素材 D&D（assets/testsrc2-10s.mp4 を帯へ）', async r => {
      // 落とし先を既定の view（ズーム前・縦スクロール上端）へ戻してから落とす
      for (let i = 0; i < 6; i++) { await wheel(cdp, centre.x, centre.y, 0, 100, { ctrlKey: true }); await sleep(150); }
      await evalOn(cdp, `(() => {const s=document.querySelector(${JSON.stringify(STRIP)}).parentElement; s.scrollTop=0; return s.scrollTop})()`);
      // 既存クリップで埋まった時間帯へ落とすと差し込みは拒否される。右へパンして空き時間帯を作る
      for (let i = 0; i < 20; i++) { await wheel(cdp, centre.x, centre.y, 40, 0); await sleep(80); }
      await sleep(800);
      const before = await evalOn(cdp, snapshotExpr);
      const editBytes = (await readFile(path.join(project, 'edit.json'), 'utf8')).length;
      // 落とし先は 1 点では決まらない（既存クリップで埋まった時間帯・レーンは差し込みが拒否される）。
      // 縦横に数点試し、最初に edit.json が書き変わった点を採用する。
      const points = [[0.5, 0.25], [0.75, 0.25], [0.5, 0.5], [0.75, 0.5], [0.5, 0.8], [0.9, 0.8]];
      r.attempts = [];
      let res = null;
      for (const [fx, fy] of points) {
        res = await evalOn(cdp, `(() => {
          const strip=document.querySelector(${JSON.stringify(STRIP)}); const scroll=strip.parentElement;
          scroll.scrollTop=0;  // 落とし先の判定は strip 上端からの localY なので縦位置を固定する
          const sr=scroll.getBoundingClientRect();
          const x=sr.left+sr.width*${fx}, y=sr.top+sr.height*${fy};
          const dt=new DataTransfer();
          dt.setData('application/x-akari-material', JSON.stringify({relativePath:'assets/testsrc2-10s.mp4',kind:'video',durationSeconds:10}));
          const mk=t=>new DragEvent(t,{dataTransfer:dt,bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y});
          const enter=mk('dragenter'), over=mk('dragover'), drop=mk('drop');
          scroll.dispatchEvent(enter); scroll.dispatchEvent(over);
          const overHandled=over.defaultPrevented;
          scroll.dispatchEvent(drop);
          const footer=document.querySelector('#akari-annotations-widget')?.lastElementChild;
          return {x:Math.round(x),y:Math.round(y),localY:Math.round(y-strip.getBoundingClientRect().top),scrollTop:scroll.scrollTop,
            typesSeen:[...dt.types],dragoverPrevented:overHandled,dropPrevented:drop.defaultPrevented,
            footerBefore:(footer?.textContent||'').trim().slice(0,120)};
        })()`);
        await sleep(600);
        res.footerAfter = await evalOn(cdp, `(() => {const f=document.querySelector('#akari-annotations-widget')?.lastElementChild; return (f?.textContent||'').trim().slice(0,160)})()`);
        const write = await waitEditWrite(project, editBytes, { timeoutMs: 3000 });
        r.attempts.push({ point: [fx, fy], ...res, write });
        if (write.changed) { r.editWrite = write; r.dispatch = res; break; }
      }
      r.dispatch ||= res;
      r.editWrite ||= { changed: false, bytes: editBytes, waitedMs: 3000 * points.length };
      if (!res.dragoverPrevented) throw new Error('dragover was not accepted (preventDefault not called) — drop zone did not recognise the material payload');
      const after = await evalOn(cdp, snapshotExpr);
      r.notice = await evalOn(cdp, `(() => {const n=document.querySelector('[data-akari-timeline-notice]');return n?{text:(document.querySelector('[data-akari-notice-text]')?.textContent||n.textContent||'').trim().slice(0,160),visible:n.getBoundingClientRect().height>0}:null})()`);
      await screenshot(cdp, path.join(SHOTS, '09-material-drop.png'));
      if (!r.editWrite.changed) throw new Error(`drop accepted but edit.json unchanged at ${r.attempts.length} points (notice: ${JSON.stringify(r.notice)})`);
      return { before: { mounted: before.mounted, byKind: before.byKind }, after: { mounted: after.mounted, byKind: after.byKind }, editWrite: r.editWrite, acceptedPoint: r.dispatch, attempts: r.attempts.length, notice: r.notice };
    });

    // --- 10 undo ---
    await step('10 undo（⌘Z）', async r => {
      // 落とした直後は view が右へ寄っているので内容のある位置へ戻す（mount 0 のまま数えない）
      for (let i = 0; i < 20; i++) { await wheel(cdp, centre.x, centre.y, -40, 0); await sleep(60); }
      await sleep(600);
      const before = await evalOn(cdp, snapshotExpr);
      const textBefore = await readFile(path.join(project, 'edit.json'), 'utf8');
      await evalOn(cdp, `document.querySelector('#akari-annotations-widget')?.focus?.()`);
      await keyPress(cdp, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 4, text: 'z' }); // 4 = Meta
      r.editWrite = await waitEditWrite(project, textBefore.length, { timeoutMs: 12_000 });
      const after = await evalOn(cdp, snapshotExpr);
      const textAfter = await readFile(path.join(project, 'edit.json'), 'utf8');
      await screenshot(cdp, path.join(SHOTS, '10-undo.png'));
      r.editJsonBytes = { before: textBefore.length, after: textAfter.length };
      return { mountedBefore: before.mounted, mountedAfter: after.mounted, editChanged: textBefore !== textAfter, editWrite: r.editWrite };
    });

    // --- 11 折りたたみトグル ---
    await step('11 折りたたみトグル（data-akari-tree-toggle）', async r => {
      // グリフを CSS で描く実装もあるため textContent は要求しない（可視であれば掴む）
      // 診断: トグルが 1 つも無いのか、見えていないだけなのかを残す
      r.toggleCensus = await evalOn(cdp, `(() => {const all=[...document.querySelectorAll('[data-akari-tree-toggle]')];
        return {total:all.length, withGlyph:all.filter(e=>e.textContent.trim()).length,
          visible:all.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}).length,
          sample:all.slice(0,5).map(e=>{const r=e.getBoundingClientRect();return{id:e.dataset.akariTreeToggle,glyph:e.textContent.trim(),w:Math.round(r.width),h:Math.round(r.height),y:Math.round(r.top)}})};})()`);
      const t = await evalOn(cdp, `(() => {const b=[...document.querySelectorAll('[data-akari-tree-toggle]')].filter(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0);
        if(!b.length)return null; const e=b[0]; const rr=e.getBoundingClientRect();
        return {id:e.dataset.akariTreeToggle,glyph:e.textContent.trim(),x:rr.left+rr.width/2,y:rr.top+rr.height/2,total:b.length};})()`);
      if (!t) { r.note = 'no expandable tree row in this fixture'; return { skipped: true, reason: 'data-akari-tree-toggle with children not present' }; }
      r.target = t;
      const before = await evalOn(cdp, snapshotExpr);
      await realClick(cdp, t.x, t.y); await sleep(1200);
      const mid = await evalOn(cdp, `(() => {const e=document.querySelector('[data-akari-tree-toggle="'+${JSON.stringify(t.id)}+'"]');return e?e.textContent.trim():null})()`);
      const midSnap = await evalOn(cdp, snapshotExpr);
      await realClick(cdp, t.x, t.y); await sleep(1200);
      const after = await evalOn(cdp, snapshotExpr);
      await screenshot(cdp, path.join(SHOTS, '11-collapse.png'));
      return { glyphBefore: t.glyph, glyphAfterToggle: mid, mounted: { before: before.mounted, collapsed: midSnap.mounted, restored: after.mounted } };
    });

    // --- 12 通し後の状態保持（選択・スクロール）---
    // 契約の「unmount 中も選択モデル上は保持」を、可視域外へ送って戻す往復で確かめる
    await step('12 選択・スクロール保持の確認（unmount → remount 往復）', async r => {
      await evalOn(cdp, `(() => {const s=document.querySelector(${JSON.stringify(STRIP)}).parentElement; s.scrollTop=Math.min(80,s.scrollHeight-s.clientHeight); return s.scrollTop})()`);
      await sleep(300);
      // 見えているクリップを 2 つ選ぶ（この時点の選択が往復後も戻るかを見る）
      const c = await evalOn(cdp, cutCandidatesExpr(12));
      r.candidates = c?.length ?? 0;
      if (c?.length) {
        await realClick(cdp, c[0].x, c[0].y); await sleep(400);
        if (c[1]) { await realClick(cdp, c[1].x, c[1].y, { modifiers: 8 }); await sleep(400); }
      }
      const marked = await evalOn(cdp, snapshotExpr);
      // 可視範囲の外まで送る（mount が外れる）
      for (let i = 0; i < 20; i++) { await wheel(cdp, centre.x, centre.y, 40, 0); await sleep(80); }
      await sleep(600);
      const away = await evalOn(cdp, snapshotExpr);
      // 戻す（mount し直され、選択ハイライトが戻るか）
      for (let i = 0; i < 20; i++) { await wheel(cdp, centre.x, centre.y, -40, 0); await sleep(80); }
      await sleep(800);
      const back = await evalOn(cdp, snapshotExpr);
      await screenshot(cdp, path.join(SHOTS, '12-preserve.png'));
      return {
        selectionBeforePan: marked.selected, selectionWhileUnmounted: away.selected, selectionAfterReturn: back.selected,
        selectionPreserved: JSON.stringify(marked.selected) === JSON.stringify(back.selected),
        mountedBefore: marked.mounted, mountedWhileAway: away.mounted, mountedAfterReturn: back.mounted,
        scrollTopBefore: marked.scrollTop, scrollTopAfter: back.scrollTop,
        scrollPreserved: marked.scrollTop === back.scrollTop
      };
    });

    // --- 13 セレクタ集合（実 DOM 側）---
    await step('13 実 DOM の data-akari-* 属性集合', async () => await evalOn(cdp, `(() => {
      const set=new Set();
      for (const e of document.querySelectorAll('#akari-annotations-widget *')) for (const a of e.attributes) if (a.name.startsWith('data-akari-')) set.add(a.name);
      return [...set].sort();
    })()`));

    out.status = out.steps.some(s => s.status === 'failed') ? 'completed-with-failures' : 'completed';
  } catch (e) {
    out.status = 'aborted'; out.reason = err(e);
  } finally {
    out.finishedAt = new Date().toISOString();
    out.loadAverageAtEnd = os.loadavg();
    try { cdp?.close(); } catch {}
    stop();
    await save();
  }
  console.log(`\n=== ${out.status} === -> ${OUT}`);
}

await main();
