#!/usr/bin/env node
// L1（CDP 3 手順）: 無音チップ → 前後の語が見える広い窓 → ズーム（ボタン / ホイールで 2〜12 秒）→
// つまみを無音の外へ 0.3 秒動かせる（可動域 = 無音の外側 0.4 秒でクランプ）。
// Electron は detached にせず、AKARI_HOME と --user-data-dir を runs/ 配下の一時ディレクトリへ向ける。
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL_DIR = path.join(REPO, 'apps', 'shell');
// apps/shell の electron 実体（postbuild の resign-electron が署名し直すのはこちら）を使う。
const ELECTRON = path.join(SHELL_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PROJECT = path.join(ROOT, 'fixture', 'project');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22171);
const ISO = path.join(ROOT, 'runs', 'l1');
const LOG = path.join(ROOT, 'runs', 'l1.log');
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [], cleanup: null };

// fixture の 1 行目 = 1.00–3.05（語は 0.5 秒間隔で 4 語・最後の語 いました 2.50–2.95）、
// 2 行目 = 3.65–5.70（最初の語 おばあさんは 3.65–4.10）。無音は 3.05–3.65 の 0.60 秒。
const GAP = { start: 3.05, end: 3.65 };
const PAD = 0.4;                       // 可動域の外側（契約の裁定）
const PREV_WORD = 'いました';
const NEXT_WORD = 'おばあさんは';

const sanitize = value => String(value?.stack || value?.message || value)
  .replaceAll(REPO, '<WORKTREE>')
  .replaceAll(process.env.HOME ?? '~', '<HOME>')
  .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"]+/g, '<TMP>')
  .replace(/\/Users\/[^\s)'"]+/g, '<HOME>');
const save = async () => {
  const temporary = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(out, null, 2)}\n`);
  await rename(temporary, RESULTS);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const run = (command, args, { cwd = ROOT, timeoutMs = 120_000 } = {}) => new Promise((resolve, reject) => {
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

async function domDump(cdp) {
  return evalOn(cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')].slice(0,3).map(r=>({id:r.dataset.captionId,chips:r.querySelectorAll('.akari-daihon-gapchip').length}));const e=document.querySelector('.akari-daihon-cutrange');return JSON.stringify({rows,editor:e?e.innerHTML.slice(0,600):null})})()`).catch(error => String(error));
}

