#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const CAPTIONS_CLI = path.join(REPO, 'packages/akari-tools/bin/captions.mjs');
const FIXTURES = path.join(REPO, 'packages/akari-tools/test/fixtures/speech-snap-owner');
const OWNER_MEDIA = process.env.AKARI_OWNER_MEDIA
  ?? path.join(os.homedir(), 'Akari/channels/my-channel/videos/2026-09-12-new-video/assets/IMG_4606のコヒ_ー.MOV');
const PORT = Number(process.env.AKARI_L1_PORT ?? 22313);
const RESULTS = path.join(ROOT, 'results.json');
const output = { status: 'running', steps: [], screenshots: [], cleanup: null };
const S = JSON.stringify;
const sanitize = value => String(value?.stack || value?.message || value)
  .replaceAll(REPO, '<WORKTREE>').replaceAll(os.homedir(), '<HOME>')
  .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"`]+/gu, '<TMP>')
  .replace(/\/Users\/[^\s)'"`]+/gu, '<HOME>');
const save = async () => { const temporary = `${RESULTS}.tmp-${process.pid}`; await writeFile(temporary, `${JSON.stringify(output, null, 2)}\n`); await rename(temporary, RESULTS); };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject); child.once('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${path.basename(command)} failed (${code}): ${stderr.slice(-1000)}`)));
});
async function step(name, operation) {
  const record = { name, pass: false }; output.steps.push(record);
  try { record.detail = await operation(); record.pass = true; await save(); return record.detail; }
  catch (error) { record.error = sanitize(error); await save(); throw error; }
}
async function waitEval(cdp, expression, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) { try { const value = await evalOn(cdp, expression); if (value) return value; } catch (error) { last = error; } await sleep(200); }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}
const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService unavailable');await window.theia.container.get(C).executeCommand(${S(id)});return 'ok'})()`;
const commandWith = (id, request) => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService unavailable');await window.theia.container.get(C).executeCommand(${S(id)},${S(request)});return 'ok'})()`;
async function click(cdp, selector) {
  // 本物のマウス入力で押す。ヒットテスト（elementFromPoint）が当該ボタンを返すまで待ってから
  // 押すことで、レイアウト確定前に別要素へ当たる取りこぼしを消す。
  const at = await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e||e.disabled)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();if(!r.width||!r.height)return null;const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&(hit===e||e.contains(hit))?{x,y}:null})()`, `${selector} hittable`);
  await realClick(cdp, at.x, at.y);
}
async function shot(cdp, number, name) {
  const file = `${String(number).padStart(2, '0')}-${name}.png`;
  await screenshot(cdp, path.join(ROOT, file)); output.screenshots.push(file); await save();
}
let previewView = null;
async function openPreview(top, editPath) {
  if (previewView) return previewView;
  await evalOn(top, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`).catch(() => undefined);
  await sleep(800);
  output.ensureVisible = await evalOn(top, `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');return String(await window.theia.container.get(C).executeCommand('akari.preview.ensureVisible',{editUri:${S(pathToFileURL(editPath).toString())}}))})()`).catch(error => sanitize(error)); await save();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const target = (await listTargets(PORT).catch(() => [])).find(item => item.type === 'iframe' && /webview\/index\.html/u.test(String(item.url)));
    if (target) {
      const view = new CDP(target.webSocketDebuggerUrl);
      const contexts = [];
      view.on('Runtime.executionContextCreated', params => contexts.push(params.context));
      await view.connect(); await view.send('Page.enable'); await view.send('Runtime.enable');
      await sleep(600);
      for (const id of [undefined, ...contexts.map(context => context.id)]) {
        try {
          if (await evalOn(view, `Boolean(document.getElementById('preview-stage'))`, id)) {
            previewView = { view, contextId: id };
            const plateDeadline = Date.now() + 90_000;
            while (Date.now() < plateDeadline) {
              if (await evalOn(view, `Boolean(document.getElementById('caption-plate'))`, id).catch(() => false)) return previewView;
              await sleep(300);
            }
            return previewView;
          }
        } catch { /* other context */ }
      }
      view.close();
    }
    await sleep(400);
  }
  throw new Error('preview webview unavailable');
}
async function previewText(top, editPath, time) {
  const { view, contextId } = await openPreview(top, editPath);
  const seeked = await evalOn(view, `(() => { const s=document.getElementById('seek'); if(!s) return 'no-seek'; s.value=String(${time}); s.dispatchEvent(new Event('input', { bubbles: true })); return Number(s.value); })()`, contextId);
  const deadline = Date.now() + 30_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalOn(view, `(() => { const p=document.getElementById('caption-plate'); if(!p) return null; return { text: [...p.querySelectorAll('.akari-caption__line')].map(e=>e.textContent).join(''), currentTime: Number(document.getElementById('seek')?.value ?? NaN) }; })()`, contextId).catch(() => null);
    if (last && Math.abs(last.currentTime - time) < 0.2) return { ...last, seeked };
    await sleep(200);
  }
  if (last) return { ...last, seeked };
  throw new Error(`preview t=${time} unavailable`);
}

