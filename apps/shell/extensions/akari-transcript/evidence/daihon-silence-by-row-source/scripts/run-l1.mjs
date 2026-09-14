#!/usr/bin/env node
// L1（CDP 3 手順）: 素材 2 本の合成プロジェクトで、行ごとに「その行の素材」の無音が使われることを実機で見る。
//  素材 1 = オーナー実プロジェクトの素材の TMP コピー（実無音 8.61–11.30 を持つ）
//  素材 2 = ffmpeg lavfi で作る 20 秒の映像 + 音声（5〜9 秒が無音。実測値は silencedetect で取る）
//  1. 素材 2 の 1 行目のチップが素材 2 の無音（実測 5.00–9.00）を示す（素材 1 の 8.61–11.30 ではない）
//  2. その行の範囲エディタの灰帯と磁石が素材 2 の無音位置
//  3. 素材 1 の行（c-0003 → c-0004）のチップは今までどおり 8.61–11.30
// Electron は detached にせず、HOME / AKARI_HOME / THEIA_CONFIG_DIR / --user-data-dir を TMP の作業領域へ向ける。
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
const VENDOR_FFMPEG = path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const OWNER_MEDIA = process.env.AKARI_OWNER_MEDIA
  ?? path.join(os.homedir(), 'Akari/channels/my-channel/videos/2026-09-12-new-video/assets/IMG_4606のコヒ_ー.MOV');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22187);
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [], cleanup: null };

// 素材 1（オーナー実素材）の既知の値 — 前票 daihon-cut-range-free の実測
const SRC1 = { row: 'c-0003', next: 'c-0004', start: 8.61, end: 11.30, span: 2.69 };
// 素材 2（合成）の字幕 2 行。行間 [4.5, 9.5] に合成した無音（5〜9 秒）が丸ごと入る
const SRC2 = { rowA: 'c-0009', rowB: 'c-0010', a: [2.0, 4.5], b: [9.5, 12.0] };
const SYNTH = { duration: 20, silenceFrom: 5, silenceTo: 9, name: 'synthetic.mp4' };

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

async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve({ stdout, stderr })
      : reject(new Error(`${path.basename(command)} exited ${code}: ${sanitize(stderr.slice(-1500))}`)));
  });
}

async function ffmpegPath() {
  if (await stat(VENDOR_FFMPEG).then(() => true).catch(() => false)) return VENDOR_FFMPEG;
  return 'ffmpeg';
}

/** 素材 2 を作る: 20 秒・440Hz のサイン波（5〜9 秒だけ無音）+ 単色映像。 */
async function makeSyntheticSource(ffmpeg, target) {
  const audio = `aevalsrc='0.5*sin(2*PI*440*t)*(lt(t,${SYNTH.silenceFrom})+gte(t,${SYNTH.silenceTo}))':d=${SYNTH.duration}:s=48000`;
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=0x1b3a6b:s=640x360:r=30:d=${SYNTH.duration}`,
    '-f', 'lavfi', '-i', audio,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', target]);
}

/** アプリと同じフィルタで素材の無音を測る（期待値をハードコードしないため）。 */
async function measureSilences(ffmpeg, target) {
  const { stderr } = await run(ffmpeg, ['-hide_banner', '-nostats', '-i', target,
    '-af', 'silencedetect=noise=-35dB:d=0.3', '-f', 'null', '-']);
  const spans = [];
  let open;
  for (const line of stderr.split('\n')) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) { open = Number(start[1]); continue; }
    const end = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (end && open !== undefined) { spans.push({ start: open, end: Number(end[1]) }); open = undefined; }
  }
  return spans;
}

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
  return evalOn(cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')].map(r=>({id:r.dataset.captionId,chip:r.querySelector('.akari-daihon-gapchip')?.textContent??null}));const e=document.querySelector('.akari-daihon-cutrange');return JSON.stringify({rows,editor:e?e.className:null})})()`).catch(error => String(error));
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

async function chipOf(cdp, rowId, { timeoutMs = 120_000 } = {}) {
  return waitEval(cdp,
    `(()=>{const c=document.querySelector('.akari-daihon-row[data-caption-id="${rowId}"] .akari-daihon-gapchip');return c?{text:c.textContent.trim(),source:c.dataset.source??null,title:c.title}:null})()`,
    { label: `${rowId} のチップ`, timeoutMs })
    .catch(async error => { throw new Error(`${sanitize(error)} | dom=${await domDump(cdp)}`); });
}

