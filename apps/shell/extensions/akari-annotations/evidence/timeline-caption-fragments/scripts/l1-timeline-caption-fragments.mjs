#!/usr/bin/env node
// L1（CDP・3 手順）— task 2026-09-13-timeline-caption-fragments
//   1. 台本で行を分割 → タイムラインの字幕帯が 3 → 4 ブロック（DOM 監視で +1 までの所要 ms を実測）
//   2. 分割した 2 行を結合 → 帯が 4 → 3 ブロック（消えた id の選択が結合先へ付け替わることも観測）
//   3. 語間の「／ ここで改行」→ その字幕ブロックに断片境界の目盛り（薄い縦線）が出る
// Electron は detached にせず、隔離 HOME / user-data-dir を runs/ 配下へ向け、自分が起動した PID だけを kill する。
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL_DIR = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PROJECT = path.join(ROOT, 'fixture', 'project');
const CAPTIONS = path.join(PROJECT, 'captions.json');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22193);
const ISO = path.join(ROOT, 'runs', 'l1');
const LOG = path.join(ROOT, 'runs', 'l1.log');
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [], cleanup: null };

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

async function waitEval(cdp, expression, { timeoutMs = 60_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await evalOn(cdp, expression); if (value) return value; }
    catch (error) { last = error; }
    await sleep(150);
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

// タイムライン字幕帯の観測点。目盛りは指示 2 の data-akari-caption-fragment-tick。
const TIMELINE = `(()=>{const chips=[...document.querySelectorAll('[data-akari-item-kind="caption"]')];return{count:chips.length,ids:chips.map(c=>c.dataset.akariItemId),selected:chips.filter(c=>c.classList.contains('akari-annotations-caption-selected')).map(c=>c.dataset.akariItemId),chips:chips.map(c=>({id:c.dataset.akariItemId,left:c.style.left,width:c.style.width,ticks:[...c.querySelectorAll('[data-akari-caption-fragment-tick]')].map(t=>{const s=getComputedStyle(t);return{index:t.dataset.akariCaptionFragmentTick,left:t.style.left,width:s.width,background:s.backgroundColor,className:t.className}})}))}})()`;

const DAIHON = `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')];return{total:rows.length,ids:rows.map(r=>r.dataset.captionId),selected:rows.filter(r=>r.classList.contains('selected')).map(r=>r.dataset.captionId),slashes:rows.map(r=>({id:r.dataset.captionId,manual:r.querySelectorAll('.akari-daihon-slash-manual,.akari-daihon-slash').length}))}})()`;

async function ensureDaihonVisible(cdp) {
  const probe = `(()=>{const e=document.querySelector('.akari-daihon-row[data-caption-id="c-0002"]');if(!e)return null;const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{width:r.width,height:r.height}:null})()`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const visible = await evalOn(cdp, probe).catch(() => null);
    if (visible) return visible;
    await evalOn(cdp, command('akari.daihon.open')).catch(() => {});
    await sleep(600);
  }
  throw new Error('台本パネルが見えない');
}

/** 選択子の要素をスクロールで見せてから中心座標を返す。 */
async function pointOf(cdp, selector, { label = selector, timeoutMs = 30_000 } = {}) {
  return waitEval(cdp, `(()=>{const el=document.querySelector(${S(selector)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;return{x:r.left+r.width/2,y:r.top+r.height/2,text:(el.textContent||'').slice(0,24)}})()`,
    { label, timeoutMs });
}

/** テキストで pop のボタンを引く（／ ここで改行 など）。 */
async function popButtonPoint(cdp, needle) {
  return waitEval(cdp, `(()=>{const pop=document.querySelector('.akari-daihon-pop');if(!pop)return null;const b=[...pop.querySelectorAll('button')].find(x=>(x.textContent||'').includes(${S(needle)}));if(!b)return null;const r=b.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;return{x:r.left+r.width/2,y:r.top+r.height/2,text:b.textContent}})()`,
    { label: `pop のボタン「${needle}」`, timeoutMs: 20_000 });
}

