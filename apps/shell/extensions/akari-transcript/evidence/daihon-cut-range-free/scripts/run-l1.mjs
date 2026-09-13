#!/usr/bin/env node
// L1（CDP 4 手順）: オーナー実データ（captions-owner.json + 素材の TMP コピー）で
//  1. 行末チップが実無音 2.69 秒（8.61–11.30）を示し、エディタに灰の無音帯が出る
//  2. つまみを 8.70 / 11.90（語の中）へ置ける（読み値に「語に食い込み 0.12 秒」）
//  3. 磁石が 11.30（無音の縁）へ吸う
//  4. Shift で磁石が外れて 11.25 に置ける
// Electron は detached にせず、HOME / AKARI_HOME / --user-data-dir を TMP の作業領域へ向ける。
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL_DIR = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURES = path.join(REPO, 'apps/shell/extensions/akari-transcript/test/fixtures/daihon-cut-range-free');
const OWNER_MEDIA = process.env.AKARI_OWNER_MEDIA
  ?? path.join(os.homedir(), 'Akari/channels/my-channel/videos/2026-09-12-new-video/assets/IMG_4606のコヒ_ー.MOV');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22181);
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [], cleanup: null };

// オーナー実データの既知の値（内部 raw/silences-owner.json・raw/captions-owner.json）
const SIL = { start: 8.61, end: 11.30 };     // 「頑張っておりました」の後の実無音（2.69 秒）
const ROW = 'c-0003';                        // 「頑張っておりました」
const PREV_WORD_START = 6.89;                // りました（6.89–7.92）
const NEXT_WORD = { start: 11.78, end: 12.62 }; // に
// 実無音の外に出た分だけを語への食い込みとして数える（契約 §指示 3）。
// つまみ to = 11.90 のとき = 「感じ」の 11.30–11.72（0.42）+「に」の 11.78–11.90（0.12）= 0.54 秒。
const INTRUSION_AT_11_90 = 0.54;
// 窓 = 前の語 start − 0.5 〜 次の語 end + 0.5。実機の語は語ユニット化（daihon-word-units）されるため
// 実測は [6.30, 13.87]（「おりました」6.80 起点 /「にかけて」13.37 終点）。ここでは無音の外へ十分広いことだけ見る。
const WINDOW_MARGIN = 1.5;
const MAGNET_TOL = 0.08;

const sanitize = value => String(value?.stack || value?.message || value)
  .replaceAll(REPO, '<WORKTREE>')
  .replaceAll(os.homedir(), '<HOME>')
  .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"]+/g, '<TMP>')
  .replace(/\/Users\/[^\s)'"]+/g, '<HOME>');
const save = async () => {
  const temporary = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(out, null, 2)}\n`);
  await rename(temporary, RESULTS);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

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

const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;

async function domDump(cdp) {
  return evalOn(cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')].slice(0,4).map(r=>({id:r.dataset.captionId,chip:r.querySelector('.akari-daihon-gapchip')?.textContent??null}));const e=document.querySelector('.akari-daihon-cutrange');return JSON.stringify({rows,editor:e?e.className:null})})()`).catch(error => String(error));
}