/** チップの title「実際の音声から検出 a–b」から秒を取り出す。 */
function chipRange(chip) {
  const matched = (chip.title ?? '').match(/検出\s*([\d.]+)–([\d.]+)/);
  return matched ? { start: Number(matched[1]), end: Number(matched[2]) } : null;
}

async function shot(cdp, number, label) {
  const name = `${String(number).padStart(2, '0')}-${label}.png`;
  await screenshot(cdp, path.join(ROOT, name));
  out.screenshots.push(name);
  await save();
}

const work = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-silence-by-row-l1-')));
const project = path.join(work, 'project');
const profile = path.join(work, 'profile');
const captionsPath = path.join(project, 'captions.json');
const editPath = path.join(project, 'edit.json');
const synthPath = path.join(project, 'assets', SYNTH.name);
let child; let cdp;
try {
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await mkdir(profile, { recursive: true });
  await cp(OWNER_MEDIA, path.join(project, 'assets/owner.MOV'));       // 原本は読むだけ
  const ffmpeg = await ffmpegPath();
  await makeSyntheticSource(ffmpeg, synthPath);
  const synthSilences = await measureSilences(ffmpeg, synthPath);
  const target = synthSilences.find(span => span.start < SRC2.b[0] && span.end > SRC2.a[1]);
  assert(target, `合成素材に行間 ${SRC2.a[1]}–${SRC2.b[0]} を覆う無音が無い: ${JSON.stringify(synthSilences)}`);
  const expected = {
    start: target.start, end: target.end,
    span: Math.round((target.end - target.start) * 1e6) / 1e6
  };
  out.synthetic = { ffmpeg: ffmpeg === VENDOR_FFMPEG ? '<WORKTREE>/packages/media-bin/vendor/darwin-arm64/ffmpeg' : 'ffmpeg',
    silences: synthSilences, expected };
  await save();

  const ownerCaptions = JSON.parse(await readFile(path.join(FIXTURES, 'captions-owner.json'), 'utf8'));
  const captions = {
    ...ownerCaptions,
    captions: [...ownerCaptions.captions,
      { id: SRC2.rowA, start: SRC2.a[0], end: SRC2.a[1], text: 'これは合成素材', speaker: null, sourceRef: { segment: 0 }, edited: false, src: 'src-2',
        words: [{ start: SRC2.a[0], end: 3.2, text: 'これは' }, { start: 3.3, end: SRC2.a[1], text: '合成素材' }] },
      { id: SRC2.rowB, start: SRC2.b[0], end: SRC2.b[1], text: '無音のあとの行', speaker: null, sourceRef: { segment: 1 }, edited: false, src: 'src-2',
        words: [{ start: SRC2.b[0], end: 10.7, text: '無音の' }, { start: 10.8, end: SRC2.b[1], text: 'あとの行' }] }]
  };
  const ownerDuration = 26.16;
  const edit = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [
    { id: 'src-1', path: 'assets/owner.MOV' },
    { id: 'src-2', path: `assets/${SYNTH.name}` }
  ], tracks: [
    { id: 'video', lane: 'visual', items: [
      { id: 'owner', at: 0, duration: Math.floor(ownerDuration * 30), source: { kind: 'media', src: 'src-1', in: 0, out: ownerDuration } },
      { id: 'synth', at: Math.floor(ownerDuration * 30), duration: SYNTH.duration * 30, source: { kind: 'media', src: 'src-2', in: 0, out: SYNTH.duration } }
    ] },
    { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
  ] };
  await writeFile(captionsPath, `${JSON.stringify(captions, null, 2)}\n`);
  await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
  // analysis.json は置かない。無音一覧は getClipSilences（その場で silencedetect）で素材ごとに取る経路を通す。
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
  let page;
  for (let attempt = 0; attempt < 600 && !page; attempt += 1) {
    page = await listTargets(PORT).then(items => items.find(item => item.type === 'page')).catch(() => undefined);
    if (electronExit) break;
    if (!page) await sleep(300);
  }
  assert(page, `CDP page target did not appear; electron=${JSON.stringify(electronExit)} log=${sanitize(log.join('').slice(-3000))}`);
  cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  out.rendererErrors = [];
  cdp.on('Runtime.exceptionThrown', params => {
    out.rendererErrors.push(sanitize(params?.exceptionDetails?.exception?.description ?? params?.exceptionDetails?.text ?? ''));
  });
  cdp.on('Runtime.consoleAPICalled', params => {
    if (params?.type !== 'error' && params?.type !== 'warning') return;
    out.rendererErrors.push(sanitize((params.args ?? []).map(argument => argument.value ?? argument.description ?? '').join(' ')));
  });
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'Theia workbench', timeoutMs: 180_000 });
  await evalOn(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b){b.click();return 'clicked';} return 'none'; })()`).catch(() => undefined);
  out.workspaceRoots = await waitEval(cdp, `(async()=>{const d=window.theia.container._bindingDictionary;const K=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.tryGetRoots==='function');if(!K)return null;const ws=window.theia.container.get(K);await ws.ready;return (ws.tryGetRoots()||[]).length})()`, { label: 'workspace roots', timeoutMs: 180_000 });
  await save();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await evalOn(cdp, command('akari.daihon.open')).catch(() => undefined);
    try { await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===10`, { label: '10 行（素材 1 の 8 行 + 素材 2 の 2 行）', timeoutMs: 40_000 }); break; }
    catch (error) { if (attempt === 2) throw new Error(`${sanitize(error)} | dom=${await domDump(cdp)} | log=${sanitize(log.join('').slice(-1200))}`); }
  }
  await save();

  // 1. 素材 2 の 1 行目のチップが素材 2 の無音（実測）を示す — 素材 1 の 8.61–11.30 ではない
  await step(`1. 素材 2 の行のチップが素材 2 の無音 ${expected.span.toFixed(2)} 秒（${expected.start.toFixed(2)}–${expected.end.toFixed(2)}）を示す`, async () => {
    const chip = await waitEval(cdp,
      `(()=>{const c=document.querySelector('.akari-daihon-row[data-caption-id="${SRC2.rowA}"] .akari-daihon-gapchip');return c&&c.dataset.source==='silence'?{text:c.textContent.trim(),source:c.dataset.source,title:c.title}:null})()`,
      { label: '素材 2 のチップ', timeoutMs: 180_000 })
      .catch(async error => { throw new Error(`${sanitize(error)} | dom=${await domDump(cdp)}`); });
    const range = chipRange(chip);
    assert(range, `チップの title から無音の範囲を読めない: ${JSON.stringify(chip)}`);
    assert(Math.abs(range.start - expected.start) < 0.02 && Math.abs(range.end - expected.end) < 0.02,
      `チップが ${JSON.stringify(range)}（素材 2 の ${expected.start}–${expected.end} のはず）: ${JSON.stringify(chip)}`);
    assert(!(Math.abs(range.start - SRC1.start) < 0.02 && Math.abs(range.end - SRC1.end) < 0.02),
      `素材 1 の無音（${SRC1.start}–${SRC1.end}）を拾っている: ${JSON.stringify(chip)}`);
    assert(chip.text.includes(expected.span.toFixed(2)), `チップの表示が ${chip.text}`);
    assert(!chip.text.includes(SRC1.span.toFixed(2)), `チップが素材 1 の ${SRC1.span} 秒を表示している: ${chip.text}`);
    const sidecar = path.join(project, `.akari/sidecars/assets/${SYNTH.name}.analysis/silences.json`);
    const cached = await readFile(sidecar, 'utf8').then(JSON.parse).catch(() => null);
    await shot(cdp, 1, 'row-source-2-chip');
    return { chip, range, expected, sidecarFilter: cached?.filter ?? null, sidecarSilences: cached?.silences ?? null };
  });

  // 2. その行の範囲エディタ — 灰帯と磁石が素材 2 の無音位置
  await step('2. 素材 2 の行の範囲エディタで灰帯と磁石が素材 2 の無音位置に出る', async () => {
    await evalOn(cdp, `window.__akariDaihonCutRangeMetrics=undefined`);
    await clickSelector(cdp, `.akari-daihon-row[data-caption-id="${SRC2.rowA}"] .akari-daihon-gapchip`);
    await waitEval(cdp, `Boolean(document.querySelector('.akari-daihon-cutrange canvas'))`, { label: '範囲エディタ' })
      .catch(async error => {
        const dom = await evalOn(cdp, `(()=>{const e=document.querySelector('.akari-daihon-cutrange');return JSON.stringify({editor:e?e.outerHTML.slice(0,400):null,notifications:[...document.querySelectorAll('.theia-notification-message,.akari-daihon-notice')].map(n=>n.textContent).slice(0,4)})})()`).catch(String);
        throw new Error(`${sanitize(error)} | dom=${dom} | renderer=${JSON.stringify((out.rendererErrors ?? []).slice(-4))}`);
      });
    const metrics = await waitEval(cdp, `(()=>{const m=window.__akariDaihonCutRangeMetrics;return m&&m.window?m:null})()`, { label: '計測' });
    const geometry = await evalOn(cdp, `(()=>{const e=document.querySelector('.akari-daihon-cutrange');return{heading:e.querySelector('.h span')?.textContent??'',sils:[...e.querySelectorAll('.sil')].map(n=>n.title),read:e.querySelector('.read')?.textContent??''}})()`);
    assert(metrics.silences?.some(span => Math.abs(span.start - expected.start) < 0.02 && Math.abs(span.end - expected.end) < 0.02),
      `素材 2 の無音が計測に出ていない: ${JSON.stringify(metrics.silences)}`);
    assert(!metrics.silences?.some(span => Math.abs(span.start - SRC1.start) < 0.02 && Math.abs(span.end - SRC1.end) < 0.02),
      `素材 1 の無音が混ざっている: ${JSON.stringify(metrics.silences)}`);
    assert(geometry.sils.some(title => title.includes(expected.start.toFixed(2)) && title.includes(expected.end.toFixed(2))),
      `灰帯が素材 2 の無音位置に出ていない: ${JSON.stringify(geometry.sils)}`);
    assert(metrics.magnets?.some(magnet => Math.abs(magnet.seconds - expected.start) < 0.02 && magnet.kind === 'silence')
      && metrics.magnets?.some(magnet => Math.abs(magnet.seconds - expected.end) < 0.02 && magnet.kind === 'silence'),
      `磁石が素材 2 の無音の縁に無い: ${JSON.stringify(metrics.magnets?.filter(magnet => magnet.kind === 'silence'))}`);
    assert(geometry.heading.includes(expected.span.toFixed(2)), `見出しが ${geometry.heading}`);
    await rect(cdp, '.akari-daihon-cutrange .wave');  // 波形ごと画面内へ送ってから撮る
    await shot(cdp, 2, 'range-editor-source-2-silence');
    return { heading: geometry.heading, sils: geometry.sils, read: geometry.read,
      window: metrics.window, selection: metrics.selection, silences: metrics.silences,
      silenceMagnets: metrics.magnets?.filter(magnet => magnet.kind === 'silence') ?? [] };
  });

  // 3. 素材 1 の行（c-0003 → c-0004）のチップは今までどおり 8.61–11.30
  await step(`3. 素材 1 の行（${SRC1.row} → ${SRC1.next}）のチップは従来どおり ${SRC1.span} 秒（${SRC1.start}–${SRC1.end}）`, async () => {
    const chip = await chipOf(cdp, SRC1.row);
    await rect(cdp, `.akari-daihon-row[data-caption-id="${SRC1.row}"] .akari-daihon-gapchip`);  // 画面内へ送る
    assert(chip && chip.source === 'silence', `素材 1 のチップが出ていない: ${JSON.stringify(chip)}`);
    const range = chipRange(chip);
    assert(range && Math.abs(range.start - SRC1.start) < 0.011 && Math.abs(range.end - SRC1.end) < 0.011,
      `素材 1 のチップが ${JSON.stringify(range)}（${SRC1.start}–${SRC1.end} のはず）: ${JSON.stringify(chip)}`);
    assert(chip.text.includes(SRC1.span.toFixed(2)), `素材 1 のチップの表示が ${chip.text}`);
    const ownerSidecar = path.join(project, '.akari/sidecars/assets/owner.MOV.analysis/silences.json');
    const cached = await readFile(ownerSidecar, 'utf8').then(JSON.parse).catch(() => null);
    await shot(cdp, 3, 'row-source-1-chip-unchanged');
    return { chip, range, sidecarFilter: cached?.filter ?? null,
      sidecarHasOwnerSilence: Boolean(cached?.silences?.some(pair => Math.abs(pair[0] - SRC1.start) < 0.011)) };
  });

  out.chips = await evalOn(cdp, `(()=>[...document.querySelectorAll('.akari-daihon-row')].map(r=>({id:r.dataset.captionId,chip:r.querySelector('.akari-daihon-gapchip')?.textContent?.trim()??null,source:r.querySelector('.akari-daihon-gapchip')?.dataset.source??null})))()`);
  out.untouched = {
    captions: (await readFile(captionsPath, 'utf8')) === originalCaptions,
    edit: (await readFile(editPath, 'utf8')) === originalEdit
  };
  assert(out.untouched.captions && out.untouched.edit, `見ただけでファイルが変わった: ${JSON.stringify(out.untouched)}`);
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