/** 行の「余白」= 対話要素に当たらない点。⌘ クリックで選択に使う。 */
const INTERACTIVE_SELECTOR = '.akari-daihon-speaker, button.akari-daihon-tc, .akari-daihon-word, .akari-daihon-word-unk, input, .akari-daihon-badge-qc, .akari-daihon-gapchip, button.akari-daihon-cut, button.akari-daihon-split, .akari-daihon-splitmark, .akari-daihon-gapzone, .akari-daihon-gapdraft, .akari-daihon-word-filler, button.akari-daihon-silence, button.akari-daihon-selcut, button.akari-daihon-selmerge, button.akari-daihon-tpl, button.akari-daihon-seltpl, .akari-daihon-tplcard, .akari-daihon-cutcell, .akari-daihon-cutrange, .akari-daihon-pop, .akari-daihon-minitl, .akari-daihon-wgap, .akari-daihon-wordbar, .akari-daihon-wordcm';
const META = 4;

async function rowBlankPoint(cdp, rowId) {
  await ensureDaihonVisible(cdp);
  return waitEval(cdp, `(()=>{const row=document.querySelector('.akari-daihon-row[data-caption-id=${S(rowId)}]');if(!row)return null;row.scrollIntoView({block:'center'});const r=row.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;
for(const fy of [0.82,0.6,0.5,0.3]){for(let fx=0.97;fx>0.08;fx-=0.02){const x=r.left+r.width*fx,y=r.top+r.height*fy;const el=document.elementFromPoint(x,y);if(!el||!row.contains(el))continue;if(el.closest(${S(INTERACTIVE_SELECTOR)}))continue;return{x,y,hit:el.className||el.tagName}}}
return null})()`, { label: `${rowId} の余白`, timeoutMs: 20_000 });
}

/**
 * 字幕帯のブロック数変化を DOM で監視する仕掛けを仕込む。
 * captions.json の書き込み完了（EDIT_STORE_DID_WRITE_EVENT）の時刻も拾い、
 * 「台本の操作から」と「書き込み完了から」の 2 つの所要 ms を出す。
 */
const INSTALL_WATCH = `(()=>{
const strip=document.querySelector('[data-akari-item-kind="caption"]')?.parentElement;
if(!strip)return null;
const count=()=>document.querySelectorAll('[data-akari-item-kind="caption"]').length;
const w={baseline:count(),changes:[],didWrite:[],startedAt:performance.now(),clickedAt:null};
let last=w.baseline;
const sample=()=>{const now=count();if(now!==last){last=now;w.changes.push({count:now,at:performance.now()})}};
w.onDidWrite=event=>{const uri=String(event?.detail?.uri||'');if(uri.endsWith('captions.json'))w.didWrite.push({at:performance.now(),bytes:String(event?.detail?.content||'').length})};
window.addEventListener('akari.editStore.didWrite',w.onDidWrite);
w.observer=new MutationObserver(sample);
w.observer.observe(strip,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});
w.timer=setInterval(sample,20);
window.__akariCapWatch=w;
return {baseline:w.baseline};})()`;

const READ_WATCH = expected => `(()=>{const w=window.__akariCapWatch;if(!w)return null;
const hit=w.changes.find(c=>c.count===${expected});if(!hit)return null;
const write=w.didWrite[0];
return{baseline:w.baseline,reached:hit.count,msFromClick:w.clickedAt===null?null:Math.round((hit.at-w.clickedAt)*10)/10,
msFromDidWrite:write?Math.round((hit.at-write.at)*10)/10:null,didWrite:w.didWrite.length,changes:w.changes.map(c=>c.count)}})()`;

const STOP_WATCH = `(()=>{const w=window.__akariCapWatch;if(!w)return false;w.observer?.disconnect();clearInterval(w.timer);window.removeEventListener('akari.editStore.didWrite',w.onDidWrite);delete window.__akariCapWatch;return true})()`;