async function rect(cdp, selector) {
  await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`, { label: `${selector} visible`, timeoutMs: 20_000 })
    .catch(async error => { throw new Error(`${sanitize(error)} | dom=${await domDump(cdp)}`); });
  await sleep(140);
  return evalOn(cdp, `(()=>{const e=document.querySelector(${S(selector)});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}})()`);
}

async function clickSelector(cdp, selector) {
  const point = await rect(cdp, selector);
  await realClick(cdp, point.x, point.y);
}

const metricsNow = async cdp => waitEval(cdp,
  `(()=>{const m=window.__akariDaihonCutRangeMetrics;return m&&m.window?m:null})()`, { label: '計測' });

async function timeToX(cdp, seconds) {
  const metrics = await metricsNow(cdp);
  const wave = await rect(cdp, '.akari-daihon-cutrange .wave');
  const ratio = (seconds - metrics.window.start) / (metrics.window.end - metrics.window.start);
  return { x: wave.left + Math.max(0, Math.min(1, ratio)) * wave.width, wave, metrics, ratio };
}

/** つまみを目標 x へドラッグする（modifiers=8 で Shift 押下）。 */
async function dragHandle(cdp, edge, targetX, modifiers = 0) {
  const handle = await rect(cdp, `.akari-daihon-cutrange .hnd.${edge}`);
  const y = handle.top + handle.height / 2;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x, y, button: 'none', modifiers });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y, button: 'left', buttons: 1, clickCount: 1, modifiers });
  const steps = 8;
  for (let index = 1; index <= steps; index++) {
    const x = handle.x + (targetX - handle.x) * index / steps;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, modifiers });
    await sleep(40);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y, button: 'left', buttons: 0, clickCount: 1, modifiers });
  await sleep(160);
}

async function dragTo(cdp, edge, seconds, modifiers = 0) {
  const aim = await timeToX(cdp, seconds);
  await dragHandle(cdp, edge, aim.x, modifiers);
  return metricsNow(cdp);
}

async function shot(cdp, number, label) {
  const name = `${String(number).padStart(2, '0')}-${label}.png`;
  await screenshot(cdp, path.join(ROOT, name));
  out.screenshots.push(name);
  await save();
}

async function ensureDaihonVisible(cdp) {
  const probe = `(()=>{const e=document.querySelector('.akari-daihon-row[data-caption-id="${ROW}"]');if(!e)return null;const r=e.getBoundingClientRect();return JSON.stringify({w:r.width,h:r.height})})()`;
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

const work = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-cut-range-free-l1-')));
const project = path.join(work, 'project');
const profile = path.join(work, 'profile');
const captionsPath = path.join(project, 'captions.json');
const editPath = path.join(project, 'edit.json');
const silenceSidecar = path.join(project, '.akari/sidecars/assets/owner.MOV.analysis/silences.json');
let child; let cdp;
try {
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await mkdir(profile, { recursive: true });
  await cp(OWNER_MEDIA, path.join(project, 'assets/owner.MOV'));
  const captions = JSON.parse(await readFile(path.join(FIXTURES, 'captions-owner.json'), 'utf8'));
  const duration = 26.16;
  const edit = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [{ id: 'src-1', path: 'assets/owner.MOV' }], tracks: [
    { id: 'video', lane: 'visual', items: [{ id: 'owner', at: 0, duration: Math.floor(duration * 30), source: { kind: 'media', src: 'src-1', in: 0, out: duration } }] },
    { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
  ] };
  await writeFile(captionsPath, `${JSON.stringify(captions, null, 2)}\n`);
  await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
  // analysis.json は置かない。無音一覧は getClipSilences（その場で silencedetect）で取る経路を通す。
  const originalCaptions = await readFile(captionsPath, 'utf8');
  const originalEdit = await readFile(editPath, 'utf8');

  child = spawn(ELECTRON, [SHELL_DIR, project, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-sandbox'], {
    cwd: REPO,
    env: { ...process.env, HOME: profile, AKARI_HOME: path.join(profile, 'akari-home'), THEIA_CONFIG_DIR: path.join(profile, 'theia') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = [];
  let electronExit;
  child.stdout.on('data', chunk => log.push(String(chunk)));
  child.stderr.on('data', chunk => log.push(String(chunk)));
  child.once('close', (code, signal) => { electronExit = { code, signal }; });
  let target;
  for (let attempt = 0; attempt < 600 && !target; attempt += 1) {
    target = await listTargets(PORT).then(items => items.find(item => item.type === 'page')).catch(() => undefined);
    if (electronExit) break;
    if (!target) await sleep(300);
  }
  assert(target, `CDP page target did not appear; electron=${JSON.stringify(electronExit)} log=${sanitize(log.join('').slice(-3000))}`);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'Theia workbench', timeoutMs: 180_000 });
  await evalOn(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b){b.click();return 'clicked';} return 'none'; })()`).catch(() => undefined);
  out.workspaceRoots = await waitEval(cdp, `(async()=>{const d=window.theia.container._bindingDictionary;const K=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.tryGetRoots==='function');if(!K)return null;const ws=window.theia.container.get(K);await ws.ready;return (ws.tryGetRoots()||[]).length})()`, { label: 'workspace roots', timeoutMs: 180_000 });
  await save();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await evalOn(cdp, command('akari.daihon.open')).catch(() => undefined);
    try { await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===8`, { label: 'owner captions rows', timeoutMs: 40_000 }); break; }
    catch (error) { if (attempt === 2) throw error; }
  }
  out.daihonVisible = await ensureDaihonVisible(cdp);
  await save();

  // 1. 実無音のチップ（2.69 秒）→ エディタに灰の無音帯（8.61–11.30）と窓いっぱいの可動域
  await step('1. 行末チップが実無音 2.69 秒（8.61–11.30）を示し、灰の無音帯が出る', async () => {
    const chip = await waitEval(cdp,
      `(()=>{const c=document.querySelector('.akari-daihon-row[data-caption-id="${ROW}"] .akari-daihon-gapchip');return c&&c.textContent.includes('2.69')?{text:c.textContent.trim(),source:c.dataset.source??null,title:c.title}:null})()`,
      { label: '実無音チップ 2.69', timeoutMs: 120_000 })
      .catch(async error => { throw new Error(`${sanitize(error)} | dom=${await domDump(cdp)}`); });
    assert(chip.source === 'silence', `チップの出所が ${chip.source}（silence のはず）: ${JSON.stringify(chip)}`);
    const sidecar = await stat(silenceSidecar).then(() => true).catch(() => false);
    const cached = sidecar ? JSON.parse(await readFile(silenceSidecar, 'utf8')) : null;
    await evalOn(cdp, `window.__akariDaihonCutRangeMetrics=undefined`);
    await clickSelector(cdp, `.akari-daihon-row[data-caption-id="${ROW}"] .akari-daihon-gapchip`);
    await waitEval(cdp, `Boolean(document.querySelector('.akari-daihon-cutrange canvas'))`, { label: '範囲エディタ' });
    const metrics = await waitEval(cdp, `(()=>{const m=window.__akariDaihonCutRangeMetrics;return m&&m.waveform&&m.waveform!=='loading'?m:null})()`, { label: '波形の計測' });
    const geometry = await evalOn(cdp, `(()=>{const e=document.querySelector('.akari-daihon-cutrange');return{heading:e.querySelector('.h span')?.textContent??'',sils:[...e.querySelectorAll('.sil')].map(n=>n.title),bands:[...e.querySelectorAll('.band')].map(n=>n.textContent),read:e.querySelector('.read')?.textContent??''}})()`);
    assert(metrics.silences?.some(s => Math.abs(s.start - SIL.start) < 0.011 && Math.abs(s.end - SIL.end) < 0.011),
      `実無音が計測に出ていない: ${JSON.stringify(metrics.silences)}`);
    assert(geometry.sils.length >= 1, `灰の無音帯が描かれていない: ${JSON.stringify(geometry)}`);
    assert(geometry.heading.includes('2.69'), `見出しが ${geometry.heading}`);
    // 可動域 = 窓全体（前の語 6.89 − 0.5 〜 次の語 12.62 + 0.5）
    assert(Math.abs(metrics.bounds.lo - metrics.window.start) < 1e-6 && Math.abs(metrics.bounds.hi - metrics.window.end) < 1e-6,
      `可動域が窓と一致しない: ${JSON.stringify({ bounds: metrics.bounds, window: metrics.window })}`);
    assert(metrics.window.start <= SIL.start - WINDOW_MARGIN && metrics.window.end >= SIL.end + WINDOW_MARGIN,
      `窓が ${JSON.stringify(metrics.window)}（無音 ${SIL.start}–${SIL.end} の外へ ${WINDOW_MARGIN} 秒以上あるはず）`);
    // 既定の範囲 = 実無音の [start + 0.15, end]
    assert(Math.abs(metrics.selection.from - (SIL.start + 0.15)) < 0.011 && Math.abs(metrics.selection.to - SIL.end) < 0.011,
      `既定の範囲が ${JSON.stringify(metrics.selection)}`);
    await shot(cdp, 1, 'silence-chip-and-band');
    return { chip, sidecarWritten: sidecar, sidecarFilter: cached?.filter ?? null,
      sidecarSilence: cached?.silences?.find(pair => Math.abs(pair[0] - SIL.start) < 0.011) ?? null,
      metrics: { window: metrics.window, bounds: metrics.bounds, selection: metrics.selection, silences: metrics.silences, source: metrics.source },
      geometry, prevWordStart: PREV_WORD_START };
  });

  // 2. つまみを 8.70（無音の中・磁石の外）と 11.90（語「に」の中）へ置ける
  await step('2. つまみを 8.70 と 11.90（語の中）へ置ける — 読み値に「語に食い込み 0.54 秒」（「感じ」0.42 +「にかけて」0.12）', async () => {
    const left = await dragTo(cdp, 'f', 8.70);
    assert(Math.abs(left.selection.from - 8.70) < 0.03, `前のつまみが ${left.selection.from}（8.70 のはず）`);
    assert(left.magnet === null, `8.70 で磁石が効いた: ${JSON.stringify(left.magnet)}`);
    const right = await dragTo(cdp, 't', 11.90);
    assert(Math.abs(right.selection.to - 11.90) < 0.03, `後ろのつまみが ${right.selection.to}（11.90 のはず）`);
    assert(right.selection.to > SIL.end, '語の中へ入れていない');
    assert(Math.abs(right.intrusion - INTRUSION_AT_11_90) < 0.05,
      `語への食い込みが ${right.intrusion} 秒（${INTRUSION_AT_11_90} 秒のはず）`);
    const read = await evalOn(cdp, `document.querySelector('.akari-daihon-cutrange .read')?.textContent ?? ''`);
    assert(read.includes('語に食い込み'), `読み値に食い込みが出ていない: ${read}`);
    await shot(cdp, 2, 'handles-free-inside-word');
    return { from: left.selection.from, to: right.selection.to, intrusion: right.intrusion, read };
  });

  // 3. 磁石が無音の縁 11.30 へ吸う
  await step('3. 磁石が無音の縁 11.30 へ吸う（許容 0.08 秒）', async () => {
    const snapped = await dragTo(cdp, 't', 11.26);
    assert(Math.abs(snapped.selection.to - SIL.end) < 0.005,
      `吸着先が ${snapped.selection.to}（${SIL.end} のはず）`);
    assert(snapped.magnet && Math.abs(snapped.magnet.seconds - SIL.end) < 0.005 && snapped.magnet.kind === 'silence',
      `磁石の記録が ${JSON.stringify(snapped.magnet)}`);
    assert(snapped.magnets.some(m => Math.abs(m.seconds - SIL.start) < 0.005),
      `無音の頭 ${SIL.start} が磁石に無い`);
    await shot(cdp, 3, 'magnet-snaps-to-silence-edge');
    return { to: snapped.selection.to, magnet: snapped.magnet, tolerance: MAGNET_TOL,
      aimed: 11.26, magnetCount: snapped.magnets.length };
  });

  // 4. Shift で磁石が外れて 11.25 に置ける
  await step('4. Shift を押しながらなら磁石が外れて 11.25 に置ける', async () => {
    const free = await dragTo(cdp, 't', 11.25, 8);
    assert(free.shift === true, `Shift が伝わっていない: ${JSON.stringify({ shift: free.shift })}`);
    assert(free.magnet === null, `Shift でも磁石が効いた: ${JSON.stringify(free.magnet)}`);
    assert(Math.abs(free.selection.to - 11.25) < 0.03, `後ろのつまみが ${free.selection.to}（11.25 のはず）`);
    assert(Math.abs(free.selection.to - SIL.end) > 0.005, '11.30 に吸われたまま');
    await shot(cdp, 4, 'shift-releases-magnet');
    return { to: free.selection.to, shift: free.shift, magnet: free.magnet };
  });

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
  cdp?.close();
  const pid = child?.pid;
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    await sleep(2500);
    try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    await sleep(800);
  }
  const survivors = await new Promise(resolve => {
    const probe = spawn('/bin/sh', ['-c', `ps -eo pid,ppid,args | grep -F ${JSON.stringify(profile)} | grep -v grep | wc -l`]);
    let stdout = '';
    probe.stdout.on('data', chunk => { stdout += chunk; });
    probe.once('close', () => resolve(Number(stdout.trim())));
  });
  out.cleanup = { killedPid: pid ?? null, survivingProcesses: survivors, workdir: '<TMP>' };
  await save();
}
process.stdout.write(`${JSON.stringify({ status: out.status, steps: out.steps.map(s => [s.name, s.pass]), screenshots: out.screenshots, cleanup: out.cleanup, error: out.error })}\n`);
process.exit(out.status === 'pass' ? 0 : 1);
