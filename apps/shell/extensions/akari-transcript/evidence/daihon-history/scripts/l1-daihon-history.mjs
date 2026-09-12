#!/usr/bin/env node
// L1（CDP・4 手順）: 操作 3 回、履歴 3 件、2 件目へ復元、両ファイル一致、復元履歴追加。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, click, evaluate, screenshot, targets } from './cdp-lib.mjs';

const EVIDENCE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(EVIDENCE, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PROJECT = path.join(EVIDENCE, 'fixture', 'project');
const EDIT = path.join(PROJECT, 'edit.json');
const CAPTIONS = path.join(PROJECT, 'captions.json');
const RUN = path.join(EVIDENCE, 'runs', `l1-${process.pid}`);
const RESULTS = path.join(EVIDENCE, 'results.json');
const LOG = path.join(RUN, 'electron.log');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22173);
const result = { status: 'running', steps: [], screenshots: [], hashes: {}, cleanup: null };
const S = JSON.stringify;
const DAIHON_OPEN_COMMAND = `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');return window.theia.container.get(C).executeCommand('akari.daihon.open')})()`;
const sha = value => createHash('sha256').update(value).digest('hex');
const hashes = async () => ({ edit: sha(await readFile(EDIT)), captions: sha(await readFile(CAPTIONS)) });
const diskHistoryCount = async () => {
  try { return (await readdir(path.join(PROJECT, '.akari', 'history'), { withFileTypes: true })).filter(entry => entry.isDirectory()).length; }
  catch { return 0; }
};
const sanitize = value => String(value?.stack ?? value).replaceAll(REPO, '<WORKTREE>')
  .replaceAll(process.env.HOME ?? '__NO_HOME__', '<HOME>')
  .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"\]]+/gu, '<TMP>')
  .replace(/\/Users\/[^\s)'"\]]+/gu, '<HOME>');
const save = async () => {
  const temporary = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temporary, `${sanitize(JSON.stringify(result, null, 2))}\n`); await rename(temporary, RESULTS);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function waitFor(operation, label, timeout = 60_000) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    try { const value = await operation(); if (value) return value; } catch (error) { last = error; }
    await sleep(180);
  }
  throw new Error(`${label} timeout${last ? `: ${sanitize(last)}` : ''}`);
}
async function step(name, operation) {
  const row = { name, pass: false }; result.steps.push(row);
  try { row.detail = await operation(); row.pass = true; await save(); return row.detail; }
  catch (error) { row.error = sanitize(error); await save(); throw error; }
}
async function ensureDaihonVisible(cdp) {
  const probe = `(()=>{const e=document.querySelector('.akari-daihon-row[data-caption-id="c-0001"]');if(!e)return null;const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{width:r.width,height:r.height}:null})()`;
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    const visible = await evaluate(cdp, probe).catch(() => null);
    if (visible) return visible;
    await evaluate(cdp, DAIHON_OPEN_COMMAND).catch(() => {});
    await sleep(600);
  }
  throw new Error('台本パネルが見えない');
}
async function point(cdp, selector, index = 0) {
  return waitFor(() => evaluate(cdp, `(()=>{const e=document.querySelectorAll(${S(selector)})[${index}];if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`), selector);
}
async function clickSelector(cdp, selector, index = 0) {
  await ensureDaihonVisible(cdp);
  const p = await point(cdp, selector, index); await click(cdp, p.x, p.y);
}
async function openDisplay(cdp) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await ensureDaihonVisible(cdp);
      await evaluate(cdp, `document.querySelectorAll('.akari-daihon-pop').forEach(node=>node.remove())`);
      await clickSelector(cdp, '.akari-daihon-display');
      await waitFor(() => evaluate(cdp, `Boolean(document.querySelector('.akari-daihon-pop input[type="range"]'))`), `display pop attempt ${attempt}`, 10_000);
      return;
    } catch (error) {
      last = error;
      await evaluate(cdp, `document.querySelectorAll('.akari-daihon-pop').forEach(node=>node.remove())`).catch(() => {});
    }
  }
  throw new Error(`display pop failed after 3 attempts: ${sanitize(last)}`);
}
async function clickPopButton(cdp, label, reopen) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await ensureDaihonVisible(cdp);
      if (attempt > 1) {
        await evaluate(cdp, `document.querySelectorAll('.akari-daihon-pop').forEach(node=>node.remove())`);
        await reopen();
      }
      const p = await waitFor(() => evaluate(cdp, `(()=>{const buttons=[...document.querySelectorAll('.akari-daihon-pop button')].filter(e=>!e.disabled);const b=buttons.find(e=>e.textContent.trim()===${S(label)})||buttons.find(e=>e.textContent.includes(${S(label)}));if(!b)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`), `pop button ${label} attempt ${attempt}`, 10_000);
      await click(cdp, p.x, p.y);
      return;
    } catch (error) {
      last = error;
      await evaluate(cdp, `document.querySelectorAll('.akari-daihon-pop').forEach(node=>node.remove())`).catch(() => {});
    }
  }
  throw new Error(`pop button ${label} failed after 3 attempts: ${sanitize(last)}`);
}
async function historyCount(cdp, count) {
  await ensureDaihonVisible(cdp);
  return waitFor(() => evaluate(cdp, `document.querySelectorAll('.akari-daihon-historyrow').length===${count}`), `history ${count}`);
}