const MARK_CLICK = `(()=>{const w=window.__akariCapWatch;if(!w)return false;w.clickedAt=performance.now();return true})()`;

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
  await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===3`, { label: '台本 3 行' });
  out.preloadOverlay = await settlePreloadOverlay(cdp);
  out.daihonVisible = await ensureDaihonVisible(cdp);
  await evalOn(cdp, command('akari.annotations.open')).catch(() => {});
  out.timelineBaseline = await waitEval(cdp, `(()=>{const v=${TIMELINE};return v.count===3?v:null})()`,
    { label: 'タイムラインに字幕 3 ブロック', timeoutMs: 90_000 });
  await evalOn(cdp, command('akari.daihon.open')).catch(() => {});
  await ensureDaihonVisible(cdp);
  await save();

  // ---- 手順 1: 台本で分割 → 帯が 3 → 4 ブロック（+1 までの所要 ms を DOM 監視で実測） ----
  const split = await step('1. 台本で c-0001 を分割すると字幕帯が 3 → 4 ブロックになる（1 秒以内）', async () => {
    const installed = await evalOn(cdp, INSTALL_WATCH);
    assert(installed && installed.baseline === 3, `監視を仕込めない: ${JSON.stringify(installed)}`);
    // ⧉（分割モード）→ 単語境界のマーカーが出る
    const splitButton = await pointOf(cdp, '.akari-daihon-row[data-caption-id="c-0001"] button.akari-daihon-split', { label: '⧉ ボタン' });
    await realClick(cdp, splitButton.x, splitButton.y);
    const marks = await waitEval(cdp, `(()=>{const m=[...document.querySelectorAll('.akari-daihon-splitmark[data-row-id="c-0001"]')].map(x=>x.dataset.splitIndex);return m.length?m:null})()`,
      { label: '分割マーカー', timeoutMs: 20_000 });
    const target = marks[Math.floor(marks.length / 2)];
    const markPoint = await pointOf(cdp, `.akari-daihon-splitmark[data-row-id="c-0001"][data-split-index="${target}"]`, { label: `分割マーカー ${target}` });
    await evalOn(cdp, MARK_CLICK);
    await realClick(cdp, markPoint.x, markPoint.y);
    const watch = await waitEval(cdp, READ_WATCH(4), { label: '字幕帯が 4 ブロックへ', timeoutMs: 30_000 });
    await evalOn(cdp, STOP_WATCH);
    const timeline = await evalOn(cdp, TIMELINE);
    const daihon = await evalOn(cdp, DAIHON);
    assert(timeline.count === 4, `帯が 4 ブロックでない: ${JSON.stringify(timeline.ids)}`);
    assert(daihon.total === 4, `台本が 4 行でない: ${JSON.stringify(daihon.ids)}`);
    assert(watch.msFromClick !== null && watch.msFromClick <= 1000,
      `分割から +1 までが 1 秒を超えた: ${watch.msFromClick}ms`);
    return { splitIndexes: marks, splitAt: target, watch, timelineIds: timeline.ids, daihonIds: daihon.ids };
  });
  await shot(cdp, 1, 'split-adds-one-caption-block');

  // ---- 手順 2: 結合 → 帯が 4 → 3 ブロック（消えた id の選択が結合先へ付け替わる） ----
  await step('2. 分割した 2 行を結合すると字幕帯が 4 → 3 ブロックへ戻り、選択が結合先の id へ付け替わる', async () => {
    const ids = split.daihonIds;
    const first = ids[0];
    const second = ids[1];
    await rowBlankPoint(cdp, first).then(point => realClick(cdp, point.x, point.y, { modifiers: META }));
    await sleep(200);
    await rowBlankPoint(cdp, second).then(point => realClick(cdp, point.x, point.y, { modifiers: META }));
    const selectedBefore = await waitEval(cdp, `(()=>{const v=${DAIHON};return v.selected.length===2?v:null})()`,
      { label: '台本で 2 行選択', timeoutMs: 30_000 });
    const timelineBefore = await waitEval(cdp, `(()=>{const v=${TIMELINE};return v.selected.length===2?v:null})()`,
      { label: 'タイムラインで 2 ブロック選択', timeoutMs: 30_000 });
    const installed = await evalOn(cdp, INSTALL_WATCH);
    assert(installed && installed.baseline === 4, `監視を仕込めない: ${JSON.stringify(installed)}`);
    const merge = await pointOf(cdp, 'button.akari-daihon-selmerge', { label: '結合ボタン' });
    await evalOn(cdp, MARK_CLICK);
    await realClick(cdp, merge.x, merge.y);
    const watch = await waitEval(cdp, READ_WATCH(3), { label: '字幕帯が 3 ブロックへ', timeoutMs: 30_000 });
    await evalOn(cdp, STOP_WATCH);
    const timeline = await evalOn(cdp, TIMELINE);
    assert(timeline.count === 3, `帯が 3 ブロックでない: ${JSON.stringify(timeline.ids)}`);
    assert(!timeline.ids.includes(second), `結合で消えた id が帯に残っている: ${second}`);
    // 消えた id を選んでいた選択は結合先（残った id）へ寄る。少なくとも stale id は残らない。
    assert(!timeline.selected.includes(second), `選択が消えた id のまま: ${JSON.stringify(timeline.selected)}`);
    return {
      mergedIds: [first, second],
      daihonSelectedBefore: selectedBefore.selected,
      timelineSelectedBefore: timelineBefore.selected,
      timelineSelectedAfter: timeline.selected,
      watch, timelineIds: timeline.ids
    };
  });
  await shot(cdp, 2, 'merge-removes-one-caption-block');

  // ---- 手順 3: 語間の「／ ここで改行」→ 帯のブロック内に断片境界の目盛り ----
  await step('3. 語間で「／ ここで改行」すると、その字幕ブロックに断片境界の目盛り（薄い縦線）が出る', async () => {
    await ensureDaihonVisible(cdp);
    const before = await evalOn(cdp, TIMELINE);
    assert(before.chips.every(chip => chip.ticks.length === 0),
      `改行前に目盛りが出ている: ${JSON.stringify(before.chips.map(c => ({ id: c.id, ticks: c.ticks.length })))}`);
    const gap = await pointOf(cdp, '.akari-daihon-wgap[data-row-id="c-0002"][data-gap-index="1"]', { label: 'c-0002 の語間' });
    await realClick(cdp, gap.x, gap.y);
    const button = await popButtonPoint(cdp, 'ここで改行');
    await realClick(cdp, button.x, button.y);
    const timeline = await waitEval(cdp, `(()=>{const v=${TIMELINE};const c=v.chips.find(x=>x.id==='c-0002');return c&&c.ticks.length>0?v:null})()`,
      { label: 'c-0002 のブロックに目盛り', timeoutMs: 30_000 });
    const chip = timeline.chips.find(candidate => candidate.id === 'c-0002');
    assert(chip.ticks.length === 1, `目盛りが 1 本でない: ${JSON.stringify(chip.ticks)}`);
    const tick = chip.ticks[0];
    const percent = Number(String(tick.left).replace('%', ''));
    assert(Number.isFinite(percent) && percent > 0 && percent < 100, `目盛りの位置が内側でない: ${tick.left}`);
    assert(parseFloat(tick.width) > 0, `目盛りの幅が 0: ${tick.width}`);
    assert(/rgba?\(/.test(tick.background), `目盛りの色が取れない: ${tick.background}`);
    const others = timeline.chips.filter(candidate => candidate.id !== 'c-0002');
    assert(others.every(candidate => candidate.ticks.length === 0),
      `改行していない行に目盛りが出た: ${JSON.stringify(others.map(c => ({ id: c.id, ticks: c.ticks.length })))}`);
    const fragments = JSON.parse(await readFile(CAPTIONS, 'utf8')).captions.find(row => row.id === 'c-0002')?.display_fragments ?? null;
    assert(Array.isArray(fragments) && fragments.length === 2, `display_fragments が 2 断片でない: ${JSON.stringify(fragments)}`);
    return { popButton: button.text, tick, fragments, chips: timeline.chips.map(c => ({ id: c.id, ticks: c.ticks.length })) };
  });
  await shot(cdp, 3, 'manual-break-draws-fragment-tick');

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
