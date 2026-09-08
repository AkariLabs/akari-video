#!/usr/bin/env node
// L1: 文字起こし済みの素材でも「字幕を作る」が必ずポップアップを開き、
// ステップ 1 に現状の要約と 3 つの出口（このまま字幕へ / 起こし直す / 比べる）が出ること、
// diff.json があればステップバーの「3 差分」が最初から押せること、
// 既定ボタンが Enter で押せることを実機（Electron + CDP）で観測する。
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const PROJECT = path.join(ROOT, 'fixture', 'done-material');
const RESULTS = path.join(ROOT, 'results.json');
const EVENTS = path.join(PROJECT, '.akari', 'events');
const CAPTIONS = path.join(PROJECT, 'captions.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 21987);
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [] };

const sanitize = value => String(value?.stack || value?.message || value)
  .replaceAll(REPO, '<worktree>').replace(/\/Users\/[^\s)]+/g, '<machine-path>');
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
  child.once('close', code => { closed = true; clearTimeout(timer);
    code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`)); });
});

async function step(name, operation) {
  const record = { name, pass: false };
  out.steps.push(record);
  try { record.detail = await operation(); record.pass = true; await save(); return record.detail; }
  catch (error) { record.error = sanitize(error); await save(); throw error; }
}
async function waitEval(cdp, expression, { timeoutMs = 60_000, intervalMs = 200, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await evalOn(cdp, expression); if (value) return value; }
    catch (error) { last = error; }
    await sleep(intervalMs);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}
async function clickSelector(cdp, selector) {
  const point = await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
    const r=e.getBoundingClientRect();if(!r.width||!r.height)return null;return{x:r.left+r.width/2,y:r.top+r.height/2}})()`,
    { label: `hit box for ${selector}` });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
  return point;
}
// The dialog footer/step buttons carry no ids: address them by their visible label.
const byLabel = (scope, label) => `[...document.querySelectorAll(${S(scope)}+' button')].find(b=>b.textContent===${S(label)})`;
const buttonState = (scope, label) => `(()=>{const b=${byLabel(scope, label)};return b?{label:b.textContent,disabled:b.disabled,visible:b.getBoundingClientRect().width>0}:null})()`;

// A hidden/occluded Electron window never runs rAF, so Theia's preload overlay never detaches
// and fromSurface:true only ever captures the spinner. fromSurface:false makes the renderer
// produce a frame, which also drives the rAF queue — use it both to pump and to capture.
async function pumpFrames(cdp, { timeoutMs = 120_000, label = 'frames' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }).catch(() => undefined);
    if (await evalOn(cdp, `!document.querySelector('.theia-preload')`).catch(() => false)) return true;
    await sleep(200);
  }
  throw new Error(`${label}: preload overlay never detached`);
}
async function shot(cdp, file) {
  await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }).catch(() => undefined);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false });
  await writeFile(path.join(ROOT, file), Buffer.from(data, 'base64'));
  out.screenshots.push(file);
  await save();
}
async function launch(project, port, runName) {
  const iso = path.join(ROOT, 'runs', runName);
  const log = path.join(ROOT, 'runs', `${runName}.log`);
  const launched = await run('/bin/zsh', [path.join(ROOT, 'scripts', 'launch-shell.sh'), project, String(port), iso, log], { timeoutMs: 20_000 });
  const pid = Number(launched.stdout.trim().split(/\s+/).at(-1));
  assert(Number.isInteger(pid) && pid > 0, 'Electron PID was not reported');
  let target;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline && !target) {
    try { target = (await listTargets(port)).find(item => item.type === 'page'); } catch { /* not up yet */ }
    if (!target) await sleep(300);
  }
  assert(target, 'CDP page target did not appear');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'Theia workbench', timeoutMs: 150_000 });
  return { pid, cdp };
}
async function stop(session) {
  session?.cdp?.close();
  if (session?.pid) { try { process.kill(session.pid, 'SIGTERM'); } catch { /* already gone */ } await sleep(1800); }
}
const command = id => `(async()=>{
  const d=window.theia.container._bindingDictionary;
  const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
  if(!C)throw new Error('CommandService binding unavailable');
  const r=await window.theia.container.get(C).executeCommand(${S(id)});
  return r!==null&&typeof r==='object'?'[object]':r??null;
})()`;

