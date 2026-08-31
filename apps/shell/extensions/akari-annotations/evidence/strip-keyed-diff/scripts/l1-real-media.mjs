#!/usr/bin/env node
// L1（実素材）= r1 差し戻しの残務 2 点を実機 CDP で観測する。
//   1. サムネイル（フィルムストリップ）と波形 canvas のノード identity がパン 20 回で保たれるか
//      （再生成 0）。サムネ生成 cache が温まった状態で測る。
//   2. 折りたたみトグル（hasChildren=true の木行）の開閉 → 子行の mount/unmount → 再度パン。
// 計測（measure-a.mjs）ではない。数えるのは ms ではなくノードの素性と mount 状態。
//
// 素材: fixtures/real-media（内部 fieldtest/2026-08-31-object-tree-manual-test の複製。
// take-a.mp4（AAC 音声あり）/ take-b.mp4 / 純グループ g-deco / 字幕袋 caps / HTML 袋 intro を含む）。
import { spawn } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot, wheel } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) || 21930);
// --label=before で起点 main のビルド（AKARI_SHELL_DIR で差す）を同じ手順で回す対照走にする。
const LABEL = process.argv.find(v => v.startsWith('--label='))?.slice(8) || 'after';
const OUT = process.argv.find(v => v.startsWith('--output='))?.slice(9)
  || path.join(ROOT, 'results', LABEL === 'after' ? 'l1-real-media.json' : `l1-real-media-${LABEL}.json`);
const SHOTS = path.join(ROOT, 'evidence', `l1-real-media-shots-${LABEL}`);
const PAN_STEPS = Number(process.argv.find(v => v.startsWith('--pans='))?.slice(7) || 20);
const ZOOM_NOTCHES = Number(process.argv.find(v => v.startsWith('--zoom='))?.slice(7) || 5);
const STRIP = '#akari-annotations-widget .akari-annotations-strip';
const ITEMS = '[data-akari-item-kind]';
const CUTS = '[data-akari-item-kind="cut"]';
const CELL = '.akari-annotations-strip-clip-filmstrip-cell';
const FILM = '.akari-annotations-strip-clip-filmstrip';

const err = e => String(e?.stack || e?.message || e);
const out = {
  status: 'running', fixture: 'real-media', label: LABEL, startedAt: new Date().toISOString(),
  loadAverageAtStart: os.loadavg(), shell: process.env.AKARI_SHELL_DIR || null,
  panSteps: PAN_STEPS, zoomNotches: ZOOM_NOTCHES,
  steps: [], mediaIdentity: null, treeToggle: null, consoleErrors: [], notes: []
};
const save = async () => {
  await mkdir(path.dirname(OUT), { recursive: true });
  const t = `${OUT}.tmp-${process.pid}`;
  await writeFile(t, `${JSON.stringify(out, null, 2)}\n`);
  await rename(t, OUT);
};
const withTimeout = (p, ms, l) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`${l} timed out after ${ms}ms`)), ms))]);

let currentStep = 'boot';

