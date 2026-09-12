#!/usr/bin/env node
// L1（CDP・5 手順）— task 2026-09-12-daihon-selection-sync
//   1. 行の余白クリック → 再生位置だけ動き、選択は 0 のまま
//   2. ⌘ クリック 2 行 → タイムラインの同じ 2 ブロックが琥珀（selected）+ 再生中ブロックに accent 枠（playing）+ プレイヘッド線
//   3. 再生して現在位置が選択の上を通過しても琥珀（selected）が残る（MutationObserver で監視）
//   4. ⌥ 押下 → 台本の全行 + タイムラインの全字幕が selected・プレビューの枠が点線（data-alt-all）
//   5. ⌥ 離す → 2 行（2 ブロック）の選択へ戻り、プレビューの枠は実線の琥珀へ戻る
// Electron は detached にせず、隔離 HOME / user-data-dir を runs/ 配下へ向け、自分が起動した PID だけを kill する。
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL_DIR = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PROJECT = path.join(ROOT, 'fixture', 'project');
const EDIT = path.join(PROJECT, 'edit.json');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22187);
const ISO = path.join(ROOT, 'runs', 'l1');
const LOG = path.join(ROOT, 'runs', 'l1.log');
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [], cleanup: null };

// akari-daihon-widget.ts の INTERACTIVE_SELECTOR のミラー（余白 = この選択子に当たらない点）。
const INTERACTIVE_SELECTOR = 'button.akari-daihon-tc, .akari-daihon-word, .akari-daihon-word-unk, input, .akari-daihon-badge-qc, .akari-daihon-gapchip, button.akari-daihon-cut, button.akari-daihon-split, .akari-daihon-splitmark, .akari-daihon-gapzone, .akari-daihon-gapdraft, .akari-daihon-word-filler, button.akari-daihon-silence, button.akari-daihon-selcut, button.akari-daihon-selmerge, button.akari-daihon-tpl, button.akari-daihon-seltpl, .akari-daihon-tplcard, .akari-daihon-cutcell, .akari-daihon-cutrange, .akari-daihon-pop, .akari-daihon-minitl, .akari-daihon-wgap, .akari-daihon-wordbar, .akari-daihon-wordcm';
const META = 4;   // CDP modifiers: Alt=1 Ctrl=2 Meta=4 Shift=8

const sanitizeText = value => {
  let text = String(value);
  text = text.replaceAll(REPO, '<WORKTREE>');
  if (process.env.HOME) text = text.replaceAll(process.env.HOME, '<HOME>');
  return text
    .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"\]]+/gu, '<TMP>')
    .replace(/\/Users\/[^\s)'"\]]+/gu, '<HOME>');
};
const sanitize = value => sanitizeText(value?.stack || value?.message || value);
const save = async () => {
  const temporary = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temporary, `${sanitizeText(JSON.stringify(out, null, 2))}\n`);
  await rename(temporary, RESULTS);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const run = (command, args, { cwd = ROOT, timeoutMs = 240_000 } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', closed = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, timeoutMs);
  child.once('error', reject);
  child.once('close', code => {
    closed = true; clearTimeout(timer);
    code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`));
  });
});

async function step(name, operation) {
  const record = { name, pass: false };
  out.steps.push(record);
  try {
    record.detail = await operation();
    record.pass = true;
    await save();
    return record.detail;
  } catch (error) {
    record.error = sanitize(error);
    await save();
    throw error;
  }
}

async function waitEval(cdp, expression, { timeoutMs = 60_000, label = 'condition', contextId } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await evalOn(cdp, expression, contextId); if (value) return value; }
    catch (error) { last = error; }
    await sleep(180);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}

async function settlePreloadOverlay(cdp) {
  const deadline = Date.now() + 120_000;
  let hiddenSince = null;
  while (Date.now() < deadline) {
    const state = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');return{exists:Boolean(el),hidden:Boolean(el?.classList.contains('theia-hidden'))}})()`);
    if (!state.exists) return 'removed';
    if (state.hidden) {
      hiddenSince ??= Date.now();
      if (Date.now() - hiddenSince >= 15_000) {
        const neutralized = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');if(!el||!el.classList.contains('theia-hidden'))return false;el.style.pointerEvents='none';return true})()`);
        if (neutralized) return 'neutralized';
      }
    } else hiddenSince = null;
    await sleep(200);
  }
  throw new Error('theia preload overlay did not settle');
}

const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;
const commandWith = (id, request) => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)},${S(request)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;

const DAIHON = `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')];const first=rows[0];const style=first?getComputedStyle(first):null;return{total:rows.length,selected:rows.filter(r=>r.classList.contains('selected')).map(r=>r.dataset.captionId),active:rows.filter(r=>r.classList.contains('active')).map(r=>r.dataset.captionId),selectionBarHidden:document.querySelector('.akari-daihon-selbar')?.hidden??null,selectedOutline:rows.filter(r=>r.classList.contains('selected')).map(r=>getComputedStyle(r).outlineColor)}})()`;

const TIMELINE = `(()=>{const chips=[...document.querySelectorAll('[data-akari-item-kind="caption"]')];const hit=document.querySelector('[data-testid="akari-playhead-line-hit"]');const head=hit?hit.parentElement:null;const headRect=head?head.getBoundingClientRect():null;return{chips:chips.map(c=>{const s=getComputedStyle(c);return{id:c.dataset.akariItemId,selected:c.classList.contains('akari-annotations-caption-selected'),playing:c.classList.contains('akari-annotations-caption-playing'),genericSelected:c.classList.contains('akari-annotations-selected'),outlineColor:s.outlineColor,background:s.backgroundColor,boxShadow:s.boxShadow}}),playhead:head?{left:head.style.left,width:getComputedStyle(head).width,background:getComputedStyle(head).backgroundColor,height:headRect.height}:null}})()`;

async function ensureDaihonVisible(cdp) {
  const probe = `(()=>{const e=document.querySelector('.akari-daihon-row[data-caption-id="c-0001"]');if(!e)return null;const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{width:r.width,height:r.height}:null})()`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const visible = await evalOn(cdp, probe).catch(() => null);
    if (visible) return visible;
    await evalOn(cdp, command('akari.daihon.open')).catch(() => {});
    await sleep(600);
  }
  throw new Error('台本パネルが見えない');
}

