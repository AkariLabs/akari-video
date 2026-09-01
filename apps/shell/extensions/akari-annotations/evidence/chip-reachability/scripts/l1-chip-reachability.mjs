#!/usr/bin/env node
// L1 = CDP 実機。タイムライン帯の「掴めるか」だけを観測する（性能計測ではない）。
// 形は evidence/strip-keyed-diff/scripts/l1-walkthrough.mjs を踏襲し、launch-shell.sh / cdp-lib.mjs を共有する。
//   1. 開いた直後（初回）の縦スクロールと cut トラックの可視性
//   2. 全体表示のままの実効当たり幅（elementFromPoint の実走査。CSS 値の申告ではない）
//   3. 隣接チップの中点規約（掴み分け）
//   4. チップ中央からの CDP 実ドラッグが edit.json へ commit されるか（移動 = at が変わる）
//   5. 左右トリムハンドルの到達性（hover カーソル + 実トリム）
//   6. 回帰: 右クリック・マーキー・手動縦スクロールの保持・data-akari-* 集合
import { spawn } from 'node:child_process';
import { mkdir, rename, writeFile, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot, wheel, keyPress } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name, fallback) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const N = Number(arg('n', '200'));
const PORT = Number(arg('port', '21930'));
const LABEL = arg('label', 'after');
const OUT = arg('output', path.join(ROOT, 'results', `l1-chip-reachability-${LABEL}-n${N}.json`));
const SHOTS = arg('shots', path.join(ROOT, 'results', 'shots'));
const STRIP = '#akari-annotations-widget .akari-annotations-strip';
const ITEMS = '[data-akari-item-kind]';
const CUTS = '[data-akari-item-kind="cut"]';
const S = v => JSON.stringify(v);

const err = e => String(e?.stack || e?.message || e);
const out = {
  status: 'running', label: LABEL, n: N, startedAt: new Date().toISOString(),
  loadAverageAtStart: os.loadavg(), shell: process.env.AKARI_SHELL_DIR || null,
  build: null, steps: [], notes: []
};
const save = async () => {
  await mkdir(path.dirname(OUT), { recursive: true });
  const tmp = `${OUT}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(out, null, 2)}\n`);
  await rename(tmp, OUT);
};
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
    try { const v = await withTimeout(evalOn(cdp, expression), 5000, label); if (v) return v; } catch (e) { last = e; }
    await sleep(intervalMs);
  }
  throw new Error(`${label} not reached: ${err(last)}`);
}

// l1-walkthrough.mjs と同じ開き方（メニュー → タイムライン）。縦スクロールには一切触らない。
async function openTimeline(cdp) {
  await waitEval(cdp, `Boolean(document.readyState==='complete'&&document.getElementById('theia-app-shell')&&document.getElementById('akari-home-widget'))`, { timeoutMs: 180_000, intervalMs: 250, label: 'workbench ready' });
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
      const count = await waitEval(cdp, `(() => { const s=document.querySelector(${S(STRIP)}); if(!s)return null; const c=s.querySelectorAll(${S(ITEMS)}).length; const st=window.__l1Ready||=({last:-1,same:0}); st.same=c===st.last?st.same+1:0; st.last=c; return c>0&&st.same>=4?c:null; })()`, { timeoutMs: 120_000, intervalMs: 250, label: 'strip stable' });
      return { attempts: attempt, mountedItems: count };
    } catch (e) { last = err(e); await sleep(3000); }
  }
  throw new Error(`timeline open failed: ${last}`);
}