async function step(name, fn) {
  const started = Date.now();
  currentStep = name;
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

// l1-walkthrough.mjs と同じ開き方（メニュー → タイムライン）。
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

const snapshotExpr = `(() => {
  const strip=document.querySelector(${JSON.stringify(STRIP)});
  const scroll=strip?.parentElement;
  const items=[...(strip?.querySelectorAll(${JSON.stringify(ITEMS)})||[])];
  return {
    mounted: items.length,
    byKind: items.reduce((a,e)=>{a[e.dataset.akariItemKind]=(a[e.dataset.akariItemKind]||0)+1;return a},{}),
    selected: [...(strip?.querySelectorAll('.akari-annotations-selected')||[])].map(e=>e.dataset.akariItemKind+':'+e.dataset.akariItemId),
    treeRows: [...(strip?.querySelectorAll('[data-akari-tree-item-kind]')||[])].map(e=>e.dataset.akariItemId).sort(),
    scrollTop: scroll?.scrollTop ?? null,
    imgs: strip?.querySelectorAll('img').length ?? 0,
    canvases: strip?.querySelectorAll('canvas').length ?? 0,
    filmstrips: strip?.querySelectorAll(${JSON.stringify(FILM)}).length ?? 0,
    filmstripCells: strip?.querySelectorAll(${JSON.stringify(CELL)}).length ?? 0,
    stripChildren: strip?.children.length ?? 0
  };
})()`;

// 実素材のメディア描画（フィルムストリップのセル・波形 canvas）をクリップ単位で測る。
// セルは <img> ではなく atlas を background-image で敷いた div（renderFilmstripCells）。
const mediaCensusExpr = `(() => {
  const strip=document.querySelector(${JSON.stringify(STRIP)});
  const sr=strip.getBoundingClientRect();
  const clips=[...strip.querySelectorAll(${JSON.stringify(CUTS)})].map(e=>{
    const r=e.getBoundingClientRect();
    const cells=[...e.querySelectorAll(${JSON.stringify(CELL)})];
    const canvas=e.querySelector('canvas');
    const first=cells[0]?.getBoundingClientRect();
    const lastCell=cells.length? cells[cells.length-1].getBoundingClientRect() : null;
    return {
      id: e.dataset.akariItemId, title: e.title,
      leftRelStrip: Math.round((r.left-sr.left)*100)/100, width: Math.round(r.width*100)/100,
      rightRelStrip: Math.round((r.right-sr.left)*100)/100,
      clippedLeft: r.left<=sr.left+1, clippedRight: r.right>=sr.right-1,
      cells: cells.length,
      firstCellLeftRelClip: first? Math.round((first.left-r.left)*100)/100 : null,
      firstCellStyleLeft: cells[0]?.style.left ?? null,
      lastCellRightRelClip: lastCell? Math.round((lastCell.right-r.left)*100)/100 : null,
      canvases: e.querySelectorAll('canvas').length,
      canvasWidthAttr: canvas? canvas.width : null,
      canvasStyleWidth: canvas? canvas.style.width : null,
      imgs: e.querySelectorAll('img').length,
      backgroundImage: e.style.backgroundImage? 'set' : ''
    };
  });
  return {
    stripWidth: Math.round(sr.width), clips,
    totals: {
      cells: strip.querySelectorAll(${JSON.stringify(CELL)}).length,
      filmstrips: strip.querySelectorAll(${JSON.stringify(FILM)}).length,
      canvases: strip.querySelectorAll('canvas').length,
      imgs: strip.querySelectorAll('img').length
    }
  };
})()`;

const mediaSel = `'canvas,img,${FILM},${CELL}'`;

// メディアノード（セル・波形 canvas・img）へ通し番号を焼き、以後の再生成を数える計器。
// MutationObserver は追加・削除された部分木の内側も歩いてメディアノードを数える
// （クリップごと差し替わると子は個別イベントにならないため）。
const armMediaExpr = `(() => {
  const strip=document.querySelector(${JSON.stringify(STRIP)});
  try { window.__l1m?.obs?.disconnect(); } catch (e) {}
  const sel=${mediaSel};
  const st={seq:0,itemSeq:0,addedMedia:0,removedMedia:0,addedFreshMedia:0,addedTaggedMedia:0,
    addedItems:0,removedItems:0,armedAt:Date.now(),perClipAtArm:{}};
  for (const e of strip.querySelectorAll(sel)) e.__l1m=++st.seq;
  for (const e of strip.querySelectorAll(${JSON.stringify(ITEMS)})) e.__l1i=++st.itemSeq;
  for (const e of strip.querySelectorAll(${JSON.stringify(CUTS)})) {
    st.perClipAtArm[e.dataset.akariItemId]={
      cells:e.querySelectorAll(${JSON.stringify(CELL)}).length,
      canvases:e.querySelectorAll('canvas').length,
      imgs:e.querySelectorAll('img').length,
      tags:[...e.querySelectorAll(sel)].map(n=>n.__l1m)
    };
  }
  const walk=(node,fn)=>{ if(node.nodeType!==1) return; if(node.matches?.(sel)) fn(node);
    for (const d of node.querySelectorAll?.(sel)||[]) fn(d); };
  const obs=new MutationObserver(recs=>{ for (const rec of recs) {
    for (const n of rec.addedNodes) {
      if(n.nodeType===1&&n.matches?.(${JSON.stringify(ITEMS)})) st.addedItems++;
      walk(n,e=>{ st.addedMedia++; if(e.__l1m!==undefined) st.addedTaggedMedia++; else st.addedFreshMedia++; });
    }
    for (const n of rec.removedNodes) {
      if(n.nodeType===1&&n.matches?.(${JSON.stringify(ITEMS)})) st.removedItems++;
      walk(n,()=>{ st.removedMedia++; });
    }
  }});
  obs.observe(strip,{childList:true,subtree:true});
  st.obs=obs; window.__l1m=st;
  return {taggedMediaNodes:st.seq, taggedItemNodes:st.itemSeq, clipsAtArm:Object.keys(st.perClipAtArm).length};
})()`;

const mediaIdentityExpr = `(() => {
  const strip=document.querySelector(${JSON.stringify(STRIP)});
  const st=window.__l1m; const sel=${mediaSel};
  const now=[...strip.querySelectorAll(sel)];
  let reused=0, fresh=0;
  for (const e of now) { if (e.__l1m!==undefined) reused++; else fresh++; }
  const perClip={};
  for (const e of strip.querySelectorAll(${JSON.stringify(CUTS)})) {
    const id=e.dataset.akariItemId;
    const nodes=[...e.querySelectorAll(sel)];
    const atArm=st.perClipAtArm[id];
    perClip[id]={
      mediaNow:nodes.length,
      mediaAtArm:atArm? atArm.tags.length : null,
      reused:nodes.filter(n=>n.__l1m!==undefined).length,
      fresh:nodes.filter(n=>n.__l1m===undefined).length,
      sameTagSet: atArm? JSON.stringify(nodes.map(n=>n.__l1m))===JSON.stringify(atArm.tags) : null,
      clipNodeReused: e.__l1i!==undefined,
      canvasReused: (() => {const c=e.querySelector('canvas'); return c? c.__l1m!==undefined : null})()
    };
  }
  const canvases=[...strip.querySelectorAll('canvas')];
  const cells=[...strip.querySelectorAll(${JSON.stringify(CELL)})];
  const imgs=[...strip.querySelectorAll('img')];
  return {
    mediaNodesAtArm: st.seq, mediaNodesNow: now.length,
    mediaNodesReused: reused, mediaNodesRecreated: fresh,
    canvasNow: canvases.length, canvasReused: canvases.filter(e=>e.__l1m!==undefined).length,
    canvasRecreated: canvases.filter(e=>e.__l1m===undefined).length,
    filmstripCellNow: cells.length, filmstripCellReused: cells.filter(e=>e.__l1m!==undefined).length,
    filmstripCellRecreated: cells.filter(e=>e.__l1m===undefined).length,
    imgNow: imgs.length, imgReused: imgs.filter(e=>e.__l1m!==undefined).length,
    imgRecreated: imgs.filter(e=>e.__l1m===undefined).length,
    mutationAddedMediaNodes: st.addedMedia, mutationRemovedMediaNodes: st.removedMedia,
    mutationAddedMediaThatWereExisting: st.addedTaggedMedia,
    mutationAddedMediaThatWereNew: st.addedFreshMedia,
    mutationAddedItemNodes: st.addedItems, mutationRemovedItemNodes: st.removedItems,
    itemNodesNow: strip.querySelectorAll(${JSON.stringify(ITEMS)}).length,
    itemNodesReused: [...strip.querySelectorAll(${JSON.stringify(ITEMS)})].filter(e=>e.__l1i!==undefined).length,
    perClip
  };
})()`;

// 木行（[data-akari-tree-toggle]）の実情。hasChildren=true はグリフ（▸/▾）と disabled で判る。
const toggleCensusExpr = `(() => {
  const all=[...document.querySelectorAll('[data-akari-tree-toggle]')];
  return {
    total: all.length,
    withGlyph: all.filter(e=>e.textContent.trim()).length,
    enabled: all.filter(e=>!e.disabled).length,
    visible: all.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}).length,
    rows: all.map(e=>{const r=e.getBoundingClientRect();
      return {id:e.dataset.akariTreeToggle,glyph:e.textContent.trim(),disabled:e.disabled,
        x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:Math.round(r.width),h:Math.round(r.height)}})
  };
})()`;

const treeRowsExpr = `(() => {
  const strip=document.querySelector(${JSON.stringify(STRIP)});
  const rows=[...strip.querySelectorAll('[data-akari-tree-item-kind]')].map(e=>({
    id:e.dataset.akariItemId, kind:e.dataset.akariTreeItemKind,
    parent:e.dataset.akariTreeParentId||'', track:e.dataset.akariTreeTrackId||'',
    ticks:e.querySelectorAll('[data-akari-tree-tick]').length
  }));
  // 字幕袋（captions）の子は木行ではなく caption 要素として帯に出る。
  // 木行 id は「<袋 id>#<caption id>」なので、その前半を親として数える。
  const captions=[...strip.querySelectorAll('[data-akari-item-kind="caption"]')].map(e=>({
    id:e.dataset.akariTreeRowId||e.dataset.akariItemId, kind:'caption',
    parent:(e.dataset.akariTreeRowId||'').includes('#')?e.dataset.akariTreeRowId.split('#')[0]:'',
    track:'', ticks:0
  }));
  const all=[...rows,...captions];
  const headers=[...document.querySelectorAll('[data-akari-tree-toggle]')].map(e=>e.dataset.akariTreeToggle);
  return {count:all.length, treeRowCount:rows.length, captionRowCount:captions.length, rows:all, headerToggleIds:headers};
})()`;

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const project = path.join(ROOT, 'fixtures', 'real-media');
  const iso = path.join(ROOT, 'evidence', 'runs', `l1-real-media-${LABEL}`);
  const log = path.join(ROOT, 'evidence', `console-l1-real-media-${LABEL}.log`);
  out.project = project;
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
    cdp.on('Runtime.exceptionThrown', p => {
      out.consoleErrors.push({ kind: 'exception', duringStep: currentStep, at: new Date().toISOString(), text: p?.exceptionDetails?.exception?.description ?? p?.exceptionDetails?.text ?? '?' });
    });
    cdp.on('Runtime.consoleAPICalled', p => {
      if (p.type !== 'error') return;
      out.consoleErrors.push({ kind: 'console.error', duringStep: currentStep, at: new Date().toISOString(), text: (p.args || []).map(a => a.description ?? a.value ?? '').join(' ').slice(0, 400) });
    });

    await step('00 タイムラインを開く（実素材プロジェクト）', async r => {
      r.open = await openTimeline(cdp);
      r.treeRows = await evalOn(cdp, treeRowsExpr);
      return await evalOn(cdp, snapshotExpr);
    });
    await screenshot(cdp, path.join(SHOTS, '00-open.png'));

    const centre = await evalOn(cdp, `(() => {const s=document.querySelector(${JSON.stringify(STRIP)});const r=s.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+Math.min(r.height/2,200),left:r.left,top:r.top,w:r.width,h:r.height}})()`);
    out.stripRect = centre;

    // --- 01 メディアが出るところまでズームし、サムネ cache が温まるまで待つ ---
    await step('01 ズームして実素材のサムネ・波形を出す（cache 温め）', async r => {
      r.beforeZoom = await evalOn(cdp, mediaCensusExpr);
      for (let i = 0; i < ZOOM_NOTCHES; i++) { await wheel(cdp, centre.x, centre.y, 0, -100, { ctrlKey: true }); await sleep(200); }
      await sleep(1000);
      // フィルムストリップ chunk / 波形の取得が終わって DOM が落ち着くまで待つ
      // （filmstripContentRevision が上がるたびクリップは作り直されるため、
      //   ここが安定するまではノード identity を測っても意味がない）。
      const warm = [];
      let stable = 0, last = '';
      for (let i = 0; i < 60; i++) {
        const c = await evalOn(cdp, `(() => {const s=document.querySelector(${JSON.stringify(STRIP)});
          return {cells:s.querySelectorAll(${JSON.stringify(CELL)}).length, canvases:s.querySelectorAll('canvas').length, imgs:s.querySelectorAll('img').length}})()`);
        const key = JSON.stringify(c);
        stable = key === last ? stable + 1 : 0;
        last = key;
        if (i % 5 === 0 || stable === 6) warm.push({ poll: i, ...c, stable });
        if (stable >= 6 && (c.cells > 0 || c.canvases > 0)) break;
        await sleep(500);
      }
      r.warmup = warm;
      r.afterZoom = await evalOn(cdp, mediaCensusExpr);
      return {
        cells: r.afterZoom.totals.cells, canvases: r.afterZoom.totals.canvases,
        imgs: r.afterZoom.totals.imgs, filmstrips: r.afterZoom.totals.filmstrips,
        clipsWithMedia: r.afterZoom.clips.filter(c => c.cells > 0 || c.canvases > 0).length
      };
    });
    await screenshot(cdp, path.join(SHOTS, '01-media-warm.png'));

    // --- 02 identity 計器（メディアノード込み）を仕掛ける ---
    await step('02 メディアノードへ計器を仕掛ける', async () => await evalOn(cdp, armMediaExpr));

    // --- 03 パン 20 回（1 回ごとに幾何を採る）---
    await step(`03 パン ${PAN_STEPS} 回（実素材・cache 温）`, async r => {
      r.samples = [];
      r.samples.push({ pan: 0, ...(await evalOn(cdp, mediaCensusExpr)) });
      for (let i = 1; i <= PAN_STEPS; i++) {
        await wheel(cdp, centre.x, centre.y, 40, 0);
        await sleep(150);
        if (i % 5 === 0 || i === PAN_STEPS) r.samples.push({ pan: i, ...(await evalOn(cdp, mediaCensusExpr)) });
      }
      await sleep(800);
      r.after = await evalOn(cdp, snapshotExpr);
      return { panSteps: PAN_STEPS, samplesTaken: r.samples.length };
    });
    await screenshot(cdp, path.join(SHOTS, '03-after-pan.png'));

    // --- 04 ノード identity の判定 ---
    await step('04 サムネ・波形ノードの identity を判定', async () => {
      out.mediaIdentity = await evalOn(cdp, mediaIdentityExpr);
      return out.mediaIdentity;
    });

    // --- 05 メディアの位置追従（幾何のずれ）を判定 ---
    // パンでビューが動くと、ビュー端で切られているクリップは DOM 上の left/width が
    // [0,100]% にクランプされる。内側のフィルムストリップのセルと波形 canvas は
    // clipLocalOffsetPx / clipWidth を作り直しなしで更新しないと絵がずれる
    // （契約 指示 3(b)「パンで再生成しない — 位置と幅だけ更新」）。
    await step('05 パン中のメディア幾何の追従', async r => {
      const samples = out.steps.find(s => s.step.startsWith('03 パン'))?.samples ?? [];
      if (samples.length < 2) throw new Error('no pan samples');
      // 各サンプル時点で「メディアを持つクリップ」の幾何が矛盾していないかを見る。
      // 期待: (a) 波形 canvas の実幅 ≒ クリップの可視幅 (b) セル列がクリップの可視幅を覆う。
      const violations = [];
      for (const smp of samples) {
        for (const c of smp.clips) {
          if (c.cells === 0 && c.canvases === 0) continue;
          const canvasMismatch = c.canvasWidthAttr !== null
            ? Math.round((c.canvasWidthAttr - c.width) * 100) / 100 : null;
          // セル列の右端がクリップ右端に 1 セル幅以上届かない = 覆えていない
          const cellWidth = c.cells > 0 && c.lastCellRightRelClip !== null && c.firstCellLeftRelClip !== null
            ? (c.lastCellRightRelClip - c.firstCellLeftRelClip) / c.cells : null;
          const cellGap = c.lastCellRightRelClip !== null
            ? Math.round((c.width - c.lastCellRightRelClip) * 100) / 100 : null;
          const bad = (canvasMismatch !== null && Math.abs(canvasMismatch) > 2)
            || (cellGap !== null && cellWidth !== null && cellGap > cellWidth);
          if (bad) violations.push({
            pan: smp.pan, id: c.id, title: c.title, clipWidth: c.width,
            canvasWidthAttr: c.canvasWidthAttr, canvasMinusClipPx: canvasMismatch,
            firstCellLeftRelClip: c.firstCellLeftRelClip, lastCellRightRelClip: c.lastCellRightRelClip,
            uncoveredRightPx: cellGap, cellWidthPx: cellWidth === null ? null : Math.round(cellWidth * 100) / 100
          });
        }
      }
      // 追加の観測: パン開始時と終了時で「クリップ内でのセル位置」が動いたか。
      const first = samples[0], last = samples.at(-1);
      const byId = new Map(first.clips.map(c => [c.id, c]));
      const tracked = [];
      for (const now of last.clips) {
        const was = byId.get(now.id);
        if (!was || (was.cells === 0 && was.canvases === 0)) continue;
        tracked.push({
          id: now.id, title: now.title,
          clippedLeft: { start: was.clippedLeft, end: now.clippedLeft },
          clipLeftShift: Math.round((now.leftRelStrip - was.leftRelStrip) * 100) / 100,
          clipRightShift: Math.round((now.rightRelStrip - was.rightRelStrip) * 100) / 100,
          clipWidth: { start: was.width, end: now.width },
          firstCellLeftRelClip: { start: was.firstCellLeftRelClip, end: now.firstCellLeftRelClip },
          cellShiftInsideClip: (was.firstCellLeftRelClip !== null && now.firstCellLeftRelClip !== null)
            ? Math.round((now.firstCellLeftRelClip - was.firstCellLeftRelClip) * 100) / 100 : null,
          canvasWidthAttr: { start: was.canvasWidthAttr, end: now.canvasWidthAttr }
        });
      }
      r.tracked = tracked;
      r.violations = violations;
      return {
        samples: samples.length,
        clipsWithMediaTracked: tracked.length,
        geometryViolations: violations.length,
        violatingClipIds: [...new Set(violations.map(v => v.id))],
        verdict: violations.length === 0 ? 'media-follows-geometry' : 'stale-media-geometry'
      };
    });

    // --- 06 折りたたみトグル（木行）---
    // 通し: ビューを先頭へ戻して木行を mount 窓へ入れ（03 のパンで窓の外へ出ているため。
    // 窓の外だと行が 0 個で「空集合どうしの一致」= 空振りの緑になる）、
    // hasChildren=true の各行で 開閉 → 子行の unmount/remount を確かめ、
    // そのうえで「折りたたみ中にパン」「展開後にパン」を往復で回して帯が壊れないことを見る。
    await step('06 折りたたみトグル 開閉 → 子行の mount/unmount → 再度パン', async r => {
      // ビューを先頭へ戻す（03 のパンぶんより多めに戻す。viewStart は 0 でクランプされる）
      for (let i = 0; i < PAN_STEPS + 10; i++) { await wheel(cdp, centre.x, centre.y, -40, 0); await sleep(90); }
      await sleep(800);
      r.census = await evalOn(cdp, toggleCensusExpr);
      r.rowsAtHome = await evalOn(cdp, treeRowsExpr);
      if (r.rowsAtHome.count === 0) throw new Error('no tree rows mounted after panning home — toggle check would be vacuous');

      const rowsNow = async () => await evalOn(cdp, treeRowsExpr);
      const idsOf = rows => rows.rows.map(row => row.id).sort();
      const childrenOfIn = (rows, id) => rows.rows.filter(row => row.parent === id).map(row => row.id).sort();
      const glyph = async id => await evalOn(cdp, `(() => {const e=document.querySelector('[data-akari-tree-toggle=' + JSON.stringify(${JSON.stringify(id)}) + ']');return e?e.textContent.trim():null})()`);
      const toggleRect = async id => await evalOn(cdp, `(() => {const e=document.querySelector('[data-akari-tree-toggle=' + JSON.stringify(${JSON.stringify(id)}) + ']');
        if(!e) return null; const r=e.getBoundingClientRect(); if(!(r.width>0&&r.height>0)) return null;
        return {x:r.left+r.width/2,y:r.top+r.height/2,glyph:e.textContent.trim(),disabled:e.disabled}})()`);
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const panRoundTrip = async steps => {
        for (let i = 0; i < steps; i++) { await wheel(cdp, centre.x, centre.y, 40, 0); await sleep(120); }
        await sleep(400);
        for (let i = 0; i < steps; i++) { await wheel(cdp, centre.x, centre.y, -40, 0); await sleep(120); }
        await sleep(700);
      };

      // 展開可能な行（グリフあり・disabled でない）を全部回す
      const candidates = r.census.rows.filter(row => row.glyph && !row.disabled).map(row => row.id);
      r.candidates = candidates;
      if (!candidates.length) throw new Error('no expandable [data-akari-tree-toggle] (hasChildren=true) in this fixture');

      // 行の増減でヘッダー列の縦位置が動くため、クリックのたびに座標を取り直し、
      // グリフが実際に反転するまで確かめる（座標を使い回すと隣の行を押して空振りする）。
      const clickToggle = async (id, expectGlyph) => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          const rect = await toggleRect(id);
          if (!rect) { await sleep(500); continue; }
          await realClick(cdp, rect.x, rect.y);
          for (let poll = 0; poll < 12; poll++) {
            await sleep(200);
            if (await glyph(id) === expectGlyph) return { ok: true, attempts: attempt, clickedAt: rect };
          }
        }
        return { ok: false, glyph: await glyph(id) };
      };

      const perToggle = [];
      for (const id of candidates) {
        if (!await toggleRect(id)) { perToggle.push({ id, skipped: 'toggle not visible' }); continue; }
        const before = await rowsNow();
        const snapBefore = await evalOn(cdp, snapshotExpr);
        const collapseClick = await clickToggle(id, '▸');
        await sleep(400);
        const collapsedGlyph = await glyph(id);
        const collapsed = await rowsNow();
        const snapCollapsed = await evalOn(cdp, snapshotExpr);
        const expandClick = await clickToggle(id, '▾');
        await sleep(400);
        const expandedGlyph = await glyph(id);
        const expanded = await rowsNow();
        const snapExpanded = await evalOn(cdp, snapshotExpr);
        const childrenBefore = childrenOfIn(before, id);
        perToggle.push({
          id, clicks: { collapse: collapseClick, expand: expandClick },
          glyph: { collapsed: collapsedGlyph, expanded: expandedGlyph },
          children: { before: childrenBefore, whileCollapsed: childrenOfIn(collapsed, id), afterExpand: childrenOfIn(expanded, id) },
          rowCount: { before: before.count, collapsed: collapsed.count, expanded: expanded.count },
          mounted: { before: snapBefore.mounted, collapsed: snapCollapsed.mounted, expanded: snapExpanded.mounted },
          ticksOnCollapsedParent: collapsed.rows.find(row => row.id === id)?.ticks ?? null,
          checks: {
            hadChildRowsMounted: childrenBefore.length > 0,
            clicksLanded: collapseClick.ok && expandClick.ok,
            glyphToggles: collapsedGlyph === '▸' && expandedGlyph === '▾',
            childRowsUnmountedOnCollapse: childrenBefore.length > 0 && childrenOfIn(collapsed, id).length === 0,
            childRowsRemountedOnExpand: same(childrenBefore, childrenOfIn(expanded, id)),
            rowSetRestoredOnExpand: same(idsOf(before), idsOf(expanded))
          },
          // 観測のみ（合否には入れない）: 折りたたんだ親行そのものが帯に描かれるのは
          // 純グループだけで、HTML 袋 / 字幕袋の親はオーバーレイ・字幕として描かれるため
          // 木行としては mount されない（T2 の描き分け。本タスクの差分とは無関係）。
          observations: {
            parentRowMountedWhileCollapsed: collapsed.rows.some(row => row.id === id),
            ticksOnCollapsedParent: collapsed.rows.find(row => row.id === id)?.ticks ?? null
          }
        });
      }

      // 通し（第 1 候補）: 折りたたみ中にパン往復 → 展開してパン往復
      const main = candidates[0];
      const expandedA = await rowsNow();
      const walkCollapseClick = await clickToggle(main, '▸');
      await sleep(400);
      const collapsedBeforePan = await rowsNow();
      await screenshot(cdp, path.join(SHOTS, '06a-collapsed.png'));
      await panRoundTrip(10);
      const collapsedAfterPan = await rowsNow();
      const snapCollapsedPanned = await evalOn(cdp, snapshotExpr);
      await screenshot(cdp, path.join(SHOTS, '06b-collapsed-panned.png'));
      const walkExpandClick = await clickToggle(main, '▾');
      await sleep(400);
      const expandedBeforePan = await rowsNow();
      await panRoundTrip(10);
      const expandedAfterPan = await rowsNow();
      const snapExpandedPanned = await evalOn(cdp, snapshotExpr);
      await screenshot(cdp, path.join(SHOTS, '06c-expanded-panned.png'));

      const walkthrough = {
        toggleId: main,
        rowIds: {
          expandedA: idsOf(expandedA), collapsedBeforePan: idsOf(collapsedBeforePan),
          collapsedAfterPan: idsOf(collapsedAfterPan), expandedBeforePan: idsOf(expandedBeforePan),
          expandedAfterPan: idsOf(expandedAfterPan)
        },
        mounted: { collapsedPanned: snapCollapsedPanned.mounted, expandedPanned: snapExpandedPanned.mounted },
        clicks: { collapse: walkCollapseClick, expand: walkExpandClick },
        checks: {
          clicksLanded: walkCollapseClick.ok && walkExpandClick.ok,
          collapsedRowSetSurvivesPan: same(idsOf(collapsedBeforePan), idsOf(collapsedAfterPan)),
          expandedRowSetSurvivesPan: same(idsOf(expandedBeforePan), idsOf(expandedAfterPan)),
          expandedRowSetMatchesStart: same(idsOf(expandedA), idsOf(expandedAfterPan)),
          childRowsBackAfterPan: same(childrenOfIn(expandedA, main), childrenOfIn(expandedAfterPan, main)),
          stripAliveThroughout: snapCollapsedPanned.mounted > 0 && snapExpandedPanned.mounted > 0
        }
      };

      const result = {
        candidates, perToggle, walkthrough,
        mediaIdentityAcrossToggle: await evalOn(cdp, mediaIdentityExpr)
      };
      const toggleChecks = perToggle.filter(t => !t.skipped).flatMap(t => Object.values(t.checks));
      result.allGreen = toggleChecks.every(Boolean) && Object.values(walkthrough.checks).every(Boolean)
        && perToggle.filter(t => !t.skipped).length === candidates.length;
      out.treeToggle = result;
      return {
        candidates, perToggleGreen: perToggle.map(t => ({ id: t.id, checks: t.checks, skipped: t.skipped })),
        walkthroughChecks: walkthrough.checks, allGreen: result.allGreen
      };
    });

    // --- 07 通し後の状態（属性集合・選択・スクロール）---
    await step('07 通し後の帯の状態', async r => {
      r.snapshot = await evalOn(cdp, snapshotExpr);
      r.media = await evalOn(cdp, mediaCensusExpr);
      return await evalOn(cdp, `(() => {
        const set=new Set();
        for (const e of document.querySelectorAll('#akari-annotations-widget *')) for (const a of e.attributes) if (a.name.startsWith('data-akari-')) set.add(a.name);
        return {attributes:[...set].sort(), count:set.size};
      })()`);
    });
    await screenshot(cdp, path.join(SHOTS, '07-final.png'));

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
  console.log(`status=${out.status} → ${OUT}`);
}

await main();