const work = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-speech-snap-l1-')));
const project = path.join(work, 'project');
const profile = path.join(work, 'profile');
const captionsPath = path.join(project, 'captions.json');
const editPath = path.join(project, 'edit.json');
let child; let cdp;
try {
  await mkdir(path.join(project, 'assets'), { recursive: true }); await mkdir(profile, { recursive: true });
  await cp(OWNER_MEDIA, path.join(project, 'assets/owner.MOV'));
  const captions = JSON.parse(await readFile(path.join(FIXTURES, 'captions-owner.json'), 'utf8'));
  const silences = JSON.parse(await readFile(path.join(FIXTURES, 'silences-owner.json'), 'utf8'));
  const duration = 26.16;
  const edit = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [{ id: 'src-1', path: 'assets/owner.MOV' }], tracks: [
    { id: 'video', lane: 'visual', items: [{ id: 'owner', at: 0, duration: Math.floor(duration * 30), source: { kind: 'media', src: 'src-1', in: 0, out: duration } }] },
    { id: 'captions', lane: 'visual', content: { from: 'captions.json' } },
  ] };
  await writeFile(captionsPath, `${JSON.stringify(captions, null, 2)}\n`); await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
  const analysisDir = path.join(project, '.akari/sidecars/assets/owner.MOV.analysis'); await mkdir(analysisDir, { recursive: true });
  await writeFile(path.join(analysisDir, 'analysis.json'), `${JSON.stringify({ version: 0, source: '../../../assets/owner.MOV', probe: { duration_s: duration }, transcript: [], keyframes: [], events: [], tracks: { speakers: [], faces: [], person_matte: null }, observations: [{ kind: 'transcribe', at: '2026-09-13T00:00:00.000Z', args: { timing_snap: { silences: silences.silences } }, outputs: [], tool: 'L1 fixture' }] }, null, 2)}\n`);

  await step('1. owner 実素材の --retime --dry-run --json は moved_words >= 1', async () => {
    const before = await readFile(captionsPath, 'utf8');
    const result = await run(process.execPath, [CAPTIONS_CLI, project, '--retime', '--source', 'src-1', '--dry-run', '--json'], { cwd: project });
    const summary = JSON.parse(result.stdout.trim()); assert(summary.moved_words >= 1, `moved_words=${summary.moved_words}`);
    assert(await readFile(captionsPath, 'utf8') === before, 'dry-run changed captions.json');
    return { movedWords: summary.moved_words, totalWords: summary.total_words };
  });

  child = spawn(ELECTRON, [SHELL, project, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-sandbox'], {
    cwd: REPO, env: { ...process.env, HOME: profile, AKARI_HOME: path.join(profile, 'akari-home'), THEIA_CONFIG_DIR: path.join(profile, 'theia') }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let target; for (let attempt = 0; attempt < 600 && !target; attempt += 1) { target = await listTargets(PORT).then(items => items.find(item => item.type === 'page')).catch(() => undefined); if (!target) await sleep(300); }
  assert(target, 'CDP page target did not appear'); cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, 'Theia workbench', 180_000);
  await evalOn(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b){b.click();return 'clicked';} return 'none'; })()`).catch(() => undefined);
  // 台本ウィジェットの configure() は 1 回きりで、その時点の workspace roots が空だと空表示のまま
  // 復帰しない。ワークスペースが開き切るまで待ってから開く。
  output.workspaceRoots = await waitEval(cdp, `(async()=>{const d=window.theia.container._bindingDictionary;const K=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.tryGetRoots==='function');if(!K)return null;const ws=window.theia.container.get(K);await ws.ready;return (ws.tryGetRoots()||[]).length})()`, 'workspace roots', 180_000);
  await save();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await evalOn(cdp, command('akari.daihon.open')).catch(() => undefined);
    try { await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===8`, 'owner captions rows', 40_000); break; }
    catch (error) { output.rowProbe = await evalOn(cdp, `document.querySelectorAll('.akari-daihon-row').length`).catch(() => null); await save(); if (attempt === 2) throw error; }
  }
  await step('2. 台本ヘッダに発話合わせ直しボタンが表示される', async () => {
    const state = await waitEval(cdp, `(()=>{const b=document.querySelector('.akari-daihon-retime');return b&&!b.disabled?{label:b.textContent,disabled:b.disabled}:null})()`, 'retime button');
    assert(state.label === '⏱ 発話に合わせ直す', `label=${state.label}`); return state;
  });
  await shot(cdp, 1, 'retime-button');

  await step('3. 台本ボタン適用で owner 数値・本文・edited 行を保つ', async () => {
    const before = JSON.parse(await readFile(captionsPath, 'utf8')); const edited = before.captions.find(row => row.edited);
    await click(cdp, '.akari-daihon-retime');
    // CLI 実行 → 書き込み → footer 更新まで待ってから captions.json を読む。
    for (let i = 0; i < 60; i += 1) { await sleep(500); const f = await evalOn(cdp, `document.querySelector('.akari-daihon-footer')?.textContent ?? ''`).catch(() => ''); if (f && !f.includes('秒数や語をクリック')) break; }
    const deadline = Date.now() + 60_000; let after;
    while (Date.now() < deadline) { after = JSON.parse(await readFile(captionsPath, 'utf8')); if (after.captions.find(row => row.id === 'c-0004').words.find(word => word.text === 'いい').start >= 11.30) break; await sleep(200); }
    const c4 = after.captions.find(row => row.id === 'c-0004'); const c5 = after.captions.find(row => row.id === 'c-0005'); const editedAfter = after.captions.find(row => row.id === edited.id);
    const values = { iiStart: c4.words.find(word => word.text === 'いい').start, kanjiEnd: c4.words.find(word => word.text === '感じ').end, goStart: c5.words.find(word => word.text === 'ゴ').start };
    assert(values.iiStart >= 11.30 && values.kanjiEnd <= 12.33 && values.goStart >= 15.74, JSON.stringify(values));
    assert(JSON.stringify(after.captions.map(row => row.text)) === JSON.stringify(before.captions.map(row => row.text)), 'text changed');
    assert(editedAfter.start === edited.start && editedAfter.end === edited.end, 'edited bounds changed');
    const footer = await waitEval(cdp, `(()=>{const t=document.querySelector('.akari-daihon-footer')?.textContent??'';return t.includes('語を動かした')?t:null})()`, 'retime footer');
    return { ...values, footer };
  });
  await shot(cdp, 2, 'retime-applied');

  await step('4. プレビューは 11.3 秒より前に対象句を出さず、以後に出す', async () => {
    const before = await previewText(cdp, editPath, 11.20); const after = await previewText(cdp, editPath, 11.40);
    assert(!before.text.includes('いい感じにかけてます'), `early text=${before.text}`);
    assert(after.text.includes('いい感じにかけてます'), `late text=${after.text}`);
    return { before: before.text, after: after.text, observedAt: 11.4 };
  });
  await shot(cdp, 3, 'preview-after-11-3');
  output.status = 'pass';
} catch (error) {
  output.status = 'fail'; output.error = sanitize(error); process.exitCode = 1;
} finally {
  try { previewView?.view?.close(); } catch {}
  cdp?.close(); const pid = child?.pid;
  if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} await sleep(2500); try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {} }
  // SIGKILL 直後は helper が落ち切っていないことがある。0 になるまで数回数え直す。
  let survivors = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const ps = await run('/bin/ps', ['-eo', 'pid,args']).catch(() => ({ stdout: '' }));
    survivors = ps.stdout.split('\n').filter(line => line.includes(work)).length;
    if (survivors === 0) break;
    await sleep(1000);
  }
  output.cleanup = { killedPid: pid ?? null, survivingProcesses: survivors };
  if (survivors !== 0) { output.status = 'fail'; process.exitCode = 1; }
  await rm(work, { recursive: true, force: true }); await save();
}
process.stdout.write(`${JSON.stringify({ status: output.status, steps: output.steps.length, screenshots: output.screenshots.length, cleanup: output.cleanup })}\n`);