async function rect(cdp, selector) {
  await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`, { label: `${selector} visible`, timeoutMs: 20_000 })
    .catch(async error => { throw new Error(`${sanitize(error)} | dom=${await domDump(cdp)}`); });
  await sleep(140);
  return evalOn(cdp, `(()=>{const e=document.querySelector(${S(selector)});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}})()`);
}

async function clickSelector(cdp, selector, modifiers = 0) {
  const point = await rect(cdp, selector);
  await realClick(cdp, point.x, point.y, { modifiers });
}

/** 見出しのズームボタンを記号のゆれに強い形で押す（− / ＋ / - / + いずれでも拾う）。 */
async function clickZoom(cdp, direction) {
  const needles = direction === 'in' ? ['+', '＋'] : ['−', '-', '－', 'ー'];
  const expression = `(()=>{const c=document.querySelector('.akari-daihon-cutrange');if(!c)return null;const n=${S(needles)};const b=[...c.querySelectorAll('button')].find(node=>{const t=(node.textContent||'').trim();return n.includes(t)&&!node.disabled});if(!b)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`;
  const point = await waitEval(cdp, expression, { label: `ズーム ${direction} ボタン` })
    .catch(async error => { throw new Error(`${sanitize(error)} | dom=${await domDump(cdp)}`); });
  await realClick(cdp, point.x, point.y);
  await sleep(160);
}

async function wheelOnWave(cdp, deltaY, times = 1) {
  const wave = await rect(cdp, '.akari-daihon-cutrange .wave');
  for (let index = 0; index < times; index++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: wave.x, y: wave.y, deltaX: 0, deltaY, button: 'none'
    });
    await sleep(90);
  }
  await sleep(120);
}

const metricsNow = async cdp => waitEval(cdp,
  `(()=>{const m=window.__akariDaihonCutRangeMetrics;return m&&m.window?m:null})()`, { label: '計測' });

/** 現在の窓に対して「秒 → 画面 x」を引く。 */
async function timeToX(cdp, seconds) {
  const metrics = await metricsNow(cdp);
  const wave = await rect(cdp, '.akari-daihon-cutrange .wave');
  const ratio = (seconds - metrics.window.start) / (metrics.window.end - metrics.window.start);
  return { x: wave.left + Math.max(0, Math.min(1, ratio)) * wave.width, wave, metrics, ratio };
}

/** つまみを目標 x へドラッグする（実ユーザーと同じ mouse 列）。 */
async function dragHandle(cdp, edge, targetX) {
  const handle = await rect(cdp, `.akari-daihon-cutrange .hnd.${edge}`);
  const y = handle.top + handle.height / 2;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x, y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y, button: 'left', buttons: 1, clickCount: 1 });
  const steps = 8;
  for (let index = 1; index <= steps; index++) {
    const x = handle.x + (targetX - handle.x) * index / steps;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    await sleep(40);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(160);
}

async function shot(cdp, number, label) {
  const name = `${String(number).padStart(2, '0')}-${label}.png`;
  await screenshot(cdp, path.join(ROOT, name));
  out.screenshots.push(name);
  await save();
}

// 右ドックの別タブが前面に来ていると台本の DOM は 0 サイズになる。見えるまで開き直す。
async function ensureDaihonVisible(cdp) {
  const probe = "(()=>{const e=document.querySelector('.akari-daihon-row[data-caption-id=\"c-0001\"]');if(!e)return null;const r=e.getBoundingClientRect();return JSON.stringify({w:r.width,h:r.height,top:r.top})})()";
  const deadline = Date.now() + 60_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalOn(cdp, probe).catch(() => null);
    if (last && JSON.parse(last).w > 0 && JSON.parse(last).h > 0) return JSON.parse(last);
    await evalOn(cdp, command('akari.daihon.open')).catch(() => {});
    await sleep(600);
  }
  throw new Error(`台本パネルが見えない: ${last} | ${await domDump(cdp)}`);
}

let spawnedChild;

async function launch() {
  await rm(ISO, { recursive: true, force: true });
  await mkdir(ISO, { recursive: true });
  await mkdir(path.join(ROOT, 'runs'), { recursive: true });
  const home = path.join(ISO, 'akari-home');
  await mkdir(home, { recursive: true });
  await writeFile(LOG, '');
  const child = spawn(ELECTRON, [
    SHELL_DIR, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${ISO}`, '--no-sandbox'
  ], {
    cwd: REPO,
    env: { ...process.env, AKARI_HOME: home, THEIA_CONFIG_DIR: ISO },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  spawnedChild = child;
  const append = chunk => void writeFile(LOG, chunk, { flag: 'a' }).catch(() => {});
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  let target;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline && !target) {
    try { target = (await listTargets(PORT)).find(item => item.type === 'page'); } catch {}
    if (!target) await sleep(300);
  }
  assert(target, 'CDP page target did not appear');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'Theia workbench', timeoutMs: 150_000 });
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
  const survivors = await new Promise(resolve => {
    const child = spawn('/bin/sh', ['-c', `ps -eo pid,ppid,args | grep -F ${JSON.stringify(ISO)} | grep -v grep | wc -l`]);
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.once('close', () => resolve(Number(stdout.trim())));
  });
  out.cleanup = { killedPid: pid ?? null, survivingProcesses: survivors };
  await save();
  return survivors;
}