// 開いた直後の縦位置。scrollTop と、cut トラック（最初の visual レーン）が表示域に入っているか。
const openGeometryExpr = `(() => {
  const strip=document.querySelector(${S(STRIP)}); const scroll=strip.parentElement;
  const sc=scroll.getBoundingClientRect();
  const rr=r=>({x:+r.left.toFixed(1),y:+r.top.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),bottom:+r.bottom.toFixed(1),right:+r.right.toFixed(1)});
  const cuts=[...strip.querySelectorAll(${S(CUTS)})].map(e=>e.getBoundingClientRect());
  const laneTop=cuts.length?Math.min(...cuts.map(r=>r.top)):null;
  const laneBottom=cuts.length?Math.max(...cuts.map(r=>r.bottom)):null;
  const visible=cuts.filter(r=>Math.min(r.bottom,sc.bottom)-Math.max(r.top,sc.top)>=8).length;
  const bands=[...strip.querySelectorAll('.akari-track-band')].map(e=>({lane:e.dataset.akariLane,...rr(e.getBoundingClientRect())}));
  return {
    scrollTop:scroll.scrollTop, scrollHeight:scroll.scrollHeight, clientHeight:scroll.clientHeight,
    overflowing:scroll.scrollHeight>scroll.clientHeight,
    viewport:rr(sc), stripHeight:parseFloat(strip.style.height)||null,
    cutCount:cuts.length, cutLaneTop:laneTop===null?null:+laneTop.toFixed(1), cutLaneBottom:laneBottom===null?null:+laneBottom.toFixed(1),
    cutLaneFullyVisible: laneTop!==null && laneTop>=sc.top-0.5 && laneBottom<=sc.bottom+0.5,
    cutChipsVisible: visible,
    bandCount: bands.length, bands: bands.slice(0,10)
  };
})()`;

// 実効当たり幅。CSS の申告ではなく elementFromPoint を 0.5px 刻みで走査して外形を決める。
const hitScanExpr = `(() => {
  const strip=document.querySelector(${S(STRIP)}); const scroll=strip.parentElement;
  const sc=scroll.getBoundingClientRect();
  const owns=(x,y,e)=>{const h=document.elementFromPoint(x,y);return Boolean(h&&h.closest(${S(ITEMS)})===e)};
  const rows=[];
  for (const e of strip.querySelectorAll(${S(CUTS)})) {
    const r=e.getBoundingClientRect();
    const top=Math.max(r.top,sc.top), bottom=Math.min(r.bottom,sc.bottom);
    const vh=bottom-top; if(!(vh>=8)) continue;
    const y=(top+bottom)/2, cx=(r.left+r.right)/2;
    if (cx<sc.left+1||cx>sc.right-1) continue;
    const base={id:e.dataset.akariItemId,lane:e.dataset.akariLane??'',row:e.style.top,
      cssWidth:+r.width.toFixed(2),left:+r.left.toFixed(2),right:+r.right.toFixed(2),y:+y.toFixed(1),
      padLeft:+(parseFloat(e.style.getPropertyValue('--akari-hit-pad-left'))||0).toFixed(2),
      padRight:+(parseFloat(e.style.getPropertyValue('--akari-hit-pad-right'))||0).toFixed(2)};
    if(!owns(cx,y,e)){rows.push({...base,centerOwned:false,hitWidth:0});continue;}
    let l=cx,rt=cx;
    for(let x=cx;x>=cx-60;x-=0.5){ if(x<sc.left+0.5) break; if(owns(x,y,e)) l=x; else break; }
    for(let x=cx;x<=cx+60;x+=0.5){ if(x>sc.right-0.5) break; if(owns(x,y,e)) rt=x; else break; }
    rows.push({...base,centerOwned:true,hitLeft:+l.toFixed(2),hitRight:+rt.toFixed(2),hitWidth:+(rt-l).toFixed(2)});
  }
  return rows;
})()`;

const emptyPointExpr = `(() => {
  const strip=document.querySelector(${S(STRIP)}); const scroll=strip.parentElement; const sc=scroll.getBoundingClientRect();
  const cuts=[...strip.querySelectorAll(${S(CUTS)})].map(e=>e.getBoundingClientRect())
    .filter(r=>Math.min(r.bottom,sc.bottom)-Math.max(r.top,sc.top)>=8).sort((a,b)=>a.left-b.left);
  for(let i=0;i+1<cuts.length;i++){
    const x=(cuts[i].right+cuts[i+1].left)/2;
    const y=(Math.max(cuts[i].top,sc.top)+Math.min(cuts[i].bottom,sc.bottom))/2;
    if(x<sc.left+2||x>sc.right-2) continue;
    const hit=document.elementFromPoint(x,y);
    if(hit&&strip.contains(hit)&&!hit.closest(${S(ITEMS)})) return {x,y};
  }
  return null;
})()`;

const attrSetExpr = `(() => { const set=new Set();
  for (const e of document.querySelectorAll('#akari-annotations-widget *')) for (const a of e.attributes) if (a.name.startsWith('data-akari-')) set.add(a.name);
  return [...set].sort(); })()`;

