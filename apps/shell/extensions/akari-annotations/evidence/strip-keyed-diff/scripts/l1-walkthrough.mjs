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
    await step('01 identity 計器を仕掛ける', async () => await evalOn(cdp, `(() => {
      const strip=document.querySelector(${JSON.stringify(STRIP)});
      const k=${key};
      const st={seq:0,tags:new Map(),added:0,removed:0,addedKeys:[],removedKeys:[],otherAdded:0,otherRemoved:0,imgTags:new WeakMap(),imgSeq:0};
      for (const e of strip.querySelectorAll(${JSON.stringify(ITEMS)})) { e.__l1=++st.seq; st.tags.set(k(e), e.__l1); }
      for (const e of strip.querySelectorAll('img,canvas')) { e.__l1img=++st.imgSeq; }
      st.initialKeys=[...st.tags.keys()];
      const obs=new MutationObserver(recs=>{ for (const rec of recs) {
        for (const n of rec.addedNodes) { if(n.nodeType!==1) continue; if(n.matches?.(${JSON.stringify(ITEMS)})) { st.added++; st.addedKeys.push(k(n)); } else { st.otherAdded++; } }
        for (const n of rec.removedNodes) { if(n.nodeType!==1) continue; if(n.matches?.(${JSON.stringify(ITEMS)})) { st.removed++; st.removedKeys.push(k(n)); } else { st.otherRemoved++; } }
      }});
      obs.observe(strip,{childList:true,subtree:true});
      st.obs=obs; window.__l1state=st;
      return {tagged:st.seq, taggedMedia:st.imgSeq};
    })()`));

    // --- 02 ズーム ---
    await step('02 ズーム（ctrl+wheel 上下 各 5 回）', async () => {
      for (let i = 0; i < 5; i++) { await wheel(cdp, centre.x, centre.y, 0, -100, { ctrlKey: true }); await sleep(120); }
      for (let i = 0; i < 5; i++) { await wheel(cdp, centre.x, centre.y, 0, 100, { ctrlKey: true }); await sleep(120); }
      await sleep(500); return await evalOn(cdp, snapshotExpr);
    });
    await screenshot(cdp, path.join(SHOTS, '02-zoom.png'));

    // --- 03 パン 20 回（identity 証明の本体）---
    await step('03 パン 20 回', async r => {
      const before = await evalOn(cdp, snapshotExpr);
      for (let i = 0; i < 20; i++) { await wheel(cdp, centre.x, centre.y, 40, 0); await sleep(120); }
      await sleep(600);
      const after = await evalOn(cdp, snapshotExpr);
      r.before = before; r.after = after;
      return { panSteps: 20 };
    });
    await screenshot(cdp, path.join(SHOTS, '03-pan20.png'));

    await step('04 ノード identity を判定', async () => {
      out.identity = await evalOn(cdp, `(() => {
        const strip=document.querySelector(${JSON.stringify(STRIP)});
        const k=${key}; const st=window.__l1state;
        const removedSet=new Set(st.removedKeys);
        let survived=0, brokenIdentity=[], enteredRange=0, untaggedButNeverRemoved=[];
        const mediaNow=[...strip.querySelectorAll('img,canvas')];
        let mediaKept=0, mediaFresh=0;
        for (const e of mediaNow) { if (e.__l1img) mediaKept++; else mediaFresh++; }
        for (const e of strip.querySelectorAll(${JSON.stringify(ITEMS)})) {
          const kk=k(e); const tag=st.tags.get(kk);
          if (tag===undefined) { enteredRange++; continue; }
          if (e.__l1===tag) { survived++; }
          else if (removedSet.has(kk)) { enteredRange++; }
          else { brokenIdentity.push(kk); untaggedButNeverRemoved.push(kk); }
        }
        return {
          initialMounted: st.initialKeys.length,
          survivedWithSameNode: survived,
          brokenIdentityCount: brokenIdentity.length,
          brokenIdentitySample: brokenIdentity.slice(0,10),
          remountedAfterLeavingRange: enteredRange,
          mutationAddedItemNodes: st.added,
          mutationRemovedItemNodes: st.removed,
          distinctAddedKeys: new Set(st.addedKeys).size,
          distinctRemovedKeys: new Set(st.removedKeys).size,
          mediaNodesNow: mediaNow.length, mediaNodesReused: mediaKept, mediaNodesRecreated: mediaFresh
        };
      })()`);
      return out.identity;
    });

    // --- 05 ドラッグ移動 ---
    await step('05 ドラッグ移動（クリップ中央から +60px）', async r => {
      const t = await evalOn(cdp, `(() => {const strip=document.querySelector(${JSON.stringify(STRIP)});const sr=strip.parentElement.getBoundingClientRect();
        const c=[...strip.querySelectorAll('[data-akari-item-kind="cut"]')].map(e=>({e,r:e.getBoundingClientRect()}))
          .filter(o=>o.r.width>=20&&o.r.top>=sr.top&&o.r.bottom<=sr.bottom&&o.r.left>=sr.left&&o.r.right<=sr.right);
        if(!c.length)return null; const o=c[Math.floor(c.length/2)];
        return {id:o.e.dataset.akariItemId,x:o.r.left+o.r.width/2,y:o.r.top+o.r.height/2,w:o.r.width,left:o.r.left};})()`);
      if (!t) throw new Error('no visible cut clip to drag');
      r.target = t;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x, y: t.y, button: 'none' }); await sleep(40);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: t.x, y: t.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(60);
      for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x + i * 10, y: t.y, button: 'left', buttons: 1 }); await sleep(40); }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: t.x + 60, y: t.y, button: 'left' });
      await sleep(1500);
      return await evalOn(cdp, snapshotExpr);
    });
    await screenshot(cdp, path.join(SHOTS, '05-drag.png'));

    // --- 06 トリム（右端 EDGE_ZONE_PX=6 以内から掴む）---
    await step('06 トリム（右端を -30px）', async r => {
      const t = await evalOn(cdp, `(() => {const strip=document.querySelector(${JSON.stringify(STRIP)});const sr=strip.parentElement.getBoundingClientRect();
        const c=[...strip.querySelectorAll('[data-akari-item-kind="cut"]')].map(e=>({e,r:e.getBoundingClientRect()}))
          .filter(o=>o.r.width>=40&&o.r.top>=sr.top&&o.r.bottom<=sr.bottom&&o.r.left>=sr.left&&o.r.right<=sr.right);
        if(!c.length)return null; const o=c[Math.floor(c.length/2)];
        return {id:o.e.dataset.akariItemId,x:o.r.right-3,y:o.r.top+o.r.height/2,w:o.r.width};})()`);
      if (!t) throw new Error('no visible cut clip wide enough to trim');
      r.target = t;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x, y: t.y, button: 'none' }); await sleep(40);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: t.x, y: t.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(60);
      for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x - i * 5, y: t.y, button: 'left', buttons: 1 }); await sleep(40); }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: t.x - 30, y: t.y, button: 'left' });
      await sleep(1500);
      return await evalOn(cdp, snapshotExpr);
    });
    await screenshot(cdp, path.join(SHOTS, '06-trim.png'));

    // --- 07 右クリックメニュー ---
    await step('07 右クリックメニュー', async r => {
      const t = await evalOn(cdp, `(() => {const strip=document.querySelector(${JSON.stringify(STRIP)});const sr=strip.parentElement.getBoundingClientRect();
        const c=[...strip.querySelectorAll('[data-akari-item-kind="cut"]')].map(e=>({e,r:e.getBoundingClientRect()}))
          .filter(o=>o.r.width>=20&&o.r.top>=sr.top&&o.r.bottom<=sr.bottom);
        if(!c.length)return null; const o=c[0]; return {id:o.e.dataset.akariItemId,x:o.r.left+o.r.width/2,y:o.r.top+o.r.height/2};})()`);
      if (!t) throw new Error('no clip for contextmenu');
      r.target = t;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x, y: t.y, button: 'none' }); await sleep(40);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: t.x, y: t.y, button: 'right', buttons: 2, clickCount: 1 }); await sleep(40);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: t.x, y: t.y, button: 'right', buttons: 0, clickCount: 1 });
      const menu = await waitEval(cdp, `(() => {const m=[...document.querySelectorAll('.lm-Menu,.p-Menu,[role="menu"]')].filter(e=>e.getBoundingClientRect().width>0);
        return m.length?{count:m.length,items:[...m[0].querySelectorAll('.lm-Menu-itemLabel,[role="menuitem"]')].map(e=>e.textContent.trim()).filter(Boolean).slice(0,12)}:null})()`, { timeoutMs: 8000, intervalMs: 150, label: 'context menu' });
      await screenshot(cdp, path.join(SHOTS, '07-contextmenu.png'));
      await keyPress(cdp, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await sleep(400);
      return menu;
    });

    // --- 08 マーキー（shift+click の複数選択）---
    await step('08 マーキー選択（shift+click 複数選択）', async r => {
      const t = await evalOn(cdp, `(() => {const strip=document.querySelector(${JSON.stringify(STRIP)});const sr=strip.parentElement.getBoundingClientRect();
        const c=[...strip.querySelectorAll('[data-akari-item-kind="cut"]')].map(e=>({e,r:e.getBoundingClientRect()}))
          .filter(o=>o.r.width>=16&&o.r.top>=sr.top&&o.r.bottom<=sr.bottom&&o.r.left>=sr.left&&o.r.right<=sr.right).slice(0,3);
        return c.map(o=>({id:o.e.dataset.akariItemId,x:o.r.left+o.r.width/2,y:o.r.top+o.r.height/2}));})()`);
      if (!t || t.length < 2) throw new Error(`need >=2 visible clips, got ${t?.length ?? 0}`);
      r.targets = t;
      await realClick(cdp, t[0].x, t[0].y); await sleep(400);
      for (const p of t.slice(1)) { await realClick(cdp, p.x, p.y, { modifiers: 8 }); await sleep(400); } // 8 = Shift
      await sleep(500);
      const snap = await evalOn(cdp, snapshotExpr);
      await screenshot(cdp, path.join(SHOTS, '08-marquee.png'));
      return { clicked: t.length, selected: snap.selected, selectedCount: snap.selected.length };
    });

    // --- 09 素材 D&D（HTML5 DragEvent を DataTransfer 付きで合成）---
    await step('09 素材 D&D（assets/testsrc2-10s.mp4 を帯へ）', async r => {
      const before = await evalOn(cdp, snapshotExpr);
      const res = await evalOn(cdp, `(() => {
        const strip=document.querySelector(${JSON.stringify(STRIP)}); const scroll=strip.parentElement;
        const sr=scroll.getBoundingClientRect();
        const x=sr.left+sr.width*0.5, y=sr.top+Math.min(sr.height*0.5,180);
        const dt=new DataTransfer();
        dt.setData('application/x-akari-material', JSON.stringify({relativePath:'assets/testsrc2-10s.mp4',kind:'video',durationSeconds:10}));
        const mk=t=>new DragEvent(t,{dataTransfer:dt,bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y});
        const enter=mk('dragenter'), over=mk('dragover'), drop=mk('drop');
        scroll.dispatchEvent(enter); scroll.dispatchEvent(over);
        const overHandled=over.defaultPrevented;
        scroll.dispatchEvent(drop);
        return {x,y,typesSeen:[...dt.types],dragoverPrevented:overHandled,dropPrevented:drop.defaultPrevented};
      })()`);
      r.dispatch = res;
      if (!res.dragoverPrevented) throw new Error('dragover was not accepted (preventDefault not called) — drop zone did not recognise the material payload');
      await sleep(2500);
      const after = await evalOn(cdp, snapshotExpr);
      await screenshot(cdp, path.join(SHOTS, '09-material-drop.png'));
      return { before: { mounted: before.mounted, byKind: before.byKind }, after: { mounted: after.mounted, byKind: after.byKind } };
    });

    // --- 10 undo ---
    await step('10 undo（⌘Z）', async r => {
      const before = await evalOn(cdp, snapshotExpr);
      const editBefore = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
      await evalOn(cdp, `document.querySelector('#akari-annotations-widget')?.focus?.()`);
      await keyPress(cdp, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 4, text: 'z' }); // 4 = Meta
      await sleep(2500);
      const after = await evalOn(cdp, snapshotExpr);
      const editAfter = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
      await screenshot(cdp, path.join(SHOTS, '10-undo.png'));
      const cutsOf = e => (e.tracks ? JSON.stringify(e.tracks).length : JSON.stringify(e).length);
      r.editJsonBytes = { before: cutsOf(editBefore), after: cutsOf(editAfter) };
      return { mountedBefore: before.mounted, mountedAfter: after.mounted, editChanged: JSON.stringify(editBefore) !== JSON.stringify(editAfter) };
    });

    // --- 11 折りたたみトグル ---
    await step('11 折りたたみトグル（data-akari-tree-toggle）', async r => {
      const t = await evalOn(cdp, `(() => {const b=[...document.querySelectorAll('[data-akari-tree-toggle]')].filter(e=>e.textContent.trim()&&e.getBoundingClientRect().width>0);
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
    await step('12 選択・スクロール保持の確認', async r => {
      const s0 = await evalOn(cdp, snapshotExpr);
      await evalOn(cdp, `(() => {const s=document.querySelector(${JSON.stringify(STRIP)}).parentElement; s.scrollTop=Math.min(80,s.scrollHeight-s.clientHeight); return s.scrollTop})()`);
      await sleep(300);
      const marked = await evalOn(cdp, snapshotExpr);
      for (let i = 0; i < 5; i++) { await wheel(cdp, centre.x, centre.y, 40, 0); await sleep(120); }
      await sleep(600);
      const s1 = await evalOn(cdp, snapshotExpr);
      await screenshot(cdp, path.join(SHOTS, '12-preserve.png'));
      return {
        selectionBeforePan: marked.selected, selectionAfterPan: s1.selected,
        selectionPreserved: JSON.stringify(marked.selected) === JSON.stringify(s1.selected),
        scrollTopBeforePan: marked.scrollTop, scrollTopAfterPan: s1.scrollTop,
        scrollPreserved: marked.scrollTop === s1.scrollTop,
        mountedBefore: s0.mounted, mountedAfter: s1.mounted
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