const captionsPath = path.join(PROJECT, 'captions.json');
const editPath = path.join(PROJECT, 'edit.json');
let session;
try {
  await rm(path.join(ROOT, 'fixture'), { recursive: true, force: true });
  out.fixture = JSON.parse((await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')], { timeoutMs: 180_000 })).stdout.trim());
  await save();
  const originalCaptions = await readFile(captionsPath, 'utf8');
  const originalEdit = await readFile(editPath, 'utf8');
  session = await launch();
  const { cdp } = session;
  await evalOn(cdp, command('akari.daihon.open'));
  await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===5`, { label: '5 rows' });
  out.preloadOverlay = await settlePreloadOverlay(cdp);
  out.daihonVisible = await ensureDaihonVisible(cdp);
  await save();

  // 1. 無音チップ → 前後の発話まで見える広い窓（語ラベル・目盛り・110px の波形・≤ 300ms）
  await step('1. 無音チップ → 前後の語が見える広い窓（≤ 300ms）', async () => {
    await evalOn(cdp, `window.__akariDaihonCutRangeMetrics=undefined`);
    await clickSelector(cdp, '.akari-daihon-row[data-caption-id="c-0001"] .akari-daihon-gapchip');
    await waitEval(cdp, `Boolean(document.querySelector('.akari-daihon-cutrange canvas'))`, { label: '範囲エディタ' });
    const metrics = await waitEval(cdp, `(()=>{const m=window.__akariDaihonCutRangeMetrics;return m&&m.waveform&&m.waveform!=='loading'?m:null})()`, { label: '波形の計測' });
    const geometry = await evalOn(cdp, `(()=>{const e=document.querySelector('.akari-daihon-cutrange');const r=e.getBoundingClientRect();const wave=e.querySelector('.wave').getBoundingClientRect();const row=document.querySelector('.akari-daihon-row[data-caption-id="c-0001"]');const hnd=e.querySelector('.hnd');return{height:Math.round(r.height),waveHeight:Math.round(wave.height),handleWidth:Math.round(hnd.getBoundingClientRect().width),afterRow:row.nextElementSibling===e,bands:[...e.querySelectorAll('.band')].map(n=>n.textContent),ticks:e.querySelectorAll('.tick').length,majorTicks:[...e.querySelectorAll('.tick.mj')].map(n=>n.textContent.trim()),handles:e.querySelectorAll('.hnd').length,playhead:Boolean(e.querySelector('.ph')),range:Boolean(e.querySelector('.rng'))}})()`);
    assert(metrics.waveform === 'ready', `波形が出ていない: ${JSON.stringify(metrics)}`);
    assert(metrics.openMs <= 300, `エディタ表示が ${metrics.openMs}ms（≤300ms のはず）`);
    assert(geometry.afterRow, 'エディタが行要素の直後に入っていない');
    assert(geometry.waveHeight >= 108 && geometry.waveHeight <= 112, `波形の高さ ${geometry.waveHeight}px（110px のはず）`);
    assert(geometry.handleWidth >= 20, `つまみの幅 ${geometry.handleWidth}px（22px のはず）`);
    assert(geometry.handles === 2 && geometry.playhead && geometry.range, `つまみ/帯/再生ヘッドが足りない: ${JSON.stringify(geometry)}`);
    // 窓 = 前の語の start − 0.5 〜 次の語の end + 0.5（最低 4 秒）
    assert(metrics.windowSec >= 4 - 1e-6, `窓が ${metrics.windowSec} 秒（最低 4 秒のはず）`);
    assert(metrics.window.start <= 2.5 - 0.5 + 1e-6, `窓の左端 ${metrics.window.start}（前の語 2.50 − 0.5 以下のはず）`);
    assert(metrics.window.end >= 4.10 + 0.5 - 1e-6, `窓の右端 ${metrics.window.end}（次の語 4.10 + 0.5 以上のはず）`);
    // 前後の発話の語ラベルが窓に出ている
    assert(geometry.bands.includes(PREV_WORD), `前の語 ${PREV_WORD} のラベルが無い: ${JSON.stringify(geometry.bands)}`);
    assert(geometry.bands.includes(NEXT_WORD), `次の語 ${NEXT_WORD} のラベルが無い: ${JSON.stringify(geometry.bands)}`);
    // 0.5 秒刻みの目盛り
    assert(geometry.ticks >= Math.floor(metrics.windowSec / 0.5) - 1, `目盛りが ${geometry.ticks} 本（0.5 秒刻みのはず）`);
    assert(geometry.majorTicks.length >= 3, `1.0 秒のラベルが ${geometry.majorTicks.length} 個: ${JSON.stringify(geometry.majorTicks)}`);
    // 可動域が無音の外 0.4 秒まで広がっている
    assert(Math.abs(metrics.bounds.lo - (GAP.start - PAD)) < 0.011, `可動域の左 ${metrics.bounds.lo}（${GAP.start - PAD} のはず）`);
    assert(Math.abs(metrics.bounds.hi - (GAP.end + PAD)) < 0.011, `可動域の右 ${metrics.bounds.hi}（${GAP.end + PAD} のはず）`);
    await shot(cdp, 1, 'wide-window-with-neighbor-words');
    return { metrics, geometry };
  });

  // 2. ズーム（ボタン − / + とホイールで 2〜12 秒）
  await step('2. ズーム（− / + ボタンとホイールで 2〜12 秒）', async () => {
    const natural = (await metricsNow(cdp)).windowSec;
    await clickZoom(cdp, 'in');
    const zoomedIn = await metricsNow(cdp);
    assert(zoomedIn.windowSec < natural - 1e-6, `+ で窓が縮まない（${natural} → ${zoomedIn.windowSec}）`);
    await clickZoom(cdp, 'out');
    await clickZoom(cdp, 'out');
    const zoomedOut = await metricsNow(cdp);
    assert(zoomedOut.windowSec > zoomedIn.windowSec + 1e-6, `− で窓が広がらない（${zoomedIn.windowSec} → ${zoomedOut.windowSec}）`);
    // 下限 2 秒 / 上限 12 秒でクランプする（ホイール）
    await wheelOnWave(cdp, -120, 12);
    const minimum = await metricsNow(cdp);
    assert(Math.abs(minimum.windowSec - 2) < 0.02, `ホイールの下限が ${minimum.windowSec} 秒（2 秒のはず）`);
    await wheelOnWave(cdp, 120, 20);
    const maximum = await metricsNow(cdp);
    assert(Math.abs(maximum.windowSec - 12) < 0.02, `ホイールの上限が ${maximum.windowSec} 秒（12 秒のはず）`);
    assert(maximum.labels.length > minimum.labels.length,
      `広げても語ラベルが増えない（2 秒 ${minimum.labels.length} 個 / 12 秒 ${maximum.labels.length} 個）`);
    await shot(cdp, 2, 'zoomed-out-12s');
    // 3 手順目のために自然窓へ戻す（12 → 4 秒付近）
    await wheelOnWave(cdp, -120, 5);
    const back = await metricsNow(cdp);
    return { naturalSec: natural, zoomInSec: zoomedIn.windowSec, zoomOutSec: zoomedOut.windowSec,
      minSec: minimum.windowSec, maxSec: maximum.windowSec, backSec: back.windowSec,
      labelsAtMin: minimum.labels, labelsAtMax: maximum.labels };
  });

  // 3. つまみを無音の外へ 0.3 秒動かせる（そこから先は 0.4 秒でクランプ）
  await step('3. つまみを無音の外へ 0.3 秒動かせる', async () => {
    const before = await metricsNow(cdp);
    const outside = GAP.start - 0.3;
    const aim = await timeToX(cdp, outside);
    await dragHandle(cdp, 'f', aim.x);
    const moved = await metricsNow(cdp);
    assert(moved.selection.from < GAP.start - 1e-6,
      `つまみが無音の外へ出ていない（from=${moved.selection.from} / 無音の頭 ${GAP.start}）`);
    assert(Math.abs(moved.selection.from - outside) < 0.05,
      `狙った ${outside} 秒に対し from=${moved.selection.from}`);
    // さらに引っ張ると可動域（無音の外側 0.4 秒）でクランプ
    const far = await timeToX(cdp, GAP.start - 1.2);
    await dragHandle(cdp, 'f', far.x);
    const clamped = await metricsNow(cdp);
    assert(Math.abs(clamped.selection.from - (GAP.start - PAD)) < 0.02,
      `左のクランプが ${clamped.selection.from}（${GAP.start - PAD} のはず）`);
    // 右のつまみも無音の外 0.4 秒まで
    const right = await timeToX(cdp, GAP.end + 1.2);
    await dragHandle(cdp, 't', right.x);
    const clampedRight = await metricsNow(cdp);
    assert(Math.abs(clampedRight.selection.to - (GAP.end + PAD)) < 0.02,
      `右のクランプが ${clampedRight.selection.to}（${GAP.end + PAD} のはず）`);
    await shot(cdp, 3, 'handle-outside-silence');
    return { before: before.selection, movedFrom: moved.selection.from,
      clampedFrom: clamped.selection.from, clampedTo: clampedRight.selection.to,
      outsideBy: Number((GAP.start - moved.selection.from).toFixed(3)) };
  });

  // 台本の副作用が無いこと（範囲エディタを触っただけでは書かない）
  out.untouched = {
    captions: (await readFile(captionsPath, 'utf8')) === originalCaptions,
    edit: (await readFile(editPath, 'utf8')) === originalEdit
  };
  assert(out.untouched.captions && out.untouched.edit, `範囲を動かしただけでファイルが変わった: ${JSON.stringify(out.untouched)}`);
  out.status = 'pass';
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
} finally {
  const survivors = await stop(session);
  out.cleanup = { ...(out.cleanup ?? {}), survivingProcesses: survivors };
  await save();
}
process.stdout.write(`${JSON.stringify({ status: out.status, steps: out.steps.map(s => [s.name, s.pass]), screenshots: out.screenshots, cleanup: out.cleanup, error: out.error })}\n`);
process.exit(out.status === 'pass' ? 0 : 1);