let electron;
let cdp;
try {
  const akariHome = path.join(RUN, 'akari-home');
  const userData = path.join(RUN, 'user-data');
  const theiaConfig = path.join(RUN, 'theia-config');
  await Promise.all([akariHome, userData, theiaConfig].map(directory => mkdir(directory, { recursive: true })));
  const fixture = spawn(process.execPath, [path.join(EVIDENCE, 'scripts', 'gen-fixture.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
  const fixtureCode = await new Promise((resolve, reject) => { fixture.once('error', reject); fixture.once('close', resolve); });
  assert(fixtureCode === 0, `fixture exited ${fixtureCode}`);
  const logFd = openSync(LOG, 'w');
  try {
    electron = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--no-sandbox'], {
      cwd: REPO, detached: false, env: { ...process.env, AKARI_HOME: akariHome, THEIA_CONFIG_DIR: theiaConfig }, stdio: ['ignore', logFd, logFd]
    });
  } finally {
    closeSync(logFd);
  }
  const target = await waitFor(async () => (await targets(PORT)).find(item => item.type === 'page' && item.webSocketDebuggerUrl), 'Electron CDP', 120_000);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await ensureDaihonVisible(cdp);
  await step('three-operations-create-three-entries', async () => {
    await openDisplay(cdp);
    await evaluate(cdp, `(()=>{const input=document.querySelector('.akari-daihon-pop input[type="range"]');input.value='12';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return input.value})()`);
    await waitFor(async () => JSON.parse(await readFile(CAPTIONS, 'utf8')).display_policy.max_line_units === 12, 'max line units write', 120_000);
    await waitFor(async () => await diskHistoryCount() === 1, 'first history snapshot');
    result.hashes.operation1 = await hashes();

    const beforePause = result.hashes.operation1.edit;
    await clickSelector(cdp, '.akari-daihon-wgap');
    await clickPopButton(cdp, '⏸ 間 0.5 秒', () => clickSelector(cdp, '.akari-daihon-wgap'));
    await waitFor(async () => sha(await readFile(EDIT)) !== beforePause, 'pause edit write', 120_000);
    await waitFor(async () => await diskHistoryCount() === 2, 'second history snapshot');
    result.hashes.operation2 = await hashes();

    await openDisplay(cdp);
    await clickPopButton(cdp, '2', () => openDisplay(cdp));
    await waitFor(async () => JSON.parse(await readFile(CAPTIONS, 'utf8')).display_policy.lines === 2, 'display lines write', 120_000);
    await waitFor(async () => await diskHistoryCount() === 3, 'third history snapshot');
    result.hashes.operation3 = await hashes();
    return { hashes: result.hashes };
  });
  await step('history-has-three-entries', async () => {
    await clickSelector(cdp, '.akari-daihon-history'); await historyCount(cdp, 3);
    const labels = await evaluate(cdp, `[...document.querySelectorAll('.akari-daihon-historylabel')].map(e=>e.textContent)`);
    assert(labels.length === 3, 'history entries are not three');
    const fileChips = await evaluate(cdp, `[...document.querySelectorAll('.akari-daihon-historyrow')].map(r=>[...r.querySelectorAll('.akari-daihon-historychip')].map(e=>e.textContent))`);
    assert(fileChips.every(files => files.includes('edit.json') && files.includes('captions.json')), 'both file chips are required');
    await screenshot(cdp, path.join(EVIDENCE, '01-history-three-entries.png')); result.screenshots.push('01-history-three-entries.png');
    return { count: labels.length, labels, fileChips };
  });
  await step('restore-second-entry', async () => {
    await screenshot(cdp, path.join(EVIDENCE, '02-before-restore-second.png')); result.screenshots.push('02-before-restore-second.png');
    await clickSelector(cdp, '.akari-daihon-historyrow .akari-daihon-historyrestore', 1);
    await waitFor(async () => { const current = await hashes(); return current.edit === result.hashes.operation2.edit && current.captions === result.hashes.operation2.captions; }, 'both files restored');
    result.hashes.restored = await hashes();
    assert(JSON.stringify(result.hashes.restored) === JSON.stringify(result.hashes.operation2), 'restored bytes differ from operation 2');
    return { byteEqual: true };
  });
  await step('restore-is-fourth-history-entry', async () => {
    await historyCount(cdp, 4);
    const labels = await evaluate(cdp, `[...document.querySelectorAll('.akari-daihon-historylabel')].map(e=>e.textContent)`);
    assert(labels[0] === '戻した', `newest label is ${labels[0]}`);
    await screenshot(cdp, path.join(EVIDENCE, '03-restored-entry-added.png')); result.screenshots.push('03-restored-entry-added.png');
    return { count: labels.length, newest: labels[0] };
  });
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL'; result.error = sanitize(error);
} finally {
  cdp?.close();
  if (electron?.pid) {
    electron.kill('SIGTERM');
    await Promise.race([new Promise(resolve => electron.once('close', resolve)), sleep(3000)]);
    if (electron.exitCode === null) electron.kill('SIGKILL');
    result.cleanup = { killedPid: electron.pid };
  }
  const rawLog = await readFile(LOG, 'utf8').catch(() => '');
  if (rawLog) await writeFile(LOG, sanitize(rawLog));
  await save();
}
if (result.status !== 'PASS') process.exitCode = 1;