await mkdir(path.join(ROOT, 'runs'), { recursive: true });
await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')]);
let session;
try {
  session = await launch(PROJECT, PORT, 'main');
  await pumpFrames(session.cdp, { label: 'startup' });

  await step('1. 済みの素材でボタンの文言は「字幕を作る」のまま', async () => {
    await evalOn(session.cdp, command('akari.daihon.open'));
    const state = await waitEval(session.cdp, `(()=>{const b=document.querySelector('.akari-daihon-captions');
      const rows=document.querySelectorAll('.akari-daihon-row').length;
      return b&&!b.disabled&&rows?{label:b.textContent,disabled:b.disabled,rows}:null})()`, { label: 'daihon captions button' });
    assert(state.label === '字幕を作る', `captions button label was ${state.label}`);
    return state;
  });
  await shot(session.cdp, '01-daihon-done-material.png');

  await step('2. 済みでもクリックで必ずポップアップが開き、要約と 3 出口が出る', async () => {
    await clickSelector(session.cdp, '.akari-daihon-captions');
    const dialog = await waitEval(session.cdp, `(()=>{const n=document.querySelector('[data-akari-transcribe-dialog]');
      if(!n||n.dataset.step!=='1')return null;
      const summary=[...n.querySelectorAll('div>p')].map(p=>p.textContent).filter(t=>t.includes(' 行')||t.startsWith('比べる組'));
      const foot=[...n.querySelectorAll('button')].map(b=>b.textContent);
      return summary.length?{step:n.dataset.step,summary,foot}:null})()`, { label: 'transcribe dialog step 1' });
    const exits = await evalOn(session.cdp, `[${['このまま字幕へ', '起こし直す', '比べる'].map(label => buttonState('[data-akari-transcribe-dialog]', label)).join(',')}]`);
    assert(exits.every(Boolean), `missing exits: ${JSON.stringify(exits)}`);
    assert(exits[0].disabled === false && exits[1].disabled === false, 'reuse/redo exits were disabled');
    assert(exits[2].disabled === true, '比べる was enabled before two engines were checked');
    assert(dialog.summary.some(line => line.includes('whisper-cpp') && line.includes('行')), `summary lacked engine/line counts: ${dialog.summary}`);
    assert(dialog.summary.some(line => line.startsWith('比べる組: whisper-cpp / speech-analyzer')), `summary lacked compare set: ${dialog.summary}`);
    const isDefault = await evalOn(session.cdp, `(()=>{const b=${byLabel('[data-akari-transcribe-dialog]', 'このまま字幕へ')};
      return b?getComputedStyle(b).borderColor:null})()`);
    return { ...dialog, exits, defaultBorder: isDefault };
  });
  await shot(session.cdp, '02-popup-three-exits.png');

  await step('3. diff.json があるのでステップバー「3 差分」が最初から押せる', async () => {
    const before = await evalOn(session.cdp, buttonState('[data-akari-transcribe-dialog] nav', '3 差分'));
    assert(before && before.disabled === false, `3 差分 was ${JSON.stringify(before)}`);
    await clickSelector(session.cdp, '[data-akari-transcribe-dialog] nav button:nth-child(3)');
    const diff = await waitEval(session.cdp, `(()=>{const n=document.querySelector('[data-akari-transcribe-dialog]');
      if(!n||n.dataset.step!=='3')return null;
      const head=[...n.querySelectorAll('th')].map(th=>th.textContent);
      const rows=n.querySelectorAll('tbody tr, table tr').length;
      return head.length?{step:n.dataset.step,head,rows,lead:n.querySelector('div>p')?.textContent}:null})()`, { label: 'diff step' });
    assert(diff.head.includes('whisper-cpp') && diff.head.includes('speech-analyzer'), `diff header was ${diff.head}`);
    return { before, ...diff };
  });
  await shot(session.cdp, '03-step3-diff-direct.png');

  await step('4. ステップ 1 に戻って 2 つチェックすると「比べる」が押せる', async () => {
    await clickSelector(session.cdp, '[data-akari-transcribe-dialog] nav button:nth-child(1)');
    await waitEval(session.cdp, `document.querySelector('[data-akari-transcribe-dialog]')?.dataset.step==='1'`, { label: 'back to step 1' });
    for (const backend of ['speech-analyzer', 'whisper-cpp']) {
      await clickSelector(session.cdp, `[data-akari-transcribe-dialog] section[data-backend="${backend}"] input[type=checkbox]`);
    }
    const state = await waitEval(session.cdp, `(()=>{const v=${buttonState('[data-akari-transcribe-dialog]', '比べる')};
      return v&&v.disabled===false?v:null})()`, { label: '比べる enabled' });
    const checked = await evalOn(session.cdp, `[...document.querySelectorAll('[data-akari-transcribe-dialog] section[data-backend] input[type=checkbox]')]
      .filter(i=>i.checked).map(i=>i.closest('section').dataset.backend)`);
    return { compare: state, checked };
  });
  await shot(session.cdp, '04-compare-enabled.png');

  await step('5. 既定ボタン「このまま字幕へ」が Enter で押せ、文字起こしを走らせずに字幕を作る', async () => {
    const eventsBefore = await readdir(EVENTS).catch(() => []);
    const captionsBefore = await readFile(CAPTIONS, 'utf8');
    await evalOn(session.cdp, `(()=>{document.activeElement?.blur?.();document.body.focus();return true})()`);
    for (const type of ['keyDown', 'keyUp']) {
      await session.cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    }
    const closed = await waitEval(session.cdp, `(()=>{const n=document.querySelector('[data-akari-transcribe-dialog]');
      return n?null:{dialog:'closed',captionsButton:document.querySelector('.akari-daihon-captions')?.textContent??null}})()`,
      { label: 'dialog accepted by Enter', timeoutMs: 30_000 });
    const settled = await waitEval(session.cdp, `(()=>{const b=document.querySelector('.akari-daihon-captions');
      const f=document.querySelector('.akari-daihon-footer')?.textContent??null;
      return b&&b.textContent!=='字幕を作成中…'?{label:b.textContent,footer:f}:null})()`,
      { label: 'buildCaptions settled', timeoutMs: 120_000 });
    assert(!settled.footer?.startsWith('字幕を作れません'), `buildCaptions failed: ${settled.footer}`);
    // transcribeFirst:false の実証 — 文字起こしが走れば .akari/events に material-transcript が積まれる。
    const eventsAfter = await readdir(EVENTS).catch(() => []);
    assert(eventsAfter.length === eventsBefore.length, `transcription ran: ${eventsAfter.length - eventsBefore.length} new events`);
    const captionsAfter = await readFile(CAPTIONS, 'utf8');
    return { ...closed, ...settled, eventsBefore: eventsBefore.length, eventsAfter: eventsAfter.length,
      captionsRebuilt: captionsAfter !== captionsBefore, captionCount: JSON.parse(captionsAfter).captions?.length ?? JSON.parse(captionsAfter).length };
  });
  await shot(session.cdp, '05-after-enter-default-exit.png');
  out.status = 'pass';
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
  process.exitCode = 1;
} finally {
  await stop(session);
  out.pass = out.status === 'pass' && out.steps.length === 5 && out.steps.every(item => item.pass);
  await save();
}