const snapshotExpr = `(() => {
  const strip=document.querySelector(${S(STRIP)}); const scroll=strip?.parentElement;
  const items=[...(strip?.querySelectorAll(${S(ITEMS)})||[])];
  return { mounted: items.length, scrollTop: scroll?.scrollTop ?? null, scrollLeft: scroll?.scrollLeft ?? null,
    selected: [...(strip?.querySelectorAll('.akari-annotations-selected')||[])].map(e=>e.dataset.akariItemKind+':'+e.dataset.akariItemId) };
})()`;

const median = xs => { const s=[...xs].sort((a,b)=>a-b); return s.length ? (s.length%2 ? s[(s.length-1)/2] : (s[s.length/2-1]+s[s.length/2])/2) : null; };

function flattenEdit(edit) {
  const map = new Map();
  for (const track of edit.tracks ?? []) {
    for (const item of track.items ?? []) {
      map.set(`${track.id}/${item.id}`, {
        at: item.at, duration: item.duration,
        in: item.source?.in, out: item.source?.out
      });
    }
  }
  return map;
}
function diffEdit(before, after) {
  const a = flattenEdit(before), b = flattenEdit(after);
  const changed = [];
  for (const [key, value] of b) {
    const prev = a.get(key);
    if (!prev) { changed.push({ key, added: value }); continue; }
    const fields = Object.keys(value).filter(f => value[f] !== prev[f]);
    if (fields.length) changed.push({ key, fields, before: Object.fromEntries(fields.map(f => [f, prev[f]])), after: Object.fromEntries(fields.map(f => [f, value[f]])) });
  }
  for (const key of a.keys()) if (!b.has(key)) changed.push({ key, removed: true });
  return changed;
}
async function readEdit(project) { return JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8')); }
async function waitEditWrite(project, baselineBytes, { timeoutMs = 10_000 } = {}) {
  const file = path.join(project, 'edit.json');
  const deadline = Date.now() + timeoutMs; let text = null;
  while (Date.now() < deadline) {
    try { text = await readFile(file, 'utf8'); } catch { text = null; }
    if (text !== null && text.length !== baselineBytes) return { changed: true, bytes: text.length };
    await sleep(200);
  }
  return { changed: false, bytes: text?.length ?? null };
}

async function hoverCursor(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await sleep(80);
  return evalOn(cdp, `(() => {const h=document.elementFromPoint(${x},${y}); const e=h&&h.closest(${S(ITEMS)}); return e?{cursor:e.style.cursor,id:e.dataset.akariItemId}:null})()`);
}
async function dragBy(cdp, x, y, dx, { steps = 8, holdMs = 60 } = {}) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(holdMs);
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + (dx * i) / steps, y, button: 'left', buttons: 1 }); await sleep(40); }
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y, button: 'left' });
  await sleep(300);
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const project = path.join(ROOT, 'fixtures', `n${N}`);
  const iso = path.join(ROOT, 'runs', `l1-${LABEL}-n${N}`);
  const log = path.join(ROOT, 'runs', `console-l1-${LABEL}-n${N}.log`);
  const bundle = path.join(process.env.AKARI_SHELL_DIR || path.join(ROOT, '..', '..', '..', '..'), 'lib', 'frontend', 'bundle.js');
  try { const st = await stat(bundle); out.build = { bundle, bytes: st.size, mtime: st.mtime.toISOString() }; } catch (e) { out.build = { bundle, error: err(e) }; }

  const launched = await run('/bin/zsh', [path.join(ROOT, 'scripts', 'launch-shell.sh'), project, String(PORT), iso, log], { timeoutMs: 20_000 });
  if (!launched.ok) throw new Error(`launch-shell failed: ${launched.stderr}`);
  const pid = Number(launched.stdout.trim().split(/\s+/).at(-1));
  out.electronPid = pid;
  const stop = () => { try { process.kill(pid, 'SIGTERM'); } catch {} };

  let cdp;
  try {
    const deadline = Date.now() + 120_000; let page;
    while (Date.now() < deadline && !page) { try { page = (await listTargets(PORT)).find(t => t.type === 'page'); } catch {} if (!page) await sleep(300); }
    if (!page) throw new Error('no CDP page target');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await withTimeout(cdp.connect(), 15_000, 'CDP connect');
    for (const d of ['Page.enable', 'Runtime.enable']) { for (let i = 1; i <= 6; i++) { try { await cdp.send(d); break; } catch (e) { if (i === 6) throw e; await sleep(3000); } } }

    // --- 00 開いた直後（縦スクロールには触っていない）---
    await step('00 タイムラインを開く（初回・縦スクロール未操作）', async r => {
      r.open = await openTimeline(cdp);
      await sleep(1500);
      out.openGeometry = await evalOn(cdp, openGeometryExpr);
      out.attrSetAtOpen = await evalOn(cdp, attrSetExpr);
      return out.openGeometry;
    });
    await screenshot(cdp, path.join(SHOTS, `${LABEL}-n${N}-00-open.png`));

    // --- 01 実効当たり幅（全体表示のまま・ズーム無し）---
    await step('01 実効当たり幅を走査（elementFromPoint 0.5px 刻み）', async r => {
      const rows = await evalOn(cdp, hitScanExpr);
      out.hitRows = rows;
      const owned = rows.filter(o => o.centerOwned);
      const widths = owned.map(o => o.hitWidth);
      r.sample = rows.slice(0, 8);
      return {
        scanned: rows.length, centerOwned: owned.length, centerMissed: rows.length - owned.length,
        cssWidthMin: rows.length ? Math.min(...rows.map(o => o.cssWidth)) : null,
        cssWidthMedian: median(rows.map(o => o.cssWidth)),
        hitWidthMin: widths.length ? Math.min(...widths) : null,
        hitWidthMedian: median(widths),
        hitWidthMax: widths.length ? Math.max(...widths) : null,
        atLeast8px: widths.filter(w => w >= 8).length,
        below8px: widths.filter(w => w < 8).length
      };
    });

    // --- 02 中点規約（隣を奪わない）---
    await step('02 隣接チップの掴み分け（中点規約）', async () => {
      const rows = (out.hitRows || []).filter(o => o.centerOwned);
      const groups = new Map();
      for (const o of rows) { const k = `${o.lane}|${o.row}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(o); }
      const pairs = [];
      for (const list of groups.values()) {
        list.sort((a, b) => a.left - b.left);
        for (let i = 0; i + 1 < list.length; i++) {
          const a = list[i], b = list[i + 1];
          if (b.left - a.right > 200) continue;
          const mid = (a.right + b.left) / 2;
          pairs.push({
            left: a.id, right: b.id, gap: +(b.left - a.right).toFixed(2), midpoint: +mid.toFixed(2),
            leftHitRight: a.hitRight, rightHitLeft: b.hitLeft,
            disjoint: a.hitRight < b.hitLeft,
            leftStopsAtMidpoint: a.hitRight <= mid + 0.75,
            rightStartsAtMidpoint: b.hitLeft >= mid - 0.75
          });
        }
      }
      const bad = pairs.filter(p => !p.disjoint || !p.leftStopsAtMidpoint || !p.rightStartsAtMidpoint);
      out.midpointPairs = { total: pairs.length, violations: bad.length, sample: pairs.slice(0, 5), badSample: bad.slice(0, 5) };
      return out.midpointPairs;
    });

    // --- 03 当たり領域のゾーン幅（hover カーソルの実走査。ew-resize = トリム / それ以外 = 移動）---
    await step('03 当たり領域のゾーン幅（左トリム / 移動 / 右トリム）', async r => {
      const rows = (out.hitRows || []).filter(o => o.centerOwned);
      const picks = [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]].filter(Boolean);
      const scans = [];
      for (const t of picks) {
        const samples = [];
        for (let x = t.hitLeft; x <= t.hitRight; x += 0.5) {
          const c = await hoverCursor(cdp, x, t.y);
          samples.push({ x: +x.toFixed(2), owned: c?.id === t.id, cursor: c?.cursor ?? null });
        }
        const mid = (t.hitLeft + t.hitRight) / 2;
        const owned = samples.filter(z => z.owned);
        const span = a => (a.length ? +(a[a.length - 1].x - a[0].x + 0.5).toFixed(2) : 0);
        const move = owned.filter(z => z.cursor !== 'ew-resize');
        scans.push({
          id: t.id, cssWidth: t.cssWidth, hitWidth: t.hitWidth,
          ownedWidth: span(owned), moveZoneWidth: span(move),
          trimLeftWidth: span(owned.filter(z => z.cursor === 'ew-resize' && z.x < mid)),
          trimRightWidth: span(owned.filter(z => z.cursor === 'ew-resize' && z.x >= mid)),
          cursorsSeen: [...new Set(owned.map(z => z.cursor))]
        });
      }
      r.scans = scans;
      const min = key => (scans.length ? Math.min(...scans.map(o => o[key])) : null);
      return {
        chips: scans.length, moveZoneMin: min('moveZoneWidth'),
        trimLeftMin: min('trimLeftWidth'), trimRightMin: min('trimRightWidth'), scans
      };
    });

    // --- 04 中央から実ドラッグ（移動が edit.json へ）---
    await step('04 チップ中央から CDP 実ドラッグ（全体表示のまま）', async r => {
      const rows = (out.hitRows || []).filter(o => o.centerOwned);
      const groups = new Map();
      for (const o of rows) { const k = `${o.lane}|${o.row}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(o); }
      let target = null;
      for (const list of groups.values()) {
        list.sort((a, b) => a.left - b.left);
        for (let i = 0; i + 1 < list.length; i++) {
          const gap = list[i + 1].left - list[i].right;
          if (!target || gap > target.gap) target = { ...list[i], gap };
        }
      }
      target ||= rows[0] && { ...rows[0], gap: 0 };
      if (!target) throw new Error('no cut chip to drag');
      r.target = target;
      const beforeEdit = await readEdit(project);
      const attempts = [];
      const x = (target.hitLeft + target.hitRight) / 2;
      for (const factor of [1, 1.5, 2]) {
        const dx = Math.max(4, Math.round(Math.max(target.cssWidth, 5) * factor));
        const bytes = (await readFile(path.join(project, 'edit.json'), 'utf8')).length;
        await dragBy(cdp, x, target.y, dx);
        const wrote = await waitEditWrite(project, bytes);
        attempts.push({ dx, wrote });
        if (wrote.changed) break;
      }
      r.attempts = attempts;
      const afterEdit = await readEdit(project);
      const changed = diffEdit(beforeEdit, afterEdit);
      out.dragDiff = changed;
      return {
        target: { id: target.id, cssWidth: target.cssWidth, hitWidth: target.hitWidth, gap: target.gap },
        attempts, changedItems: changed.length, changed: changed.slice(0, 4),
        movedByAt: changed.some(c => c.fields?.includes('at')),
        trimmedInstead: changed.some(c => c.fields?.some(f => f === 'in' || f === 'out') && !c.fields?.includes('at'))
      };
    });
    await screenshot(cdp, path.join(SHOTS, `${LABEL}-n${N}-04-drag.png`));

    // --- 04b 掴み分け: 見た目の中心から ±2 / ±4 px ずらした押下点で何が起きるか ---
    await step('04b 中心から ±2px / ±4px の押下点で move / trim / 無反応を実測', async r => {
      const results = [];
      let cursorIndex = 5;
      for (const offset of [-4, -2, 2, 4]) {
        const rows = await evalOn(cdp, hitScanExpr);
        const list = rows.filter(o => o.centerOwned);
        const t = list[Math.min(list.length - 1, cursorIndex)];
        cursorIndex += 3;
        if (!t) break;
        const cx = (t.left + t.right) / 2;
        const x = cx + offset;
        const empty = await evalOn(cdp, emptyPointExpr);
        if (empty) { await realClick(cdp, empty.x, empty.y); await sleep(400); }
        const selectionBefore = (await evalOn(cdp, snapshotExpr)).selected.length;
        const before = await readEdit(project);
        const bytes = (await readFile(path.join(project, 'edit.json'), 'utf8')).length;
        const cursor = await hoverCursor(cdp, x, t.y);
        const dx = Math.max(5, Math.round(t.cssWidth * 0.55));
        await dragBy(cdp, x, t.y, dx);
        const wrote = await waitEditWrite(project, bytes, { timeoutMs: 6000 });
        const changed = diffEdit(before, await readEdit(project));
        const expanded = list.filter(o => o.padLeft > 0 || o.padRight > 0).length;
        results.push({
          offset, dx, chip: t.id, selectionBefore, cssWidth: t.cssWidth, hitWidth: t.hitWidth,
          padLeft: t.padLeft, padRight: t.padRight, expandedChipsInView: expanded, chipsInView: list.length,
          pressOwnedBy: cursor?.id ?? null, cursor: cursor?.cursor ?? null, wrote: wrote.changed,
          outcome: changed.some(c => c.fields?.includes('at')) ? 'moved'
            : changed.some(c => c.fields?.some(f => ['in', 'out', 'duration'].includes(f))) ? 'trimmed' : 'none',
          changed: changed.slice(0, 2)
        });
      }
      r.results = results;
      return { probes: results.length, moved: results.filter(o => o.outcome === 'moved').length, results };
    });

    // --- 05 トリムハンドル（拡張領域の右端から）---
    await step('05 右トリムハンドルを掴んで実トリム（拡張チップ）', async r => {
      const rows = await evalOn(cdp, hitScanExpr);
      const t = rows.filter(o => o.centerOwned).sort((a, b) => b.hitWidth - a.hitWidth)[0];
      if (!t) throw new Error('no chip to trim');
      r.target = t;
      const cursorAtHandle = await hoverCursor(cdp, t.hitRight - 1, t.y);
      const beforeEdit = await readEdit(project);
      const attempts = [];
      for (const dx of [-3, -6, -12]) {
        const bytes = (await readFile(path.join(project, 'edit.json'), 'utf8')).length;
        await dragBy(cdp, t.hitRight - 1, t.y, dx);
        const wrote = await waitEditWrite(project, bytes, { timeoutMs: 6000 });
        attempts.push({ dx, wrote: wrote.changed });
        if (wrote.changed) break;
      }
      const changed = diffEdit(beforeEdit, await readEdit(project));
      return {
        target: { id: t.id, cssWidth: t.cssWidth, hitWidth: t.hitWidth, hitRight: t.hitRight },
        cursorAtHandle, handleReachableOutsideChipBox: t.hitRight - 1 > t.right,
        attempts, changed: changed.slice(0, 3),
        trimmed: changed.some(c => c.fields?.some(f => ['in', 'out', 'duration'].includes(f)))
      };
    });

    // --- 05b 回帰: ズームインした通常幅チップ（非拡張パス = 従来の EDGE_ZONE_PX）---
    await step('05b 回帰: 通常幅チップ（ズームイン）の右トリム', async r => {
      const centre = await evalOn(cdp, `(() => {const s=document.querySelector(${S(STRIP)}).parentElement;const r=s.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      for (let i = 0; i < 6; i++) { await wheel(cdp, centre.x, centre.y, 0, -100, { ctrlKey: true }); await sleep(180); }
      await sleep(1200);
      const rows = await evalOn(cdp, hitScanExpr);
      const owned = rows.filter(o => o.centerOwned).sort((a, b) => b.cssWidth - a.cssWidth);
      r.widest = owned.slice(0, 3);
      const wide = owned.find(o => o.cssWidth >= 24);
      if (!wide) { r.skipped = true; return { skipped: true, reason: 'no chip wider than 24px after zoom', widest: r.widest }; }
      const cursorAtEdge = await hoverCursor(cdp, wide.right - 3, wide.y);
      const cursorAtCentre = await hoverCursor(cdp, (wide.left + wide.right) / 2, wide.y);
      const before = await readEdit(project);
      const bytes = (await readFile(path.join(project, 'edit.json'), 'utf8')).length;
      await dragBy(cdp, wide.right - 3, wide.y, -30);
      const wrote = await waitEditWrite(project, bytes, { timeoutMs: 8000 });
      const changed = diffEdit(before, await readEdit(project));
      for (let i = 0; i < 6; i++) { await wheel(cdp, centre.x, centre.y, 0, 100, { ctrlKey: true }); await sleep(180); }
      await sleep(1000);
      return {
        chip: { id: wide.id, cssWidth: wide.cssWidth, hitWidth: wide.hitWidth, padLeft: wide.padLeft, padRight: wide.padRight },
        noPaddingOnWideChip: wide.padLeft === 0 && wide.padRight === 0,
        hitEqualsCssWidth: Math.abs(wide.hitWidth - wide.cssWidth) <= 1.5,
        cursorAtEdge: cursorAtEdge?.cursor ?? null, cursorAtCentre: cursorAtCentre?.cursor ?? null,
        wrote: wrote.changed, changed: changed.slice(0, 3),
        trimmed: changed.some(c => c.fields?.some(f => ['in', 'out', 'duration'].includes(f)))
      };
    });

    // --- 06 回帰: 右クリック ---
    await step('06 回帰: 細いチップの右クリックメニュー', async r => {
      const rows = await evalOn(cdp, hitScanExpr);
      const t = rows.filter(o => o.centerOwned)[0];
      if (!t) throw new Error('no chip for contextmenu');
      const x = (t.hitLeft + t.hitRight) / 2;
      r.target = t;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: t.y, button: 'none' }); await sleep(40);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: t.y, button: 'right', buttons: 2, clickCount: 1 }); await sleep(40);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: t.y, button: 'right', buttons: 0, clickCount: 1 });
      const menu = await waitEval(cdp, `(() => {const m=[...document.querySelectorAll('[data-akari-context-menu],.lm-Menu,[role="menu"]')].filter(e=>e.getBoundingClientRect().width>0);
        return m.length?{count:m.length,items:[...m[0].querySelectorAll('[data-akari-context-item],.lm-Menu-itemLabel,[role="menuitem"]')].map(e=>e.textContent.trim()).filter(Boolean).slice(0,8)}:null})()`, { timeoutMs: 8000, intervalMs: 150, label: 'context menu' });
      await keyPress(cdp, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await sleep(300);
      return menu;
    });

    // --- 07 回帰: 空き点からのマーキー（拡張領域が空きを食い潰していないか）---
    await step('07 回帰: 空き点の判定とマーキー開始', async r => {
      const point = await evalOn(cdp, emptyPointExpr);
      const plan = point ? { empty: true, startX: point.x, startY: point.y, endX: point.x + 120 } : { empty: false };
      r.plan = plan;
      if (!plan?.empty) return { marqueeStarted: false, plan };
      const before = await evalOn(cdp, snapshotExpr);
      await dragBy(cdp, plan.startX, plan.startY, plan.endX - plan.startX, { steps: 6 });
      const after = await evalOn(cdp, snapshotExpr);
      return { marqueeStarted: true, selectedBefore: before.selected.length, selectedAfter: after.selected.length, gapPointIsEmpty: true };
    });

    // --- 08 回帰: 手動の縦スクロールが再描画で保持されるか ---
    await step('08 回帰: 手動縦スクロールの保持（パン往復後）', async r => {
      const set = await evalOn(cdp, `(() => {const s=document.querySelector(${S(STRIP)}).parentElement; s.scrollTop=Math.min(60,Math.max(0,s.scrollHeight-s.clientHeight)); return s.scrollTop})()`);
      await sleep(400);
      const centre = await evalOn(cdp, `(() => {const s=document.querySelector(${S(STRIP)}).parentElement;const r=s.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      r.centre = centre;
      const afterSet = await evalOn(cdp, `document.querySelector(${S(STRIP)}).parentElement.scrollTop`);
      for (let i = 0; i < 6; i++) { await wheel(cdp, centre.x, centre.y, 40, 0); await sleep(120); }
      const afterPanOut = await evalOn(cdp, `document.querySelector(${S(STRIP)}).parentElement.scrollTop`);
      for (let i = 0; i < 6; i++) { await wheel(cdp, centre.x, centre.y, -40, 0); await sleep(120); }
      await sleep(600);
      const after = await evalOn(cdp, `document.querySelector(${S(STRIP)}).parentElement.scrollTop`);
      return { scrollTopSet: set, scrollTopAfterSet: afterSet, scrollTopMidPan: afterPanOut, scrollTopAfterPan: after, preserved: set === after };
    });

    // --- 09 data-akari-* 集合 ---
    await step('09 data-akari-* 属性集合', async () => { out.attrSet = await evalOn(cdp, attrSetExpr); return { count: out.attrSet.length }; });

    out.status = out.steps.some(s => s.status === 'failed') ? 'completed-with-failures' : 'completed';
  } catch (e) {
    out.status = 'aborted'; out.reason = err(e);
  } finally {
    out.finishedAt = new Date().toISOString();
    out.loadAverageAtEnd = os.loadavg();
    try { cdp?.close(); } catch {}
    stop();
    await sleep(1500);
    await save();
  }
  console.log(`\n=== ${out.status} === -> ${OUT}`);
}

await main();