/** 行の「余白」= INTERACTIVE_SELECTOR に当たらない点を右から探す。 */
async function rowBlankPoint(cdp, rowId) {
  await ensureDaihonVisible(cdp);
  return waitEval(cdp, `(()=>{const row=document.querySelector('.akari-daihon-row[data-caption-id=${S(rowId)}]');if(!row)return null;row.scrollIntoView({block:'center'});const r=row.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;
for(const fy of [0.82,0.6,0.5,0.3]){for(let fx=0.97;fx>0.08;fx-=0.02){const x=r.left+r.width*fx,y=r.top+r.height*fy;const el=document.elementFromPoint(x,y);if(!el||!row.contains(el))continue;if(el.closest(${S(INTERACTIVE_SELECTOR)}))continue;return{x,y,hit:el.className||el.tagName}}}
return null})()`, { label: `${rowId} の余白`, timeoutMs: 20_000 });
}

async function clickRowBlank(cdp, rowId, modifiers = 0) {
  const point = await rowBlankPoint(cdp, rowId);
  await realClick(cdp, point.x, point.y, { modifiers });
  await sleep(220);
  return point;
}

async function findWebview() {
  const targets = (await listTargets(PORT)).filter(item =>
    item.type === 'iframe' && /webview\/index\.html/u.test(String(item.url)) && item.webSocketDebuggerUrl);
  for (const target of targets) {
    const cdp = new CDP(target.webSocketDebuggerUrl);
    const contexts = [];
    cdp.on('Runtime.executionContextCreated', params => contexts.push(params.context));
    try {
      await cdp.connect();
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await sleep(700);
      const frameTree = await cdp.send('Page.getFrameTree');
      const topFrame = frameTree.frameTree.frame.id;
      const context = contexts.find(candidate => candidate.auxData?.frameId !== topFrame);
      if (!context) { cdp.close(); continue; }
      const ready = await evalOn(cdp, `Boolean(document.getElementById('caption-plate'))&&(window.__akariPreview?.captions?.length??0)>0`, context.id).catch(() => false);
      if (!ready) { cdp.close(); continue; }
      return { cdp, contextId: context.id };
    } catch { cdp.close(); }
  }
  return null;
}

const PLATE_PROBE = `(()=>{const plate=document.getElementById('caption-plate');if(!plate)return null;const inner=plate.querySelector('.akari-caption__plate');const target=inner??plate;const s=getComputedStyle(target);return{selected:plate.hasAttribute('data-selected'),altAll:plate.hasAttribute('data-alt-all'),usesInner:Boolean(inner),text:(plate.textContent||'').slice(0,40),outlineStyle:s.outlineStyle,outlineColor:s.outlineColor,outlineWidth:s.outlineWidth}})()`;

async function withWebview(operation, { timeoutMs = 90_000, label = 'webview' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const connection = await findWebview();
    if (connection) {
      try { return await operation(connection); }
      catch (error) { last = error; }
      finally { connection.cdp.close(); }
    }
    await sleep(400);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}

async function seek(cdp, time) {
  const editUri = pathToFileURL(EDIT).toString();
  await evalOn(cdp, commandWith('akari.preview.ensureVisible', { editUri })).catch(() => {});
  await evalOn(cdp, commandWith('akari.preview.seekOutput', { editUri, time })).catch(() => {});
  await sleep(500);
}

/**
 * プレビューを開いた直後の 1 発目の seek は webview のロード中に落ちることがある
 * （実測: 開いた直後に seekOutput が 'seeked' を返しても playbackTick が来ない）。
 * 条件が満たされるまで seek を打ち直す。
 */
async function seekUntil(cdp, time, expression, { label = 'seek condition', timeoutMs = 120_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    await seek(cdp, time);
    try { const value = await evalOn(cdp, expression); if (value) return value; }
    catch (error) { last = error; }
    await sleep(400);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}

async function shot(cdp, number, label) {
  const name = `${String(number).padStart(2, '0')}-${label}.png`;
  await screenshot(cdp, path.join(ROOT, name));
  out.screenshots.push(name);
  await save();
}

let spawnedChild;
async function launch() {
  await rm(ISO, { recursive: true, force: true });
  await mkdir(ISO, { recursive: true });
  await mkdir(path.join(ROOT, 'runs'), { recursive: true });
  const akariHome = path.join(ISO, 'akari-home');
  await mkdir(akariHome, { recursive: true });
  await writeFile(LOG, '');
  const child = spawn(ELECTRON, [
    SHELL_DIR, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${ISO}`, '--no-sandbox'
  ], {
    cwd: REPO,
    env: { ...process.env, AKARI_HOME: akariHome, THEIA_CONFIG_DIR: ISO },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  spawnedChild = child;
  const append = chunk => void writeFile(LOG, sanitizeText(chunk), { flag: 'a' }).catch(() => {});
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  let target;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && !target) {
    try { target = (await listTargets(PORT)).find(item => item.type === 'page'); } catch {}
    if (!target) await sleep(300);
  }
  assert(target, 'CDP page target did not appear');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'Theia workbench', timeoutMs: 180_000 });
  return { child, cdp };
}

async function stop(session) {
  session?.cdp?.close();
  const pid = (session?.child ?? spawnedChild)?.pid;
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
    await sleep(2500);
    try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {}
    await sleep(800);
  }
  const count = shellCommand => new Promise(resolve => {
    const child = spawn('/bin/sh', ['-c', shellCommand]);
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.once('close', () => resolve(Number(stdout.trim())));
  });
  const survivors = await count(`ps -eo pid,ppid,args | grep -F ${JSON.stringify(ISO)} | grep -v grep | wc -l`);
  const backendSurvivors = await count(`ps -eo pid,ppid,args | grep -F ${JSON.stringify(path.join(SHELL_DIR, 'lib/backend/main.js'))} | grep -v grep | wc -l`);
  try {
    const log = await readFile(LOG, 'utf8');
    await writeFile(LOG, sanitizeText(log));
  } catch {}
  out.cleanup = { killedPid: pid ?? null, survivingProcesses: survivors, survivingBackendMain: backendSurvivors };
  await save();
  return survivors;
}

let session;
try {
  out.fixture = JSON.parse((await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')], { timeoutMs: 240_000 })).stdout.trim());
  await save();

  session = await launch();
  const { cdp } = session;
  await evalOn(cdp, command('akari.daihon.open'));
  await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===3`, { label: '3 rows' });
  out.preloadOverlay = await settlePreloadOverlay(cdp);
  out.daihonVisible = await ensureDaihonVisible(cdp);
  await evalOn(cdp, command('akari.annotations.open')).catch(() => {});
  out.timelineChips = await waitEval(cdp, `(()=>{const v=${TIMELINE};return v.chips.length===3?v.chips.map(c=>c.id):null})()`, { label: 'タイムラインに字幕 3 ブロック', timeoutMs: 90_000 });
  await evalOn(cdp, command('akari.daihon.open')).catch(() => {});
  await ensureDaihonVisible(cdp);
  // プレビューを先に開き、playbackTick が台本へ届く（= 現在行が光る）状態まで暖機してから手順 1 に入る。
  out.warmUp = await seekUntil(cdp, 1.2, `(()=>{const v=${DAIHON};return v.active.includes('c-0001')?v:null})()`,
    { label: '暖機: 現在行が c-0001' });
  await save();

  // ---- 手順 1: 余白クリック = シーク（選択は変わらない） ----
  await step('1. 行の余白クリックは選択を変えず、再生位置だけ動く', async () => {
    const before = await evalOn(cdp, DAIHON);
    const timelineBefore = await evalOn(cdp, TIMELINE);
    assert(before.selected.length === 0, `初期選択が 0 でない: ${JSON.stringify(before.selected)}`);
    const point = await clickRowBlank(cdp, 'c-0002');
    const after = await waitEval(cdp, `(()=>{const v=${DAIHON};return v.active.includes('c-0002')?v:null})()`,
      { label: '余白クリックで現在行が c-0002 になる', timeoutMs: 90_000 });
    const timelineAfter = await waitEval(cdp, `(()=>{const v=${TIMELINE};return v.playhead&&v.playhead.left!==${S(timelineBefore.playhead?.left ?? '0%')}?v:null})()`,
      { label: 'プレイヘッドが動く', timeoutMs: 30_000 });
    assert(after.selected.length === 0, `余白クリックで選択が増えた: ${JSON.stringify(after.selected)}`);
    assert(timelineAfter.chips.every(chip => !chip.selected), `余白クリックでタイムラインが選択された: ${JSON.stringify(timelineAfter.chips)}`);
    return {
      clickedAt: { hit: point.hit },
      daihon: { before: before.selected, after: after.selected, active: after.active },
      playhead: { before: timelineBefore.playhead?.left ?? null, after: timelineAfter.playhead.left },
      timelineSelected: timelineAfter.chips.filter(chip => chip.selected).map(chip => chip.id)
    };
  });
  await shot(cdp, 1, 'blank-click-seeks-without-selection');

  // ---- 手順 2: ⌘ クリック 2 行 → タイムライン 2 ブロック琥珀 + 再生中 accent 枠 + プレイヘッド線 ----
  await step('2. ⌘ クリック 2 行でタイムラインの同じ 2 ブロックが selected（琥珀）になり、再生中ブロックに playing（accent 枠）とプレイヘッド線が同時に出る', async () => {
    await clickRowBlank(cdp, 'c-0001', META);
    await clickRowBlank(cdp, 'c-0002', META);
    const daihon = await waitEval(cdp, `(()=>{const v=${DAIHON};return v.selected.length===2?v:null})()`,
      { label: '台本で 2 行選択', timeoutMs: 30_000 });
    const timeline = await waitEval(cdp, `(()=>{const v=${TIMELINE};const s=v.chips.filter(c=>c.selected).map(c=>c.id);return s.length===2&&s.includes('c-0001')&&s.includes('c-0002')?v:null})()`,
      { label: 'タイムラインで 2 ブロック selected', timeoutMs: 30_000 });
    // 現在位置を c-0001 の中（1.5s）へ置く → c-0001 は selected かつ playing
    const both = await seekUntil(cdp, 1.5, `(()=>{const v=${TIMELINE};const c=v.chips.find(x=>x.id==='c-0001');return c&&c.selected&&c.playing?v:null})()`,
      { label: 'c-0001 が selected かつ playing', timeoutMs: 60_000 });
    const chip = both.chips.find(candidate => candidate.id === 'c-0001');
    assert(both.playhead && both.playhead.height > 0, `プレイヘッド線が見えない: ${JSON.stringify(both.playhead)}`);
    assert(both.chips.find(candidate => candidate.id === 'c-0002')?.selected === true, 'c-0002 の selected が落ちた');
    assert(both.chips.find(candidate => candidate.id === 'c-0003')?.selected === false, 'c-0003 まで selected になっている');
    return {
      daihonSelected: daihon.selected,
      daihonSelectedOutline: daihon.selectedOutline,
      timelineSelected: timeline.chips.filter(candidate => candidate.selected).map(candidate => candidate.id),
      selectedAndPlaying: { id: chip.id, selected: chip.selected, playing: chip.playing, background: chip.background, outlineColor: chip.outlineColor, boxShadow: chip.boxShadow },
      playhead: both.playhead,
      chips: both.chips
    };
  });
  await shot(cdp, 2, 'cmd-click-two-rows-amber-playing-playhead');

  // ---- 手順 3: 再生して現在位置が選択の上を通過しても琥珀が残る（MutationObserver で監視） ----
  await step('3. 再生して現在位置が選択ブロックの上を通過しても selected（琥珀）が残る', async () => {
    await evalOn(cdp, `(()=>{window.__akariSelWatch={drops:[],samples:[],playing:[]};const ids=['c-0001','c-0002'];
const sample=()=>{const chips=[...document.querySelectorAll('[data-akari-item-kind="caption"]')];const state=chips.map(c=>({id:c.dataset.akariItemId,selected:c.classList.contains('akari-annotations-caption-selected'),playing:c.classList.contains('akari-annotations-caption-playing')}));
window.__akariSelWatch.samples.push(state);const playing=state.filter(s=>s.playing).map(s=>s.id);if(playing.length)window.__akariSelWatch.playing.push(playing.join(','));
for(const id of ids){const found=state.find(s=>s.id===id);if(found&&!found.selected)window.__akariSelWatch.drops.push({id,at:Date.now()})}};
const strip=document.querySelector('[data-akari-item-kind="caption"]')?.parentElement;
window.__akariSelObserver=new MutationObserver(sample);if(strip)window.__akariSelObserver.observe(strip,{subtree:true,attributes:true,attributeFilter:['class'],childList:true});
sample();return true})()`);
    await seekUntil(cdp, 1.2, `(()=>{const v=${TIMELINE};const c=v.chips.find(x=>x.id==='c-0001');return c&&c.playing?v:null})()`,
      { label: '再生前に現在位置が c-0001 の上', timeoutMs: 60_000 });
    await evalOn(cdp, commandWith('akari.preview.togglePlayback', { editUri: pathToFileURL(EDIT).toString() })).catch(() => {});
    const crossed = await waitEval(cdp, `(()=>{const w=window.__akariSelWatch;const seen=new Set(w.playing);return seen.has('c-0002')||[...seen].some(v=>v!=='c-0001')?{playingSeen:[...seen],samples:w.samples.length,drops:w.drops.length}:null})()`,
      { label: '現在位置が c-0001 → 別ブロックへ通過', timeoutMs: 60_000 });
    await evalOn(cdp, commandWith('akari.preview.togglePlayback', { editUri: pathToFileURL(EDIT).toString() })).catch(() => {});
    await sleep(400);
    const watch = await evalOn(cdp, `(()=>{const w=window.__akariSelWatch;window.__akariSelObserver?.disconnect();const chips=[...document.querySelectorAll('[data-akari-item-kind="caption"]')].map(c=>({id:c.dataset.akariItemId,selected:c.classList.contains('akari-annotations-caption-selected'),playing:c.classList.contains('akari-annotations-caption-playing')}));return{drops:w.drops,samples:w.samples.length,playingSeen:[...new Set(w.playing)],final:chips}})()`);
    assert(watch.drops.length === 0, `再生中に selected が落ちた: ${JSON.stringify(watch.drops)}`);
    const daihon = await evalOn(cdp, DAIHON);
    assert(daihon.selected.length === 2, `台本の選択が減った: ${JSON.stringify(daihon.selected)}`);
    return { crossed, observedSamples: watch.samples, playingSeen: watch.playingSeen, drops: watch.drops, final: watch.final, daihonSelected: daihon.selected };
  });
  await shot(cdp, 3, 'playhead-passes-selection-stays-amber');

  // ---- 手順 4: ⌥ 押下 → 全行 / 全ブロックが selected・プレビューの枠が点線 ----
  const altOn = await step('4. ⌥ 押下で台本の全行とタイムラインの全字幕が selected になり、プレビューの枠が点線（data-alt-all）になる', async () => {
    await seekUntil(cdp, 1.5, `(()=>{const v=${TIMELINE};const c=v.chips.find(x=>x.id==='c-0001');return c&&c.selected&&c.playing?v:null})()`,
      { label: '⌥ 検証の前に現在位置を c-0001 へ', timeoutMs: 60_000 });
    const before = await withWebview(async ({ cdp: web, contextId }) => {
      const value = await evalOn(web, PLATE_PROBE, contextId);
      return value?.selected ? value : Promise.reject(new Error(`plate に data-selected が無い: ${JSON.stringify(value)}`));
    }, { label: 'プレビューの字幕プレートに data-selected' });
    const after = await withWebview(async ({ cdp: web, contextId }) => {
      await evalOn(web, `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Alt',altKey:true}))`, contextId);
      await sleep(400);
      const value = await evalOn(web, PLATE_PROBE, contextId);
      return value?.altAll ? value : Promise.reject(new Error(`plate に data-alt-all が付かない: ${JSON.stringify(value)}`));
    }, { label: 'プレビューの ⌥ 全体モード' });
    const daihon = await waitEval(cdp, `(()=>{const v=${DAIHON};return v.selected.length===v.total&&v.total===3?v:null})()`,
      { label: '台本の全行が selected', timeoutMs: 30_000 });
    const timeline = await waitEval(cdp, `(()=>{const v=${TIMELINE};return v.chips.length===3&&v.chips.every(c=>c.selected)?v:null})()`,
      { label: 'タイムラインの全字幕が selected', timeoutMs: 30_000 });
    assert(after.outlineStyle === 'dashed', `⌥ 中の枠が点線でない: ${after.outlineStyle}`);
    assert(before.outlineStyle === 'solid', `⌥ 前の枠が実線でない: ${before.outlineStyle}`);
    return {
      plateBefore: before, plateAfter: after,
      daihonSelected: daihon.selected, daihonTotal: daihon.total,
      timelineSelected: timeline.chips.filter(chip => chip.selected).map(chip => chip.id)
    };
  });
  await shot(cdp, 4, 'alt-all-mode-everything-selected-dashed');

  // ---- 手順 5: ⌥ 離す → 2 行（2 ブロック）へ戻る ----
  await step('5. ⌥ を離すと元の 2 行（2 ブロック）の選択へ戻り、プレビューの枠が実線の琥珀へ戻る', async () => {
    const plate = await withWebview(async ({ cdp: web, contextId }) => {
      await evalOn(web, `window.dispatchEvent(new KeyboardEvent('keyup',{key:'Alt',altKey:false}))`, contextId);
      await sleep(400);
      const value = await evalOn(web, PLATE_PROBE, contextId);
      return value && !value.altAll ? value : Promise.reject(new Error(`plate の data-alt-all が外れない: ${JSON.stringify(value)}`));
    }, { label: 'プレビューの ⌥ 解除' });
    const daihon = await waitEval(cdp, `(()=>{const v=${DAIHON};return v.selected.length===2?v:null})()`,
      { label: '台本が 2 行選択へ戻る', timeoutMs: 30_000 });
    const timeline = await waitEval(cdp, `(()=>{const v=${TIMELINE};const s=v.chips.filter(c=>c.selected).map(c=>c.id);return s.length===2&&s.includes('c-0001')&&s.includes('c-0002')?v:null})()`,
      { label: 'タイムラインが 2 ブロックへ戻る', timeoutMs: 30_000 });
    assert(plate.outlineStyle === 'solid', `⌥ 解除後の枠が実線でない: ${plate.outlineStyle}`);
    assert(plate.selected === true, '⌥ 解除後に data-selected が落ちた');
    assert(altOn.daihonSelected.length === 3, '手順 4 の全選択が記録されていない');
    return {
      plate,
      daihonSelected: daihon.selected,
      timelineSelected: timeline.chips.filter(chip => chip.selected).map(chip => chip.id),
      restoredFrom: altOn.daihonSelected
    };
  });
  await shot(cdp, 5, 'alt-release-back-to-two-rows');

  out.status = 'pass';
  await save();
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
  try {
    if (session?.cdp) {
      const name = '99-failure.png';
      await screenshot(session.cdp, path.join(ROOT, name));
      if (!out.screenshots.includes(name)) out.screenshots.push(name);
    }
  } catch {}
  await save();
  process.exitCode = 1;
} finally {
  const survivors = await stop(session);
  if (survivors !== 0) {
    out.status = out.status === 'pass' ? 'fail' : out.status;
    out.cleanupError = `surviving processes: ${survivors}`;
    await save();
    process.exitCode = 1;
  }
}
